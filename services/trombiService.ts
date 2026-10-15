import { GoogleGenAI, Type } from '@google/genai';
import * as pdfjsLib from 'pdfjs-dist';

// Configure pdfjs worker
try {
  // Use worker from local package or unpkg CDN
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version || '4.10.38'}/build/pdf.worker.min.mjs`;
} catch (e) {
  console.warn('Could not set pdfjs workerSrc:', e);
}

const getApiKey = (): string => {
  return process.env.GEMINI_API_KEY || process.env.API_KEY || '';
};

export interface ExtractedTrombiStudent {
  name: string;
  box_2d?: [number, number, number, number]; // [ymin, xmin, ymax, xmax] 0-1000
  photoUrl?: string; // base64 JPEG
  isPlaceholder?: boolean;
}

export interface TrombiExtractionResult {
  className?: string;
  year?: string;
  students: ExtractedTrombiStudent[];
  renderedPageDataUrl?: string;
}

/**
 * Normalizes text for robust name matching
 */
export const normalizeStudentName = (name: string): string => {
  if (!name) return '';
  // Strip leading numbering or bullet prefixes like "1. ", "01 - ", "2) ", etc.
  const withoutDigits = name.replace(/^\s*\d+[\s\.\-\)\:]+\s*/, '').trim();
  const target = withoutDigits || name;
  return target
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Computes a token-overlap similarity between two student names (0.0 to 1.0)
 */
export const calculateNameMatchScore = (nameA: string, nameB: string): number => {
  const normA = normalizeStudentName(nameA);
  const normB = normalizeStudentName(nameB);
  if (normA === normB) return 1.0;
  if (!normA || !normB) return 0;

  const tokensA = new Set(normA.split(' ').filter(Boolean));
  const tokensB = new Set(normB.split(' ').filter(Boolean));

  let common = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) common++;
  }

  // Jaccard-like score
  const total = new Set([...tokensA, ...tokensB]).size;
  return total > 0 ? common / total : 0;
};

/**
 * Converts a PDF File (or ArrayBuffer) into an HTMLCanvasElement of page 1
 */
export const renderPdfPageToCanvas = async (
  fileOrBuffer: File | ArrayBuffer,
  pageNumber: number = 1
): Promise<HTMLCanvasElement> => {
  let arrayBuffer: ArrayBuffer;
  if (fileOrBuffer instanceof File) {
    arrayBuffer = await fileOrBuffer.arrayBuffer();
  } else {
    arrayBuffer = fileOrBuffer;
  }

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    useSystemFonts: true,
  });

  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(pageNumber);

  // High resolution scale for crisp photo extraction (2x / 2.5x)
  const viewport = page.getViewport({ scale: 2.0 });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Impossible d\'obtenir le contexte 2D du canvas.');
  }

  const renderContext = {
    canvasContext: ctx as any,
    viewport: viewport,
  };

  await page.render(renderContext).promise;
  return canvas;
};

/**
 * Converts an Image File to an HTMLCanvasElement
 */
export const renderImageFileToCanvas = async (file: File): Promise<HTMLCanvasElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D context error'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve(canvas);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
};

import { compressImageToWebP } from './photoLibraryService';

/**
 * Crops a sub-rectangle from a canvas and returns a lightweight, crisp WebP/JPEG data URL (thumbnail size max 120x150)
 */
export const cropPhotoFromCanvas = (
  canvas: HTMLCanvasElement,
  box: [number, number, number, number] // [ymin, xmin, ymax, xmax] in 0-1000
): string | undefined => {
  const [ymin, xmin, ymax, xmax] = box;
  const cropX = Math.max(0, Math.round((xmin / 1000) * canvas.width));
  const cropY = Math.max(0, Math.round((ymin / 1000) * canvas.height));
  const cropW = Math.min(canvas.width - cropX, Math.round(((xmax - xmin) / 1000) * canvas.width));
  const cropH = Math.min(canvas.height - cropY, Math.round(((ymax - ymin) / 1000) * canvas.height));

  if (cropW < 8 || cropH < 8) return undefined;

  // Scale down to crisp, compact thumbnail (max 120x150) ~ 3-5 KB
  let targetW = cropW;
  let targetH = cropH;
  if (targetW > 120 || targetH > 150) {
    const ratio = Math.min(120 / targetW, 150 / targetH);
    targetW = Math.round(targetW * ratio);
    targetH = Math.round(targetH * ratio);
  }

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = targetW;
  cropCanvas.height = targetH;
  const ctx = cropCanvas.getContext('2d');
  if (!ctx) return undefined;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH);

  try {
    const webpUrl = cropCanvas.toDataURL('image/webp', 0.82);
    if (webpUrl && webpUrl.startsWith('data:image/webp')) {
      return webpUrl;
    }
  } catch {
    // fallback
  }

  return cropCanvas.toDataURL('image/jpeg', 0.82);
};

/**
 * Parses individual photo files (JPG/PNG/WebP) and matches them to student names
 */
export const processMultiplePhotoFiles = async (
  files: File[]
): Promise<ExtractedTrombiStudent[]> => {
  const results: ExtractedTrombiStudent[] = [];

  for (const file of files) {
    if (!file.type.startsWith('image/') && !file.name.match(/\.(jpg|jpeg|png|webp|avif|gif)$/i)) {
      continue;
    }

    // Extract student name from filename (e.g. "01_DUPONT_Jean.jpg" -> "DUPONT Jean")
    const baseName = file.name
      .replace(/\.[^/.]+$/, '') // remove extension
      .replace(/^[\d\s_\-\.\)]+/, '') // remove leading digits/dashes
      .replace(/[_\-]+/g, ' ') // replace underscores/dashes with spaces
      .trim();

    try {
      const compressedUrl = await compressImageToWebP(file, 120, 150, 0.82);
      results.push({
        name: baseName || file.name,
        photoUrl: compressedUrl,
        isPlaceholder: false,
      });
    } catch (err) {
      console.warn(`Failed to process photo ${file.name}:`, err);
    }
  }

  return results;
};

/**
 * Parses a trombinoscope canvas with Gemini 3.8 Flash to detect students, names, and photo boxes
 */
export const extractTrombiWithGemini = async (
  canvas: HTMLCanvasElement
): Promise<TrombiExtractionResult> => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("Clé d'API Gemini manquante. Veuillez vérifier la configuration de l'application.");
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  // Convert canvas to base64 jpeg
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  const base64Data = dataUrl.replace(/^data:image\/jpeg;base64,/, '');

  const prompt = `Tu es un expert en traitement de trombinoscopes scolaires français.
