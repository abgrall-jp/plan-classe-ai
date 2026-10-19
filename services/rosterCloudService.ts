import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, authReady, reportSaveError } from '../lib/firebase';
import { Student } from '../types';

// Listes d'élèves par classe, enregistrées dans la base (document classRosters/{enseignant}) :
// l'enseignant les retrouve sur n'importe quel ordinateur. Auparavant elles n'existaient que dans un navigateur.
// Les photos n'y sont pas recopiées (elles sont dans la bibliothèque de photos et dans les plans).
const COLLECTION = 'classRosters';

type Rosters = Record<string, Student[]>;

const withoutPhotos = (rosters: Rosters): Rosters => {
  const out: Rosters = {};
  for (const [cls, list] of Object.entries(rosters || {})) {
    if (!Array.isArray(list)) continue;
    out[cls] = list.map(({ photoUrl, cpsProfile, ...rest }) => JSON.parse(JSON.stringify(rest)));
  }
  return out;
};

export const loadCloudRosters = async (teacherUid: string): Promise<Rosters | null> => {
  await authReady;
  try {
    const snap = await getDoc(doc(db, COLLECTION, teacherUid));
    const data = snap.data();
    return data && data.rosters && typeof data.rosters === 'object' ? (data.rosters as Rosters) : {};
  } catch (e) {
    console.warn('Lecture des listes de classes impossible :', e);
    return null;
  }
};

let pending: ReturnType<typeof setTimeout> | null = null;
/** Enregistre les listes (regroupe les modifications rapprochées). */
export const saveCloudRosters = (teacherUid: string, rosters: Rosters) => {
  if (pending) clearTimeout(pending);
  pending = setTimeout(async () => {
    pending = null;
    try {
      await setDoc(doc(db, COLLECTION, teacherUid), {
        teacherId: teacherUid,
        rosters: withoutPhotos(rosters),
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      reportSaveError('Listes de classes non enregistrées', e);
    }
  }, 800);
};

/** Fusion à la connexion : la version de la base l'emporte, les classes connues seulement de ce navigateur sont gardées. */
export const mergeRosters = (cloud: Rosters, local: Rosters): Rosters => {
  const merged: Rosters = { ...local, ...cloud };
  // Les photos gardées localement sont réassociées par nom aux élèves de la base.
  for (const [cls, list] of Object.entries(cloud)) {
    const localList = local[cls] || [];
    merged[cls] = list.map(st => {
      const loc = localList.find(l => l.name.trim().toLowerCase() === st.name.trim().toLowerCase());
      return loc?.photoUrl ? { ...st, photoUrl: loc.photoUrl } : st;
    });
  }
  return merged;
};
