import { normalizeStudentName } from './trombiService';
import { auth } from '../lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { apiEnseignant, enseignantConnecte } from './api';

const DB_NAME = 'ClassroomSeatingPhotoLibrary';
const DB_VERSION = 1;
const STORE_NAME = 'photos';

export interface StoredPhotoRecord {
  key: string; // normalized student name
  name: string;
  photoUrl: string; // WebP or JPEG data URL
  className?: string;
  updatedAt: number;
}

// In-memory cache for ultra-fast, zero-delay rendering in React components
const photoCache = new Map<string, string>();
let isDbReady = false;
let dbPromise: Promise<IDBDatabase | null> | null = null;
const listeners = new Set<() => void>();

/**
 * Notifies all subscribers (React components) that a photo changed
 */
export const notifyListeners = () => {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.warn('Photo listener error:', e);
    }
  });
};

/**
 * Synchronizes and pre-caches photos from all local storage repositories
 * (class_rosters_v2, classroom_student_rosters, published plans, etc.)
 */
export const syncPhotosFromLocalStorage = () => {
  if (typeof window === 'undefined') return;
  try {
    let countAdded = 0;

    const cacheStudentPhoto = (name: string, photoUrl: string) => {
      if (!name || !photoUrl || typeof photoUrl !== 'string' || !photoUrl.trim()) return;
      const key = normalizeStudentName(name);
      if (!key) return;
      photoCache.set(key, photoUrl);
      const cleanTokens = name.trim().toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
      if (cleanTokens.length >= 2) {
        photoCache.set(cleanTokens.slice().sort().join(' '), photoUrl);
      }
      countAdded++;
    };

    // 1. Sync from class_rosters_v2 (Teacher Class Manager primary store)
    const rawRosters = localStorage.getItem('class_rosters_v2');
    if (rawRosters) {
      try {
        const rosters: Record<string, any[]> = JSON.parse(rawRosters);
        Object.values(rosters).forEach((students) => {
          if (Array.isArray(students)) {
            students.forEach((st) => {
              if (st && st.name && st.photoUrl) {
                cacheStudentPhoto(st.name, st.photoUrl);
              }
            });
          }
        });
      } catch (e) {
        console.warn('Error reading class_rosters_v2 in photo sync:', e);
      }
    }

    // 2. Sync from classroom_student_rosters
    const rawOldRosters = localStorage.getItem('classroom_student_rosters');
    if (rawOldRosters) {
      try {
        const oldRosters: Record<string, any[]> = JSON.parse(rawOldRosters);
        Object.values(oldRosters).forEach((students) => {
          if (Array.isArray(students)) {
            students.forEach((st) => {
              if (st && st.name && st.photoUrl) {
                cacheStudentPhoto(st.name, st.photoUrl);
              }
            });
          }
        });
      } catch (e) {
        console.warn('Error reading classroom_student_rosters in photo sync:', e);
      }
    }

    // 3. Sync from plan_de_classe_published_plans_v3
    const rawPlans = localStorage.getItem('plan_de_classe_published_plans_v3');
    if (rawPlans) {
      try {
        const plans: any[] = JSON.parse(rawPlans);
        if (Array.isArray(plans)) {
          plans.forEach((p) => {
            if (p && Array.isArray(p.placements)) {
              p.placements.forEach((pl: any) => {
                if (pl && pl.name && pl.photoUrl) {
                  cacheStudentPhoto(pl.name, pl.photoUrl);
                }
              });
            }
          });
        }
      } catch (e) {
        console.warn('Error reading published plans in photo sync:', e);
      }
    }

    if (countAdded > 0) {
      notifyListeners();
    }
  } catch (err) {
    console.warn('Photo localStorage sync failed:', err);
  }
};

// Immediate sync on load
if (typeof window !== 'undefined') {
  syncPhotosFromLocalStorage();
}

/**
 * Subscribe to photo library updates
 */
export const subscribeToPhotoLibrary = (callback: () => void): (() => void) => {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
};

