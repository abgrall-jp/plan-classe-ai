import { auth, googleProvider, db } from '../lib/firebase';
import {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  getDocs,
  collection,
  onSnapshot
} from 'firebase/firestore';

export interface TeacherAccount {
  uid: string;
  email: string;
  firstName: string;
  lastName: string;
  disciplines: string[];
  classes: string[];
  role: 'teacher' | 'super_admin';
  photoURL?: string;
  updatedAt: string;
}

const TEACHERS_COLLECTION = 'teachers';
const LOCAL_AUTH_KEY = 'teacher_auth_account_v1';
const IMPERSONATE_KEY = 'superadmin_impersonate_target_v1';

// Check if email belongs to Super Admin
export const isSuperAdminEmail = (email: string | null | undefined): boolean => {
  if (!email) return false;
  const lower = email.toLowerCase().trim();
  return lower === 'alimatlea@gmail.com';
};

// Default profile generator
export const createDefaultProfileForEmail = (
  uid: string,
  email: string,
  displayName?: string | null,
  photoURL?: string | null
): TeacherAccount => {
  const isSuper = isSuperAdminEmail(email);
  let firstName = '';
  let lastName = '';

  if (displayName) {
    const parts = displayName.trim().split(' ');
    if (parts.length > 0) firstName = parts[0];
    if (parts.length > 1) lastName = parts.slice(1).join(' ');
  } else if (email) {
    const username = email.split('@')[0];
    firstName = username.charAt(0).toUpperCase() + username.slice(1);
  }

  if (isSuper) {
    firstName = 'JP';
    lastName = 'Abgrall';
  }

  return {
    uid,
    email: email || 'prof@enseignant.fr',
    firstName,
    lastName,
    disciplines: isSuper ? ['Administration Globale', 'Informatique'] : [],
    // Un nouvel enseignant commence sans classe : il ajoute les siennes dans son profil.
    classes: isSuper ? ['Toutes les classes'] : [],
    role: isSuper ? 'super_admin' : 'teacher',
    photoURL: photoURL || undefined,
    updatedAt: new Date().toISOString(),
  };
};

// Save local teacher account
export const saveLocalTeacherAccount = (account: TeacherAccount) => {
  try {
    localStorage.setItem(LOCAL_AUTH_KEY, JSON.stringify(account));
  } catch (err) {
    console.error('Error saving local teacher account:', err);
  }
};