Analyse attentivement cette image de trombinoscope de classe.
Détecte TOUS les élèves visibles sur cette page (en parcourant ligne par ligne de haut en bas, de gauche à droite).

Pour chaque élève :
1. "name" : Le nom complet et prénom de l'élève écrit sous sa photo (ex: "BATAILLE PENALVA Lucas"). Conserve fidèlement les noms composés, majuscules et accents.
2. "box_2d" : Les 4 coordonnées entières normalisées [ymin, xmin, ymax, xmax] (valeurs entre 0 et 1000) du rectangle de la vignette PHOTO de l'élève (au-dessus du nom). Ne pas inclure le texte du nom dans cette boîte, seulement la photo.
3. "isPlaceholder" : booléen. True si la photo est un avatar par défaut, un point d'interrogation ou une case vide. False si c'est une vraie photo d'élève.

Extrait également s'ils existent :
- "className" : le nom de la classe (ex: "SECONDE 3" ou "203").
- "year" : l'année scolaire (ex: "2026 - 2027").`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash',
    contents: [
      {
        inlineData: {
          mimeType: 'image/jpeg',
          data: base64Data,
        },
      },
      {
        text: prompt,
      },
    ],
    config: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          className: { type: Type.STRING },
          year: { type: Type.STRING },
          students: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                box_2d: {
                  type: Type.ARRAY,
                  items: { type: Type.INTEGER },
                },
                isPlaceholder: { type: Type.BOOLEAN },
              },
              required: ['name', 'box_2d'],
            },
          },
        },
        required: ['students'],
      },
    },
  });

  const jsonText = response.text ? response.text.trim() : '';
  if (!jsonText) {
    throw new Error("L'IA n'a retourné aucune réponse pour ce trombinoscope.");
  }

  const parsed = JSON.parse(jsonText);
  const rawStudents: Array<{
    name: string;
    box_2d: [number, number, number, number];
    isPlaceholder?: boolean;
  }> = parsed.students || [];

  // Crop each student's photo from the canvas
  const studentsWithPhotos: ExtractedTrombiStudent[] = rawStudents.map((st) => {
    let photoUrl: string | undefined = undefined;
    if (Array.isArray(st.box_2d) && st.box_2d.length === 4) {
      photoUrl = cropPhotoFromCanvas(canvas, st.box_2d);
    }
    return {
      name: st.name.trim(),
      box_2d: st.box_2d,
      photoUrl,
      isPlaceholder: st.isPlaceholder ?? false,
    };
  });

  return {
    className: parsed.className?.trim(),
    year: parsed.year?.trim(),
    students: studentsWithPhotos,
    renderedPageDataUrl: dataUrl,
  };
};

export interface CachedTrombiExtraction {
  id: string;
  fileName: string;
  className?: string;
  timestamp: string;
  students: ExtractedTrombiStudent[];
}

const CACHED_TROMBI_STORAGE_KEY = 'classroom_cached_trombi_extractions_v2';

/**
 * Saves an extraction result to persistent local cache so users never lose associations
 */