/**
 * Opens or initializes the IndexedDB database
 */
const getDb = async (): Promise<IDBDatabase | null> => {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return null;
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        isDbReady = true;
        // Preload all photos into in-memory cache
        preloadCacheFromDb(db).then(() => {
          resolve(db);
        });
      };

      request.onerror = (err) => {
        console.warn('IndexedDB photo store unavailable, using in-memory cache:', err);
        resolve(null);
      };
    } catch (err) {
      console.warn('IndexedDB initialization failed:', err);
      resolve(null);
    }
  });

  return dbPromise;
};

/**
 * Preloads all photos from IndexedDB into memory
 */
const preloadCacheFromDb = async (db: IDBDatabase): Promise<void> => {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => {
        const records: StoredPhotoRecord[] = req.result || [];
        records.forEach((rec) => {
          if (rec.key && rec.photoUrl) {
            photoCache.set(rec.key, rec.photoUrl);
          }
        });
        notifyListeners();
        resolve();
      };

      req.onerror = () => {
        resolve();
      };
    } catch {
      resolve();
    }
  });
};

// Auto-initialize DB and cloud photo sync on module load
if (typeof window !== 'undefined') {
  getDb();
}

let cloudPhotosUnsubscribe: (() => void) | null = null;

/**
 * Photos de l'enseignant connecté, gardées sur le serveur (relues toutes les minutes).
 * Les élèves et les parents reçoivent les photos de leur classe avec le plan, après connexion.
 */
export const subscribeToCloudPhotos = (): (() => void) => {
  if (typeof window === 'undefined') return () => {};
  if (cloudPhotosUnsubscribe) return cloudPhotosUnsubscribe;
  const lire = async () => {
    if (!enseignantConnecte()) return;
    try {
      const photos = await apiEnseignant<Array<{ key: string; name: string; photoUrl: string }>>('GET', '/api/photos');
      photos.forEach((data) => {
        if (data && data.key && data.photoUrl && typeof data.photoUrl === 'string') {
          photoCache.set(data.key, data.photoUrl);
          const cleanTokens = (data.name || data.key).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
          if (cleanTokens.length >= 2) {
            photoCache.set(cleanTokens.slice().sort().join(' '), data.photoUrl);
          }
        }
      });
      if (photos.length) notifyListeners();
    } catch (err) {
      console.warn('Cloud photos fallback:', err);
    }
  };
  const stopAuth = onAuthStateChanged(auth, (u) => { if (u) lire(); });
  const id = setInterval(lire, 60000);
  cloudPhotosUnsubscribe = () => { stopAuth(); clearInterval(id); cloudPhotosUnsubscribe = null; };
  return cloudPhotosUnsubscribe;
};

// Start cloud photo sync immediately in browser
if (typeof window !== 'undefined') {
  subscribeToCloudPhotos();
}

/**
 * Compresses an image File or Data URL to a lightweight, crisp WebP (or JPEG fallback)
 * Quality ~0.82 with thumbnail bounded sizing (max 120x150) ~ 3-5 KB per photo.
 * This keeps real photography quality while being ultra-light for database and rendering.
 */
