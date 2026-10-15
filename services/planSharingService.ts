import { StudentPlacement, StudentPeriodRemark, PublishedPlan } from '../types';
export type { StudentPeriodRemark, PublishedPlan };
import { db, handleFirestoreError } from '../lib/firebase';
import {
  collection,
  doc,
  setDoc,
  getDocs,
  onSnapshot,
  deleteDoc,
  writeBatch
} from 'firebase/firestore';
import { getStudentPhoto } from './photoLibraryService';
import { getLocalTeacherAccount, getImpersonatedTeacher } from './teacherAuthService';

/**
 * Propriétaire d'un plan : l'enseignant connecté (ou celui que le Super Admin incarne).
 */
export interface PlanOwner {
  uid: string;
  email?: string;
  classes?: string[];
  isSuperAdmin?: boolean;
}

export const getActivePlanOwner = (): PlanOwner | null => {
  const acc = getImpersonatedTeacher() || getLocalTeacherAccount();
  if (!acc || !acc.uid) return null;
  return { uid: acc.uid, email: acc.email, classes: acc.classes, isSuperAdmin: acc.role === 'super_admin' };
};

const normEmail = (email?: string | null) => (email || '').trim().toLowerCase();

/**
 * Un plan appartient à un enseignant si son uid ou son e-mail correspond.
 * Les anciens plans sans propriétaire restent visibles pour le Super Admin et pour l'enseignant
 * dont le profil contient la classe, afin qu'ils puissent être récupérés en les republiant.
 */
export const isPlanOwnedBy = (plan: PublishedPlan, owner: PlanOwner | null): boolean => {
  if (!plan) return false;
  if (!plan.teacherId && !plan.teacherEmail) {
    if (!owner || owner.isSuperAdmin) return true;
    const planClasses = (plan.className || '').split(',').map(c => c.trim().toLowerCase());
    return (owner.classes || []).some(c => planClasses.includes(c.trim().toLowerCase()));
  }
  if (!owner) return false;
  if (plan.teacherId && plan.teacherId === owner.uid) return true;
  const email = normEmail(owner.email);
  return !!email && normEmail(plan.teacherEmail) === email;
};

export const filterPlansForOwner = (plans: PublishedPlan[], owner: PlanOwner | null): PublishedPlan[] =>
  (plans || []).filter(p => isPlanOwnedBy(p, owner));

const ownerFields = (owner: PlanOwner | null) =>
  owner ? { teacherId: owner.uid, ...(owner.email ? { teacherEmail: owner.email } : {}) } : {};

export interface StudentPasswordEntry {
  password?: string; // Cleartext or hashed string password
  isDefault: boolean; // true if still 0000
  updatedAt?: string;
}

/**
 * Ensures all student placements are enriched with their associated photo
 */
export const enrichPlacementsWithPhotos = (placements: StudentPlacement[]): StudentPlacement[] => {
  if (!Array.isArray(placements)) return [];
  return placements.map(p => {
    if (!p) return p;
    const photo = p.photoUrl || getStudentPhoto(p.name, p.photoUrl);
    if (photo) {
      return { ...p, photoUrl: photo };
    }
    return p;
  });
};

/**
 * Deduplicates placements to guarantee:
 * 1. Each student appears AT MOST ONCE (by id and by normalized name)
 * 2. Seated students (location: number) take precedence over unseated ('bank')
 * 3. No two students occupy the same seat number
 */
export const deduplicatePlacements = (placements: StudentPlacement[]): StudentPlacement[] => {
  if (!Array.isArray(placements)) return [];

  // Sort so seated placements come before 'bank'
  const sorted = [...placements].sort((a, b) => {
    const aSeated = typeof a?.location === 'number' ? 1 : 0;
    const bSeated = typeof b?.location === 'number' ? 1 : 0;
    return bSeated - aSeated;
  });

  const seenIds = new Set<string | number>();
  const seenNames = new Set<string>();
  const seenSeats = new Set<number>();
  const result: StudentPlacement[] = [];

  for (const p of sorted) {
    if (!p || !p.name || !p.name.trim()) continue;
    const normName = p.name.trim().toLowerCase();

    // Skip if student already registered in this plan
    if (p.id !== undefined && p.id !== null && seenIds.has(p.id)) {
      continue;
    }
    if (seenNames.has(normName)) {
      continue;
    }

    let loc = p.location;
    if (typeof loc === 'number') {
      if (seenSeats.has(loc)) {
        loc = 'bank';
      } else {
        seenSeats.add(loc);
      }
    }

    if (p.id !== undefined && p.id !== null) seenIds.add(p.id);
    seenNames.add(normName);
    result.push({ ...p, location: loc });
  }

  return result;
};

export const cleanForFirestore = <T>(obj: T): T => {
  if (obj === null || obj === undefined) {
    return null as unknown as T;
  }
  return JSON.parse(
    JSON.stringify(obj, (key, value) => {
      if (value === undefined) return undefined;
      return value;
    })
  );
};

const COLLECTION_NAME = 'publishedPlans';
const LOCAL_STORAGE_KEY = 'plan_de_classe_published_plans_v3';

