import React, { useState, useEffect } from 'react';
import { subscribeToQuotaState, testConnection } from '../lib/firebase';

const FIREBASE_CONSOLE_URL = "https://console.firebase.google.com/project/gen-lang-client-0301284188/firestore/databases/ai-studio-plandeclasseia-81a53100-2107-4731-87b5-73225b704ef0/data?openUpgradeDialog=true";

export const QuotaNotificationBanner: React.FC = () => {
  const [isExceeded, setIsExceeded] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToQuotaState((exceeded) => {
      setIsExceeded(exceeded);
    });
    return () => unsubscribe();
  }, []);

  const handleTestConnection = async () => {
    setIsChecking(true);
    setFeedback(null);
    const ok = await testConnection();
    setIsChecking(false);
    if (ok) {
      setFeedback("✅ Connexion à la base de données Firestore rétablie !");
      setTimeout(() => setFeedback(null), 3000);
    } else {
      setFeedback("⚠️ La base de données renvoie encore une limite de quota.");
      setTimeout(() => setFeedback(null), 4000);
    }
  };

  if (!isExceeded || isDismissed) {
    return null;
  }

  return (
    <div className="w-full bg-gradient-to-r from-amber-600 via-orange-600 to-amber-700 text-white px-4 py-2.5 text-xs font-medium border-b border-amber-500 shadow-lg relative z-30 animate-fadeIn">
      <div className="container mx-auto flex flex-col sm:flex-row items-center justify-between gap-2.5">
        <div className="flex items-start sm:items-center gap-2">
          <span className="text-base shrink-0">⚠️</span>
          <div>
            <span className="font-bold">Information Base de données Firestore : </span>
            <span>
              Vos données et modifications sont enregistrées en sécurité <strong>localement dans votre navigateur (LocalStorage)</strong>. L'application continue de fonctionner normalement.
            </span>
            {feedback && (
              <div className="mt-1 font-bold text-amber-100 bg-black/20 px-2 py-0.5 rounded inline-block">
                {feedback}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-auto flex-wrap">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={isChecking}
            className="px-3 py-1 bg-amber-900 hover:bg-amber-950 text-white border border-amber-400 font-bold rounded-lg shadow-sm transition-all text-[11px] whitespace-nowrap cursor-pointer disabled:opacity-50"
          >
            {isChecking ? "⌛ Vérification..." : "🔄 Tester la connexion Firestore"}
          </button>

          <a
            href={FIREBASE_CONSOLE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1 bg-white text-amber-900 hover:bg-amber-50 font-black rounded-lg shadow-sm transition-all text-[11px] whitespace-nowrap"
          >
            📊 Console Firebase
          </a>

          <button
            type="button"
            onClick={() => setIsDismissed(true)}
            className="p-1 hover:bg-amber-800/60 rounded-md text-amber-100 hover:text-white transition-colors cursor-pointer text-sm"
            title="Masquer cet avertissement"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
};

export default QuotaNotificationBanner;