export const compressImageToWebP = async (
  input: File | Blob | string,
  maxWidth: number = 120,
  maxHeight: number = 150,
  quality: number = 0.82
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let objectUrlToRevoke: string | null = null;

    img.onload = () => {
      if (objectUrlToRevoke) URL.revokeObjectURL(objectUrlToRevoke);

      const srcW = img.naturalWidth || img.width;
      const srcH = img.naturalHeight || img.height;

      // Calculate aspect-ratio preserving dimensions
      let targetW = srcW;
      let targetH = srcH;

      if (targetW > maxWidth || targetH > maxHeight) {
        const ratio = Math.min(maxWidth / targetW, maxHeight / targetH);
        targetW = Math.round(targetW * ratio);
        targetH = Math.round(targetH * ratio);
      }

      // Minimum bounds for crispness
      targetW = Math.max(targetW, 16);
      targetH = Math.max(targetH, 16);

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        if (typeof input === 'string') resolve(input);
        else reject(new Error('Canvas context error'));
        return;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, targetW, targetH);

      // Try WebP first, fallback to JPEG
      try {
        const webpUrl = canvas.toDataURL('image/webp', quality);
        if (webpUrl && webpUrl.startsWith('data:image/webp')) {
          resolve(webpUrl);
          return;
        }
      } catch {
        // Ignore and fallback
      }

      const jpegUrl = canvas.toDataURL('image/jpeg', quality);
      resolve(jpegUrl);
    };

    img.onerror = (err) => {
      if (objectUrlToRevoke) URL.revokeObjectURL(objectUrlToRevoke);
      if (typeof input === 'string' && input.startsWith('data:')) {
        resolve(input);
      } else {
        reject(err);
      }
    };

    if (typeof input === 'string') {
      img.src = input;
    } else {
      objectUrlToRevoke = URL.createObjectURL(input);
      img.src = objectUrlToRevoke;
    }
  });
};

/**
 * Creates a clean, raster WebP avatar without SVG format
 */
export const createWebpAvatar = (
  name: string,
  gender: string = 'm',
  hairColor: string = '#333',
  isPlaceholder: boolean = false
): string => {
  const canvas = document.createElement('canvas');
  canvas.width = 180;
  canvas.height = 220;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  if (isPlaceholder) {
    // Neutral placeholder
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(0, 0, 180, 220);

    ctx.fillStyle = '#94a3b8';
    // Head circle
    ctx.beginPath();
    ctx.arc(90, 85, 36, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.beginPath();
    ctx.arc(90, 240, 100, Math.PI * 1.15, Math.PI * 1.85);
    ctx.fill();

    // Question mark
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 46px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', 90, 88);
  } else {
    // Colored crisp background
    const bgColors = ['#e0e7ff', '#fce7f3', '#fef3c7', '#dcfce7', '#e0f2fe', '#f3e8ff'];
    const charSum = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const bg = bgColors[Math.abs(charSum) % bgColors.length];

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 180, 220);

    // Shoulders / Shirt
    ctx.fillStyle = gender === 'f' ? '#4f46e5' : '#0284c7';
    ctx.beginPath();
    ctx.ellipse(90, 215, 75, 55, 0, 0, Math.PI * 2);
    ctx.fill();

    // Neck
    ctx.fillStyle = '#fed7aa';
    ctx.fillRect(78, 120, 24, 25);

    // Head
    ctx.fillStyle = '#fed7aa';
    ctx.beginPath();
    ctx.arc(90, 82, 38, 0, Math.PI * 2);
    ctx.fill();

    // Hair
    ctx.fillStyle = hairColor;
    if (gender === 'f') {
      // Long hair
      ctx.beginPath();
      ctx.arc(90, 80, 42, Math.PI * 0.8, Math.PI * 2.2);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(48, 80, 20, 60, 10);
      ctx.roundRect(112, 80, 20, 60, 10);
      ctx.fill();
    } else {
      // Short hair
      ctx.beginPath();
      ctx.arc(90, 72, 42, Math.PI * 0.9, Math.PI * 2.1);
      ctx.fill();
    }

    // Eyes
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(77, 85, 4, 0, Math.PI * 2);
    ctx.arc(103, 85, 4, 0, Math.PI * 2);
    ctx.fill();

    // Smile
    ctx.strokeStyle = '#ea580c';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(90, 95, 10, 0.2, Math.PI - 0.2);
    ctx.stroke();

    // Initials badge at bottom
    const initials = name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('');

    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.beginPath();
    ctx.roundRect(60, 178, 60, 26, 13);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials, 90, 191);
  }

  try {
    const webp = canvas.toDataURL('image/webp', 0.90);
    if (webp && webp.startsWith('data:image/webp')) return webp;
  } catch {
    // fallback
  }
  return canvas.toDataURL('image/jpeg', 0.90);
};