// Default initial demo plans for immediate preview
const INITIAL_DEMO_PLANS: PublishedPlan[] = [
  {
    id: 'demo-plan-1',
    teacherName: 'M. Abgrall (Mathématiques)',
    className: '3ème A',
    period: 'Période 1 (Septembre - Toussaint)',
    allowStudentSelfPlacement: true,
    isFrozen: false,
    gridDimensions: { rows: 5, cols: 6 },
    unavailableCells: [0, 5],
    placements: [
      { id: 1, name: 'Hugo Dupont', rollNumber: '1', location: 7 },
      { id: 2, name: 'Emma Martin', rollNumber: '2', location: 8 },
      { id: 3, name: 'Lucas Bernard', rollNumber: '3', location: 13 },
      { id: 4, name: 'Chloé Thomas', rollNumber: '4', location: 14 },
      { id: 5, name: 'Enzo Petit', rollNumber: '5', location: 'bank' },
      { id: 6, name: 'Manon Robert', rollNumber: '6', location: 'bank' },
      { id: 7, name: 'Nathan Richard', rollNumber: '7', location: 'bank' },
    ],
    studentPasswords: {
      1: { password: '0000', isDefault: true },
      2: { password: '0000', isDefault: true },
      3: { password: '0000', isDefault: true },
      4: { password: '0000', isDefault: true },
      5: { password: '0000', isDefault: true },
      6: { password: '0000', isDefault: true },
      7: { password: '0000', isDefault: true },
    },
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'demo-plan-2',
    teacherName: 'Mme Dubois (Français)',
    className: '4ème B',
    period: 'Trimestre 1 - 2026',
    allowStudentSelfPlacement: false,
    isFrozen: true,
    gridDimensions: { rows: 4, cols: 5 },
    unavailableCells: [],
    placements: [
      { id: 101, name: 'Antoine Moreau', rollNumber: '1', location: 2 },
      { id: 102, name: 'Léa Laurent', rollNumber: '2', location: 3 },
      { id: 103, name: 'Gabriel Simon', rollNumber: '3', location: 7 },
      { id: 104, name: 'Camille Michel', rollNumber: '4', location: 8 },
      { id: 105, name: 'Sarah Lefebvre', rollNumber: '5', location: 'bank' },
    ],
    studentPasswords: {
      101: { password: '0000', isDefault: true },
      102: { password: '0000', isDefault: true },
      103: { password: '0000', isDefault: true },
      104: { password: '0000', isDefault: true },
      105: { password: '0000', isDefault: true },
    },
    updatedAt: new Date().toISOString(),
  }
];

// Helper for local storage backup
const getLocalPlans = (): PublishedPlan[] => {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) {
      const enrichedDemo = INITIAL_DEMO_PLANS.map(p => ({
        ...p,
        placements: enrichPlacementsWithPhotos(deduplicatePlacements(p.placements || []))
      }));
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(enrichedDemo));
      return enrichedDemo;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map(p => ({
        ...p,
        placements: enrichPlacementsWithPhotos(deduplicatePlacements(p.placements || []))
      }));
    }
    return INITIAL_DEMO_PLANS.map(p => ({
      ...p,
      placements: enrichPlacementsWithPhotos(deduplicatePlacements(p.placements || []))
    }));
  } catch {
    return INITIAL_DEMO_PLANS.map(p => ({
      ...p,
      placements: enrichPlacementsWithPhotos(deduplicatePlacements(p.placements || []))
    }));
  }
};

const saveLocalPlans = (plans: PublishedPlan[]) => {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(plans));
  } catch (e) {
    console.error('LocalStorage save error:', e);
  }
};

// Real-time listener for all published plans
export const subscribeToPublishedPlans = (
  onData: (plans: PublishedPlan[]) => void
) => {
  try {
    const colRef = collection(db, COLLECTION_NAME);
    return onSnapshot(
      colRef,
      (snapshot) => {
        if (!snapshot.empty) {
          const plans = snapshot.docs.map(docSnap => {
            const data = docSnap.data() as PublishedPlan;
            return {
              ...data,
              placements: enrichPlacementsWithPhotos(deduplicatePlacements(data.placements || []))
            };
          });
          plans.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
          saveLocalPlans(plans);
          onData(plans);
        } else {
          onData(getLocalPlans());
        }
      },
      (error) => {
        handleFirestoreError(error, 'list', COLLECTION_NAME);
        onData(getLocalPlans());
      }
    );
  } catch (err) {
    handleFirestoreError(err, 'list', COLLECTION_NAME);
    onData(getLocalPlans());
    return () => {};
  }
};

export const getPublishedPlans = async (): Promise<PublishedPlan[]> => {
  try {
    const snapshot = await getDocs(collection(db, COLLECTION_NAME));
    if (!snapshot.empty) {
      const plans = snapshot.docs.map(docSnap => {
        const data = docSnap.data() as PublishedPlan;
        return {
          ...data,
          placements: enrichPlacementsWithPhotos(deduplicatePlacements(data.placements || []))
        };
      });
      plans.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      saveLocalPlans(plans);
      return plans;
    }
  } catch (e) {
    handleFirestoreError(e, 'get', COLLECTION_NAME);
  }
  return getLocalPlans();
};

let hasReconciledPlansThisSession = false;

/**
 * Safely syncs local teacher plans with photos to Firestore if they do not yet exist in Firestore.
 * Strictly guarded to run at most ONCE per browser session and never inside an onSnapshot listener.
 */
export const reconcileLocalPlansToFirestore = async (): Promise<void> => {
  if (typeof window === 'undefined') return;
  if (hasReconciledPlansThisSession) return;
  hasReconciledPlansThisSession = true;

  try {
    const localPlans = getLocalPlans();
    if (!Array.isArray(localPlans) || localPlans.length === 0) return;

    // Check remote docs first to avoid unnecessary writes
    const snapshot = await getDocs(collection(db, COLLECTION_NAME));
    const remotePlanMap = new Map<string, PublishedPlan>();
    snapshot.forEach(docSnap => {
      remotePlanMap.set(docSnap.id, docSnap.data() as PublishedPlan);
    });

    const batch = writeBatch(db);
    let count = 0;

    const owner = getActivePlanOwner();
    for (const plan of localPlans) {
      if (!plan || !plan.id) continue;
      if (plan.id.startsWith('demo-')) continue;
      const remote = remotePlanMap.get(plan.id);
      // Ne jamais réécrire dans la base le plan d'un autre enseignant resté dans le cache de ce navigateur.
      if (!isPlanOwnedBy(remote || plan, owner)) continue;

      // If remote already exists and has photos, skip
      const remoteHasPhotos = remote?.placements?.some(p => !!p.photoUrl);
      if (remote && remoteHasPhotos) continue;

      const enrichedPlacements = enrichPlacementsWithPhotos(plan.placements || []);
      const localHasPhotos = enrichedPlacements.some(p => !!p.photoUrl);
      if (!localHasPhotos && remote) continue;

      const enrichedPlan: PublishedPlan = {
        ...(remote || plan),
        placements: enrichedPlacements,
      };

      const docRef = doc(db, COLLECTION_NAME, plan.id);
      batch.set(docRef, cleanForFirestore(enrichedPlan), { merge: true });
      count++;
      if (count >= 100) break;
    }

    if (count > 0) {
      await batch.commit();
    }
  } catch (err) {
    console.warn('[Firestore] reconcileLocalPlansToFirestore error:', err);
  }
};

