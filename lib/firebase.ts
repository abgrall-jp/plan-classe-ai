import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, connectAuthEmulator } from 'firebase/auth';
import appletConfig from '../firebase-applet-config.json';

// Le navigateur ne sert plus qu'à connecter les enseignants : les données passent par le serveur (/api).
// La configuration est écrite dans la page par le serveur ; le fichier sert de secours (vite seul).
const firebaseConfig = (window as any).__FIREBASE_CONFIG__ || appletConfig;

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
export const auth = getAuth(app);
if (firebaseConfig.emulators?.authPort) connectAuthEmulator(auth, `http://${location.hostname}:${firebaseConfig.emulators.authPort}`, { disableWarnings: true });
export const googleProvider = new GoogleAuthProvider();

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

// Vérifie au démarrage que le serveur répond.
export async function testConnection(): Promise<boolean> {
  try {
    const r = await fetch('/api/health');
    if (!r.ok) return false;
    clearQuotaExceeded();
    return true;
  } catch {
    console.warn("Le serveur du Plan de classe ne répond pas.");
    return false;
  }
}
testConnection();
