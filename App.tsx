import React, { useState, useCallback, useEffect } from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { Student, SavedLayout, ActivePlan } from './types';
import StudentInput from './components/StudentInput';
import ClassroomPlanner from './components/ClassroomPlanner';
import { RoleSelectionHome } from './components/RoleSelectionHome';
import { StudentPortal } from './components/StudentPortal';
import { ParentPortal } from './components/ParentPortal';
import { AppLogo } from './components/AppLogo';
import { RgpdLogo } from './components/RgpdLogo';
import { RgpdComplianceModal } from './components/RgpdComplianceModal';
import { QuotaNotificationBanner } from './components/QuotaNotificationBanner';

export const APP_VERSION = "2.2.0";
export const LAST_PUBLICATION_DATE = "18 septembre 2026";

export type UserRole = 'home' | 'student' | 'teacher' | 'parent';

const App: React.FC = () => {
  const [currentRole, setCurrentRole] = useState<UserRole>('home');
  const [activePlan, setActivePlan] = useState<ActivePlan | null>(null);
  const [step, setStep] = useState(1);
  const [isRgpdModalOpen, setIsRgpdModalOpen] = useState(false);

  // Mode sombre permanent par défaut (économies d'énergie et confort visuel)
  useEffect(() => {
    document.documentElement.classList.add('dark');
    localStorage.setItem('theme_mode', 'dark');
  }, []);

  const handleStudentsParsed = useCallback((
    parsedStudents: Student[],
    template?: {
      gridDimensions?: { rows: number; cols: number };
      unavailableCells?: number[];
      selectedClasses?: string[];
      teacherName?: string;
      periodName?: string;
    }
  ) => {
    setActivePlan({ 
        id: `plan-${Date.now()}`,
        students: parsedStudents,
        initialGridDimensions: template?.gridDimensions,
        initialUnavailableCells: template?.unavailableCells,
        selectedClasses: template?.selectedClasses,
        teacherName: template?.teacherName,
        periodName: template?.periodName,
    });
    setStep(2);
  }, []);
  
  const handleRestore = useCallback((
    layout: SavedLayout,
    meta?: { selectedClasses?: string[]; teacherName?: string; periodName?: string }
  ) => {
    setActivePlan({
      id: `plan-${Date.now()}`,
      students: layout.students,
      initialPlacements: layout.placements,
      initialGridDimensions: layout.gridDimensions,
      initialUnavailableCells: layout.unavailableCells,
      initialGroups: layout.groups,
      selectedClasses: meta?.selectedClasses,
      teacherName: meta?.teacherName,
      periodName: meta?.periodName,
    });
    setStep(3);
  }, []);

  const handleReset = useCallback(() => {
    setActivePlan(null);
    setStep(1);
  }, []);

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 dark:bg-[#0B0F17] text-slate-800 dark:text-slate-100 transition-colors duration-200">
      <QuotaNotificationBanner />
      <header className="bg-white/90 dark:bg-[#0E1524]/90 backdrop-blur-md shadow-sm dark:shadow-2xl dark:shadow-black/40 border-b border-slate-200 dark:border-slate-800/80 sticky top-0 z-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between h-auto sm:h-16 py-3 sm:py-0 gap-3">
            
            {/* Logo & Application Title */}
            <div
              onClick={() => setCurrentRole('home')}
              className="flex items-center space-x-3 cursor-pointer group"
              title="Retour à l'accueil"
            >
              <AppLogo size="sm" showText={false} />
              <div>
                <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                  Plan de Classe <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">IA</span>
                  {currentRole !== 'home' && (
                    <span className="text-[11px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider bg-indigo-100 text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                      {currentRole === 'student' ? '🎓 Élève' : currentRole === 'parent' ? '👨‍👩‍👧 Parent' : '👨‍🏫 Enseignant'}
                    </span>
                  )}
                </h1>
              </div>
            </div>

            {/* Navigation Role Selector, RGPD Badge & Teacher Steps */}
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setCurrentRole('home')}
                className={`px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${
                  currentRole === 'home'
                    ? 'bg-slate-900 text-white border-slate-900 dark:bg-indigo-600 dark:text-white dark:border-indigo-500 shadow-sm'
                    : 'bg-white dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700/80 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                🏠 Accueil
              </button>

              <button
                type="button"
                onClick={() => setCurrentRole('student')}
                className={`px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${
                  currentRole === 'student'
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm ring-2 ring-emerald-500/30'
                    : 'bg-white dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700/80 hover:bg-emerald-50 dark:hover:bg-slate-700'
                }`}
              >
                🎓 Espace Élève
              </button>

              <button
                type="button"
                onClick={() => setCurrentRole('parent')}
                className={`px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${
                  currentRole === 'parent'
                    ? 'bg-amber-600 text-white border-amber-600 shadow-sm ring-2 ring-amber-500/30'
                    : 'bg-white dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700/80 hover:bg-amber-50 dark:hover:bg-slate-700'
                }`}
              >
                👨‍👩‍👧 Espace Parent
              </button>

              <button
                type="button"
                onClick={() => setCurrentRole('teacher')}
                className={`px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${
                  currentRole === 'teacher'
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm ring-2 ring-indigo-500/30'
                    : 'bg-white dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700/80 hover:bg-indigo-50 dark:hover:bg-slate-700'
                }`}
              >
                👨‍🏫 Espace Enseignant
              </button>

              {/* RGPD Compliance Shield in Header */}
              <RgpdLogo
                variant="badge"
                size="sm"
                onClick={() => setIsRgpdModalOpen(true)}
              />

              {currentRole === 'teacher' && step > 1 && (
                <div className="flex items-center space-x-1 pl-2 border-l border-slate-300 dark:border-slate-700 text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className={`px-2 py-1 rounded-lg transition-all cursor-pointer ${
                      step === 1
                        ? 'bg-indigo-600 text-white font-semibold'
                        : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700'
                    }`}
                  >
                    1. Liste
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className={`px-2 py-1 rounded-lg transition-all cursor-pointer ${
                      step === 2
                        ? 'bg-indigo-600 text-white font-semibold'
                        : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700'
                    }`}
                  >
                    2. Réglages
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    className={`px-2 py-1 rounded-lg transition-all cursor-pointer ${
                      step === 3
                        ? 'bg-indigo-600 text-white font-semibold'
                        : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700'
                    }`}
                  >
                    3. Visu
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="w-full max-w-[1920px] mx-auto p-3 sm:p-5 lg:p-6 flex-grow">
        {currentRole === 'home' && (
          <RoleSelectionHome
            onSelectRole={(role) => setCurrentRole(role)}
            onOpenRgpd={() => setIsRgpdModalOpen(true)}
          />
        )}

        {currentRole === 'student' && (
          <StudentPortal onBackToHome={() => setCurrentRole('home')} />
        )}

        {currentRole === 'parent' && (
          <ParentPortal onBackToHome={() => setCurrentRole('home')} />
        )}

        {currentRole === 'teacher' && (
          <>
            {step === 1 && (
              <StudentInput 
                onStudentsParsed={handleStudentsParsed}
                onRestore={handleRestore}
              />
            )}
            {step > 1 && activePlan && (
              <DndProvider backend={HTML5Backend}>
                <ClassroomPlanner
                  key={activePlan.id}
                  plan={activePlan} 
                  onReset={handleReset} 
                  step={step}
                  setStep={setStep}
                />
              </DndProvider>
            )}
          </>
        )}
      </main>

      <footer className="w-full bg-white dark:bg-[#0E1524]/90 border-t border-slate-200 dark:border-slate-800/80 py-4 px-4 sm:px-6 lg:px-8">
        <div className="container mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-slate-600 dark:text-slate-400">
          <div className="flex items-center gap-3">
            <AppLogo size="xs" showText={false} />
            <p className="text-center md:text-left">
              L'application est en développement : merci d'envoyer vos remarques, demandes au concepteur &rarr; JP Abgrall :{' '}
              <a
                href="https://jepeuxapprendre.fr"
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
              >
                https://jepeuxapprendre.fr
              </a>
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap justify-center">
            {/* RGPD Compliance Footer Button */}
            <button
              type="button"
              onClick={() => setIsRgpdModalOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/60 text-blue-800 dark:text-blue-300 font-bold hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-colors cursor-pointer"
            >
              <span>🛡️</span>
              <span>Conformité RGPD & CNIL</span>
            </button>

            <div className="flex items-center gap-2 font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-900 px-3 py-1 rounded-full border border-slate-200 dark:border-slate-800 select-none">
              <span>Version {APP_VERSION}</span>
              <span className="text-slate-300 dark:text-slate-700">•</span>
              <span>Dernière publication : {LAST_PUBLICATION_DATE}</span>
            </div>
          </div>
        </div>
      </footer>

      {/* RGPD Compliance & Data Protection Interactive Modal */}
      <RgpdComplianceModal
        isOpen={isRgpdModalOpen}
        onClose={() => setIsRgpdModalOpen(false)}
      />
    </div>
  );
};

export default App;