export const STANDARD_PERIODS = [
  'Trimestre 1',
  'Trimestre 2',
  'Trimestre 3',
  'Période 1 (Sept-Oct)',
  'Période 2 (Nov-Déc)',
  'Période 3 (Janv-Fév)',
  'Période 4 (Mars-Avr)',
  'Période 5 (Mai-Juin)',
  'Semestre 1',
  'Semestre 2',
  'Année Complète'
];

export const duplicatePlanToPeriod = async (
  originalPlan: PublishedPlan,
  targetPeriod: string
): Promise<PublishedPlan> => {
  const newPlan: Omit<PublishedPlan, 'id' | 'updatedAt'> = {
    teacherName: originalPlan.teacherName,
    teacherId: originalPlan.teacherId,
    teacherEmail: originalPlan.teacherEmail,
    className: originalPlan.className,
    period: targetPeriod,
    allowStudentSelfPlacement: originalPlan.allowStudentSelfPlacement,
    isFrozen: originalPlan.isFrozen ?? false,
    gridDimensions: originalPlan.gridDimensions,
    unavailableCells: originalPlan.unavailableCells || [],
    cellObstacles: originalPlan.cellObstacles || {},
    placements: originalPlan.placements || [],
    studentPasswords: originalPlan.studentPasswords || {},
  };
  return await savePublishedPlan(newPlan);
};

export const savePublishedPlan = async (
  plan: Omit<PublishedPlan, 'id' | 'updatedAt'> & { id?: string }
): Promise<PublishedPlan> => {
  const normTeacher = (plan.teacherName || '').trim().toLowerCase();
  const normClass = (plan.className || '').trim().toLowerCase();
  const normPeriod = (plan.period || '').trim().toLowerCase();
  const activeOwner = getActivePlanOwner();
  const owner: PlanOwner | null = plan.teacherId
    ? { uid: plan.teacherId, email: plan.teacherEmail, classes: activeOwner?.classes }
    : activeOwner;

  // Search for an existing plan of the SAME OWNER for this class and period to update it instead of duplicating.
  // Plans without owner (older versions) are matched by teacher name and are then attached to the current owner.
  const localOrDbPlans = await getPublishedPlans();
  const existing = localOrDbPlans.find(p => {
    const pClass = p.className.trim().toLowerCase();
    const pPeriod = p.period.trim().toLowerCase();
    if (pClass !== normClass || pPeriod !== normPeriod) return false;
    if (p.teacherId || p.teacherEmail) return isPlanOwnedBy(p, owner);
    return p.teacherName.trim().toLowerCase() === normTeacher && isPlanOwnedBy(p, owner);
  });

  let targetId: string;
  if (existing) {
    targetId = existing.id;
  } else {
    const cleanClass = normClass.replace(/[^a-z0-9]/g, '-');
    const cleanPeriod = normPeriod.replace(/[^a-z0-9]/g, '-');
    targetId = `pub-${cleanClass}-${cleanPeriod}-${Date.now()}`;
  }

  const now = new Date().toISOString();
  const unavailSet = new Set(plan.unavailableCells || []);

  // Sanitize placements: ensure no student is placed on an unavailable cell, no duplicates exist, and photos are preserved
  const sanitizedPlacements = enrichPlacementsWithPhotos(
    deduplicatePlacements(
      (plan.placements || []).map(p => {
        if (typeof p.location === 'number' && unavailSet.has(p.location)) {
          return { ...p, location: 'bank' as const };
        }
        return p;
      })
    )
  );

  // Ensure every student has a password entry (default 0000 if not present)
  const existingPasswords = plan.studentPasswords || existing?.studentPasswords || {};
  const studentPasswords: Record<string | number, StudentPasswordEntry> = { ...existingPasswords };

  sanitizedPlacements.forEach(student => {
    if (!studentPasswords[student.id]) {
      studentPasswords[student.id] = { password: '0000', isDefault: true };
    }
  });

  const cellObstacles = plan.cellObstacles !== undefined
    ? plan.cellObstacles
    : (existing?.cellObstacles || {});

  const newRecord: PublishedPlan = {
    ...plan,
    ...ownerFields(owner),
    id: targetId,
    cellObstacles,
    placements: sanitizedPlacements,
    isFrozen: plan.isFrozen ?? false,
    studentPasswords,
    updatedAt: now,
  };

  try {
    const docRef = doc(db, COLLECTION_NAME, targetId);
    await setDoc(docRef, cleanForFirestore(newRecord));
  } catch (e) {
    console.warn('Firestore save error, saving to local:', e);
  }

  // Always update local storage
  const local = getLocalPlans();
  const idx = local.findIndex(p => p.id === targetId);
  if (idx >= 0) local[idx] = newRecord;
  else local.unshift(newRecord);
  saveLocalPlans(local);

  return newRecord;
};

