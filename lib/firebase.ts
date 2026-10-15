import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';

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
testConnection();

