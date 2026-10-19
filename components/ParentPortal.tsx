import React, { useState, useEffect, useMemo } from 'react';
import { deduplicatePlacements } from '../services/planSharingService';
import {
  Directory,
  PortalSession,
  PortalStudent,
  fetchDirectory,
  fetchPlanStudents,
  loadPortalSession,
  portalLogin,
  savePortalSession,
  usePortalPlan,
} from '../services/portalService';
import { UserIcon } from './icons/UserIcon';
import { GridIcon } from './icons/GridIcon';
import { useSeatingColors, getSeatBorderStyle } from '../services/seatingColorService';
import { StudentPhotoModal, PhotoModalData } from './StudentPhotoModal';
import { PlanZoomPanContainer } from './PlanZoomPanContainer';
import { RgpdLogo } from './RgpdLogo';

interface ParentPortalProps {
  onBackToHome: () => void;
}

// Seules les photos enregistrées dans le plan par l'enseignant s'affichent.
const getStudentPhoto = (_name?: string, photoUrl?: string): string | undefined =>
  photoUrl && photoUrl.trim() ? photoUrl : undefined;

const splitClasses = (className: string) => className.split(',').map(c => c.trim()).filter(Boolean);
const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export const ParentPortal: React.FC<ParentPortalProps> = ({ onBackToHome }) => {
  const { colors } = useSeatingColors();
  const [session, setSession] = useState<PortalSession | null>(() => loadPortalSession('parent'));
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [planStudents, setPlanStudents] = useState<PortalStudent[]>([]);
  const [busy, setBusy] = useState(false);
  const [photoModalData, setPhotoModalData] = useState<PhotoModalData | null>(null);

  // Selection state
  const [selectedTeacher, setSelectedTeacher] = useState<string>(session?.teacherId || '');
  const [selectedClass, setSelectedClass] = useState<string>(session?.className || '');
  const [selectedPlanId, setSelectedPlanId] = useState<string>(session?.planId || '');
  const [selectedChildId, setSelectedChildId] = useState<number | null>(null);

  // Password state
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [showPasswordChangeModal, setShowPasswordChangeModal] = useState<boolean>(false);
  const [newPasswordInput, setNewPasswordInput] = useState<string>('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState<string>('');

  const [notification, setNotification] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3500);
  };

  const updateSession = (s: PortalSession | null) => {
    savePortalSession('parent', s);
    setSession(s);
  };

  const logout = () => {
    updateSession(null);
    setSelectedChildId(null);
    setPasswordInput('');
    setShowPasswordChangeModal(false);
  };

  // Le plan est rafraîchi moins souvent que dans l'espace élève : les parents ne changent pas les places.
  const { plan: activePlan, error: planError } = usePortalPlan(session, () => {
    logout();
    showToast('La connexion a expiré : merci de vous reconnecter.');
  }, 15000);

  useEffect(() => {
    let alive = true;
    fetchDirectory()
      .then(d => { if (alive) setDirectory(d); })
      .catch(e => { if (alive) setDirectoryError(e.message); });
    return () => { alive = false; };
  }, []);

  const loading = !directory && !directoryError;
  const teachers = directory?.teachers || [];

  const classesForTeacher = useMemo(() => {
    if (!selectedTeacher || !directory) return [];
    const set = new Set<string>();
    directory.plans.filter(p => p.teacherId === selectedTeacher).forEach(p => splitClasses(p.className).forEach(c => set.add(c)));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'));
  }, [directory, selectedTeacher]);

  const availablePlans = useMemo(() => {
    if (!selectedTeacher || !selectedClass || !directory) return [];
    return directory.plans
      .filter(p => p.teacherId === selectedTeacher && splitClasses(p.className).some(c => sameText(c, selectedClass)))
      .sort((a, b) => Number(a.isPast) - Number(b.isPast) || b.updatedAt.localeCompare(a.updatedAt));
  }, [directory, selectedTeacher, selectedClass]);

  useEffect(() => {
    if (!directory) return;
    if (availablePlans.length > 0) {
      if (!selectedPlanId || !availablePlans.some(p => p.id === selectedPlanId)) {
        setSelectedPlanId(availablePlans[0].id);
      }
    } else {
      setSelectedPlanId('');
    }
  }, [availablePlans, selectedPlanId, directory]);

  const selectedPlanMeta = useMemo(
    () => availablePlans.find(p => p.id === selectedPlanId) || null,
    [availablePlans, selectedPlanId]
  );

  useEffect(() => {
    if (session && selectedPlanId && selectedPlanId !== session.planId) {
      updateSession({ ...session, planId: selectedPlanId });
    }
  }, [selectedPlanId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setPlanStudents([]);
    if (!selectedPlanId || session) return;
    let alive = true;
    fetchPlanStudents(selectedPlanId)
      .then(list => { if (alive) setPlanStudents(list); })
      .catch(e => { if (alive) showToast(e.message); });
    return () => { alive = false; };
  }, [selectedPlanId, session]);

  const childrenInPlan = useMemo(
    () => planStudents.map(s => ({ ...s, photoUrl: undefined as string | undefined })),
    [planStudents]
  );

  const authChildId: number | null = session && activePlan ? activePlan.myStudentId : null;

  const activePlacementsList = useMemo(
    () => (activePlan ? deduplicatePlacements(activePlan.placements || []) : []),
    [activePlan]
  );

  const openSession = (token: string, student: { id: number; name: string }) => {
    updateSession({
      token,
      planId: selectedPlanId,
      studentId: student.id,
      name: student.name,
      teacherId: selectedTeacher,
      className: selectedClass,
    });
    setShowPasswordChangeModal(false);
    setPasswordInput('');
    setNewPasswordInput('');
    setConfirmPasswordInput('');
    setPasswordError(null);
  };

  const handleVerifyPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlanId || selectedChildId === null || busy) return;
    setPasswordError(null);
    setBusy(true);
    try {
      const r = await portalLogin({ planId: selectedPlanId, studentId: selectedChildId, pin: passwordInput, role: 'parent' });
      if (r.needsNewPin) {
        setShowPasswordChangeModal(true);
      } else if (r.token && r.student) {
        openSession(r.token, r.student);
        showToast('Connexion réussie !');
      }
    } catch (err: any) {
      setPasswordError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleChangePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlanId || selectedChildId === null || busy) return;

    if (newPasswordInput.trim().length < 4) {
      setPasswordError('Le nouveau mot de passe doit comporter au moins 4 caractères.');
      return;
    }
    if (newPasswordInput.trim() === '0000') {
      setPasswordError('Choisissez un mot de passe différent de 0000.');
      return;
    }
    if (newPasswordInput.trim() !== confirmPasswordInput.trim()) {
      setPasswordError('Les deux mots de passe ne sont pas identiques.');
      return;
    }

    setPasswordError(null);
    setBusy(true);
    try {
      const r = await portalLogin({
        planId: selectedPlanId,
        studentId: selectedChildId,
        pin: passwordInput,
        newPin: newPasswordInput.trim(),
        role: 'parent',
      });
      if (r.token && r.student) {
        openSession(r.token, r.student);
        showToast('Mot de passe enregistré. Bienvenue !');
      }
    } catch (err: any) {
      setPasswordError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Placement map for grid rendering
  const placementMap = useMemo(() => {
    const map = new Map<number, typeof activePlacementsList[0]>();
    activePlacementsList.forEach(p => {
      if (typeof p.location === 'number') {
        map.set(p.location, p);
      }
    });
    return map;
  }, [activePlacementsList]);

  const authenticatedChildObj = useMemo(() => {
    if (authChildId === null) return null;
    return activePlacementsList.find(p => p.id === authChildId) || null;
  }, [authChildId, activePlacementsList]);

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Toast Notification */}
      {notification && (
        <div className="fixed bottom-16 right-4 z-50 bg-amber-900 text-white px-4 py-3 rounded-xl shadow-2xl text-sm font-semibold animate-bounce border border-amber-600 flex items-center gap-2">
          <span>✨ {notification}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-gradient-to-r from-amber-600 via-orange-600 to-amber-700 rounded-2xl p-6 text-white shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-xs font-bold uppercase tracking-wider">
              <span>👨‍👩‍👧 Espace Parent</span>
            </div>
            <RgpdLogo size="xs" variant="badge" />
          </div>
          <h2 className="text-2xl font-bold">Consulter le Placement de Mon Enfant</h2>
          <p className="text-amber-100 text-sm mt-1">
            Sélectionnez l'enseignant, la classe et le nom de votre enfant pour consulter sa position exacte dans la salle.
          </p>
        </div>
        <button
          onClick={onBackToHome}
          className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white border border-white/30 rounded-xl text-xs font-semibold transition-all backdrop-blur-sm self-stretch md:self-auto text-center"
        >
          &larr; Accueil / Changer de Rôle
        </button>
      </div>

      {/* Selection Panel */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-700 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          
          {/* 1. Teacher */}
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
                setSelectedChildId(null);
                if (session) logout();
              }}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 px-4 py-2.5 text-sm font-medium text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-amber-500 focus:outline-none"
            >
              <option value="">-- Choisir l'enseignant --</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  👨‍🏫 {t.name}
                </option>
              ))}
            </select>
          </div>

          {/* 2. Class */}
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
                setSelectedChildId(null);
                if (session) logout();
              }}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 px-4 py-2.5 text-sm font-medium text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-amber-500 focus:outline-none disabled:opacity-50"
            >
              <option value="">-- Choisir la classe --</option>
              {classesForTeacher.map((c) => (
                <option key={c} value={c}>
                  🏫 Classe {c}
                </option>
              ))}
            </select>
          </div>

          {/* 3. Period / Plan */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
              3. Période / Plan
            </label>
            <select
              disabled={!selectedClass}
              value={selectedPlanId}
              onChange={(e) => {
                setSelectedPlanId(e.target.value);
                setSelectedChildId(null);
              }}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 px-4 py-2.5 text-sm font-medium text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-amber-500 focus:outline-none disabled:opacity-50"
            >
              <option value="">-- Choisir le plan --</option>
              {availablePlans.map((p, pIdx) => (
                <option key={`parent-plan-opt-${p.id}-${pIdx}`} value={p.id}>
                  📅 {p.period} {p.isFrozen ? '(🔒 Figé)' : ''}
                </option>
              ))}
            </select>
          </div>

        </div>

        {/* 4. Child Selection & Password Auth */}
        {selectedPlanMeta && (
          <div className="border-t border-slate-200 dark:border-slate-700 pt-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-400 flex items-center gap-1.5">
                <UserIcon className="h-4 w-4" />
                4. Sélectionner le nom de votre enfant :
              </label>
              {authChildId !== null && (
                <span className="text-xs font-bold text-amber-700 bg-amber-100 dark:bg-amber-950 px-3 py-1 rounded-full border border-amber-300 dark:border-amber-700">
                  Enfant : {authenticatedChildObj?.name}
                </span>
              )}
            </div>

            {session && authChildId === null ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 p-3">Chargement du plan…</p>
            ) : authChildId === null ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 max-h-56 overflow-y-auto p-2.5 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700">
                {childrenInPlan.map((ch, chIdx) => {
                  const chPhoto = getStudentPhoto(ch.name, ch.photoUrl);
                  const isSelected = selectedChildId === ch.id;
                  return (
                    <button
                      key={`parent-ch-${ch.id}-${ch.name}-${chIdx}`}
                      type="button"
                      onClick={() => {
                        setSelectedChildId(ch.id);
                        setPasswordInput('');
                        setPasswordError(null);
                      }}
                      className={`p-2.5 rounded-xl text-xs font-semibold transition-all text-left flex items-center justify-between gap-2 cursor-pointer ${
                        isSelected
                          ? 'bg-amber-600 text-white shadow-md ring-2 ring-amber-400'
                          : 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-600 hover:border-amber-500'
                      }`}
                    >
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="truncate font-bold">{ch.name}</span>
                        {ch.rollNumber && (
                          <span className={`text-[10px] font-mono ${isSelected ? 'text-amber-100' : 'text-slate-400'}`}>
                            N°{ch.rollNumber}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 ml-1">
                        {chPhoto ? (
                          <img
                            src={chPhoto}
                            alt={ch.name}
                            className="w-7 h-8.5 rounded-md object-cover border border-slate-300 dark:border-slate-600 shadow-2xs"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className={`w-7 h-8.5 rounded-md flex items-center justify-center text-[10px] border ${
                            isSelected ? 'bg-amber-700/80 border-white text-white' : 'bg-slate-100 dark:bg-slate-600 text-slate-400'
                          }`}>
                            👤
                          </div>
                        )}
                        {isSelected && <span>🔑</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-xl flex items-center justify-between text-xs">
                <p className="text-amber-900 dark:text-amber-200 font-semibold">
                  👋 Consultation active pour <strong>{authenticatedChildObj?.name}</strong>.
                </p>
                <button
                  onClick={logout}
                  className="px-3 py-1 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 font-bold"
                >
                  Déconnexion Parent
                </button>
              </div>
            )}

            {/* Password Login Dialog Box */}
            {selectedChildId !== null && authChildId === null && !showPasswordChangeModal && (
              <form onSubmit={handleVerifyPassword} className="bg-amber-50 dark:bg-amber-950/50 border-2 border-amber-400 dark:border-amber-700 rounded-xl p-4 space-y-3 max-w-md mx-auto shadow-md">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-amber-900 dark:text-amber-100">
                    🔑 Mot de passe Parent / Élève ({childrenInPlan.find(s => s.id === selectedChildId)?.name})
                  </h4>
                  <button
                    type="button"
                    onClick={() => setSelectedChildId(null)}
                    className="text-xs text-slate-500 hover:text-slate-700 underline"
                  >
                    Fermer
                  </button>
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Saisissez le mot de passe de votre enfant (le même que dans son espace élève). Pour une toute première connexion, c'est <code className="font-bold bg-white dark:bg-slate-800 px-1 py-0.5 rounded border border-slate-300">0000</code> ou celui donné par l'enseignant.
                </p>

                <div className="flex gap-2">
                  <input
                    type="password"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    placeholder="Saisir votre mot de passe"
                    autoFocus
                    className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-white focus:ring-2 focus:ring-amber-500"
                  />
                  <button
                    type="submit"
                    disabled={busy || !passwordInput}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold text-xs rounded-lg shadow-sm"
                  >
                    {busy ? '…' : 'Valider'}
                  </button>
                </div>

                {passwordError && (
                  <p className="text-xs font-semibold text-red-600 dark:text-red-400">
                    ⚠️ {passwordError}
                  </p>
                )}
              </form>
            )}

            {/* Password Change Modal */}
            {showPasswordChangeModal && (
              <form onSubmit={handleChangePasswordSubmit} className="bg-amber-50 dark:bg-amber-950/60 border-2 border-amber-400 dark:border-amber-700 rounded-xl p-5 space-y-3 max-w-md mx-auto shadow-lg">
                <div className="text-amber-900 dark:text-amber-100">
                  <h4 className="text-sm font-extrabold flex items-center gap-2">
                    🔒 Première connexion : Personnalisation du mot de passe
                  </h4>
                  <p className="text-xs mt-1">
                    Choisissez un mot de passe personnel. Il remplacera « 0000 » et servira aussi à votre enfant dans son espace élève.
                  </p>
                </div>

                <div className="space-y-2">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Nouveau mot de passe (min 4 car.)
                    </label>
                    <input
                      type="password"
                      value={newPasswordInput}
                      onChange={(e) => setNewPasswordInput(e.target.value)}
                      placeholder="Ex : MonP@ss2026"
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Confirmer le mot de passe
                    </label>
                    <input
                      type="password"
                      value={confirmPasswordInput}
                      onChange={(e) => setConfirmPasswordInput(e.target.value)}
                      placeholder="Confirmer le mot de passe"
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
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
                  Enregistrer le mot de passe
                </button>
              </form>
            )}

          </div>
        )}

      </div>

      {/* Seating Plan View with Exclusive Child Highlighting */}
      {activePlan && authChildId !== null ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-700 space-y-6">
          
          {/* Child Position Highlight Banner */}
          {typeof authenticatedChildObj?.location === 'number' ? (
            <div className="bg-gradient-to-r from-amber-500 to-yellow-600 text-white p-5 rounded-xl shadow-md border border-amber-400 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-3xl">📍</span>
                <div>
                  <h3 className="text-lg font-extrabold">
                    Votre enfant {authenticatedChildObj.name} est placé à la table #{authenticatedChildObj.location + 1}
                  </h3>
                  <p className="text-xs text-amber-100">
                    Classe {activePlan.className} &bull; Enseignant : {activePlan.teacherName} &bull; {activePlan.period}
                  </p>
                </div>
              </div>
              <span className="px-3 py-1 bg-white text-amber-800 font-extrabold text-xs rounded-full shadow-sm">
                Place attribuée
              </span>
            </div>
          ) : (
            <div className="bg-slate-100 dark:bg-slate-700/60 p-4 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-2">
              <span>⚠️</span>
              <span>
                Votre enfant <strong>{authenticatedChildObj?.name}</strong> n'a pas encore de table attribuée dans ce plan de classe.
              </span>
            </div>
          )}

          {/* Legend */}
          <div className="flex items-center gap-2 px-1 text-xs">
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

          {/* Seating Plan Container with Zoom & Right-Click Pan */}
          <PlanZoomPanContainer
            helperText="🖱️ Clic droit maintenu pour déplacer la salle • 📐 Bouton Ajuster pour afficher toute la classe"
          >
            <div className="w-full rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-[#0B0F17]/80 p-3 sm:p-4 shadow-inner">
              <div
                style={{
                  minWidth: `${Math.max(activePlan.gridDimensions.cols * 120, 320)}px`,
                  width: '100%',
                }}
                className="space-y-3 mx-0"
              >
              {/* Blackboard */}
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
                  const isMyChild = occupant && occupant.id === authChildId;

                  const status: 'available' | 'occupied' | 'unavailable' = isUnavailable
                    ? 'unavailable'
                    : occupant
                    ? 'occupied'
                    : 'available';

                  const frameStyle = getSeatBorderStyle(status, colors, isMyChild);

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
                        {obstacle ? (
                          <>
                            <span className="text-xl leading-none mb-0.5">{obstacle.icon}</span>
                            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 truncate max-w-full px-1">
                              {obstacle.label}
                            </span>
                          </>
                        ) : (
                          <span className="font-bold opacity-80" style={{ color: colors.unavailable }}>
                            ✕ Indisponible
                          </span>
                        )}
                      </div>
                    );
                  }

                  return (
                    <div
                      key={cellIdx}
                      style={{
                        borderColor: isMyChild ? '#f59e0b' : frameStyle.borderColor,
                        borderWidth: isMyChild ? '3px' : frameStyle.borderWidth,
                        borderStyle: frameStyle.borderStyle,
                        boxShadow: isMyChild
                          ? '0 0 0 3px rgba(245, 158, 11, 0.4), 0 0 20px rgba(245, 158, 11, 0.3)'
                          : frameStyle.boxShadow,
                      }}
                      className={`h-20 rounded-xl p-1.5 sm:p-2 flex flex-col justify-between transition-all select-none relative ${
                        isMyChild
                          ? 'bg-amber-100 dark:bg-amber-950/90 scale-105 z-10 ring-2 ring-amber-400'
                          : occupant
                          ? 'bg-white dark:bg-[#161F30]'
                          : 'bg-white/80 dark:bg-[#0E1524]/60'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 dark:text-slate-500">
                        <span>#{cellIdx + 1}</span>
                        {isMyChild ? (
                          <span className="text-[9px] px-1.5 py-0.5 bg-amber-600 text-white rounded font-extrabold uppercase">
                            Mon Enfant
                          </span>
                        ) : !occupant ? (
                          <span className="text-[10px] font-bold" style={{ color: colors.available }}>
                            Libre
                          </span>
                        ) : null}
                      </div>

                      {occupant ? (() => {
                        const occupantPhoto = getStudentPhoto(occupant.name, occupant.photoUrl);
                        return (
                          <div className="flex-1 flex items-center justify-center gap-1.5 px-0.5">
                            {occupantPhoto && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPhotoModalData({
                                    name: occupant.name,
                                    photoUrl: occupantPhoto,
                                    rollNumber: occupant.rollNumber,
                                    className: activePlan.className,
                                    seatInfo: `Table #${cellIdx + 1}`,
                                  });
                                }}
                                className="w-7 h-8 shrink-0 rounded overflow-hidden border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-700 shadow-2xs hover:scale-115 transition-transform cursor-pointer"
                                title="Cliquer pour agrandir la photo de l'élève"
                              >
                                <img
                                  src={occupantPhoto}
                                  alt={occupant.name}
                                  className="w-full h-full object-cover"
                                  referrerPolicy="no-referrer"
                                />
                              </button>
                            )}
                            <div
                              onClick={(e) => {
                                if (occupantPhoto) {
                                  e.stopPropagation();
                                  setPhotoModalData({
                                    name: occupant.name,
                                    photoUrl: occupantPhoto,
                                    rollNumber: occupant.rollNumber,
                                    className: activePlan.className,
                                    seatInfo: `Table #${cellIdx + 1}`,
                                  });
                                }
                              }}
                              className={`flex flex-col text-center min-w-0 flex-1 ${occupantPhoto ? 'cursor-pointer' : ''}`}
                              title={occupantPhoto ? "Cliquer pour agrandir la photo" : undefined}
                            >
                              <span className={`text-xs font-bold line-clamp-2 leading-tight ${
                                isMyChild ? 'text-amber-950 dark:text-amber-100 font-extrabold text-sm' : 'text-slate-800 dark:text-slate-100'
                              }`}>
                                {occupant.name}
                              </span>
                              {occupant.rollNumber && (
                                <span className="text-[9px] text-slate-400 font-mono">N°{occupant.rollNumber}</span>
                              )}
                            </div>
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
      ) : selectedPlanMeta ? (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-2xl p-8 text-center space-y-2">
          <p className="text-sm font-bold text-amber-900 dark:text-amber-200">
            👈 Saisissez le mot de passe de votre enfant ci-dessus pour afficher son plan de classe.
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-12 text-center border border-slate-200 dark:border-slate-700 space-y-3">
          <div className="inline-flex p-4 bg-amber-50 dark:bg-amber-950/50 rounded-full text-amber-600 dark:text-amber-400">
            <GridIcon className="h-8 w-8" />
          </div>
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
            {loading ? 'Chargement des classes…' : directoryError ? 'Impossible de charger les classes' : 'Choisissez la classe de votre enfant'}
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            {directoryError || planError || "Choisissez l'enseignant, la classe et la période dans les menus ci-dessus."}
          </p>
        </div>
      )}

      {/* Student Photo Modal */}
      {photoModalData && (
        <StudentPhotoModal
          data={photoModalData}
          onClose={() => setPhotoModalData(null)}
        />
      )}
    </div>
  );
};