// Toggle plan freeze state (Figer / Dégeler)
export const toggleFreezePlan = async (planId: string, isFrozen: boolean): Promise<PublishedPlan | null> => {
  const plans = await getPublishedPlans();
  const plan = plans.find(p => p.id === planId);
  if (!plan) return null;

  plan.isFrozen = isFrozen;
  plan.updatedAt = new Date().toISOString();

  try {
    const docRef = doc(db, COLLECTION_NAME, planId);
    await setDoc(docRef, cleanForFirestore(plan));
  } catch (e) {
    console.warn('Firestore freeze update error:', e);
    const local = getLocalPlans();
    const idx = local.findIndex(p => p.id === planId);
    if (idx >= 0) local[idx] = plan;
    saveLocalPlans(local);
  }

  return plan;
};

// Toggle whether a plan is marked as a past/archived plan (Plan passé vs Plan actuel)
export const togglePastPlan = async (planId: string, isPast: boolean): Promise<PublishedPlan | null> => {
  const plans = await getPublishedPlans();
  const plan = plans.find(p => p.id === planId);
  if (!plan) return null;

  plan.isPast = isPast;
  plan.updatedAt = new Date().toISOString();

  try {
    const docRef = doc(db, COLLECTION_NAME, planId);
    await setDoc(docRef, cleanForFirestore(plan));
  } catch (e) {
    console.warn('Firestore toggle past plan error:', e);
    const local = getLocalPlans();
    const idx = local.findIndex(p => p.id === planId);
    if (idx >= 0) local[idx] = plan;
    saveLocalPlans(local);
  }

  return plan;
};

// Synchronize class roster changes (add/remove students) with CURRENT published plans ONLY.
// Past plans (where isPast === true) remain untouched.
export const syncClassRosterWithCurrentPlans = async (
  targetClassName: string,
  newRoster: { id?: number; name: string; rollNumber?: string; photoUrl?: string }[],
  teacherName?: string,
  customPasswords?: Record<string | number, StudentPasswordEntry>
): Promise<PublishedPlan[]> => {
  const owner = getActivePlanOwner();
  // Only the current teacher's plans are synchronized: never another teacher's class with the same name.
  const currentPlans = filterPlansForOwner(await getPublishedPlans(), owner);
  const normTarget = targetClassName.trim().toLowerCase();

  const matchingPlans = currentPlans.filter(p => {
    if (!p.className) return false;
    const classes = p.className.split(',').map(c => c.trim().toLowerCase());
    return classes.includes(normTarget) || p.className.trim().toLowerCase() === normTarget;
  });

  if (matchingPlans.length === 0) {
    if (newRoster && newRoster.length > 0) {
      const cleanClass = normTarget.replace(/[^a-z0-9]/g, '-');
      const newPlanId = `pub-${cleanClass}-periode-1-${Date.now()}`;
      const defaultPlacements: StudentPlacement[] = enrichPlacementsWithPhotos(
        newRoster.map((st, idx) => ({
          id: st.id || Date.now() + idx,
          name: st.name,
          rollNumber: st.rollNumber || `${idx + 1}`,
          photoUrl: st.photoUrl || getStudentPhoto(st.name, st.photoUrl),
          location: 'bank',
        }))
      );
      const defaultPasswords: Record<string | number, StudentPasswordEntry> = {};
      defaultPlacements.forEach(st => {
        defaultPasswords[st.id] = customPasswords?.[st.id] || { password: '0000', isDefault: true };
      });

      const newPlanRecord: PublishedPlan = {
        id: newPlanId,
        ...ownerFields(owner),
        teacherName: teacherName || 'Enseignant',
        className: targetClassName.trim(),
        period: 'Période 1 (Septembre - Toussaint)',
        allowStudentSelfPlacement: true,
        isFrozen: false,
        gridDimensions: { rows: 5, cols: 6 },
        unavailableCells: [],
        placements: defaultPlacements,
        studentPasswords: defaultPasswords,
        updatedAt: new Date().toISOString(),
      };

      try {
        const docRef = doc(db, COLLECTION_NAME, newPlanId);
        await setDoc(docRef, cleanForFirestore(newPlanRecord));
      } catch (e) {
        console.warn('Firestore sync auto-create plan error:', e);
      }

      const local = getLocalPlans();
      local.unshift(newPlanRecord);
      saveLocalPlans(local);
    }
    return getPublishedPlans();
  }

  // Maps for efficient roster lookup
  const newRosterById = new Map(newRoster.filter(s => s.id !== undefined).map(s => [s.id as number, s]));
  const newRosterByName = new Map(newRoster.map(s => [s.name.trim().toLowerCase(), s]));

  for (const plan of matchingPlans) {
    // CRITICAL REQUIREMENT: Past plans (isPast === true) MUST NOT be modified!
    if (plan.isPast) {
      continue;
    }

    const currentPlacements = deduplicatePlacements(Array.isArray(plan.placements) ? plan.placements : []);

    // Track matched new roster entries to avoid duplicates
    const matchedRosterIds = new Set<number>();
    const matchedRosterNames = new Set<string>();

    // 1. Keep and update students from current plan who are STILL in the new roster
    const updatedPlacements: StudentPlacement[] = [];

    currentPlacements.forEach(p => {
      // Try match by ID first
      const matchedById = p.id ? newRosterById.get(p.id) : undefined;
      if (matchedById) {
        const id = matchedById.id as number;
        const normName = matchedById.name.trim().toLowerCase();
        if ((id !== undefined && matchedRosterIds.has(id)) || matchedRosterNames.has(normName)) {
          return;
        }
        updatedPlacements.push({
          ...p,
          name: matchedById.name,
          rollNumber: matchedById.rollNumber || p.rollNumber,
          photoUrl: (matchedById.photoUrl !== undefined && matchedById.photoUrl)
            ? matchedById.photoUrl
            : (p.photoUrl || getStudentPhoto(matchedById.name, p.photoUrl)),
        });
        if (id !== undefined) matchedRosterIds.add(id);
        matchedRosterNames.add(normName);
        return;
      }

      // If not matched by ID, try match by name
      const matchedByName = newRosterByName.get(p.name.trim().toLowerCase());
      if (matchedByName) {
        const id = matchedByName.id as number;
        const normName = matchedByName.name.trim().toLowerCase();
        if ((id !== undefined && matchedRosterIds.has(id)) || matchedRosterNames.has(normName)) {
          return;
        }
        updatedPlacements.push({
          ...p,
          name: matchedByName.name,
          rollNumber: matchedByName.rollNumber || p.rollNumber,
          photoUrl: (matchedByName.photoUrl !== undefined && matchedByName.photoUrl)
            ? matchedByName.photoUrl
            : (p.photoUrl || getStudentPhoto(matchedByName.name, p.photoUrl)),
        });
        if (id !== undefined) matchedRosterIds.add(id);
        matchedRosterNames.add(normName);
        return;
      }

      // If neither matches, student was removed by teacher from this class
    });

    // 2. Add newly added students to the bank ('bank')
    newRoster.forEach((st, idx) => {
      const isAlreadyAdded =
        (st.id !== undefined && matchedRosterIds.has(st.id)) ||
        matchedRosterNames.has(st.name.trim().toLowerCase());

      if (!isAlreadyAdded) {
        const studentId = st.id || Date.now() + idx;
        updatedPlacements.push({
          id: studentId,
          name: st.name,
          rollNumber: st.rollNumber || `${idx + 1}`,
          photoUrl: st.photoUrl || getStudentPhoto(st.name, st.photoUrl),
          location: 'bank',
        });
        matchedRosterIds.add(studentId);
        matchedRosterNames.add(st.name.trim().toLowerCase());
      }
    });

    const finalPlacements = enrichPlacementsWithPhotos(deduplicatePlacements(updatedPlacements));

    // 3. Update student passwords dictionary (incorporating customPasswords if provided)
    const passwords = plan.studentPasswords || {};
    const updatedPasswords: Record<string | number, StudentPasswordEntry> = {};
    finalPlacements.forEach(p => {
      if (customPasswords && customPasswords[p.id]) {
        updatedPasswords[p.id] = customPasswords[p.id];
      } else if (passwords[p.id]) {
        updatedPasswords[p.id] = passwords[p.id];
      } else {
        updatedPasswords[p.id] = { password: '0000', isDefault: true };
      }
    });

    const updatedPlanRecord: PublishedPlan = {
      ...plan,
      ...(plan.teacherId || plan.teacherEmail ? {} : ownerFields(owner)),
      placements: finalPlacements,
      studentPasswords: updatedPasswords,
      updatedAt: new Date().toISOString(),
    };

    try {
      const docRef = doc(db, COLLECTION_NAME, plan.id);
      await setDoc(docRef, cleanForFirestore(updatedPlanRecord));
    } catch (e) {
      console.warn('Firestore sync error, saving local:', e);
      const local = getLocalPlans();
      const idx = local.findIndex(p => p.id === plan.id);
      if (idx >= 0) local[idx] = updatedPlanRecord;
      saveLocalPlans(local);
    }
  }

  return getPublishedPlans();
};

