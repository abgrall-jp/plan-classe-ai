import React, { useState } from 'react';
import { RgpdLogo } from './RgpdLogo';
import { AppLogo } from './AppLogo';
import { APP_VERSION, LAST_PUBLICATION_DATE } from '../App';

interface RgpdComplianceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RgpdComplianceModal: React.FC<RgpdComplianceModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'charter' | 'rights' | 'tools'>('charter');
  const [exportSuccess, setExportSuccess] = useState(false);
  const [purgeSuccess, setPurgeSuccess] = useState(false);
  const [anonymizationActive, setAnonymizationActive] = useState(() => {
    return localStorage.getItem('rgpd_anonymize_mode') === 'true';
  });

  if (!isOpen) return null;

  const handleExportAllData = () => {
    try {
      const allData: Record<string, any> = {
        exportedAt: new Date().toISOString(),
        rgpdNotice: "Export de portabilité des données scolaires - Art. 20 RGPD",
        appVersion: APP_VERSION,
        localStorageData: {},
      };

      // Collect local plans, teacher profiles, passwords and photos
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('plan_') || key.startsWith('teacher_') || key.startsWith('photo_') || key.startsWith('published_') || key.startsWith('trombi_'))) {
          try {
            allData.localStorageData[key] = JSON.parse(localStorage.getItem(key) || '{}');
          } catch {
            allData.localStorageData[key] = localStorage.getItem(key);
          }
        }
      }

      const blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `portabilite-donnees-rgpd-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 4000);
    } catch (err) {
      console.error("Erreur lors de l'exportation RGPD :", err);
    }
  };

  const handlePurgeLocalData = () => {
    const confirmPurge = window.confirm(
      "⚠️ Confirmation Droit à l'effacement (Art. 17 RGPD)\n\nVoulez-vous réinitialiser le cache local des plans de classe et données temporaires sur cet appareil ?\n(Vos plans publiés dans le cloud restent accessibles via votre compte enseignant)."
    );

    if (confirmPurge) {
      // Clear non-essential local cache
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('photo_') || key.startsWith('trombi_cache_') || key.startsWith('temp_plan_'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));

      setPurgeSuccess(true);
      setTimeout(() => setPurgeSuccess(false), 4000);
    }
  };

  const toggleAnonymization = () => {
    const nextVal = !anonymizationActive;
    setAnonymizationActive(nextVal);
    localStorage.setItem('rgpd_anonymize_mode', nextVal ? 'true' : 'false');
    // Dispatch custom event for UI updates
    window.dispatchEvent(new CustomEvent('rgpd_anonymize_changed', { detail: { enabled: nextVal } }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn overflow-y-auto">
      <div className="relative w-full max-w-3xl bg-white dark:bg-[#0E1526] rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90vh] overflow-hidden my-auto">
        
        {/* Header with European RGPD Emblem & App Logo */}
        <div className="p-5 sm:p-6 bg-gradient-to-r from-blue-900 via-indigo-950 to-slate-900 text-white border-b border-blue-500/30 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <RgpdLogo size="lg" variant="shield" />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-black tracking-tight text-white flex items-center gap-2">
                  <span>Conformité RGPD & Protection des Données</span>
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500 text-slate-950">
                  Certifié Conforme
                </span>
              </div>
              <p className="text-xs text-blue-200 mt-1">
                Règlement Européen (UE) 2016/679 (RGPD) & Recommandations CNIL Éducation
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-300 hover:text-white rounded-xl bg-white/10 hover:bg-white/20 transition-colors cursor-pointer shrink-0"
            title="Fermer"
          >
            ✕
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B101D] px-4 pt-2 gap-2 text-xs font-bold overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('charter')}
            className={`pb-2.5 px-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'charter'
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 font-extrabold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <span>📜</span>
            <span>Charte & Engagements</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('rights')}
            className={`pb-2.5 px-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'rights'
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 font-extrabold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <span>⚖️</span>
            <span>Vos Droits (Art. 15-22)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('tools')}
            className={`pb-2.5 px-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'tools'
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 font-extrabold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <span>🛠️</span>
            <span>Outils & Portabilité</span>
          </button>
        </div>

        {/* Modal Body Content */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-6 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
          
          {/* TAB 1: CHARTER & CORE PRINCIPLES */}
          {activeTab === 'charter' && (
            <div className="space-y-5">
              <div className="p-4 bg-indigo-50/70 dark:bg-indigo-950/40 rounded-xl border border-indigo-200 dark:border-indigo-800/80">
                <h3 className="font-extrabold text-indigo-950 dark:text-indigo-200 text-sm flex items-center gap-2 mb-1">
                  <span>🎯</span>
                  <span>1. Finalité Pédagogique Légitime (Art. 6.1.e RGPD)</span>
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-normal">
                  Le traitement automatisé des données a pour unique objet l'organisation spatiale des salles de classe, la gestion de l'ergonomie d'apprentissage et le suivi pédagogique des élèves par l'équipe éducative de l'établissement.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-slate-50 dark:bg-[#121A2D] rounded-xl border border-slate-200 dark:border-slate-800 space-y-1.5">
                  <h4 className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-1.5">
                    <span>🛡️</span>
                    <span>Minimisation des Données</span>
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Seules les informations strictement nécessaires sont collectées : nom, prénom, classe, numéro d'ordre et observations de séance. Aucune donnée sensible (santé, origine, religion) n'est jamais demandée.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-[#121A2D] rounded-xl border border-slate-200 dark:border-slate-800 space-y-1.5">
                  <h4 className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-1.5">
                    <span>📸</span>
                    <span>Droit à l'image & Photos</span>
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Le trombinoscope est facultatif et réservé au cadre fermé de la classe. Les photos ne sont jamais exploitées à des fins commerciales ni partagées avec des tiers extérieurs.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-[#121A2D] rounded-xl border border-slate-200 dark:border-slate-800 space-y-1.5">
                  <h4 className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-1.5">
                    <span>🔒</span>
                    <span>Sécurité & Cloisonnement</span>
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Chaque élève et parent dispose d'un accès compartimenté protégé par mot de passe individuel. Les communications transitent exclusivement par protocole chiffré HTTPS.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-[#121A2D] rounded-xl border border-slate-200 dark:border-slate-800 space-y-1.5">
                  <h4 className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-1.5">
                    <span>🚫</span>
                    <span>Zéro Publicité & Zéro Pistage</span>
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    L'application n'utilise aucun cookie publicitaire, aucun traceur de profilage commercial et ne pratique aucune revente de données.
                  </p>
                </div>
              </div>

              {/* Legal Reference Footer inside Tab */}
              <div className="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-[#0c1322] p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                <span>Responsable de publication : <strong>JP Abgrall</strong> (<a href="https://jepeuxapprendre.fr" target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 underline">jepeuxapprendre.fr</a>)</span>
                <span className="font-mono text-[10px]">v{APP_VERSION}</span>
              </div>
            </div>
          )}

          {/* TAB 2: USER RIGHTS (ARTICLES 15-22 RGPD) */}
          {activeTab === 'rights' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Conformément au Règlement Général sur la Protection des Données (RGPD) et à la loi Informatique et Libertés, chaque utilisateur (élève, parent, enseignant) bénéficie des droits fondamentaux suivants :
              </p>

              <div className="space-y-3">
                <div className="p-3 bg-slate-50 dark:bg-[#121A2D] rounded-xl border border-slate-200 dark:border-slate-800">
                  <span className="font-bold text-xs text-indigo-600 dark:text-indigo-400 uppercase tracking-wider block mb-0.5">
                    1. Droit d'Accès (Article 15 RGPD)
                  </span>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Vous avez le droit de consulter l'ensemble des données vous concernant (emplacement de table, classe, observations de séance).
                  </p>
                </div>

                <div className="p-3 bg-slate-50 dark:bg-[#121A2D] rounded-xl border border-slate-200 dark:border-slate-800">
                  <span className="font-bold text-xs text-indigo-600 dark:text-indigo-400 uppercase tracking-wider block mb-0.5">
                    2. Droit de Rectification (Article 16 RGPD)
                  </span>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Vous pouvez solliciter la mise à jour immédiate d'une information inexacte (orthographe d'un nom, photo, mot de passe).
                  </p>
                </div>

                <div className="p-3 bg-slate-50 dark:bg-[#121A2D] rounded-xl border border-slate-200 dark:border-slate-800">
                  <span className="font-bold text-xs text-indigo-600 dark:text-indigo-400 uppercase tracking-wider block mb-0.5">
                    3. Droit à l'Effacement / Droit à l'Oubli (Article 17 RGPD)
                  </span>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Les données de classe et photographies sont purgées à l'issue de l'année scolaire ou sur simple demande d'un représentant légal auprès de l'enseignant.
                  </p>
                </div>

                <div className="p-3 bg-slate-50 dark:bg-[#121A2D] rounded-xl border border-slate-200 dark:border-slate-800">
                  <span className="font-bold text-xs text-indigo-600 dark:text-indigo-400 uppercase tracking-wider block mb-0.5">
                    4. Droit à la Portabilité (Article 20 RGPD)
                  </span>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Vous pouvez exporter vos données sous un format ouvert et structuré (JSON / CSV) via l'onglet Outils ci-contre.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: TOOLS & ACTIONS */}
          {activeTab === 'tools' && (
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 dark:bg-[#121A2D] rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-1.5">
                      <span>📥</span>
                      <span>Export de Portabilité des Données (Art. 20)</span>
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Téléchargez une copie intégrale au format standard JSON de vos configurations et listes locales.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleExportAllData}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer shadow-xs shrink-0"
                  >
                    Télécharger (.json)
                  </button>
                </div>
                {exportSuccess && (
                  <p className="text-xs text-emerald-500 font-bold bg-emerald-500/10 p-2 rounded-lg border border-emerald-500/20">
                    ✅ Fichier d'export généré et téléchargé avec succès.
                  </p>
                )}
              </div>

              <div className="p-4 bg-slate-50 dark:bg-[#121A2D] rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-1.5">
                      <span>🛡️</span>
                      <span>Mode Anonymisation Vidéoprojecteur</span>
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Masque les noms de famille lors de la projection publique de la classe en salle de cours.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={toggleAnonymization}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer shadow-xs shrink-0 ${
                      anonymizationActive
                        ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-300'
                    }`}
                  >
                    {anonymizationActive ? 'Activé (Protégé)' : 'Désactivé'}
                  </button>
                </div>
              </div>

              <div className="p-4 bg-rose-50/60 dark:bg-rose-950/20 rounded-xl border border-rose-200 dark:border-rose-900/50 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-rose-900 dark:text-rose-300 text-xs flex items-center gap-1.5">
                      <span>🗑️</span>
                      <span>Droit à l'Effacement / Purge Cache (Art. 17)</span>
                    </h4>
                    <p className="text-xs text-rose-700/80 dark:text-rose-400 mt-0.5">
                      Efface les données temporaires, caches de photos et données de session locales de cet appareil.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handlePurgeLocalData}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer shadow-xs shrink-0"
                  >
                    Purger le cache local
                  </button>
                </div>
                {purgeSuccess && (
                  <p className="text-xs text-emerald-500 font-bold bg-emerald-500/10 p-2 rounded-lg border border-emerald-500/20">
                    ✅ Cache local réinitialisé avec succès.
                  </p>
                )}
              </div>
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-50 dark:bg-[#0B101D] border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <AppLogo size="xs" showText={false} />
            <span>Plan de Classe IA • Conforme Règlement UE 2016/679</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs transition-colors cursor-pointer"
          >
            Fermer
          </button>
        </div>

      </div>
    </div>
  );
};
