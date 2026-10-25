import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getFirestore, doc, getDocFromServer, connectFirestoreEmulator } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider, connectAuthEmulator, onAuthStateChanged, type User } from 'firebase/auth';
import appletConfigFile from '../firebase-applet-config.json';

// Sur o2switch, le serveur écrit les réglages dans la page (window.__FIREBASE_CONFIG__) : la base peut changer sans recompiler.
const firebaseConfig: typeof appletConfigFile & { emulators?: { host: string; firestorePort: number; authPort: number } } = {
  ...appletConfigFile,
  ...((typeof window !== 'undefined' && (window as any).__FIREBASE_CONFIG__) || {}),
};

let app: FirebaseApp;
if (getApps().length > 0) {
  app = getApp();
} else {
  try {
    app = initializeApp(firebaseConfig);
  } catch (error: any) {
    if (error?.code === 'app/duplicate-app' || error?.message?.includes('already exists')) {
      app = getApp();
    } else {
      throw error;
    }
  }
}

export { app };
export const db = firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

export const auth = getAuth(app);

// Tests locaux uniquement : le serveur lancé avec USE_FIREBASE_EMULATORS=1 indique les émulateurs Firebase.
if (firebaseConfig.emulators) {
  const e = firebaseConfig.emulators;
  connectAuthEmulator(auth, `http://${e.host}:${e.authPort}`, { disableWarnings: true });
  connectFirestoreEmulator(db, e.host, e.firestorePort);
}
export const googleProvider = new GoogleAuthProvider();

/** Attend que Firebase ait restauré la session (ou constaté qu'il n'y en a pas). */
export const authReady: Promise<User | null> = new Promise(resolve => {
  const unsub = onAuthStateChanged(auth, user => { unsub(); resolve(user); });
});

/** Adresse de l'administrateur (même règle que le serveur et les règles Firestore). */
export const ADMIN_EMAIL = 'alimatlea@gmail.com';
export const isAdminUser = (user: User | null | undefined) =>
  !!user?.email && user.email.toLowerCase() === ADMIN_EMAIL && user.emailVerified !== false;

// Échec d'enregistrement : l'application affiche un bandeau au lieu de se taire (voir SaveErrorBanner).
export const SAVE_ERROR_EVENT = 'plan-classe-save-error';
export const reportSaveError = (what: string, error: unknown) => {
  console.warn(`[Enregistrement] ${what} :`, error);
  handleFirestoreError(error, what);
  if (typeof window !== 'undefined') {
    const code = (error as any)?.code || '';
    const detail = code === 'permission-denied'
      ? "accès refusé (reconnectez-vous)"
      : code === 'unavailable' ? 'pas de connexion Internet' : ((error as any)?.message || String(error));
    window.dispatchEvent(new CustomEvent(SAVE_ERROR_EVENT, { detail: `${what} : ${detail}` }));
  }
};

// Quota state and notification tracker
let quotaExceededState = false;
const quotaSubscribers = new Set<(exceeded: boolean) => void>();

export const getIsQuotaExceeded = () => quotaExceededState;

export const subscribeToQuotaState = (callback: (exceeded: boolean) => void) => {
  quotaSubscribers.add(callback);
  callback(quotaExceededState);
  return () => {
    quotaSubscribers.delete(callback);
  };
};

export const markQuotaExceeded = () => {
  if (!quotaExceededState) {
    quotaExceededState = true;
    quotaSubscribers.forEach(cb => cb(true));
  }
};

export const clearQuotaExceeded = () => {
  quotaExceededState = false;
  quotaSubscribers.forEach(cb => cb(false));
};

export const handleFirestoreError = (error: unknown, operationType: string, path: string | null = null) => {
  const errMsg = error instanceof Error ? error.message : String(error);
  const errCode = (error as any)?.code || '';

  if (
    errCode === 'resource-exhausted' ||
    errMsg.includes('resource-exhausted') ||
    errMsg.includes('Quota limit exceeded') ||
    errMsg.includes('Quota exceeded') ||
    errMsg.includes('Free daily write units') ||
    errMsg.includes('Free daily read units')
  ) {
    markQuotaExceeded();
    console.warn(`[Firestore Quota Exceeded] ${operationType} path=${path || 'unknown'}: ${errMsg}`);
  } else {
    console.warn(`[Firestore Error] ${operationType} path=${path || 'unknown'}: ${errMsg}`);
  }
};

// Test connection on boot according to Firebase Integration Skill
export async function testConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    clearQuotaExceeded();
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('resource-exhausted') || msg.includes('Quota limit exceeded') || msg.includes('Quota exceeded')) {
      markQuotaExceeded();
      return false;
    } else if (msg.includes('the client is offline')) {
      console.warn("Please check your Firebase configuration or network.");
      return false;
    } else {
      // If error is code "not-found" (document test/connection doesn't exist), that means Firestore responds fine!
      clearQuotaExceeded();
      return true;
    }
  }
}

