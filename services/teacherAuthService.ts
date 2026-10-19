import { auth, googleProvider, db, isAdminUser } from '../lib/firebase';
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
  return email.toLowerCase().trim() === 'alimatlea@gmail.com';
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
    classes: [],
    role: isSuper ? 'super_admin' : 'teacher',
    photoURL: photoURL || undefined,
    updatedAt: new Date().toISOString(),
  };
};

/**
 * Clé de stockage du navigateur propre à l'enseignant affiché (listes de classes, profil) :
 * deux collègues sur le même ordinateur de l'établissement ne voient pas les classes de l'autre.
 */
export const teacherStorageKey = (base: string): string => {
  const acc = getImpersonatedTeacher() || getLocalTeacherAccount();
  return acc?.uid ? `${base}:${acc.uid}` : `${base}:anonyme`;
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
  // La session locale n'est mise à jour que pour le compte connecté lui-même (pas quand l'administrateur modifie un collègue).
  if (!auth.currentUser || auth.currentUser.uid === account.uid) saveLocalTeacherAccount(account);
  try {
    const docRef = doc(db, TEACHERS_COLLECTION, account.uid);
    const { role, ...rest } = account;
    // Le rôle n'est écrit que par l'administrateur : un enseignant ne peut pas se l'attribuer.
    await setDoc(docRef, isAdminUser(auth.currentUser) ? account : rest, { merge: true });
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
      data.uid = uid;
      data.email = data.email || email;
      // Le rôle d'administrateur dépend seulement de l'adresse vérifiée, jamais du profil enregistré.
      data.role = isSuper && isAdminUser(firebaseUser) ? 'super_admin' : 'teacher';
      data.classes = Array.isArray(data.classes) ? data.classes : [];
      data.disciplines = Array.isArray(data.disciplines) ? data.disciplines : [];
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
  if (newProfile.role === 'super_admin' && !isAdminUser(firebaseUser)) newProfile.role = 'teacher';

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
    console.warn('Firebase Email Auth for Super Admin failed:', err);
    throw new Error("Connexion Administrateur refusée");
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

/** Message compréhensible pour les erreurs de connexion Firebase. */
export const authErrorMessage = (err: any): string => {
  const code = String(err?.code || '');
  if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-login-credentials'].includes(code)) {
    return "Adresse e-mail ou mot de passe incorrect.";
  }
  if (code === 'auth/email-already-in-use') return "Un compte existe déjà avec cette adresse : utilisez l'onglet « Connexion ».";
  if (code === 'auth/weak-password') return 'Le mot de passe doit comporter au moins 6 caractères.';
  if (code === 'auth/invalid-email') return "L'adresse e-mail n'est pas valide.";
  if (code === 'auth/too-many-requests') return 'Trop de tentatives. Réessayez dans quelques minutes.';
  if (code === 'auth/network-request-failed') return 'Connexion impossible : vérifiez votre accès à Internet.';
  return err?.message || 'Échec de la connexion.';
};

/**
 * Suit la session Firebase : renvoie le profil quand un enseignant est connecté,
 * et null quand la session a expiré (le profil gardé dans le navigateur est alors effacé).
 */
export const watchTeacherSession = (onChange: (account: TeacherAccount | null) => void) =>
  onAuthStateChanged(auth, async (user) => {
    if (!user || !user.email) {
      if (getLocalTeacherAccount()) {
        localStorage.removeItem(LOCAL_AUTH_KEY);
        localStorage.removeItem(IMPERSONATE_KEY);
        onChange(null);
      }
      return;
    }
    const local = getLocalTeacherAccount();
    if (local && local.uid === user.uid) return;
    try {
      onChange(await fetchOrCreateTeacherProfile(user));
    } catch {
      /* hors ligne : on garde l'état actuel */
    }
  });

// Sign in with Email / Password
export const loginWithEmail = async (email: string, pass: string): Promise<TeacherAccount> => {
  const isSuper = isSuperAdminEmail(email);

  try {
    const result = await signInWithEmailAndPassword(auth, email.trim(), pass);
    return await fetchOrCreateTeacherProfile(result.user);
  } catch (err: any) {
    console.warn('Firebase Email Auth Failed:', err);

    throw new Error(authErrorMessage(err));
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
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      disciplines: disciplines.filter(Boolean),
      classes: classes.filter(Boolean),
      role: isSuper && isAdminUser(result.user) ? 'super_admin' : 'teacher',
      updatedAt: new Date().toISOString(),
    };
    return await syncTeacherProfileToFirestore(profile);
  } catch (err: any) {
    console.warn('Firebase Registration error:', err);
    throw new Error(authErrorMessage(err));
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
  const defaultList: TeacherAccount[] = [];
  // Liste réservée à l'administrateur (les règles de la base refusent les autres comptes).
  if (!isAdminUser(auth.currentUser)) return defaultList;

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