// Update the assigned class name of a published plan (Réaffecter / Désaffecter)
export const reassignPublishedPlanClass = async (planId: string, newClassName: string): Promise<PublishedPlan | null> => {
  const plans = await getPublishedPlans();
  const plan = plans.find(p => p.id === planId);
  if (!plan) return null;

  plan.className = newClassName.trim() || 'Sans classe';
  plan.updatedAt = new Date().toISOString();

  try {
    const docRef = doc(db, COLLECTION_NAME, planId);
    await setDoc(docRef, cleanForFirestore(plan));
  } catch (e) {
    console.warn('Firestore reassign class error:', e);
    const local = getLocalPlans();
    const idx = local.findIndex(p => p.id === planId);
    if (idx >= 0) local[idx] = plan;
    saveLocalPlans(local);
  }

  return plan;
};

// Duplicate a published plan for another class (Affecter à une autre classe)
export const duplicatePublishedPlanForClass = async (planId: string, newClassName: string): Promise<PublishedPlan | null> => {
  const plans = await getPublishedPlans();
  const originalPlan = plans.find(p => p.id === planId);
  if (!originalPlan) return null;

  const targetClassName = newClassName.trim() || 'Nouvelle classe';
  const newId = `pub-${targetClassName.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}`;

  const duplicatedPlan: PublishedPlan = {
    ...originalPlan,
    ...(originalPlan.teacherId || originalPlan.teacherEmail ? {} : ownerFields(getActivePlanOwner())),
    id: newId,
    className: targetClassName,
    updatedAt: new Date().toISOString(),
  };

  try {
    const docRef = doc(db, COLLECTION_NAME, newId);
    await setDoc(docRef, cleanForFirestore(duplicatedPlan));
  } catch (e) {
    console.warn('Firestore duplicate plan error:', e);
    const local = getLocalPlans();
    local.unshift(duplicatedPlan);
    saveLocalPlans(local);
  }

  return duplicatedPlan;
};

export const deletePublishedPlan = async (id: string): Promise<void> => {
  try {
    await deleteDoc(doc(db, COLLECTION_NAME, id));
  } catch (e) {
    console.warn('Firestore delete error:', e);
  }
  const local = getLocalPlans().filter(p => p.id !== id);
  saveLocalPlans(local);
};

export const updatePlanPeriod = async (planId: string, newPeriod: string): Promise<PublishedPlan | null> => {
  const plans = await getPublishedPlans();
  const plan = plans.find(p => p.id === planId);
  if (!plan) return null;

  plan.period = newPeriod.trim() || 'Période 1';
  plan.updatedAt = new Date().toISOString();

  try {
    const docRef = doc(db, COLLECTION_NAME, planId);
    await setDoc(docRef, cleanForFirestore(plan));
  } catch (e) {
    console.warn('Firestore update period error:', e);
    const local = getLocalPlans();
    const idx = local.findIndex(p => p.id === planId);
    if (idx >= 0) local[idx] = plan;
    saveLocalPlans(local);
  }

  return plan;
};