/**
 * Stores a student photo in the central library (IndexedDB + memory cache).
 * Automatically compresses to lightweight WebP/JPG.
 */
export const saveStudentPhoto = async (
  name: string,
  rawPhoto: File | Blob | string,
  className?: string
): Promise<string> => {
  const key = normalizeStudentName(name);
  if (!key) throw new Error('Nom d\'élève invalide');

  const compressedWebp = await compressImageToWebP(rawPhoto, 260, 320, 0.88);

  // Update in-memory cache immediately (direct key + token sorted key)
  photoCache.set(key, compressedWebp);
  const cleanTokens = name.trim().toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (cleanTokens.length >= 2) {
    photoCache.set(cleanTokens.slice().sort().join(' '), compressedWebp);
  }
  notifyListeners();

  // Persist to IndexedDB
  try {
    const db = await getDb();
    if (db) {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({
        key,
        name: name.trim(),
        photoUrl: compressedWebp,
        className,
        updatedAt: Date.now(),
      });
    }
  } catch (err) {
    console.warn('Failed to save photo to IndexedDB:', err);
  }

  // Persist on the server (teacher only) so the teacher's other browsers and the class plan have it
  try {
    if (enseignantConnecte()) await apiEnseignant('PUT', '/api/photos', [{ name: name.trim(), photoUrl: compressedWebp, className: className || '' }]);
  } catch (err) {
    console.warn('Failed to save photo to Cloud Firestore:', err);
  }

  return compressedWebp;
};

/**
 * Resolves a student's photo from the central library or in-memory cache.
 * Uses multiple matching strategies (normalized key, token-sorted key, reversed name tokens, fuzzy tokens, fallback, and live localStorage lookup).
 */