export const saveTrombiExtractionToCache = (fileName: string, result: TrombiExtractionResult) => {
  if (typeof window === 'undefined') return;
  try {
    const existing = getCachedTrombiExtractions();
    const newEntry: CachedTrombiExtraction = {
      id: `trombi_${Date.now()}`,
      fileName,
      className: result.className,
      timestamp: new Date().toISOString(),
      students: result.students,
    };
    // Keep last 10 extractions
    const updated = [newEntry, ...existing.filter(e => e.fileName !== fileName)].slice(0, 10);
    localStorage.setItem(CACHED_TROMBI_STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn('Could not save trombi extraction to cache:', err);
  }
};

/**
 * Retrieves all cached trombi extractions
 */
export const getCachedTrombiExtractions = (): CachedTrombiExtraction[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CACHED_TROMBI_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (err) {
    console.warn('Could not load cached trombi extractions:', err);
    return [];
  }
};

/**
 * Deletes a cached trombi extraction
 */
export const deleteCachedTrombiExtraction = (id: string) => {
  if (typeof window === 'undefined') return;
  try {
    const existing = getCachedTrombiExtractions();
    const updated = existing.filter(e => e.id !== id);
    localStorage.setItem(CACHED_TROMBI_STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn('Could not delete cached trombi extraction:', err);
  }
};

/**
 * Pre-seeded sample photos dataset for class "203" / "SECONDE 3" as provided in the user prompt.
 * Generates clean custom avatars representing the students from the example PDF when demo mode is activated.
 */
export const SAMPLE_203_CLASS_NAME = '203';
export const SAMPLE_203_LABEL = 'Seconde 3 (203)';

export const SAMPLE_203_STUDENTS = [
  { id: 201, name: 'BATAILLE PENALVA Lucas', rollNumber: '1', gender: 'm', hair: '#1e1b18' },
  { id: 202, name: 'BOGUS LARNICOL Malo', rollNumber: '2', gender: 'm', hair: '#2a221b' },
  { id: 203, name: 'BOURCIER Yanis', rollNumber: '3', gender: 'm', hair: '#1c1917' },
  { id: 204, name: 'CARVAL Mathis', rollNumber: '4', gender: 'm', hair: '#b45309' },
  { id: 205, name: 'DOUDET Lili', rollNumber: '5', gender: 'f', hair: '#451a03' },
  { id: 206, name: 'JUIGNET Suzanne', rollNumber: '6', gender: 'f', hair: '#38220f' },
  { id: 207, name: 'LE LOCH Lana', rollNumber: '7', gender: 'f', hair: '#6b7280', isPlaceholder: true },
  { id: 208, name: 'LE ROY Mathilde', rollNumber: '8', gender: 'f', hair: '#78350f' },
  { id: 209, name: 'LE TALLEC Camille', rollNumber: '9', gender: 'm', hair: '#dc2626' },
  { id: 210, name: 'LEBAS Capucine', rollNumber: '10', gender: 'f', hair: '#451a03' },
  { id: 211, name: 'MENARD DUCATEL Soan', rollNumber: '11', gender: 'm', hair: '#854d0e' },
  { id: 212, name: 'MINOT Clémence', rollNumber: '12', gender: 'f', hair: '#312e81' },
  { id: 213, name: 'PÉRON Félix', rollNumber: '13', gender: 'm', hair: '#172554' },
  { id: 214, name: 'PERRAULT Laora', rollNumber: '14', gender: 'f', hair: '#713f12' },
  { id: 215, name: 'POUZERATE Léontine', rollNumber: '15', gender: 'f', hair: '#6b7280', isPlaceholder: true },
  { id: 216, name: 'PRIMOT COSSEC Enzo', rollNumber: '16', gender: 'm', hair: '#92400e' },
  { id: 217, name: 'QUAETAERS Rose', rollNumber: '17', gender: 'f', hair: '#6b7280', isPlaceholder: true },
  { id: 218, name: 'RIOU Lena', rollNumber: '18', gender: 'f', hair: '#78350f' },
  { id: 219, name: 'SAMSON Juline', rollNumber: '19', gender: 'f', hair: '#a16207' },
  { id: 220, name: 'TABORET Kylian', rollNumber: '20', gender: 'm', hair: '#ca8a04' },
  { id: 221, name: 'TANGUY Nora', rollNumber: '21', gender: 'f', hair: '#3b2f2f' },
  { id: 222, name: 'TOULEMONT Nathanaël', rollNumber: '22', gender: 'm', hair: '#451a03' },
];

/**
 * Creates a crisp WebP/JPG photo avatar for a student (No SVG)
 */
export const createStudentAvatarDataUrl = (
  name: string,
  gender: string = 'm',
  hairColor: string = '#333',
  isPlaceholder: boolean = false
): string => {
  return createWebpAvatar(name, gender, hairColor, isPlaceholder);
};