export const clearPlanPlacements = async (planId: string): Promise<PublishedPlan | null> => {
  const plans = await getPublishedPlans();
  const plan = plans.find(p => p.id === planId);
  if (!plan) return null;

  plan.placements = plan.placements.map(st => ({
    ...st,
    location: 'bank'
  }));
  plan.allowStudentSelfPlacement = true;
  plan.isFrozen = false;
  plan.updatedAt = new Date().toISOString();

  try {
    const docRef = doc(db, COLLECTION_NAME, planId);
    await setDoc(docRef, cleanForFirestore(plan));
  } catch (e) {
    console.warn('Firestore clear placements error:', e);
    const local = getLocalPlans();
    const idx = local.findIndex(p => p.id === planId);
    if (idx >= 0) local[idx] = plan;
    saveLocalPlans(local);
  }

  return plan;
};

export const fillPlanPlacements = async (planId: string): Promise<PublishedPlan | null> => {
  const plans = await getPublishedPlans();
  const plan = plans.find(p => p.id === planId);
  if (!plan) return null;

  const rows = plan.gridDimensions?.rows || 5;
  const cols = plan.gridDimensions?.cols || 6;
  const totalCells = rows * cols;
  const unavailableSet = new Set(plan.unavailableCells || []);

  const availableIndices: number[] = [];
  for (let i = 0; i < totalCells; i++) {
    if (!unavailableSet.has(i)) {
      availableIndices.push(i);
    }
  }

  let nextAvailIdx = 0;
  plan.placements = plan.placements.map(st => {
    if (nextAvailIdx < availableIndices.length) {
      const loc = availableIndices[nextAvailIdx++];
      return { ...st, location: loc };
    }
    return { ...st, location: 'bank' };
  });

  plan.updatedAt = new Date().toISOString();

  try {
    const docRef = doc(db, COLLECTION_NAME, planId);
    await setDoc(docRef, cleanForFirestore(plan));
  } catch (e) {
    console.warn('Firestore fill placements error:', e);
    const local = getLocalPlans();
    const idx = local.findIndex(p => p.id === planId);
    if (idx >= 0) local[idx] = plan;
    saveLocalPlans(local);
  }

  return plan;
};

export const updatePlanGridDimensions = async (
  planId: string,
  rows: number,
  cols: number
): Promise<PublishedPlan | null> => {
  const plans = await getPublishedPlans();
  const plan = plans.find(p => p.id === planId);
  if (!plan) return null;

  plan.gridDimensions = { rows: Math.max(1, rows), cols: Math.max(1, cols) };
  plan.updatedAt = new Date().toISOString();

  try {
    const docRef = doc(db, COLLECTION_NAME, planId);
    await setDoc(docRef, cleanForFirestore(plan));
  } catch (e) {
    console.warn('Firestore update grid dimensions error:', e);
    const local = getLocalPlans();
    const idx = local.findIndex(p => p.id === planId);
    if (idx >= 0) local[idx] = plan;
    saveLocalPlans(local);
  }

  return plan;
};

export const updateStudentSeatInPlan = async (
  planId: string,
  studentId: number,
  newLocation: number | 'bank'
): Promise<{ success: boolean; plan?: PublishedPlan; message?: string }> => {
  const currentPlans = await getPublishedPlans();
  const plan = currentPlans.find(p => p.id === planId);
  if (!plan) return { success: false, message: 'Plan introuvable' };

  if (plan.isFrozen) {
    return { success: false, message: 'Ce plan est figé par l’enseignant. Les modifications ne sont pas autorisées.' };
  }

  if (!plan.allowStudentSelfPlacement) {
    return { success: false, message: 'Le placement libre est désactivé par l’enseignant.' };
  }

  // Seat conflicts resolution
  if (typeof newLocation === 'number') {
    const occupant = plan.placements.find(p => p.location === newLocation && p.id !== studentId);
    if (occupant) {
      const previousSeatOfStudent = plan.placements.find(p => p.id === studentId)?.location;
      occupant.location = previousSeatOfStudent || 'bank';
    }
  }

  plan.placements = enrichPlacementsWithPhotos(
    plan.placements.map(p => {
      if (p.id === studentId) {
        return { ...p, location: newLocation };
      }
      return p;
    })
  );

  plan.updatedAt = new Date().toISOString();

  try {
    const docRef = doc(db, COLLECTION_NAME, planId);
    await setDoc(docRef, cleanForFirestore(plan));
  } catch (e) {
    console.warn('Firestore update seat error:', e);
    const local = getLocalPlans();
    const idx = local.findIndex(p => p.id === planId);
    if (idx >= 0) local[idx] = plan;
    saveLocalPlans(local);
  }

  return { success: true, plan };
};

/**
 * Teacher-authorized real-time movement of students on the published plan.
 * Directly updates Cloud Firestore and local storage so students in their portal
 * see movements live in real-time during class.
 */
export const moveStudentByTeacher = async (
  planId: string,
  studentId: number,
  newLocation: number | 'bank'
): Promise<{ success: boolean; plan?: PublishedPlan; message?: string }> => {
  const currentPlans = await getPublishedPlans();
  const plan = currentPlans.find(p => p.id === planId);
  if (!plan) return { success: false, message: 'Plan introuvable' };

  const studentCurrent = plan.placements.find(p => p.id === studentId);
  const oldLocation = studentCurrent?.location;

  // Handle seat conflict / swap
  let updatedPlacements = plan.placements.map(p => ({ ...p }));
  if (typeof newLocation === 'number') {
    const occupant = updatedPlacements.find(p => p.location === newLocation && p.id !== studentId);
    if (occupant) {
      // If student was on another seat, swap their seats! If student came from bank, send old occupant to bank
      occupant.location = typeof oldLocation === 'number' ? oldLocation : 'bank';
    }
  }

  updatedPlacements = updatedPlacements.map(p => {
    if (p.id === studentId) {
      return { ...p, location: newLocation };
    }
    return p;
  });

  plan.placements = enrichPlacementsWithPhotos(updatedPlacements);
  plan.updatedAt = new Date().toISOString();

  // Save to local cache first
  const local = getLocalPlans();
  const idx = local.findIndex(p => p.id === planId);
  if (idx >= 0) local[idx] = plan;
  saveLocalPlans(local);

  // Write directly to Firestore
  try {
    const docRef = doc(db, COLLECTION_NAME, planId);
    await setDoc(docRef, cleanForFirestore(plan));
  } catch (e) {
    console.warn('Firestore live teacher move error:', e);
  }

  return { success: true, plan };
};