export const getStudentPhoto = (
  name: string | undefined | null,
  fallbackUrl?: string
): string | undefined => {
  const cleanName = name ? name.trim() : '';
  const key = cleanName ? normalizeStudentName(cleanName) : '';

  // 1. Direct normalized key lookup
  if (key && photoCache.has(key)) {
    const direct = photoCache.get(key);
    if (direct && direct.trim()) return direct;
  }

  // 2. Token-sorted lookup (e.g. "Dupont Jean" and "Jean Dupont" both map to "dupont jean")
  if (cleanName) {
    const tokens = cleanName.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) {
      const sortedKey = tokens.slice().sort().join(' ');
      if (photoCache.has(sortedKey)) {
        const sortedMatch = photoCache.get(sortedKey);
        if (sortedMatch && sortedMatch.trim()) return sortedMatch;
      }

      // 3. Reversed tokens lookup
      const reversedKey = tokens.slice().reverse().join(' ');
      if (photoCache.has(reversedKey)) {
        const rev = photoCache.get(reversedKey);
        if (rev && rev.trim()) return rev;
      }

      // 4. Scan cache for any record containing all name tokens
      for (const [cachedKey, cachedUrl] of photoCache.entries()) {
        if (!cachedUrl) continue;
        const cachedTokens = cachedKey.split(' ');
        const allTokensMatch = tokens.every(t => cachedTokens.includes(t)) || cachedTokens.every(t => tokens.includes(t));
        if (allTokensMatch) {
          return cachedUrl;
        }
      }
    }
  }

  // 5. Fallback URL passed from placement / student object
  if (fallbackUrl && typeof fallbackUrl === 'string' && fallbackUrl.trim()) {
    if (key) {
      photoCache.set(key, fallbackUrl);
      const tokens = cleanName.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
      if (tokens.length >= 2) {
        photoCache.set(tokens.slice().sort().join(' '), fallbackUrl);
      }
    }
    return fallbackUrl;
  }

  // 6. Dynamic fallback: Scan class_rosters_v2 in localStorage
  if (typeof window !== 'undefined' && key) {
    try {
      const rawRosters = localStorage.getItem('class_rosters_v2');
      if (rawRosters) {
        const rosters: Record<string, any[]> = JSON.parse(rawRosters);
        const tokens = cleanName.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
        for (const students of Object.values(rosters)) {
          if (Array.isArray(students)) {
            const matchedStudent = students.find((st) => {
              if (!st || !st.name) return false;
              const stKey = normalizeStudentName(st.name);
              if (stKey === key) return true;
              const stTokens = st.name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
              return tokens.length >= 2 && stTokens.length >= 2 &&
                (tokens.every(t => stTokens.includes(t)) || stTokens.every(t => tokens.includes(t)));
            });

            if (matchedStudent && matchedStudent.photoUrl && typeof matchedStudent.photoUrl === 'string') {
              photoCache.set(key, matchedStudent.photoUrl);
              return matchedStudent.photoUrl;
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return undefined;
};

/**
 * Checks if a student has an assigned photo in the library
 */
export const hasStudentPhoto = (name: string): boolean => {
  const key = normalizeStudentName(name);
  if (!key) return false;
  return photoCache.has(key);
};

/**
 * Deletes a student photo from the library (IndexedDB + memory cache)
 */
export const deleteStudentPhoto = async (name: string): Promise<void> => {
  const key = normalizeStudentName(name);
  if (!key) return;

  photoCache.delete(key);
  notifyListeners();

  try {
    const db = await getDb();
    if (db) {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(key);
    }
  } catch (err) {
    console.warn('Failed to delete photo from IndexedDB:', err);
  }

  // Delete on the server (teacher only)
  try {
    if (enseignantConnecte()) await apiEnseignant('DELETE', `/api/photos/${encodeURIComponent(key)}`);
  } catch (err) {
    console.warn('Failed to delete photo from Cloud Firestore:', err);
  }
};

/**
 * Bulk registers photos into the library (e.g. from trombinoscope extraction or sample class)
 */
export const registerPhotosBatch = async (
  entries: Array<{ name: string; photoUrl: string; className?: string }>
): Promise<void> => {
  const compressedEntries: Array<{ key: string; name: string; photoUrl: string; className?: string }> = [];

  for (const item of entries) {
    const key = normalizeStudentName(item.name);
    if (!key || !item.photoUrl) continue;

    let finalUrl = item.photoUrl;
    // Compress if not already compressed webp
    if (!item.photoUrl.startsWith('data:image/webp')) {
      try {
        finalUrl = await compressImageToWebP(item.photoUrl, 260, 320, 0.86);
      } catch {
        finalUrl = item.photoUrl;
      }
    }

    photoCache.set(key, finalUrl);
    const cleanTokens = item.name.trim().toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    if (cleanTokens.length >= 2) {
      photoCache.set(cleanTokens.slice().sort().join(' '), finalUrl);
    }
    compressedEntries.push({
      key,
      name: item.name.trim(),
      photoUrl: finalUrl,
      className: item.className,
    });
  }

  notifyListeners();

  try {
    const db = await getDb();
    if (db) {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      compressedEntries.forEach((rec) => {
        store.put({
          key: rec.key,
          name: rec.name,
          photoUrl: rec.photoUrl,
          className: rec.className,
          updatedAt: Date.now(),
        });
      });
    }
  } catch (err) {
    console.warn('Batch save to IndexedDB error:', err);
  }

  // Persist batch on the server (teacher only ; in the student and parent portals, photos stay in this browser)
  try {
    if (compressedEntries.length > 0 && enseignantConnecte()) {
      const CHUNK_SIZE = 100;
      for (let i = 0; i < compressedEntries.length; i += CHUNK_SIZE) {
        await apiEnseignant('PUT', '/api/photos', compressedEntries.slice(i, i + CHUNK_SIZE).map(rec => ({ name: rec.name, photoUrl: rec.photoUrl, className: rec.className || '' })));
      }
    }
  } catch (err) {
    console.warn('Batch save to Cloud Firestore error:', err);
  }
};
