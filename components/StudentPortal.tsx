import React, { useState, useEffect, useMemo } from 'react';
import { StudentPlacement } from '../types';
import {
  PublishedPlan,
  subscribeToPublicPlans,
  loginToPlan,
  logoutFromPlan,
  getSessionPlan,
  updateStudentSeatInPlan,
  updateStudentPassword,
  deduplicatePlacements,
  getStudentRemarks
} from '../services/planSharingService';
import { UserIcon } from './icons/UserIcon';
import { GridIcon } from './icons/GridIcon';
import { useSeatingColors, getSeatBorderStyle } from '../services/seatingColorService';
import { StudentPhotoModal, PhotoModalData } from './StudentPhotoModal';
import { getStudentPhoto, subscribeToPhotoLibrary, syncPhotosFromLocalStorage, registerPhotosBatch } from '../services/photoLibraryService';
import { PlanZoomPanContainer } from './PlanZoomPanContainer';
import { StudentRemarksViewModal } from './StudentRemarksViewModal';
import { RgpdLogo } from './RgpdLogo';
import { ObstacleRenderer } from './ObstacleRenderer';

interface StudentPortalProps {
  onBackToHome: () => void;
}

export const StudentPortal: React.FC<StudentPortalProps> = ({ onBackToHome }) => {
  const { colors } = useSeatingColors();
  const [plans, setPlans] = useState<PublishedPlan[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [, setPhotoVersion] = useState<number>(0);

  // Photo modal state
  const [portalPhotoModalData, setPortalPhotoModalData] = useState<PhotoModalData | null>(null);

  // Student Remarks modal state
  const [selectedRemarksStudent, setSelectedRemarksStudent] = useState<{
    name: string;
    id?: number;
    photoUrl?: string;
    rollNumber?: string;
    location?: number | 'bank';
  } | null>(null);

  // Selection state
  const [selectedTeacher, setSelectedTeacher] = useState<string>('');
  const [selectedClass, setSelectedClass] = useState<string>('');
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);
  const [hoveredCellIndex, setHoveredCellIndex] = useState<number | null>(null);

  // Auth / Password state
  const [authStudentId, setAuthStudentId] = useState<number | null>(null);
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [showPasswordChangeModal, setShowPasswordChangeModal] = useState<boolean>(false);
  const [newPasswordInput, setNewPasswordInput] = useState<string>('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState<string>('');

  const [notification, setNotification] = useState<string | null>(null);

  // Initial sync & subscribe to photo changes in IndexedDB / cache
  useEffect(() => {
    syncPhotosFromLocalStorage();
    const unsub = subscribeToPhotoLibrary(() => {
      setPhotoVersion((v) => v + 1);
    });
    return () => unsub();
  }, []);

  // Subscribe to plan updates (relus régulièrement sur le serveur)
  useEffect(() => {
    logoutFromPlan();
    setLoading(true);
    const unsubscribe = subscribeToPublicPlans((freshPlans) => {
      syncPhotosFromLocalStorage();

      // Collect and register all photos from incoming plans into the photo cache
      const photosToRegister: Array<{ name: string; photoUrl: string; className?: string }> = [];
      freshPlans.forEach(plan => {
        if (Array.isArray(plan.placements)) {
          plan.placements.forEach(p => {
            if (p && p.name && p.photoUrl && typeof p.photoUrl === 'string' && p.photoUrl.trim()) {
              photosToRegister.push({
                name: p.name,
                photoUrl: p.photoUrl,
                className: plan.className,
              });
            }
          });
        }
      });

      if (photosToRegister.length > 0) {
        registerPhotosBatch(photosToRegister).catch(console.warn);
      }

      setPlans(freshPlans);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Filter list of unique teachers
  const teachers = useMemo(() => {
    const list = Array.from(new Set(plans.map(p => p.teacherName.trim()))).filter(Boolean);
    return list.sort();
  }, [plans]);

  // Classes for selected teacher
  const classesForTeacher = useMemo(() => {
    if (!selectedTeacher) return [];
    const set = new Set<string>();
    plans
      .filter(p => p.teacherName.trim().toLowerCase() === selectedTeacher.trim().toLowerCase())
      .forEach(p => {
        if (p.className) {
          p.className.split(',').forEach(c => {
            const trimmed = c.trim();
            if (trimmed) set.add(trimmed);
          });
        }
      });
    return Array.from(set).sort();
  }, [plans, selectedTeacher]);

  // Plans available for teacher & class
  const availablePlans = useMemo(() => {
    if (!selectedTeacher || !selectedClass) return [];
    return plans.filter(p => {
      const teacherMatch = p.teacherName.trim().toLowerCase() === selectedTeacher.trim().toLowerCase();
      const classList = p.className.split(',').map(c => c.trim().toLowerCase());
      const classMatch = classList.includes(selectedClass.trim().toLowerCase()) || p.className.trim().toLowerCase() === selectedClass.trim().toLowerCase();
      return teacherMatch && classMatch;
    });
  }, [plans, selectedTeacher, selectedClass]);

  // Auto-select available plan when available
  useEffect(() => {
    if (availablePlans.length > 0) {
      if (!selectedPlanId || !availablePlans.some(p => p.id === selectedPlanId)) {
        setSelectedPlanId(availablePlans[0].id);
      }
    } else {
      setSelectedPlanId('');
    }
  }, [availablePlans, selectedPlanId]);

  // Active selected plan
  const activePlan = useMemo(() => {
    return plans.find(p => p.id === selectedPlanId) || null;
  }, [plans, selectedPlanId]);

  // Helper to extract placements array safely and deduplicated
  const activePlacementsList = useMemo(() => {
    if (!activePlan) return [];
    let rawList: any[] = [];
    if (Array.isArray(activePlan.placements)) {
      rawList = activePlan.placements;
    } else if (activePlan.placements && typeof activePlan.placements === 'object') {
      rawList = Object.values(activePlan.placements);
    } else if ((activePlan as any).students && Array.isArray((activePlan as any).students)) {
      rawList = (activePlan as any).students.map((s: any) => ({
        id: s.id,
        name: s.name,
        rollNumber: s.rollNumber || '',
        location: 'bank'
      }));
    }
    return deduplicatePlacements(rawList);
  }, [activePlan]);

  // Student list in current plan (deduplicated & sorted alphabetically)
  const studentsInPlan = useMemo(() => {
    return activePlacementsList
      .slice()
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [activePlacementsList]);

  const showToast = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3500);
  };

  // Password submission handler
  // Le plan complet (photos de la classe, remarques de l'élève) n'arrive qu'après connexion.
  const mettreAJourPlan = (complet: PublishedPlan | null | undefined) => {
    if (!complet) return;
    setPlans(prev => prev.map(p => (p.id === complet.id ? { ...complet, placements: deduplicatePlacements(complet.placements || []) } : p)));
  };

  const handleVerifyPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePlan || selectedStudentId === null) return;

    setPasswordError(null);
    const { valid, requiresPasswordChange, message } = await loginToPlan(
      activePlan.id,
      selectedStudentId,
      passwordInput,
      'student'
    );

    if (!valid) {
      setPasswordError(message || "Mot de passe incorrect. (Par défaut : 0000)");
      return;
    }
    mettreAJourPlan(await getSessionPlan());

    if (requiresPasswordChange) {
      setShowPasswordChangeModal(true);
      return;
    }

    // Auth Success directly
    setAuthStudentId(selectedStudentId);
    showToast("Connexion réussie !");
  };

  // Save new custom password
  const handleChangePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePlan || selectedStudentId === null) return;

    if (newPasswordInput.trim().length < 4) {
      setPasswordError("Le nouveau mot de passe doit comporter au moins 4 caractères.");
      return;
    }

    if (newPasswordInput.trim() === '0000') {
      setPasswordError("Veuillez choisir un mot de passe différent de 0000.");
      return;
    }

    if (newPasswordInput.trim() !== confirmPasswordInput.trim()) {
      setPasswordError("Les mots de passe ne correspondent pas.");
      return;
    }

    setPasswordError(null);
    const updatedPlan = await updateStudentPassword(
      activePlan.id,
      selectedStudentId,
      newPasswordInput.trim()
    );

    if (updatedPlan) {
      mettreAJourPlan(updatedPlan);
      setShowPasswordChangeModal(false);
      setAuthStudentId(selectedStudentId);
      showToast("Mot de passe mis à jour avec succès ! Bienvenue.");
    }
  };

  // Move or assign student seat
  const handleCellClick = async (cellIndex: number) => {
    if (!activePlan) return;
    if (activePlan.isFrozen) {
      showToast("🔒 Ce plan de classe est figé par l'enseignant. Vous ne pouvez pas modifier votre place.");
      return;
    }
    if (!activePlan.allowStudentSelfPlacement) {
      showToast("Le placement libre est désactivé par l'enseignant.");
      return;
    }
    if (authStudentId === null) {
      showToast("Connectez-vous d'abord en choisissant votre nom et votre mot de passe.");
      return;
    }

    if (activePlan.unavailableCells.includes(cellIndex)) {
      showToast("Cet emplacement est indisponible dans la salle.");
      return;
    }

    const res = await updateStudentSeatInPlan(activePlan.id, authStudentId, cellIndex);
    if (res.success) {
      mettreAJourPlan(res.plan);
      const st = activePlan.placements.find(p => p.id === authStudentId);
      showToast(`Bravo ${st?.name || ''} ! Ta place a été enregistrée à la table #${cellIndex + 1}.`);
    } else if (res.message) {
      showToast(res.message);
    }
  };

  const handleUnseatStudent = async () => {
    if (!activePlan || authStudentId === null) return;
    const res = await updateStudentSeatInPlan(activePlan.id, authStudentId, 'bank');
    if (res.success) {
      mettreAJourPlan(res.plan);
      showToast("Ta place a été libérée.");
    }
  };

  // Cell occupant map
  const placementMap = useMemo(() => {
    const map = new Map<number, StudentPlacement>();
    if (activePlan) {
      activePlacementsList.forEach(p => {
        if (p && typeof p.location === 'number') {
          map.set(p.location, p);
        }
      });
    }
    return map;
  }, [activePlan, activePlacementsList]);

  const authenticatedStudentObj = useMemo(() => {
    if (!activePlan || authStudentId === null) return null;
    return activePlacementsList.find(p => p && p.id === authStudentId) || null;
  }, [activePlan, authStudentId, activePlacementsList]);

  const unplacedStudentsInPortal = useMemo(() => {
    return activePlacementsList.filter(p => p && (p.location === 'bank' || typeof p.location !== 'number'));
  }, [activePlacementsList]);

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Notification Toast */}
      {notification && (
        <div className="fixed bottom-16 right-4 z-50 bg-emerald-900 text-white px-4 py-3 rounded-xl shadow-2xl text-sm font-semibold animate-bounce border border-emerald-600 flex items-center gap-2">
          <span>✨ {notification}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-2xl p-6 text-white shadow-xl border border-emerald-500/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-500/20 border border-emerald-500/30 rounded-full text-xs font-bold uppercase tracking-wider text-emerald-300">
              <span>🎓 Espace Élève</span>
            </div>
            <RgpdLogo size="xs" variant="badge" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Consulter & Choisir Ma Place</h2>
          <p className="text-slate-300 text-sm mt-1">
            Sélectionne ton enseignant, ta classe et ton nom pour accéder à ton plan de classe en temps réel.
          </p>
        </div>
        <button
          onClick={onBackToHome}
          className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded-xl text-xs font-semibold transition-all backdrop-blur-sm self-stretch md:self-auto text-center"
        >
          &larr; Accueil / Changer de Rôle
        </button>
      </div>

      {/* Filter & Selection Panel */}
      <div className="bg-white dark:bg-[#111827]/90 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-800 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          
          {/* 1. Teacher Selection */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
              1. Sélectionner l'enseignant
            </label>
            <select
              value={selectedTeacher}
              onChange={(e) => {
                setSelectedTeacher(e.target.value);
                setSelectedClass('');
                setSelectedPlanId('');
                setSelectedStudentId(null);
                setAuthStudentId(null);
                logoutFromPlan();
              }}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] px-4 py-2.5 text-sm font-medium text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            >
              <option value="">-- Choisir un enseignant --</option>
              {teachers.map((t) => (
                <option key={t} value={t}>
                  👨‍🏫 {t}
                </option>
              ))}
            </select>
          </div>

          {/* 2. Class Selection */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
              2. Sélectionner la classe
            </label>
            <select
              disabled={!selectedTeacher}
              value={selectedClass}
              onChange={(e) => {
                setSelectedClass(e.target.value);
                setSelectedPlanId('');
                setSelectedStudentId(null);
                setAuthStudentId(null);
                logoutFromPlan();
              }}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] px-4 py-2.5 text-sm font-medium text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none disabled:opacity-50"
            >
              <option value="">-- Choisir la classe --</option>
              {classesForTeacher.map((c) => (
                <option key={c} value={c}>
                  🏫 Classe {c}
                </option>
              ))}
            </select>
          </div>

          {/* 3. Period / Plan Selection */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
              3. Période / Plan
            </label>
            <select
              disabled={!selectedClass}
              value={selectedPlanId}
              onChange={(e) => {
                setSelectedPlanId(e.target.value);
                setSelectedStudentId(null);
                setAuthStudentId(null);
                logoutFromPlan();
              }}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] px-4 py-2.5 text-sm font-medium text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none disabled:opacity-50"
            >
              <option value="">-- Choisir le plan --</option>
              {availablePlans.map((p, pIdx) => (
                <option key={`portal-plan-opt-${p.id}-${pIdx}`} value={p.id}>
                  📅 {p.period} {p.isFrozen ? '(🔒 Figé)' : p.allowStudentSelfPlacement ? '(Placement libre)' : '(Lecture seule)'}
                </option>
              ))}
            </select>
          </div>

        </div>

        {/* 4. Student Name Selection & Login Prompt */}
        {activePlan && (
          <div className="border-t border-slate-200 dark:border-slate-800 pt-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                <UserIcon className="h-4 w-4" />
                4. Choisis ton nom dans la liste :
              </label>
              {authStudentId !== null && (
                <span className="text-xs font-bold text-emerald-600 bg-emerald-100 dark:bg-emerald-950/80 px-3 py-1 rounded-full border border-emerald-300 dark:border-emerald-700">
                  Connecté en tant que : {authenticatedStudentObj?.name}
                </span>
              )}
            </div>

            {authStudentId === null ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 max-h-72 overflow-y-auto p-2.5 bg-slate-50 dark:bg-[#0B0F17] rounded-xl border border-slate-200 dark:border-slate-800">
                {studentsInPlan.map((st, stIdx) => {
                  const studentPhoto = getStudentPhoto(st.name, st.photoUrl);
                  const isSelected = selectedStudentId === st.id;
                  return (
                    <button
                      key={`portal-st-${st.id}-${st.name}-${stIdx}`}
                      type="button"
                      onClick={() => {
                        setSelectedStudentId(st.id);
                        setPasswordInput('');
                        setPasswordError(null);
                      }}
                      className={`p-2.5 rounded-xl text-xs font-semibold transition-all text-left flex items-center justify-between gap-2.5 cursor-pointer ${
                        isSelected
                          ? 'bg-emerald-600 text-white shadow-md ring-2 ring-emerald-400 scale-[1.01]'
                          : 'bg-white dark:bg-[#161F30] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700/80 hover:border-emerald-500 hover:shadow-xs'
                      }`}
                    >
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="truncate font-bold text-xs">{st.name}</span>
                        {st.rollNumber && (
                          <span className={`text-[10px] font-mono ${isSelected ? 'text-emerald-100' : 'text-slate-400'}`}>
                            N°{st.rollNumber}
                          </span>
                        )}
                      </div>

                      {/* Photo to the right of student name */}
                      <div className="flex items-center gap-1.5 shrink-0 ml-1">
                        {studentPhoto ? (
                          <img
                            src={studentPhoto}
                            alt={st.name}
                            className={`w-7 h-8.5 rounded-md object-cover border shadow-2xs ${
                              isSelected ? 'border-white ring-1 ring-white/50' : 'border-slate-300 dark:border-slate-600'
                            }`}
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className={`w-7 h-8.5 rounded-md flex items-center justify-center text-[10px] font-bold border ${
                            isSelected
                              ? 'bg-emerald-700/80 border-white text-white'
                              : 'bg-slate-100 dark:bg-slate-700/60 border-slate-300 dark:border-slate-600 text-slate-400'
                          }`}>
                            👤
                          </div>
                        )}
                        {isSelected && <span className="text-xs">🔑</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (() => {
              const authPhoto = getStudentPhoto(authenticatedStudentObj?.name, authenticatedStudentObj?.photoUrl);
              return (
                <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 rounded-xl flex items-center justify-between gap-3 text-xs shadow-xs">
                  <div className="flex items-center gap-3 min-w-0">
                    {authPhoto ? (
                      <button
                        type="button"
                        onClick={() => {
                          setPortalPhotoModalData({
                            name: authenticatedStudentObj?.name || '',
                            photoUrl: authPhoto,
                            rollNumber: authenticatedStudentObj?.rollNumber,
                            className: activePlan.className,
                            seatInfo: typeof authenticatedStudentObj?.location === 'number' ? `Table #${authenticatedStudentObj.location + 1}` : 'Non assis',
                          });
                        }}
                        className="w-9 h-11 rounded-lg overflow-hidden border-2 border-emerald-500 shadow-xs shrink-0 cursor-pointer hover:scale-105 transition-transform"
                        title="Agrandir ma photo"
                      >
                        <img
                          src={authPhoto}
                          alt={authenticatedStudentObj?.name}
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      </button>
                    ) : (
                      <div className="w-9 h-11 rounded-lg bg-emerald-200 dark:bg-emerald-900 border-2 border-emerald-500 flex items-center justify-center text-sm text-emerald-700 dark:text-emerald-300 shrink-0 font-bold">
                        👤
                      </div>
                    )}
                    <div>
                      <p className="text-emerald-950 dark:text-emerald-100 font-extrabold text-sm">
                        👋 Bonjour <strong>{authenticatedStudentObj?.name}</strong> !
                      </p>
                      <p className="text-emerald-700 dark:text-emerald-300 text-xs mt-0.5">
                        {typeof authenticatedStudentObj?.location === 'number'
                          ? `📍 Ta place actuelle est à la table #${authenticatedStudentObj.location + 1}.`
                          : '⚠️ Tu n\'as pas encore choisi de place. Clique sur une chaise libre dans la grille !'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setAuthStudentId(null);
                logoutFromPlan();
                      setSelectedStudentId(null);
                    }}
                    className="px-3.5 py-1.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 font-bold text-xs shadow-xs cursor-pointer"
                  >
                    Déconnexion
                  </button>
                </div>
              );
            })()}

            {/* Password Login Dialog Box */}
            {selectedStudentId !== null && authStudentId === null && !showPasswordChangeModal && (() => {
              const targetStudent = studentsInPlan.find(s => s.id === selectedStudentId);
              const targetPhoto = targetStudent ? getStudentPhoto(targetStudent.name, targetStudent.photoUrl) : undefined;
              return (
                <form onSubmit={handleVerifyPassword} className="bg-emerald-50 dark:bg-emerald-950/50 border-2 border-emerald-400 dark:border-emerald-700 rounded-xl p-4 space-y-3 max-w-md mx-auto shadow-md">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      {targetPhoto ? (
                        <img
                          src={targetPhoto}
                          alt={targetStudent?.name}
                          className="w-9 h-11 rounded-lg object-cover border-2 border-emerald-500 shadow-xs shrink-0"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-9 h-11 rounded-lg bg-emerald-200 dark:bg-emerald-900 border border-emerald-400 flex items-center justify-center text-sm shrink-0">
                          👤
                        </div>
                      )}
                      <div>
                        <h4 className="text-sm font-bold text-emerald-900 dark:text-emerald-100">
                          🔑 Mot de passe
                        </h4>
                        <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                          {targetStudent?.name}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedStudentId(null)}
                      className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 underline cursor-pointer"
                    >
                      Fermer
                    </button>
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    Entrez votre mot de passe (par défaut : <code className="font-bold bg-white dark:bg-slate-800 px-1 py-0.5 rounded border border-slate-300 dark:border-slate-700">0000</code>).
                  </p>

                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      placeholder="Saisir votre mot de passe"
                      autoFocus
                      className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-[#0B0F17] dark:text-white focus:ring-2 focus:ring-emerald-500"
                    />
                    <button
                      type="submit"
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg shadow-sm cursor-pointer"
                    >
                      Valider
                    </button>
                  </div>

                  {passwordError && (
                    <p className="text-xs font-semibold text-red-600 dark:text-red-400">
                      ⚠️ {passwordError}
                    </p>
                  )}
                </form>
              );
            })()}

            {/* Mandatory First-Time Password Change Modal */}
            {showPasswordChangeModal && (
              <form onSubmit={handleChangePasswordSubmit} className="bg-amber-50 dark:bg-amber-950/60 border-2 border-amber-400 dark:border-amber-700 rounded-xl p-5 space-y-3 max-w-md mx-auto shadow-lg">
                <div className="text-amber-900 dark:text-amber-100">
                  <h4 className="text-sm font-extrabold flex items-center gap-2">
                    🔒 Première connexion : Personnalisation du mot de passe
                  </h4>
                  <p className="text-xs mt-1">
                    Votre mot de passe actuel est la valeur par défaut (<code className="font-bold">0000</code>). Vous devez choisir un mot de passe personnel pour sécuriser votre accès.
                  </p>
                </div>

                <div className="space-y-2">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Nouveau mot de passe personnel (min 4 car.)
                    </label>
                    <input
                      type="password"
                      value={newPasswordInput}
                      onChange={(e) => setNewPasswordInput(e.target.value)}
                      placeholder="Ex : MonP@ss2026"
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-[#0B0F17] dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Confirmer le nouveau mot de passe
                    </label>
                    <input
                      type="password"
                      value={confirmPasswordInput}
                      onChange={(e) => setConfirmPasswordInput(e.target.value)}
                      placeholder="Confirmer le mot de passe"
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-[#0B0F17] dark:text-white"
                    />
                  </div>
                </div>

                {passwordError && (
                  <p className="text-xs font-semibold text-red-600 dark:text-red-400">
                    ⚠️ {passwordError}
                  </p>
                )}

                <button
                  type="submit"
                  className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-lg shadow"
                >
                  Enregistrer mon nouveau mot de passe
                </button>
              </form>
            )}

          </div>
        )}

      </div>

      {/* Plan Visualizer */}
      {activePlan ? (
        <div className="bg-white dark:bg-[#111827]/90 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-800 space-y-6">
          
          {/* Plan Info Banner */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 dark:bg-[#0B0F17] p-4 rounded-xl border border-slate-200 dark:border-slate-800">
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span>🏫 Classe {activePlan.className}</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 font-semibold">
                  {activePlan.period}
                </span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Enseignant : <strong className="text-slate-700 dark:text-slate-200">{activePlan.teacherName}</strong>
                <span className="mx-2">•</span>
                <span>📐 Grille {activePlan.gridDimensions.rows}×{activePlan.gridDimensions.cols} ({activePlan.gridDimensions.rows * activePlan.gridDimensions.cols} places)</span>
              </p>
            </div>

            <div>
              {activePlan.isFrozen ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 text-xs font-bold rounded-full border border-amber-300 dark:border-amber-700">
                  🔒 Plan Figé par l'Enseignant
                </span>
              ) : activePlan.allowStudentSelfPlacement ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 text-xs font-bold rounded-full border border-emerald-300 dark:border-emerald-700">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  Placement libre autorisé
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-300 text-xs font-bold rounded-full border border-slate-300 dark:border-slate-700">
                  Lecture seule
                </span>
              )}
            </div>
          </div>

          {/* Interactive Instruction Banner */}
          {authStudentId !== null && (() => {
            const myPhoto = getStudentPhoto(authenticatedStudentObj?.name, authenticatedStudentObj?.photoUrl);
            const myRemarks = authenticatedStudentObj ? getStudentRemarks(activePlan, authenticatedStudentObj.name, authenticatedStudentObj.id) : [];
            const canPlace = !activePlan.isFrozen && activePlan.allowStudentSelfPlacement;

            return (
              <div className="p-3.5 bg-gradient-to-r from-emerald-600 to-teal-700 text-white rounded-xl text-xs font-semibold flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-md border border-emerald-400/30">
                <div className="flex items-center gap-3">
                  {myPhoto ? (
                    <img
                      src={myPhoto}
                      alt={authenticatedStudentObj?.name}
                      className="w-9 h-11 rounded-lg object-cover border-2 border-white shadow-xs shrink-0"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-9 h-11 rounded-lg bg-emerald-800 border-2 border-white flex items-center justify-center text-sm font-bold shrink-0">
                      👤
                    </div>
                  )}
                  <div>
                    <p className="font-extrabold text-sm flex items-center gap-1.5">
                      <span>🎯</span>
                      <span>Bonjour, {authenticatedStudentObj?.name}</span>
                    </p>
                    <p className="text-emerald-100 text-xs mt-0.5">
                      {canPlace
                        ? "Survole et clique sur n'importe quelle chaise libre dans la grille ci-dessous pour t'installer ou changer de place."
                        : "Consulte ci-dessous ta position dans la classe et les indications de ton enseignant."}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Direct button to check remarks */}
                  {authenticatedStudentObj && (
                    <button
                      type="button"
                      onClick={() => setSelectedRemarksStudent(authenticatedStudentObj)}
                      className="px-3 py-1.5 bg-emerald-950/80 hover:bg-emerald-900 text-white rounded-lg font-bold text-xs border border-emerald-400/40 shadow-xs flex items-center gap-1.5 cursor-pointer transition-colors"
                      title="Consulter les remarques et indications de l'enseignant"
                    >
                      <span>📝 Mes Remarques</span>
                      {myRemarks.length > 0 ? (
                        <span className="px-1.5 py-0.2 bg-amber-400 text-emerald-950 text-[10px] font-black rounded-full">
                          {myRemarks.length}
                        </span>
                      ) : null}
                    </button>
                  )}

                  {canPlace && typeof authenticatedStudentObj?.location === 'number' && (
                    <button
                      onClick={handleUnseatStudent}
                      className="px-3 py-1.5 bg-emerald-900/80 hover:bg-emerald-950 text-white rounded-lg font-bold text-xs border border-emerald-400/40 shadow-xs shrink-0 transition-colors cursor-pointer"
                    >
                      Libérer ma place
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

          {activePlan.isFrozen && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-xs font-medium text-amber-800 dark:text-amber-200 flex items-center gap-2">
              <span>🔒</span>
              <span>L'enseignant a figé le plan pour cette période. Vous ne pouvez plus déplacer votre chaise.</span>
            </div>
          )}

          {/* Mobile horizontal scroll hint & Legend */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-400 font-semibold">Légende des cadres :</span>
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-slate-800/80 border border-slate-700">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colors.available }} />
                <span className="font-semibold text-slate-300">Libre</span>
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-slate-800/80 border border-slate-700">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colors.occupied }} />
                <span className="font-semibold text-slate-300">Occupé</span>
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-slate-800/80 border border-slate-700">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colors.unavailable }} />
                <span className="font-semibold text-slate-300">Indisponible</span>
              </span>
            </div>
            <span className="text-[11px] text-slate-500 font-mono sm:hidden">
              👈 {activePlan.gridDimensions.cols} colonnes 👉
            </span>
          </div>

          {/* Seating Grid Canvas & Unplaced Students Sidebar Container */}
          <div className="flex flex-col lg:flex-row gap-4 items-start">
            <div className="flex-1 w-full space-y-3 min-w-0">
              
              {/* Seating Grid Container with Zoom and Right-Click Pan */}
              <PlanZoomPanContainer
                helperText="🖱️ Clic droit enfoncé pour faire défiler la salle • 📐 Bouton Ajuster pour tout voir"
              >
                <div className="w-full rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-[#0B0F17]/80 p-3 sm:p-4 shadow-inner">
                  <div
                    style={{
                      minWidth: `${Math.max(activePlan.gridDimensions.cols * 120, 320)}px`,
                      width: '100%',
                    }}
                    className="space-y-3 mx-0"
                  >
                  {/* Blackboard / Desk Front (Aligned with Seating Grid) */}
                  <div className="w-full py-2.5 bg-gradient-to-r from-slate-800 via-slate-700 to-slate-800 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 text-slate-200 text-center text-xs font-bold uppercase tracking-widest rounded-xl shadow-md border border-slate-600 dark:border-slate-700 flex items-center justify-center gap-2">
                    <span>📺</span>
                    <span>Bureau Enseignant / Tableau</span>
                  </div>

                  {/* Seating Grid */}
                  <div
                    className="grid gap-2.5 sm:gap-3 rounded-xl bg-white dark:bg-[#111827]/90 border border-slate-200 dark:border-slate-800/90 p-3 sm:p-4"
                    style={{
                      gridTemplateColumns: `repeat(${activePlan.gridDimensions.cols}, minmax(105px, 1fr))`,
                      width: '100%',
                    }}
                  >
                    {Array.from({ length: activePlan.gridDimensions.rows * activePlan.gridDimensions.cols }).map((_, cellIdx) => {
                      const isUnavailable = activePlan.unavailableCells.includes(cellIdx);
                      const occupant = placementMap.get(cellIdx);
                      const isMe = occupant && occupant.id === authStudentId;

                      const status: 'available' | 'occupied' | 'unavailable' = isUnavailable
                        ? 'unavailable'
                        : occupant
                        ? 'occupied'
                        : 'available';

                      const frameStyle = getSeatBorderStyle(status, colors, isMe);

                      if (isUnavailable) {
                        const obstacle = activePlan.cellObstacles?.[cellIdx];
                        return (
                          <div
                            key={cellIdx}
                            style={{
                              borderColor: frameStyle.borderColor,
                              borderWidth: frameStyle.borderWidth,
                              borderStyle: frameStyle.borderStyle,
                              boxShadow: frameStyle.boxShadow,
                            }}
                            className="h-20 bg-slate-200/50 dark:bg-slate-900/50 rounded-xl flex flex-col items-center justify-center text-[10px] select-none p-1 text-center"
                          >
                            <ObstacleRenderer
                              obstacle={obstacle}
                              labelColor={colors.unavailable}
                              size="md"
                            />
                          </div>
                        );
                      }

                      const canPlaceHere = !activePlan.isFrozen && activePlan.allowStudentSelfPlacement && authStudentId !== null && !occupant && !isUnavailable;
                      const isHovered = hoveredCellIndex === cellIdx;

                      return (
                        <div
                          key={cellIdx}
                          onClick={() => handleCellClick(cellIdx)}
                          onMouseEnter={() => setHoveredCellIndex(cellIdx)}
                          onMouseLeave={() => setHoveredCellIndex(null)}
                          style={{
                            borderColor: isHovered && canPlaceHere ? colors.available : frameStyle.borderColor,
                            borderWidth: frameStyle.borderWidth,
                            borderStyle: frameStyle.borderStyle,
                            boxShadow: isMe
                              ? `0 0 0 2px ${colors.available}, 0 0 16px ${colors.available}44`
                              : isHovered && canPlaceHere
                              ? `0 0 0 2px ${colors.available}, 0 0 12px ${colors.available}33`
                              : frameStyle.boxShadow,
                          }}
                          className={`h-20 rounded-xl p-1.5 sm:p-2 flex flex-col justify-between transition-all select-none relative ${
                            !activePlan.isFrozen && activePlan.allowStudentSelfPlacement && authStudentId !== null
                              ? 'cursor-pointer hover:scale-[1.02]'
                              : ''
                          } ${
                            isMe
                              ? 'bg-emerald-500/20 dark:bg-emerald-950/90 scale-105 z-10'
                              : isHovered && canPlaceHere
                              ? 'bg-emerald-50 dark:bg-emerald-950/60 ring-2 ring-emerald-400 z-10'
                              : occupant
                              ? 'bg-white dark:bg-[#161F30]'
                              : 'bg-white/80 dark:bg-[#0E1524]/60 hover:bg-emerald-50/30'
                          }`}
                        >
                          <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 dark:text-slate-500">
                            <div className="flex items-center gap-1">
                              <span>#{cellIdx + 1}</span>
                              {occupant && (() => {
                                const rems = getStudentRemarks(activePlan, occupant.name, occupant.id);
                                return rems.length > 0 ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedRemarksStudent(occupant);
                                    }}
                                    className="text-[9px] px-1.5 py-0.2 bg-amber-100 dark:bg-amber-950/90 text-amber-800 dark:text-amber-300 font-black rounded border border-amber-300 dark:border-amber-700/80 hover:bg-amber-200 dark:hover:bg-amber-900 transition-colors cursor-pointer"
                                    title={`${rems.length} remarque(s) de l'enseignant pour cette période - Cliquer pour ouvrir`}
                                  >
                                    📝 {rems.length}
                                  </button>
                                ) : null;
                              })()}
                            </div>

                            {isMe ? (
                              <span className="text-[9px] px-1.5 py-0.5 bg-emerald-500 text-white rounded font-extrabold shadow-sm">MOI</span>
                            ) : isHovered && canPlaceHere ? (
                              <span className="text-[9px] px-1.5 py-0.5 bg-emerald-600 text-white rounded font-extrabold shadow-sm animate-pulse">
                                CHOISIR
                              </span>
                            ) : !occupant ? (
                              <span className="text-[10px] font-bold" style={{ color: colors.available }}>
                                Libre
                              </span>
                            ) : null}
                          </div>

                          {occupant ? (() => {
                            const occupantPhotoUrl = getStudentPhoto(occupant.name, occupant.photoUrl);
                            const occupantRemarks = getStudentRemarks(activePlan, occupant.name, occupant.id);

                            return (
                              <div className="flex-1 flex flex-col justify-center">
                                <div className="flex items-center justify-center gap-1.5 px-0.5">
                                  {occupantPhotoUrl && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setPortalPhotoModalData({
                                          name: occupant.name,
                                          photoUrl: occupantPhotoUrl,
                                          rollNumber: occupant.rollNumber,
                                          className: activePlan.className,
                                          seatInfo: `Table #${cellIdx + 1}`,
                                        });
                                      }}
                                      className="w-7 h-8.5 shrink-0 rounded-md overflow-hidden border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-700 shadow-2xs hover:scale-115 transition-transform cursor-pointer"
                                      title="Cliquer pour agrandir la photo de l'élève"
                                    >
                                      <img
                                        src={occupantPhotoUrl}
                                        alt={occupant.name}
                                        className="w-full h-full object-cover"
                                        referrerPolicy="no-referrer"
                                      />
                                    </button>
                                  )}
                                  <div
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedRemarksStudent(occupant);
                                    }}
                                    className="flex flex-col text-center min-w-0 flex-1 cursor-pointer group"
                                    title="Cliquer pour consulter les remarques et indications de l'enseignant"
                                  >
                                    <span className={`text-xs font-bold line-clamp-2 leading-tight group-hover:text-emerald-500 transition-colors ${
                                      isMe ? 'text-emerald-400 font-extrabold text-sm' : 'text-slate-800 dark:text-slate-100'
                                    }`}>
                                      {occupant.name}
                                    </span>
                                    {occupant.rollNumber && !occupantRemarks.length && (
                                      <span className="text-[9px] text-slate-400 font-mono">N°{occupant.rollNumber}</span>
                                    )}
                                  </div>
                                </div>

                                {/* Indications and teacher remarks shown under the student's name */}
                                {occupantRemarks.length > 0 && (
                                  <div
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedRemarksStudent(occupant);
                                    }}
                                    className="mt-1 px-1.5 py-0.5 bg-amber-50/90 dark:bg-amber-950/70 border border-amber-200/90 dark:border-amber-800/60 rounded-md text-[9px] text-amber-900 dark:text-amber-300 cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-900/60 transition-colors flex items-center justify-between gap-1"
                                    title={`Remarque de l'enseignant (${occupantRemarks[0].date}) : "${occupantRemarks[0].text}" — Cliquer pour tout lire`}
                                  >
                                    <span className="truncate font-medium">
                                      <strong className="font-bold">Remarque :</strong> {occupantRemarks[0].text}
                                    </span>
                                    <span className="text-[8px] font-mono opacity-80 shrink-0">
                                      {occupantRemarks[0].date.slice(5)}
                                    </span>
                                  </div>
                                )}
                              </div>
                            );
                          })() : isHovered && canPlaceHere ? (() => {
                            const authPhoto = getStudentPhoto(authenticatedStudentObj?.name, authenticatedStudentObj?.photoUrl);
                            return (
                              <div className="flex-1 flex flex-col items-center justify-center gap-0.5">
                                {authPhoto ? (
                                  <img
                                    src={authPhoto}
                                    alt="M'installer"
                                    className="w-6 h-7 rounded object-cover border border-emerald-500 shadow-sm animate-bounce"
                                    referrerPolicy="no-referrer"
                                  />
                                ) : (
                                  <span className="text-sm animate-bounce">💺</span>
                                )}
                                <span className="text-[9px] font-extrabold text-emerald-600 dark:text-emerald-400 leading-none">
                                  M'asseoir ici
                                </span>
                              </div>
                            );
                          })() : (
                            <div className="flex-1 flex items-center justify-center text-slate-400">
                              <GridIcon className="h-5 w-5 opacity-40" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              </PlanZoomPanContainer>
            </div>

            {/* Unplaced Students Sidebar in Portal */}
            {unplacedStudentsInPortal.length > 0 && (
              <div className="w-full lg:w-72 bg-slate-50 dark:bg-[#111827]/90 rounded-2xl border border-emerald-500/40 p-4 space-y-3 shrink-0 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
                  <span className="font-extrabold text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-1.5">
                    <span>👥 Élèves non placés ({unplacedStudentsInPortal.length})</span>
                  </span>
                  <span className="px-2 py-0.5 bg-emerald-600 text-white font-black text-[10px] rounded-md uppercase">
                    En réserve
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-tight">
                  {authStudentId !== null && !activePlan.isFrozen && activePlan.allowStudentSelfPlacement
                    ? "Connecté ! Cliquez sur une chaise libre à gauche pour choisir votre place."
                    : "Ces élèves n'ont pas encore attribué de place sur la grille."}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2 max-h-80 overflow-y-auto pr-1">
                  {unplacedStudentsInPortal.map((st, idx) => {
                    const isMe = st.id === authStudentId;
                    const studentPhoto = getStudentPhoto(st.name, st.photoUrl);
                    const bankRemarks = getStudentRemarks(activePlan, st.name, st.id);

                    return (
                      <div
                        key={`unplaced-portal-${st.id}-${st.name}-${idx}`}
                        onClick={() => setSelectedRemarksStudent(st)}
                        className={`px-2.5 py-2 rounded-xl text-xs flex items-center justify-between gap-2 border transition-all cursor-pointer hover:border-emerald-400 ${
                          isMe
                            ? 'bg-emerald-100 dark:bg-emerald-950 border-emerald-500 text-emerald-900 dark:text-emerald-200 font-extrabold ring-2 ring-emerald-400'
                            : 'bg-white dark:bg-[#161F30] border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 font-semibold'
                        }`}
                        title="Cliquer pour voir les remarques et indications de l'enseignant"
                      >
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="truncate font-bold">{st.name} {isMe ? ' (MOI)' : ''}</span>
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="text-[10px] font-mono text-slate-400">
                              N°{st.rollNumber || (idx + 1)}
                            </span>
                            {bankRemarks.length > 0 && (
                              <span className="text-[9px] px-1 py-0.1 bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 rounded font-black border border-amber-300 dark:border-amber-700">
                                📝 {bankRemarks.length}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Photo next to student name */}
                        <div className="shrink-0">
                          {studentPhoto ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPortalPhotoModalData({
                                  name: st.name,
                                  photoUrl: studentPhoto,
                                  rollNumber: st.rollNumber,
                                  className: activePlan.className,
                                  seatInfo: 'Non assis (En réserve)',
                                });
                              }}
                              className="w-7 h-8.5 rounded-md overflow-hidden border border-slate-300 dark:border-slate-600 shadow-2xs hover:scale-110 transition-transform cursor-pointer"
                              title="Agrandir la photo"
                            >
                              <img
                                src={studentPhoto}
                                alt={st.name}
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                            </button>
                          ) : (
                            <div className="w-7 h-8.5 rounded-md bg-slate-100 dark:bg-slate-700/60 border border-slate-300 dark:border-slate-600 flex items-center justify-center text-[10px] text-slate-400 font-bold">
                              👤
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

        </div>
      ) : (
        <div className="bg-white dark:bg-[#111827]/90 rounded-2xl p-12 text-center border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="inline-flex p-4 bg-emerald-50 dark:bg-emerald-500/10 rounded-full text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <GridIcon className="h-8 w-8" />
          </div>
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
            Aucun plan de classe sélectionné
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Veuillez choisir un enseignant, une classe et une période dans les menus ci-dessus.
          </p>
        </div>
      )}

      {/* Student Photo Modal */}
      {portalPhotoModalData && (
        <StudentPhotoModal
          data={portalPhotoModalData}
          onClose={() => setPortalPhotoModalData(null)}
        />
      )}

      {/* Student Read-Only Remarks View Modal */}
      {selectedRemarksStudent && activePlan && (
        <StudentRemarksViewModal
          student={selectedRemarksStudent}
          plan={activePlan}
          onClose={() => setSelectedRemarksStudent(null)}
        />
      )}
    </div>
  );
};