/**
 * Teacher-authorized bulk update of placements for a published plan.
 */
export const updatePlanPlacementsByTeacher = async (
  planId: string,
  newPlacements: StudentPlacement[]
): Promise<{ success: boolean; plan?: PublishedPlan; message?: string }> => {
  const currentPlans = await getPublishedPlans();
  const plan = currentPlans.find(p => p.id === planId);
  if (!plan) return { success: false, message: 'Plan introuvable' };

  plan.placements = enrichPlacementsWithPhotos(newPlacements);
  plan.updatedAt = new Date().toISOString();

  const local = getLocalPlans();
  const idx = local.findIndex(p => p.id === planId);
  if (idx >= 0) local[idx] = plan;
  saveLocalPlans(local);

  try {
    const docRef = doc(db, COLLECTION_NAME, planId);
    await setDoc(docRef, cleanForFirestore(plan));
  } catch (e) {
    console.warn('Firestore live teacher update placements error:', e);
  }

  return { success: true, plan };
};

/**
 * Teacher-authorized update of unavailable cells and cell obstacles on a published plan.
 * Automatically moves any student seated on a newly unavailable cell back to the bank,
 * and pushes real-time updates to Firestore and local storage.
 */
export const updatePlanObstaclesByTeacher = async (
  planId: string,
  unavailableCells: number[],
  cellObstacles: Record<number | string, { icon: string; label: string; svgKey?: string }>
): Promise<{ success: boolean; plan?: PublishedPlan; message?: string }> => {
  const currentPlans = await getPublishedPlans();
  const plan = currentPlans.find(p => p.id === planId);
  if (!plan) return { success: false, message: 'Plan introuvable' };

  const unavailSet = new Set(unavailableCells);

  // If student was on a cell that is now unavailable, move student to bank
  plan.placements = enrichPlacementsWithPhotos(
    plan.placements.map(p => {
      if (typeof p.location === 'number' && unavailSet.has(p.location)) {
        return { ...p, location: 'bank' as const };
      }
      return p;
    })
  );

  plan.unavailableCells = unavailableCells;
  plan.cellObstacles = cellObstacles;
  plan.updatedAt = new Date().toISOString();

  const local = getLocalPlans();
  const idx = local.findIndex(p => p.id === planId);
  if (idx >= 0) local[idx] = plan;
  saveLocalPlans(local);

  try {
    const docRef = doc(db, COLLECTION_NAME, planId);
    await setDoc(docRef, cleanForFirestore(plan));
  } catch (e) {
    console.warn('Firestore live teacher update obstacles error:', e);
  }

  return { success: true, plan };
};

// Verify student / parent password
export const verifyStudentPassword = (
  plan: PublishedPlan,
  studentId: number,
  inputPass: string
): { valid: boolean; requiresPasswordChange: boolean } => {
  const passwords = plan.studentPasswords || {};
  const entry = passwords[studentId] || { password: '0000', isDefault: true };

  const targetPassword = entry.password || '0000';
  const trimmedInput = inputPass.trim();

  const isValid = trimmedInput === targetPassword;

  // If password is default '0000' OR entry.isDefault is true, prompt for mandatory change
  const requiresPasswordChange = isValid && (entry.isDefault || targetPassword === '0000');

  return { valid: isValid, requiresPasswordChange };
};

// Change student password from default 0000 to custom password
export const updateStudentPassword = async (
  planId: string,
  studentId: number,
  newPass: string
): Promise<PublishedPlan | null> => {
  const currentPlans = await getPublishedPlans();
  const plan = currentPlans.find(p => p.id === planId);
  if (!plan) return null;

  if (!plan.studentPasswords) {
    plan.studentPasswords = {};
  }

  plan.studentPasswords[studentId] = {
    password: newPass.trim(),
    isDefault: false,
    updatedAt: new Date().toISOString(),
  };

  plan.updatedAt = new Date().toISOString();

  try {
    const docRef = doc(db, COLLECTION_NAME, planId);
    await setDoc(docRef, cleanForFirestore(plan));
  } catch (e) {
    console.warn('Firestore update password error:', e);
    const local = getLocalPlans();
    const idx = local.findIndex(p => p.id === planId);
    if (idx >= 0) local[idx] = plan;
    saveLocalPlans(local);
  }

  return plan;
};

// Teacher action: reset a student password back to '0000'
export const resetStudentPasswordToDefault = async (
  planId: string,
  studentId: number
): Promise<PublishedPlan | null> => {
  const currentPlans = await getPublishedPlans();
  const plan = currentPlans.find(p => p.id === planId);
  if (!plan) return null;

  if (!plan.studentPasswords) {
    plan.studentPasswords = {};
  }

  plan.studentPasswords[studentId] = {
    password: '0000',
    isDefault: true,
    updatedAt: new Date().toISOString(),
  };

  plan.updatedAt = new Date().toISOString();

  try {
    const docRef = doc(db, COLLECTION_NAME, planId);
    await setDoc(docRef, cleanForFirestore(plan));
  } catch (e) {
    console.warn('Firestore password reset error:', e);
    const local = getLocalPlans();
    const idx = local.findIndex(p => p.id === planId);
    if (idx >= 0) local[idx] = plan;
    saveLocalPlans(local);
  }

  return plan;
};

/**
 * Normalizes a student lookup key for remarks dictionary
 */