// Get local saved account
export const getLocalTeacherAccount = (): TeacherAccount | null => {
  try {
    const raw = localStorage.getItem(LOCAL_AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

// Sync profile to Firestore
export const syncTeacherProfileToFirestore = async (account: TeacherAccount): Promise<TeacherAccount> => {
  saveLocalTeacherAccount(account);
  try {
    const docRef = doc(db, TEACHERS_COLLECTION, account.uid);
    await setDoc(docRef, account, { merge: true });
  } catch (err) {
    console.warn('Firestore teacher sync fallback:', err);
  }
  return account;
};

// Load or create teacher profile from Firestore
export const fetchOrCreateTeacherProfile = async (
  firebaseUser: User
): Promise<TeacherAccount> => {
  const uid = firebaseUser.uid;
  const email = firebaseUser.email || '';
  const isSuper = isSuperAdminEmail(email);

  try {
    const docRef = doc(db, TEACHERS_COLLECTION, uid);
    const snap = await getDoc(docRef);

    if (snap.exists()) {
      const data = snap.data() as TeacherAccount;
      // Guarantee super_admin role if email is alimatlea@gmail.com
      if (isSuper && data.role !== 'super_admin') {
        data.role = 'super_admin';
        await setDoc(docRef, { role: 'super_admin' }, { merge: true });
      }
      saveLocalTeacherAccount(data);
      return data;
    }
  } catch (err) {
    console.warn('Error reading teacher doc from Firestore, creating default:', err);
  }

  const newProfile = createDefaultProfileForEmail(
    uid,
    email,
    firebaseUser.displayName,
    firebaseUser.photoURL
  );

  return await syncTeacherProfileToFirestore(newProfile);
};

// Direct fallback login for Super Admin when Google Auth is blocked by network/SSL filters (requires password)
export const loginAsSuperAdminFallback = async (password: string): Promise<TeacherAccount> => {
  if (!password || password.trim().length === 0) {
    throw new Error("Mot de passe requis pour valider et sécuriser l'accès Administrateur Global.");
  }

  try {
    const result = await signInWithEmailAndPassword(auth, 'alimatlea@gmail.com', password.trim());
    return await fetchOrCreateTeacherProfile(result.user);
  } catch (err: any) {
    // Plus de profil Super Admin de secours : un mot de passe refusé ne doit jamais ouvrir l'accès administrateur.
    console.warn('Firebase Email Auth for Super Admin failed:', err);
    throw new Error("Connexion Administrateur refusée : mot de passe incorrect ou réseau indisponible.");
  }
};

// Sign in with Google Popup
export const loginWithGoogle = async (): Promise<TeacherAccount> => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return await fetchOrCreateTeacherProfile(result.user);
  } catch (err: any) {
    console.error('Google Auth Error:', err);
    if (err.code === 'auth/popup-blocked' || err.code === 'auth/network-request-failed' || err.message?.includes('popup') || err.message?.includes('network') || err.message?.includes('authority')) {
      throw new Error("La connexion Google est restreinte par le réseau de l'établissement (filtrage SSL/proxy). Utilisez le bouton de connexion secours ci-dessous.");
    }
    throw new Error(err.message || 'Échec de la connexion avec Google');
  }
};

// Sign in with Email / Password
export const loginWithEmail = async (email: string, pass: string): Promise<TeacherAccount> => {
  const isSuper = isSuperAdminEmail(email);

  try {
    const result = await signInWithEmailAndPassword(auth, email.trim(), pass);
    return await fetchOrCreateTeacherProfile(result.user);
  } catch (err: any) {
    console.warn('Firebase Email Auth Failed, using fallback profile:', err);

    // Profil de secours uniquement si le réseau bloque Firebase, jamais pour un mot de passe refusé,
    // et jamais avec les droits Super Admin.
    if (err?.code !== 'auth/network-request-failed' || isSuper) {
      throw new Error('Connexion refusée : e-mail ou mot de passe incorrect.');
    }
    const localProfile = createDefaultProfileForEmail(`user-${Date.now()}`, email.trim());
    return await syncTeacherProfileToFirestore(localProfile);
  }
};

// Register with Email / Password
export const registerWithEmail = async (
  email: string,
  pass: string,
  firstName: string,
  lastName: string,
  disciplines: string[],
  classes: string[]
): Promise<TeacherAccount> => {
  const isSuper = isSuperAdminEmail(email);

  try {
    const result = await createUserWithEmailAndPassword(auth, email.trim(), pass);
    const profile: TeacherAccount = {
      uid: result.user.uid,
      email: email.trim(),
      firstName: firstName.trim() || 'Professeur',
      lastName: lastName.trim() || 'Enseignant',
      disciplines: disciplines.length > 0 ? disciplines : ['Mathématiques'],
      classes: classes.length > 0 ? classes : ['3ème A'],
      role: isSuper ? 'super_admin' : 'teacher',
      updatedAt: new Date().toISOString(),
    };
    return await syncTeacherProfileToFirestore(profile);
  } catch (err: any) {
    console.warn('Firebase Registration fallback to local mode:', err);
    const profile: TeacherAccount = {
      uid: `local-${Date.now()}`,
      email: email.trim(),
      firstName: firstName.trim() || 'Professeur',
      lastName: lastName.trim() || 'Enseignant',
      disciplines: disciplines.length > 0 ? disciplines : ['Mathématiques'],
      classes: classes.length > 0 ? classes : ['3ème A'],
      role: isSuper ? 'super_admin' : 'teacher',
      updatedAt: new Date().toISOString(),
    };
    saveLocalTeacherAccount(profile);
    return profile;
  }
};

// Logout
export const logoutTeacher = async (): Promise<void> => {
  try {
    await signOut(auth);
  } catch (err) {
    console.warn('Logout warning:', err);
  }
  localStorage.removeItem(LOCAL_AUTH_KEY);
  localStorage.removeItem(IMPERSONATE_KEY);
};

// Fetch all registered teachers (For Super Admin)
export const fetchAllTeachersForAdmin = async (): Promise<TeacherAccount[]> => {
  const defaultList: TeacherAccount[] = [
    createDefaultProfileForEmail('admin-alimatlea-1', 'alimatlea@gmail.com', 'JP Abgrall'),
  ];

  try {
    const snap = await getDocs(collection(db, TEACHERS_COLLECTION));
    if (!snap.empty) {
      const dbList = snap.docs.map(doc => doc.data() as TeacherAccount);
      // Merge dbList with defaultList ensuring no duplicates by uid
      const map = new Map<string, TeacherAccount>();
      defaultList.forEach(t => map.set(t.uid, t));
      dbList.forEach(t => map.set(t.uid, t));
      return Array.from(map.values());
    }
  } catch (err) {
    console.warn('Error fetching all teachers for admin:', err);
  }

  return defaultList;
};

// Impersonation Helpers
export const setImpersonatedTeacher = (teacher: TeacherAccount | null) => {
  if (teacher) {
    localStorage.setItem(IMPERSONATE_KEY, JSON.stringify(teacher));
  } else {
    localStorage.removeItem(IMPERSONATE_KEY);
  }
};

export const getImpersonatedTeacher = (): TeacherAccount | null => {
  try {
    const raw = localStorage.getItem(IMPERSONATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};