export const normalizeStudentRemarkKey = (studentName: string, studentId?: number): string => {
  if (studentName && studentName.trim()) {
    return studentName.trim().toLowerCase();
  }
  if (studentId !== undefined && studentId !== null) {
    return `id_${studentId}`;
  }
  return 'unknown';
};

/**
 * Returns all teacher remarks recorded for a specific student in a given plan/period
 */
export const getStudentRemarks = (
  plan: PublishedPlan | null | undefined,
  studentName: string,
  studentId?: number
): StudentPeriodRemark[] => {
  if (!plan || !plan.studentRemarks) return [];

  const nameKey = normalizeStudentRemarkKey(studentName, studentId);
  const idKey = studentId !== undefined && studentId !== null ? `id_${studentId}` : '';
  const altKey = studentId !== undefined && studentId !== null ? String(studentId) : '';

  // Look up by normalized name, then idKey, then direct numeric key
  const list = plan.studentRemarks[nameKey] || (idKey ? plan.studentRemarks[idKey] : undefined) || (altKey ? plan.studentRemarks[altKey] : undefined) || [];

  if (!Array.isArray(list)) return [];

  // Return sorted by date (newest first), then by createdAt
  return [...list].sort((a, b) => {
    const dateComp = (b.date || '').localeCompare(a.date || '');
    if (dateComp !== 0) return dateComp;
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });
};

/**
 * Adds or updates a teacher remark for a student on a specific plan period
 */
export const saveStudentRemark = async (
  planId: string,
  studentName: string,
  studentId: number | undefined,
  remarkData: {
    date: string;
    sessionNumber?: string;
    sequenceNumber?: string;
    text: string;
    teacherName?: string;
  },
  existingRemarkId?: string
): Promise<{ success: boolean; plan?: PublishedPlan; message?: string }> => {
  if (!planId || !studentName?.trim() || !remarkData.text?.trim()) {
    return { success: false, message: 'Données de remarque incomplètes.' };
  }

  const currentPlans = await getPublishedPlans();
  const plan = currentPlans.find(p => p.id === planId);
  if (!plan) {
    return { success: false, message: 'Plan de classe introuvable.' };
  }

  if (!plan.studentRemarks) {
    plan.studentRemarks = {};
  }

  const key = normalizeStudentRemarkKey(studentName, studentId);
  const existingList = Array.isArray(plan.studentRemarks[key]) ? [...plan.studentRemarks[key]] : [];

  const now = new Date().toISOString();

  if (existingRemarkId) {
    // Update existing remark
    const idx = existingList.findIndex(r => r.id === existingRemarkId);
    if (idx >= 0) {
      existingList[idx] = {
        ...existingList[idx],
        date: remarkData.date || new Date().toISOString().split('T')[0],
        sessionNumber: remarkData.sessionNumber?.trim() || undefined,
        sequenceNumber: remarkData.sequenceNumber?.trim() || undefined,
        text: remarkData.text.trim(),
        teacherName: remarkData.teacherName || plan.teacherName || existingList[idx].teacherName,
        updatedAt: now,
      };
    } else {
      // Fallback create
      existingList.unshift({
        id: existingRemarkId,
        studentId,
        studentName: studentName.trim(),
        date: remarkData.date || new Date().toISOString().split('T')[0],
        sessionNumber: remarkData.sessionNumber?.trim() || undefined,
        sequenceNumber: remarkData.sequenceNumber?.trim() || undefined,
        text: remarkData.text.trim(),
        teacherName: remarkData.teacherName || plan.teacherName,
        createdAt: now,
        updatedAt: now,
      });
    }
  } else {
    // Create new remark
    const newRemark: StudentPeriodRemark = {
      id: `rem_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      studentId,
      studentName: studentName.trim(),
      date: remarkData.date || new Date().toISOString().split('T')[0],
      sessionNumber: remarkData.sessionNumber?.trim() || undefined,
      sequenceNumber: remarkData.sequenceNumber?.trim() || undefined,
      text: remarkData.text.trim(),
      teacherName: remarkData.teacherName || plan.teacherName,
      createdAt: now,
      updatedAt: now,
    };
    existingList.unshift(newRemark);
  }

  plan.studentRemarks[key] = existingList;
  plan.updatedAt = now;

  try {
    const docRef = doc(db, COLLECTION_NAME, planId);
    await setDoc(docRef, cleanForFirestore(plan));
  } catch (e) {
    console.warn('Firestore remark save error:', e);
    const local = getLocalPlans();
    const idx = local.findIndex(p => p.id === planId);
    if (idx >= 0) local[idx] = plan;
    saveLocalPlans(local);
  }

  return { success: true, plan };
};

/**
 * Deletes a teacher remark for a student
 */
export const deleteStudentRemark = async (
  planId: string,
  studentName: string,
  studentId: number | undefined,
  remarkId: string
): Promise<{ success: boolean; plan?: PublishedPlan; message?: string }> => {
  if (!planId || !remarkId) {
    return { success: false, message: 'Paramètres invalides.' };
  }

  const currentPlans = await getPublishedPlans();
  const plan = currentPlans.find(p => p.id === planId);
  if (!plan || !plan.studentRemarks) {
    return { success: false, message: 'Plan introuvable.' };
  }

  const key = normalizeStudentRemarkKey(studentName, studentId);
  const existingList = Array.isArray(plan.studentRemarks[key]) ? [...plan.studentRemarks[key]] : [];
  plan.studentRemarks[key] = existingList.filter(r => r.id !== remarkId);
  plan.updatedAt = new Date().toISOString();

  try {
    const docRef = doc(db, COLLECTION_NAME, planId);
    await setDoc(docRef, cleanForFirestore(plan));
  } catch (e) {
    console.warn('Firestore remark delete error:', e);
    const local = getLocalPlans();
    const idx = local.findIndex(p => p.id === planId);
    if (idx >= 0) local[idx] = plan;
    saveLocalPlans(local);
  }

  return { success: true, plan };
};
