import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { parseStudentList } from '../services/geminiService';
import { Student, SavedLayout, StudentPlacement, StudentLocation } from '../types';
import { UploadIcon } from './icons/UploadIcon';
import { SheetIcon } from './icons/SheetIcon';
import { FilePlusIcon } from './icons/FilePlusIcon';
import { HelpIcon } from './icons/HelpIcon';
import {
  PublishedPlan,
  subscribeToPublishedPlans,
  savePublishedPlan,
  getPublishedPlans,
  duplicatePublishedPlanForClass,
  reassignPublishedPlanClass,
  togglePastPlan,
  syncClassRosterWithCurrentPlans,
  duplicatePlanToPeriod,
  deletePublishedPlan,
  updatePlanPeriod,
  toggleFreezePlan,
  updatePlanGridDimensions,
  clearPlanPlacements,
  fillPlanPlacements,
  filterPlansForOwner,
  STANDARD_PERIODS,
  StudentPasswordEntry,
  deduplicatePlacements
} from '../services/planSharingService';
import { TeacherAuthHeader } from './TeacherAuthHeader';
import {
  TeacherAccount,
  getLocalTeacherAccount,
  getImpersonatedTeacher,
  setImpersonatedTeacher,
  syncTeacherProfileToFirestore,
  fetchAllTeachersForAdmin,
  isSuperAdminEmail
} from '../services/teacherAuthService';
import { TrombinoscopeModal } from './TrombinoscopeModal';
import { StudentPhotoModal, PhotoModalData } from './StudentPhotoModal';
import { LiveTeacherClassPlan } from './LiveTeacherClassPlan';
import {
  saveStudentPhoto,
  deleteStudentPhoto,
  getStudentPhoto,
  registerPhotosBatch,
  compressImageToWebP,
} from '../services/photoLibraryService';

export interface TeacherProfile {
  firstName: string;
  lastName: string;
  disciplines: string[];
  classes: string[];
}

const DEFAULT_TEACHER_PROFILE: TeacherProfile = {
  firstName: '',
  lastName: '',
  disciplines: [],
  classes: [],
};

interface StudentInputProps {
  onStudentsParsed: (
    students: Student[],
    template?: {
      gridDimensions?: { rows: number; cols: number };
      unavailableCells?: number[];
      selectedClasses?: string[];
      teacherName?: string;
      periodName?: string;
    }
  ) => void;
  onRestore: (
    layout: SavedLayout,
    meta?: { selectedClasses?: string[]; teacherName?: string; periodName?: string }
  ) => void;
}

// Internal Interactive Preview Grid Component for Step 2 & Step 3
interface PlanPreviewGridProps {
  plan: PublishedPlan;
  targetClasses: string[];
  activeRoster?: Student[];
  allDbPlans?: PublishedPlan[];
  onSelectPlanForPreview?: (planId: string) => void;
  onAssignAndProceed: (plan: PublishedPlan, classes: string[], mode: 'replace' | 'merge') => void;
  onDeletePlan?: (planId: string) => void;
  onUpdatePeriod?: (planId: string, newPeriod: string) => void;
}

const PlanPreviewGridComponent: React.FC<PlanPreviewGridProps> = ({
  plan,
  targetClasses,
  activeRoster,
  allDbPlans = [],
  onSelectPlanForPreview,
  onAssignAndProceed,
  onDeletePlan,
  onUpdatePeriod,
}) => {
  const { gridDimensions, unavailableCells, placements: originalPlacements } = plan;
  const totalCells = gridDimensions.rows * gridDimensions.cols;

  // Association mode: 'replace' (effacer la liste précédente) vs 'merge' (fusionner / ajouter)
  const [associationMode, setAssociationMode] = useState<'replace' | 'merge'>('replace');

  // Management controls state
  const [isEditingPeriod, setIsEditingPeriod] = useState(false);
  const [newPeriodInput, setNewPeriodInput] = useState(plan.period);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  // Sync newPeriodInput when plan changes
  useEffect(() => {
    setNewPeriodInput(plan.period);
    setIsEditingPeriod(false);
    setIsConfirmingDelete(false);
  }, [plan.id, plan.period]);

  // Find all plans in DB for this class to allow multi-period switching
  const sameClassPlans = useMemo(() => {
    const normClass = plan.className.trim().toLowerCase();
    return allDbPlans.filter(p => p.className.trim().toLowerCase() === normClass);
  }, [allDbPlans, plan.className]);

  const effectivePlacements = useMemo(() => {
    if (activeRoster && activeRoster.length > 0) {
      const unavailSet = new Set(unavailableCells || []);
      const availableCells: number[] = [];
      for (let i = 0; i < totalCells; i++) {
        if (!unavailSet.has(i)) availableCells.push(i);
      }

      if (associationMode === 'replace') {
        const baseOccupiedSeats: number[] = [];
        originalPlacements.forEach(p => {
          if (typeof p.location === 'number' && !unavailSet.has(p.location)) {
            if (!baseOccupiedSeats.includes(p.location)) {
              baseOccupiedSeats.push(p.location);
            }
          }
        });

        const unusedAvailableSeats = availableCells.filter(cell => !baseOccupiedSeats.includes(cell));
        const seatQueue = [...baseOccupiedSeats, ...unusedAvailableSeats];

        return activeRoster.map((st, idx) => {
          const assignedSeat = idx < seatQueue.length ? seatQueue[idx] : 'bank';
          return {
            id: st.id || idx + 1,
            name: st.name,
            rollNumber: st.rollNumber || `${idx + 1}`,
            location: assignedSeat,
          };
        });
      } else {
        // 'merge': keep existing placements and append missing class roster students
        const merged = [...originalPlacements];
        const existingNames = new Set(originalPlacements.map(p => p.name.trim().toLowerCase()));

        activeRoster.forEach((st) => {
          if (!existingNames.has(st.name.trim().toLowerCase())) {
            merged.push({
              id: st.id || merged.length + 1,
              name: st.name,
              rollNumber: st.rollNumber || `${merged.length + 1}`,
              location: 'bank',
            });
          }
        });

        return merged;
      }
    }
    return originalPlacements;
  }, [activeRoster, originalPlacements, unavailableCells, totalCells, associationMode]);

  const placedStudentsCount = effectivePlacements.filter(p => typeof p.location === 'number').length;
  const unplacedStudents = useMemo(() => {
    return deduplicatePlacements(effectivePlacements.filter(p => p.location === 'bank' || typeof p.location !== 'number'));
  }, [effectivePlacements]);

  return (
    <div className="bg-slate-900 text-white p-5 rounded-2xl border-2 border-amber-500/50 shadow-xl space-y-4 my-2 animate-fadeIn">
      {/* Header Info */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700/80 pb-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2.5 py-0.5 bg-amber-500 text-slate-950 font-black text-xs rounded-md uppercase tracking-wider">
              👀 Fenêtre de Prévisualisation Interne
            </span>
            <span className="font-extrabold text-amber-300 text-xs sm:text-sm">
              🏫 Classe : {plan.className}
            </span>
            <span className="px-2 py-0.5 bg-indigo-900 text-indigo-200 border border-indigo-700 font-extrabold text-xs rounded-md">
              📅 Période actuelle : {plan.period}
            </span>
          </div>
          <div className="text-xs text-slate-300 flex items-center gap-3">
            <span>👨‍🏫 Professeur : <strong className="text-white">{plan.teacherName}</strong></span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 text-xs bg-slate-800/90 px-3 py-1.5 rounded-xl border border-slate-700 flex-wrap">
          <span className="font-bold text-amber-400">
            👥 {effectivePlacements.length} élève(s) {activeRoster && activeRoster.length > 0 ? `(${associationMode === 'replace' ? 'Remplacé' : 'Fusionné'} depuis Étape 1)` : `(${placedStudentsCount} placés)`}
          </span>
          <label
            className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-100 rounded-md text-xs font-bold cursor-pointer transition-all border border-slate-600 select-none"
            title="Cocher pour placer les élèves sur la grille, décocher pour les laisser non placés en réserve."
          >
            <input
              type="checkbox"
              checked={placedStudentsCount > 0}
              onChange={async (e) => {
                const shouldPlace = e.target.checked;
                if (shouldPlace) {
                  await fillPlanPlacements(plan.id);
                } else {
                  await clearPlanPlacements(plan.id);
                }
                const fresh = await getPublishedPlans();
                if (onSelectPlanForPreview) {
                  const updated = fresh.find(fp => fp.id === plan.id);
                  if (updated) onSelectPlanForPreview(updated.id);
                }
              }}
              className="w-3.5 h-3.5 text-amber-500 rounded border-slate-500 focus:ring-amber-400 cursor-pointer"
            />
            <span>{placedStudentsCount > 0 ? '✅ Placés' : '⏳ Non placés'}</span>
          </label>
          <span>•</span>
          <span className="font-bold text-indigo-300">📐 Grille {gridDimensions.rows}×{gridDimensions.cols}</span>
        </div>
      </div>

      {/* Multi-Period Visualization Bar across DB plans for this class */}
      {sameClassPlans.length > 1 && (
        <div className="p-3 bg-indigo-950/80 rounded-xl border border-indigo-700/80 space-y-2 text-xs">
          <div className="font-extrabold text-indigo-200 flex items-center gap-2">
            <span>📅 Visualiser les plans en BDD pour {plan.className} à différentes périodes :</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {sameClassPlans.map((p) => {
              const isCurrent = p.id === plan.id;
              return (
                <button
                  key={`prev-period-btn-${p.id}`}
                  type="button"
                  onClick={() => onSelectPlanForPreview && onSelectPlanForPreview(p.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border flex items-center gap-1.5 cursor-pointer ${
                    isCurrent
                      ? 'bg-amber-500 text-slate-950 border-amber-400 font-black shadow-md ring-2 ring-amber-300'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600'
                  }`}
                >
                  <span>{isCurrent ? '👁️' : '📅'}</span>
                  <span>{p.period}</span>
                  <span className="text-[10px] opacity-80">({p.placements.length} élèves)</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Roster Association Choice Selector */}
      {activeRoster && activeRoster.length > 0 && (
        <div className="p-3 bg-slate-800/90 rounded-xl border border-indigo-800/80 space-y-2 text-xs">
          <div className="font-extrabold text-amber-300 flex items-center gap-1.5">
            <span>⚙️ Choix d'affectation de la liste d'élèves ({activeRoster.length} élèves) :</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setAssociationMode('replace')}
              className={`p-2 rounded-xl text-left font-bold transition-all border flex items-center gap-2 cursor-pointer ${
                associationMode === 'replace'
                  ? 'bg-amber-500 text-slate-950 border-amber-400 ring-2 ring-amber-300'
                  : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
              }`}
            >
              <span className="text-base">🗑️</span>
              <div>
                <div className="font-extrabold text-xs">Effacer & Remplacer</div>
                <div className="text-[10px] opacity-90">Applique les {activeRoster.length} élèves de la classe sélectionnée en effaçant l'ancienne liste.</div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setAssociationMode('merge')}
              className={`p-2 rounded-xl text-left font-bold transition-all border flex items-center gap-2 cursor-pointer ${
                associationMode === 'merge'
                  ? 'bg-amber-500 text-slate-950 border-amber-400 ring-2 ring-amber-300'
                  : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
              }`}
            >
              <span className="text-base">➕</span>
              <div>
                <div className="font-extrabold text-xs">Conserver & Fusionner</div>
                <div className="text-[10px] opacity-90">Garde la liste existante et ajoute les nouveaux élèves en banque.</div>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Canvas & Unplaced Students Sidebar Container */}
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* Main Seating Grid Canvas */}
        <div className="flex-1 w-full space-y-2 min-w-0">
          {/* Blackboard / Room Front Indicator */}
          <div className="w-full py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-center text-[11px] font-extrabold tracking-wider text-slate-300 shadow-inner flex items-center justify-center gap-2">
            <span>⬛ TABLEAU DE BORD & BUREAU DU PROFESSEUR (DEVANT DU COURS)</span>
          </div>

          {/* Seating Grid Canvas Preview */}
          <div 
            className="grid gap-1.5 p-3 bg-slate-950/90 rounded-xl border border-slate-800 overflow-x-auto max-h-80"
            style={{
              gridTemplateColumns: `repeat(${gridDimensions.cols}, minmax(75px, 1fr))`
            }}
          >
            {Array.from({ length: totalCells }).map((_, idx) => {
              const isUnavailable = unavailableCells?.includes(idx);
              const studentAtIdx = effectivePlacements.find(p => p.location === idx);

              if (isUnavailable) {
                return (
                  <div
                    key={idx}
                    className="h-13 rounded-lg bg-slate-800/50 border border-slate-700/50 flex flex-col items-center justify-center text-[9px] text-slate-500 italic select-none"
                  >
                    <span>🚫</span>
                    <span>Inactif</span>
                  </div>
                );
              }

              if (studentAtIdx) {
                const photo = getStudentPhoto(studentAtIdx.name, (studentAtIdx as any).photoUrl);
                return (
                  <div
                    key={idx}
                    className="h-14 p-1.5 rounded-lg bg-indigo-900/90 border border-indigo-500/80 flex flex-col justify-between shadow-xs select-none hover:border-amber-400 transition-all"
                  >
                    <div className="flex items-center justify-between text-[9px] text-indigo-200">
                      <span className="font-mono font-black">#{studentAtIdx.rollNumber || (idx + 1)}</span>
                      {photo ? (
                        <img
                          src={photo}
                          alt={studentAtIdx.name}
                          className="w-4 h-5 rounded object-cover border border-indigo-400/50"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span className="text-[9px]">👤</span>
                      )}
                    </div>
                    <div className="font-bold text-[10px] text-white truncate leading-tight" title={studentAtIdx.name}>
                      {studentAtIdx.name}
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={idx}
                  className="h-13 rounded-lg bg-slate-900/80 border border-dashed border-slate-700/70 flex flex-col items-center justify-center text-[9px] text-slate-500 select-none"
                >
                  <span className="text-[10px]">🪑</span>
                  <span className="text-[8px]">Libre</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Unplaced Students Reserve Sidebar */}
        {unplacedStudents.length > 0 && (
          <div className="w-full lg:w-72 bg-slate-950/90 rounded-xl border-2 border-amber-500/60 p-3.5 space-y-2.5 shrink-0 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="font-extrabold text-amber-300 text-xs flex items-center gap-1.5">
                <span>👥 Élèves non placés ({unplacedStudents.length})</span>
              </span>
              <span className="px-2 py-0.5 bg-amber-500 text-slate-950 font-black text-[10px] rounded-md uppercase">
                Réserve
              </span>
            </div>
            <p className="text-[10px] text-slate-400 leading-tight">
              Élèves inscrits dans la classe mais non attribués à un siège sur la grille (chaises libres sur la grille) :
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-1 gap-1.5 max-h-72 overflow-y-auto pr-1">
              {unplacedStudents.map((st, idx) => {
                const photo = getStudentPhoto(st.name, (st as any).photoUrl);
                return (
                  <div
                    key={`unplaced-side-${st.id}-${st.name}-${idx}`}
                    className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700/80 rounded-lg text-xs flex items-center justify-between text-slate-200 shadow-xs gap-1.5"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      {photo ? (
                        <img
                          src={photo}
                          alt={st.name}
                          className="w-4 h-5 rounded object-cover border border-slate-600 shrink-0"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span className="text-[10px] text-slate-400">👤</span>
                      )}
                      <span className="font-bold truncate text-slate-100 text-[11px]" title={st.name}>{st.name}</span>
                    </div>
                    <span className="text-[10px] font-mono text-amber-400 font-extrabold shrink-0 ml-1.5">
                      #{st.rollNumber || (idx + 1)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Direct Management Section: Delete Plan & Modify Period */}
      <div className="p-3.5 bg-slate-800/90 rounded-xl border border-slate-700/80 space-y-3 text-xs">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="text-slate-300 space-y-0.5">
            <span className="font-extrabold text-amber-300 block">
              🛠️ Gestion rapide sous la prévisualisation ({plan.className} — {plan.period}) :
            </span>
            <span className="text-[11px] text-slate-400">
              Ajustez la période ou supprimez ce plan s'il est erroné.
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Modify Period Button */}
            <button
              type="button"
              onClick={() => setIsEditingPeriod(!isEditingPeriod)}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold rounded-xl text-xs transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
            >
              <span>✏️ Modifier la période</span>
            </button>

            {/* Delete Plan Button */}
            {!isConfirmingDelete ? (
              <button
                type="button"
                onClick={() => setIsConfirmingDelete(true)}
                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-extrabold rounded-xl text-xs transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <span>🗑️ Supprimer ce plan</span>
              </button>
            ) : (
              <div className="flex items-center gap-2 bg-rose-950 border-2 border-rose-600 p-1.5 rounded-xl animate-fadeIn">
                <span className="text-rose-200 font-extrabold text-[11px]">⚠️ Supprimer le plan ({plan.className} - {plan.period}) ?</span>
                <button
                  type="button"
                  onClick={() => {
                    if (onDeletePlan) onDeletePlan(plan.id);
                    setIsConfirmingDelete(false);
                  }}
                  className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white font-black text-xs rounded-lg shadow-xs cursor-pointer"
                >
                  Oui, supprimer
                </button>
                <button
                  type="button"
                  onClick={() => setIsConfirmingDelete(false)}
                  className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold text-xs rounded-lg cursor-pointer"
                >
                  Annuler
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Inline Drawer for Modifying Period */}
        {isEditingPeriod && (
          <div className="p-3 bg-slate-900/90 rounded-xl border border-indigo-500/50 space-y-2 animate-fadeIn mt-2">
            <div className="flex items-center justify-between">
              <label className="font-extrabold text-amber-300 text-xs flex items-center gap-1.5">
                <span>✏️ Changer la période attribuée à ce plan ({plan.className}) :</span>
              </label>
              <button
                type="button"
                onClick={() => setIsEditingPeriod(false)}
                className="text-slate-400 hover:text-white text-xs font-bold"
              >
                ✕
              </button>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={STANDARD_PERIODS.includes(newPeriodInput) ? newPeriodInput : 'custom'}
                onChange={(e) => {
                  if (e.target.value !== 'custom') {
                    setNewPeriodInput(e.target.value);
                  }
                }}
                className="px-3 py-1.5 bg-slate-800 border border-slate-600 text-white font-bold text-xs rounded-lg"
              >
                <option value="custom">-- Période type --</option>
                {STANDARD_PERIODS.map(sp => (
                  <option key={`prev-edit-p-${sp}`} value={sp}>{sp}</option>
                ))}
              </select>
              <input
                type="text"
                value={newPeriodInput}
                onChange={(e) => setNewPeriodInput(e.target.value)}
                placeholder="Ex : Trimestre 2 - 2026"
                className="flex-1 px-3 py-1.5 bg-slate-800 border border-slate-600 text-white font-extrabold text-xs rounded-lg focus:ring-2 focus:ring-amber-400"
              />
              <button
                type="button"
                onClick={() => {
                  if (onUpdatePeriod && newPeriodInput.trim()) {
                    onUpdatePeriod(plan.id, newPeriodInput.trim());
                    setIsEditingPeriod(false);
                  }
                }}
                className="px-4 py-1.5 bg-indigo-500 hover:bg-indigo-400 text-white font-extrabold text-xs rounded-lg shadow-2xs shrink-0 cursor-pointer"
              >
                💾 Enregistrer
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer Action */}
      <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-800/80 p-3 rounded-xl border border-slate-700">
        <div className="text-xs text-slate-300">
          <span className="text-amber-400 font-bold">🎯 Affectation sélectionnée pour : </span>
          <span className="font-extrabold text-white">
            {targetClasses.length > 0 ? targetClasses.join(', ') : plan.className}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onAssignAndProceed(plan, targetClasses.length > 0 ? targetClasses : [plan.className], associationMode)}
          className="w-full sm:w-auto px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl text-xs shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
        >
          <span>🚀 Valider ce Plan & Publier pour ({targetClasses.length > 0 ? targetClasses.join(', ') : plan.className}) → Espace Élève Accessible</span>
        </button>
      </div>
    </div>
  );
};

const StudentInput: React.FC<StudentInputProps> = ({ onStudentsParsed, onRestore }) => {
  const [text, setText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const sheetInputRef = useRef<HTMLInputElement>(null);
  const [isHelpVisible, setIsHelpVisible] = useState(false);

  // Teacher Auth Account State
  const [currentTeacher, setCurrentTeacher] = useState<TeacherAccount | null>(() => {
    return getImpersonatedTeacher() || getLocalTeacherAccount();
  });

  // Teacher Profile state & persistence
  const [profile, setProfile] = useState<TeacherProfile>(() => {
    const acc = getImpersonatedTeacher() || getLocalTeacherAccount();
    if (acc) {
      return {
        firstName: acc.firstName,
        lastName: acc.lastName,
        disciplines: acc.disciplines,
        classes: acc.classes,
      };
    }
    try {
      const saved = localStorage.getItem('teacher_profile_v2');
      return saved ? JSON.parse(saved) : DEFAULT_TEACHER_PROFILE;
    } catch {
      return DEFAULT_TEACHER_PROFILE;
    }
  });

  const handleTeacherChange = (teacher: TeacherAccount | null) => {
    setCurrentTeacher(teacher);
    if (teacher) {
      const updatedProf: TeacherProfile = {
        firstName: teacher.firstName,
        lastName: teacher.lastName,
        disciplines: teacher.disciplines,
        classes: teacher.classes,
      };
      setProfile(updatedProf);
      if (teacher.classes.length > 0) {
        setSelectedClasses([teacher.classes[0]]);
      }
    }
  };

  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editFirstName, setEditFirstName] = useState(profile.firstName);
  const [editLastName, setEditLastName] = useState(profile.lastName);
  const [editEmail, setEditEmail] = useState(currentTeacher?.email || '');
  const [editDisciplines, setEditDisciplines] = useState<string[]>(profile.disciplines);
  const [editClasses, setEditClasses] = useState<string[]>(profile.classes);
  const [newDisciplineInput, setNewDisciplineInput] = useState('');
  const [newProfileClassInput, setNewProfileClassInput] = useState('');

  // Class Selection & Period state
  const [teacherName, setTeacherName] = useState(profile.lastName ? `M. ${profile.lastName}` : '');
  const [periodName, setPeriodName] = useState('Trimestre 1 - 2026');
  const [selectedPublishPeriods, setSelectedPublishPeriods] = useState<string[]>(['Trimestre 1 - 2026']);
  const [step1DuplicatePlanId, setStep1DuplicatePlanId] = useState<string | null>(null);
  const [step1DuplicatePeriodTarget, setStep1DuplicatePeriodTarget] = useState<string>('Trimestre 2');

  // Step 2 Plan Card Action states
  const [step2CardEditingPeriodId, setStep2CardEditingPeriodId] = useState<string | null>(null);
  const [step2CardPeriodValue, setStep2CardPeriodValue] = useState<string>('');
  const [step2CardDuplicatingId, setStep2CardDuplicatingId] = useState<string | null>(null);
  const [step2CardDuplicateTargetPeriod, setStep2CardDuplicateTargetPeriod] = useState<string>('Trimestre 2');
  const [step2CardDuplicateTargetClass, setStep2CardDuplicateTargetClass] = useState<string>('');
  const [step2CardDeletingId, setStep2CardDeletingId] = useState<string | null>(null);
  const [step2CardEditingGridId, setStep2CardEditingGridId] = useState<string | null>(null);
  const [step2CardEditingRows, setStep2CardEditingRows] = useState<number>(15);
  const [step2CardEditingCols, setStep2CardEditingCols] = useState<number>(8);

  // Filter mode: BY DEFAULT ONLY teacher's classes appear
  const [showOnlyTeacherClasses, setShowOnlyTeacherClasses] = useState<boolean>(true);

  const [selectedClasses, setSelectedClasses] = useState<string[]>(() => {
    return profile.classes.length > 0 ? [profile.classes[0]] : [];
  });
  const [newClassInput, setNewClassInput] = useState('');

  // Active class tab and collapse state for live teacher classroom plan
  const [activeLiveClass, setActiveLiveClass] = useState<string>(() => {
    return profile.classes.length > 0 ? profile.classes[0] : '';
  });
  const [isLivePlanCollapsed, setIsLivePlanCollapsed] = useState<boolean>(false);

  useEffect(() => {
    if (selectedClasses.length > 0) {
      if (!selectedClasses.includes(activeLiveClass)) {
        setActiveLiveClass(selectedClasses[0]);
      }
    } else {
      setActiveLiveClass('');
    }
  }, [selectedClasses, activeLiveClass]);

  // Class Roster Storage (Students per class)
  const [classRosters, setClassRosters] = useState<Record<string, Student[]>>(() => {
    try {
      const saved = localStorage.getItem('class_rosters_v2');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Modal State for Class Editing & Student Import
  const [editingClass, setEditingClass] = useState<string | null>(null);
  const [editClassNameInput, setEditClassNameInput] = useState<string>('');
  const [isRenamingClass, setIsRenamingClass] = useState<boolean>(false);
  const [isCreatingNewClass, setIsCreatingNewClass] = useState<boolean>(false);
  const [newModalClassName, setNewModalClassName] = useState<string>('');
  const [modalStudents, setModalStudents] = useState<Student[]>([]);
  const [modalStudentPasswords, setModalStudentPasswords] = useState<Record<string | number, StudentPasswordEntry>>({});
  const [isTrombiModalOpen, setIsTrombiModalOpen] = useState(false);
  const [photoModalData, setPhotoModalData] = useState<PhotoModalData | null>(null);
  const [showModalPasswords, setShowModalPasswords] = useState<boolean>(true);
  const [modalPasteText, setModalPasteText] = useState<string>('');
  const [modalActiveTab, setModalActiveTab] = useState<'list' | 'csv' | 'paste'>('list');
  const [modalNotice, setModalNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isModalParsing, setIsModalParsing] = useState<boolean>(false);
  const [newStudentNameInput, setNewStudentNameInput] = useState<string>('');
  const [newStudentRollInput, setNewStudentRollInput] = useState<string>('');
  const [newStudentPasswordInput, setNewStudentPasswordInput] = useState<string>('0000');
  const [modalSearchFilter, setModalSearchFilter] = useState<string>('');
  const classFileInputRef = useRef<HTMLInputElement>(null);

  // Database plans state
  const [allDbPlans, setPublishedDbPlans] = useState<PublishedPlan[]>([]);
  const publishedDbPlans = useMemo(() => filterPlansForOwner(allDbPlans, currentTeacher ? { uid: currentTeacher.uid, email: currentTeacher.email, classes: profile.classes, isSuperAdmin: currentTeacher.role === 'super_admin' } : null), [allDbPlans, currentTeacher, profile.classes]);
  const [loadingDbPlans, setLoadingDbPlans] = useState<boolean>(true);
  const [filterBySelectedClass, setFilterBySelectedClass] = useState<boolean>(true);

  // All Teachers List State for Admin Dropdown
  const [allTeachersList, setAllTeachersList] = useState<TeacherAccount[]>([]);
  const [selectedTeacherForClassAssign, setSelectedTeacherForClassAssign] = useState<string>('');
  const [assignmentNotice, setAssignmentNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Step 2 & 3 Interactive State
  const [planAssignTargetClasses, setPlanAssignTargetClasses] = useState<Record<string, string[]>>({});
  const [planAssignCustomInput, setPlanAssignCustomInput] = useState<Record<string, string>>({});
  const [selectedPreviewPlanId, setSelectedPreviewPlanId] = useState<string>('');
  const [assignedPlanForStep3, setAssignedPlanForStep3] = useState<{
    plan: PublishedPlan;
    targetClasses: string[];
  } | null>(null);
  const [step3Notice, setStep3Notice] = useState<string | null>(null);

  // Placement mode & Editability options for assigned plan
  const [placementMode, setPlacementMode] = useState<'base_plan' | 'random' | 'empty'>('base_plan');
  const [editabilityMode, setEditabilityMode] = useState<'teacher_only' | 'students_allowed'>('teacher_only');

  // Active student roster derived from selected classes in Step 1
  const activeStudentsForSelectedClasses = useMemo(() => {
    const combined: Student[] = [];
    const seen = new Set<string>();

    selectedClasses.forEach((cls) => {
      const roster = classRosters[cls] || [];
      roster.forEach((st) => {
        const key = st.name.trim().toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          const photoUrl = st.photoUrl || getStudentPhoto(st.name);
          combined.push({ ...st, photoUrl });
        }
      });
    });

    return combined;
  }, [selectedClasses, classRosters]);

  // Keep Step 3 text area synced with active student roster when no manual plan is loaded
  useEffect(() => {
    if (!assignedPlanForStep3 && activeStudentsForSelectedClasses.length > 0) {
      const formatted = activeStudentsForSelectedClasses
        .map((s, idx) => `${idx + 1}. ${s.name}`)
        .join('\n');
      setText(formatted);
    }
  }, [selectedClasses, classRosters, assignedPlanForStep3, activeStudentsForSelectedClasses]);

  // Step 3 Tab & Open Plan State
  const [step3Mode, setStep3Mode] = useState<'create' | 'open'>('create');
  const [step3SelectedPlanId, setStep3SelectedPlanId] = useState<string>('');
  const [step3TargetClasses, setStep3TargetClasses] = useState<string[]>([]);

  // Check if active user is Admin
  const isAdmin = useMemo(() => {
    if (!currentTeacher) return false;
    return currentTeacher.role === 'super_admin' || isSuperAdminEmail(currentTeacher.email);
  }, [currentTeacher]);

  // Load teacher list for Admin
  useEffect(() => {
    let isMounted = true;
    fetchAllTeachersForAdmin().then((teachers) => {
      if (isMounted && teachers) {
        setAllTeachersList(teachers);
        if (teachers.length > 0 && !selectedTeacherForClassAssign) {
          setSelectedTeacherForClassAssign(teachers[0].uid);
        }
      }
    });
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToPublishedPlans((plans) => {
      setPublishedDbPlans(plans);
      setLoadingDbPlans(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const name = profile.lastName ? `M. ${profile.lastName}`.trim() : '';
    setTeacherName(name);
  }, [profile]);

  // Open profile editor
  const handleOpenProfileEditor = () => {
    setEditFirstName(profile.firstName);
    setEditLastName(profile.lastName);
    setEditEmail(currentTeacher?.email || 'prof@etablissement.fr');
    setEditDisciplines([...profile.disciplines]);
    setEditClasses([...profile.classes]);
    setNewDisciplineInput('');
    setNewProfileClassInput('');
    setIsEditingProfile(true);
  };

  // Save profile edits
  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    const updated: TeacherProfile = {
      firstName: editFirstName.trim(),
      lastName: editLastName.trim(),
      disciplines: editDisciplines,
      classes: editClasses,
    };
    setProfile(updated);
    try {
      localStorage.setItem('teacher_profile_v2', JSON.stringify(updated));
    } catch (err) {
      console.error("Erreur sauvegarde profil:", err);
    }

    if (currentTeacher) {
      const updatedAccount: TeacherAccount = {
        ...currentTeacher,
        email: editEmail.trim() || currentTeacher.email,
        firstName: updated.firstName,
        lastName: updated.lastName,
        disciplines: updated.disciplines,
        classes: updated.classes,
        updatedAt: new Date().toISOString(),
      };
      setCurrentTeacher(updatedAccount);
      syncTeacherProfileToFirestore(updatedAccount);

      // If an impersonated target is active, keep impersonated state synced
      if (getImpersonatedTeacher()) {
        setImpersonatedTeacher(updatedAccount);
      }
    }

    setIsEditingProfile(false);
  };

  const handleAddDisciplineToEdit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newDisciplineInput.trim();
    if (trimmed && !editDisciplines.includes(trimmed)) {
      setEditDisciplines([...editDisciplines, trimmed]);
      setNewDisciplineInput('');
    }
  };

  const handleRemoveDisciplineFromEdit = (disc: string) => {
    setEditDisciplines(editDisciplines.filter(d => d !== disc));
  };

  const handleAddClassToEditProfile = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newProfileClassInput.trim();
    if (trimmed && !editClasses.includes(trimmed)) {
      setEditClasses([...editClasses, trimmed]);
      setNewProfileClassInput('');
    }
  };

  const handleRemoveClassFromEditProfile = (cls: string) => {
    setEditClasses(editClasses.filter(c => c !== cls));
  };

  // Extract unique Firestore class names
  const dbClassNames = useMemo(() => {
    return Array.from(new Set(publishedDbPlans.map(p => p.className.trim()))).filter(Boolean);
  }, [publishedDbPlans]);

  // Master list of all available classes with sources
  const allAvailableClassesList = useMemo(() => {
    const teacherSet = new Set(profile.classes);
    const dbSet = new Set(dbClassNames);
    const rosterSet = new Set(Object.keys(classRosters));

    const allNames = Array.from(new Set([
      ...profile.classes,
      ...dbClassNames,
      ...Object.keys(classRosters),
    ])).filter(name => !!name && name.trim().length > 0);

    return allNames.map(name => ({
      name,
      isTeacher: teacherSet.has(name),
      isDb: dbSet.has(name),
      isRoster: rosterSet.has(name),
    }));
  }, [profile.classes, dbClassNames, classRosters]);

  // Classes currently displayed based on teacher filter
  const displayedClasses = useMemo(() => {
    if (showOnlyTeacherClasses && profile.classes.length > 0) {
      return allAvailableClassesList.filter(c => c.isTeacher);
    }
    return allAvailableClassesList;
  }, [allAvailableClassesList, showOnlyTeacherClasses, profile.classes.length]);

  const toggleClassSelection = (className: string) => {
    let nextSelected: string[];
    if (selectedClasses.includes(className)) {
      if (selectedClasses.length === 1) {
        setError("Veuillez conserver au moins une classe sélectionnée.");
        return;
      }
      setError(null);
      nextSelected = selectedClasses.filter(c => c !== className);
    } else {
      setError(null);
      nextSelected = [...selectedClasses, className];
    }
    setSelectedClasses(nextSelected);

    // Auto-fill student text if empty and roster exists
    if (!text.trim() && classRosters[className] && classRosters[className].length > 0) {
      const rosterNames = classRosters[className].map(s => s.name).join('\n');
      setText(rosterNames);
    }
  };

  // Open modal for editing class & importing students
  const handleOpenClassModal = (cls: string) => {
    setEditingClass(cls);
    setEditClassNameInput(cls);

    // 1. Get existing roster from classRosters
    let existingRoster: Student[] = classRosters[cls] ? [...classRosters[cls]] : [];

    // 2. Also check published plans for this class
    let existingPasswords: Record<string | number, StudentPasswordEntry> = {};
    const normCls = cls.trim().toLowerCase();
    const matchingPlan = publishedDbPlans.find(p => {
      if (!p.className) return false;
      const list = p.className.split(',').map(c => c.trim().toLowerCase());
      return list.includes(normCls) || p.className.trim().toLowerCase() === normCls;
    });

    if (matchingPlan) {
      if (matchingPlan.studentPasswords) {
        existingPasswords = { ...matchingPlan.studentPasswords };
      }
      // If local classRoster was empty, populate from the active plan placements
      if (existingRoster.length === 0 && matchingPlan.placements && matchingPlan.placements.length > 0) {
        existingRoster = matchingPlan.placements.map((p, idx) => ({
          id: p.id || (idx + 1),
          name: p.name,
          rollNumber: p.rollNumber || String(idx + 1),
          photoUrl: p.photoUrl,
          grade: p.grade,
          groupId: p.groupId,
          cpsProfile: p.cpsProfile,
        }));
      }
    }

    // 3. Build passwords map for every student in the roster
    const passwordsMap: Record<string | number, StudentPasswordEntry> = {};
    existingRoster.forEach((st, idx) => {
      const pId = st.id ?? (idx + 1);
      passwordsMap[pId] = existingPasswords[pId] || { password: '0000', isDefault: true };
    });

    setModalStudents(existingRoster);
    setModalStudentPasswords(passwordsMap);
    setModalPasteText('');
    setModalActiveTab('list'); // ALWAYS open directly on the class student list!
    setModalNotice(null);
    setNewStudentNameInput('');
    setNewStudentRollInput(String(existingRoster.length + 1));
    setNewStudentPasswordInput('0000');
    setModalSearchFilter('');
  };

  // Rename class inside modal
  const handleRenameClassInModal = () => {
    const trimmedNew = editClassNameInput.trim();
    if (!trimmedNew || !editingClass) return;
    if (trimmedNew === editingClass) return;

    // Update profile classes
    if (profile.classes.includes(editingClass)) {
      const updatedProfileClasses = profile.classes.map(c => c === editingClass ? trimmedNew : c);
      const updatedProfile = { ...profile, classes: updatedProfileClasses };
      setProfile(updatedProfile);
      try {
        localStorage.setItem('teacher_profile_v2', JSON.stringify(updatedProfile));
      } catch (err) {
        console.error(err);
      }
    }

    // Update selected classes if needed
    if (selectedClasses.includes(editingClass)) {
      setSelectedClasses(selectedClasses.map(c => c === editingClass ? trimmedNew : c));
    }

    // Update class rosters
    const updatedRosters = { ...classRosters };
    if (updatedRosters[editingClass]) {
      updatedRosters[trimmedNew] = updatedRosters[editingClass];
      delete updatedRosters[editingClass];
      setClassRosters(updatedRosters);
      try {
        localStorage.setItem('class_rosters_v2', JSON.stringify(updatedRosters));
      } catch (err) {
        console.error(err);
      }
    }

    setEditingClass(trimmedNew);
    setModalNotice({ type: 'success', text: `Classe renommée en "${trimmedNew}" avec succès !` });
  };

  // Helper to parse XLSX / CSV 2D array rows
  const parseRowsToStudents = (jsonRows: any[][]): Student[] => {
    const students: Student[] = [];
    jsonRows.forEach((row) => {
      if (!row || row.length === 0) return;

      const cleanCells = row.map(cell => String(cell || '').trim()).filter(Boolean);
      if (cleanCells.length === 0) return;

      // Skip header row if matches common terms
      const firstCellLower = cleanCells[0].toLowerCase();
      if (['nom', 'num', 'n°', 'id', 'prénom', 'prenom', 'élève', 'eleve'].includes(firstCellLower)) {
        return;
      }

      let name = '';
      let rollNumber: string | undefined = undefined;

      if (cleanCells.length === 1) {
        name = cleanCells[0];
      } else if (cleanCells.length === 2) {
        const [c1, c2] = cleanCells;
        if (/^\d+$/.test(c1)) {
          rollNumber = c1;
          name = c2;
        } else {
          name = `${c2} ${c1}`.trim();
        }
      } else {
        const [c1, c2, c3] = cleanCells;
        if (/^\d+$/.test(c1)) {
          rollNumber = c1;
          name = `${c3} ${c2}`.trim();
        } else {
          name = `${c1} ${c2}`.trim();
        }
      }

      // Clean leading digits or numbers like "1 - Dupont Jean"
      name = name.replace(/^\d+[\s\.\-\)\:]+/, '').trim();

      if (name && name.length >= 2) {
        students.push({
          id: students.length,
          name,
          rollNumber,
        });
      }
    });

    return students;
  };

  // Handle CSV / Excel File upload in modal
  const handleModalClassFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsModalParsing(true);
    setModalNotice(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = event.target?.result;
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonRows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        const parsedStudents = parseRowsToStudents(jsonRows);
        if (parsedStudents.length > 0) {
          const passwordsMap: Record<string | number, StudentPasswordEntry> = { ...modalStudentPasswords };
          parsedStudents.forEach(st => {
            if (!passwordsMap[st.id]) {
              passwordsMap[st.id] = { password: '0000', isDefault: true };
            }
          });
          setModalStudents(parsedStudents);
          setModalStudentPasswords(passwordsMap);
          setModalActiveTab('list');
          setModalNotice({
            type: 'success',
            text: `✅ ${parsedStudents.length} élève(s) importé(s) avec succès depuis "${file.name}" ! Vous pouvez maintenant modifier leurs noms et mots de passe ci-dessous.`
          });
        } else {
          setModalNotice({
            type: 'error',
            text: `⚠️ Aucun élève valide n'a pu être extrait de "${file.name}". Assurez-vous que le fichier contient une liste de noms.`
          });
        }
      } catch (err: any) {
        console.error("Erreur importation CSV/Excel:", err);
        setModalNotice({
          type: 'error',
          text: `Erreur lors de la lecture du fichier : ${err.message || 'Format non reconnu'}`
        });
      } finally {
        setIsModalParsing(false);
      }
    };

    reader.readAsArrayBuffer(file);
    if (e.target) e.target.value = '';
  };

  // Handle Copy-Paste Text Parse in modal
  const handleModalParseCopyPaste = async () => {
    if (!modalPasteText.trim()) {
      setModalNotice({ type: 'error', text: "Veuillez coller la liste des élèves dans la zone de texte." });
      return;
    }

    setIsModalParsing(true);
    setModalNotice(null);

    try {
      const parsedData = await parseStudentList(modalPasteText);
      const studentsWithIds: Student[] = parsedData.map((s, idx) => ({
        id: idx + 1,
        name: s.name,
        rollNumber: s.rollNumber || String(idx + 1),
      }));

      if (studentsWithIds.length > 0) {
        const passwordsMap: Record<string | number, StudentPasswordEntry> = { ...modalStudentPasswords };
        studentsWithIds.forEach(st => {
          if (!passwordsMap[st.id]) {
            passwordsMap[st.id] = { password: '0000', isDefault: true };
          }
        });
        setModalStudents(studentsWithIds);
        setModalStudentPasswords(passwordsMap);
        setModalActiveTab('list');
        setModalNotice({
          type: 'success',
          text: `✅ ${studentsWithIds.length} élève(s) analysé(s) et ajoutés avec succès ! Vous pouvez vérifier ou modifier les mots de passe et noms ci-dessous.`
        });
      } else {
        setModalNotice({
          type: 'error',
          text: "Aucun élève valide n'a pu être identifié dans le texte collé."
        });
      }
    } catch (err: any) {
      setModalNotice({
        type: 'error',
        text: `Erreur lors de l'analyse : ${err.message || 'Format invalide'}`
      });
    } finally {
      setIsModalParsing(false);
    }
  };

  // Add single student manually
  const handleAddSingleStudentInModal = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newStudentNameInput.trim();
    if (!trimmed) return;
    const newId = modalStudents.length > 0 ? Math.max(...modalStudents.map(s => Number(s.id) || 0)) + 1 : 1;
    const newRoll = newStudentRollInput.trim() || String(modalStudents.length + 1);
    const newPass = newStudentPasswordInput.trim() || '0000';
    const newStudent: Student = {
      id: newId,
      name: trimmed,
      rollNumber: newRoll,
    };
    setModalStudents([...modalStudents, newStudent]);
    setModalStudentPasswords(prev => ({
      ...prev,
      [newId]: { password: newPass, isDefault: newPass === '0000' }
    }));
    setNewStudentNameInput('');
    setNewStudentRollInput(String(modalStudents.length + 2));
    setNewStudentPasswordInput('0000');
    setModalNotice({ type: 'success', text: `Élève "${trimmed}" (N° ${newRoll}) ajouté avec succès.` });
  };

  // Update single student name in-place
  const handleUpdateStudentName = (id: number, newName: string) => {
    setModalStudents(prev => prev.map(s => s.id === id ? { ...s, name: newName } : s));
  };

  // Update single student roll number
  const handleUpdateStudentRollNumber = (id: number, newRoll: string) => {
    setModalStudents(prev => prev.map(s => s.id === id ? { ...s, rollNumber: newRoll } : s));
  };

  // Update single student password
  const handleUpdateStudentPassword = (id: number, newPass: string) => {
    const trimmed = newPass.trim();
    setModalStudentPasswords(prev => ({
      ...prev,
      [id]: { password: trimmed, isDefault: trimmed === '0000' }
    }));
  };

  // Reset single student password to 0000
  const handleResetSinglePassword = (id: number) => {
    setModalStudentPasswords(prev => ({
      ...prev,
      [id]: { password: '0000', isDefault: true }
    }));
  };

  // Update photo for student (compress to WebP and save to photo library)
  const handleUpdateStudentPhoto = async (id: number, photo: string | File) => {
    const student = modalStudents.find(s => s.id === id);
    if (!student) return;
    try {
      const compressedUrl = await saveStudentPhoto(student.name, photo, editingClass || undefined);
      setModalStudents(prev => prev.map(s => (s.id === id ? { ...s, photoUrl: compressedUrl } : s)));
      setModalNotice({ type: 'success', text: `Photo de ${student.name} enregistrée avec succès (WebP/JPG).` });
    } catch (err: any) {
      console.error("Erreur mise à jour photo:", err);
      setModalNotice({ type: 'error', text: "Erreur lors de l'enregistrement de la photo." });
    }
  };

  // Delete/Clear photo for student
  const handleDeleteStudentPhoto = async (id: number) => {
    const student = modalStudents.find(s => s.id === id);
    if (!student) return;
    try {
      await deleteStudentPhoto(student.name);
      setModalStudents(prev => prev.map(s => (s.id === id ? { ...s, photoUrl: undefined } : s)));
      setModalNotice({ type: 'success', text: `Photo de ${student.name} effacée avec succès.` });
    } catch (err) {
      console.error("Erreur suppression photo:", err);
    }
  };

  // Reset all passwords to default 0000
  const handleResetAllPasswordsToDefault = () => {
    const resetMap: Record<string | number, StudentPasswordEntry> = {};
    modalStudents.forEach(st => {
      resetMap[st.id] = { password: '0000', isDefault: true };
    });
    setModalStudentPasswords(resetMap);
    setModalNotice({ type: 'success', text: 'Tous les mots de passe de la classe ont été réinitialisés à "0000".' });
  };

  // Generate random 4-digit PIN for all students
  const handleGenerateRandomPins = () => {
    const randomMap: Record<string | number, StudentPasswordEntry> = { ...modalStudentPasswords };
    modalStudents.forEach(st => {
      const pin = Math.floor(1000 + Math.random() * 9000).toString();
      randomMap[st.id] = { password: pin, isDefault: false };
    });
    setModalStudentPasswords(randomMap);
    setModalNotice({ type: 'success', text: 'Codes PIN à 4 chiffres générés pour tous les élèves.' });
  };

  // Remove single student
  const handleRemoveStudentInModal = (id: number) => {
    const student = modalStudents.find(s => s.id === id);
    setModalStudents(prev => prev.filter(s => s.id !== id));
    setModalStudentPasswords(prev => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    if (student) {
      setModalNotice({ type: 'success', text: `Élève "${student.name}" retiré de la classe.` });
    }
  };

  // Clear modal students
  const handleClearModalStudents = () => {
    if (window.confirm("Voulez-vous vraiment vider la liste des élèves de cette classe ?")) {
      setModalStudents([]);
      setModalStudentPasswords({});
      setModalNotice({ type: 'success', text: "Liste d'élèves vidée." });
    }
  };

  // Save class roster only
  const handleSaveModalRosterOnly = async () => {
    if (!editingClass) return;
    const updatedRosters = {
      ...classRosters,
      [editingClass]: modalStudents,
    };
    setClassRosters(updatedRosters);
    try {
      localStorage.setItem('class_rosters_v2', JSON.stringify(updatedRosters));
    } catch (err) {
      console.error("Erreur sauvegarde liste classe:", err);
    }

    // Persist photos to central photo library
    const studentsWithPhotos = modalStudents.filter(s => !!s.photoUrl);
    if (studentsWithPhotos.length > 0) {
      await registerPhotosBatch(studentsWithPhotos.map(s => ({
        name: s.name,
        photoUrl: s.photoUrl!,
        className: editingClass || undefined,
      }))).catch(console.error);
    }

    // Synchronize additions / removals / name changes / passwords with CURRENT published plans ONLY
    try {
      const activeTeacherName = teacherName.trim() || (profile.fullName && profile.fullName !== 'M. / Mme Enseignant' ? profile.fullName : 'M. / Mme Enseignant');
      const freshPlans = await syncClassRosterWithCurrentPlans(editingClass, modalStudents, activeTeacherName, modalStudentPasswords);
      setPublishedDbPlans(freshPlans);
    } catch (syncErr) {
      console.error("Erreur de synchronisation avec les plans actuels:", syncErr);
    }

    setEditingClass(null);
  };

  // Save roster and launch plan directly
  const handleSaveModalAndLaunchPlan = async () => {
    if (!editingClass) return;

    // Save roster
    const updatedRosters = {
      ...classRosters,
      [editingClass]: modalStudents,
    };
    setClassRosters(updatedRosters);
    try {
      localStorage.setItem('class_rosters_v2', JSON.stringify(updatedRosters));
    } catch (err) {
      console.error("Erreur sauvegarde liste classe:", err);
    }

    // Persist photos to central photo library
    const studentsWithPhotos = modalStudents.filter(s => !!s.photoUrl);
    if (studentsWithPhotos.length > 0) {
      await registerPhotosBatch(studentsWithPhotos.map(s => ({
        name: s.name,
        photoUrl: s.photoUrl!,
        className: editingClass || undefined,
      }))).catch(console.error);
    }

    // Synchronize additions / removals / name changes / passwords with CURRENT published plans ONLY
    try {
      const activeTeacherName = teacherName.trim() || (profile.fullName && profile.fullName !== 'M. / Mme Enseignant' ? profile.fullName : 'M. / Mme Enseignant');
      const freshPlans = await syncClassRosterWithCurrentPlans(editingClass, modalStudents, activeTeacherName, modalStudentPasswords);
      setPublishedDbPlans(freshPlans);
    } catch (syncErr) {
      console.error("Erreur de synchronisation avec les plans actuels:", syncErr);
    }

    // Select class
    if (!selectedClasses.includes(editingClass)) {
      setSelectedClasses([editingClass]);
    }

    // Update main text
    if (modalStudents.length > 0) {
      setText(modalStudents.map(s => s.name).join('\n'));
    }

    const currentEditingClass = editingClass;
    setEditingClass(null);

    // Launch plan generation if students exist
    if (modalStudents.length > 0) {
      onStudentsParsed(modalStudents, {
        selectedClasses: [currentEditingClass],
        teacherName: teacherName.trim() || 'M. / Mme Enseignant',
        periodName: periodName.trim() || 'Trimestre 1 - 2026',
      });
    }
  };

  // Helper to assign a class to a specific teacher profile
  const handleAssignClassToTargetTeacher = async (className: string, targetUidOrEmail: string) => {
    if (!className) return;

    // Find target teacher account
    const targetTeacher = allTeachersList.find(t => t.uid === targetUidOrEmail || t.email === targetUidOrEmail) || currentTeacher;
    if (!targetTeacher) return;

    const existingClasses = targetTeacher.classes || [];
    if (!existingClasses.includes(className)) {
      const updatedClasses = [...existingClasses, className];
      const updatedAccount: TeacherAccount = {
        ...targetTeacher,
        classes: updatedClasses,
        updatedAt: new Date().toISOString(),
      };

      // Sync to Firestore
      await syncTeacherProfileToFirestore(updatedAccount);

      // If assigning to active logged in teacher, update active profile & local storage
      if (currentTeacher && (targetTeacher.uid === currentTeacher.uid || targetTeacher.email === currentTeacher.email)) {
        const updatedProf: TeacherProfile = {
          ...profile,
          classes: updatedClasses,
        };
        setProfile(updatedProf);
        try {
          localStorage.setItem('teacher_profile_v2', JSON.stringify(updatedProf));
        } catch (e) {
          console.error(e);
        }
      }

      // Refresh teachers list
      const refreshedList = await fetchAllTeachersForAdmin();
      setAllTeachersList(refreshedList);

      setAssignmentNotice({
        type: 'success',
        text: `✅ Classe "${className}" affectée à ${targetTeacher.firstName} ${targetTeacher.lastName} avec succès !`,
      });
    } else {
      setAssignmentNotice({
        type: 'success',
        text: `ℹ️ La classe "${className}" est déjà attribuée à ${targetTeacher.firstName} ${targetTeacher.lastName}.`,
      });
    }

    setTimeout(() => setAssignmentNotice(null), 4000);
  };

  // Helper for batch class assignment
  const handleBatchAssignClassesToTargetTeacher = async (classesList: string[], targetUidOrEmail: string) => {
    if (!classesList || classesList.length === 0) return;

    const targetTeacher = allTeachersList.find(t => t.uid === targetUidOrEmail || t.email === targetUidOrEmail) || currentTeacher;
    if (!targetTeacher) return;

    const updatedClasses = Array.from(new Set([...(targetTeacher.classes || []), ...classesList]));
    const updatedAccount: TeacherAccount = {
      ...targetTeacher,
      classes: updatedClasses,
      updatedAt: new Date().toISOString(),
    };

    await syncTeacherProfileToFirestore(updatedAccount);

    if (currentTeacher && (targetTeacher.uid === currentTeacher.uid || targetTeacher.email === currentTeacher.email)) {
      const updatedProf: TeacherProfile = {
        ...profile,
        classes: updatedClasses,
      };
      setProfile(updatedProf);
      try {
        localStorage.setItem('teacher_profile_v2', JSON.stringify(updatedProf));
      } catch (e) {
        console.error(e);
      }
    }

    const refreshedList = await fetchAllTeachersForAdmin();
    setAllTeachersList(refreshedList);

    setAssignmentNotice({
      type: 'success',
      text: `✅ ${classesList.length} classe(s) (${classesList.join(', ')}) affectée(s) à ${targetTeacher.firstName} ${targetTeacher.lastName} avec succès !`,
    });

    setTimeout(() => setAssignmentNotice(null), 4000);
  };

  // Helper to assign a DB plan to target classes and pass to Step 3 for verification & validation
  const handleAssignDbPlanToClassesAndLoad = async (
    planToLoad: PublishedPlan,
    targetClassesList: string[],
    associationMode: 'replace' | 'merge' = 'replace',
    forceEmptyPlacements: boolean = false
  ) => {
    if (!targetClassesList || targetClassesList.length === 0) {
      setError("Veuillez choisir au moins une classe pour affecter ce plan.");
      return;
    }

    // Set selected classes in state
    setSelectedClasses(targetClassesList);

    // Check if target classes have active students in Step 1 classRosters
    const activeTargetStudents: Student[] = [];
    const seen = new Set<string>();
    targetClassesList.forEach(cls => {
      (classRosters[cls] || []).forEach(st => {
        const key = st.name.trim().toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          activeTargetStudents.push(st);
        }
      });
    });

    let studentsToUse: Student[] = [];
    let placementsToUse: StudentPlacement[] = [];

    const shouldForceEmpty = forceEmptyPlacements || placementMode === 'empty';

    if (activeTargetStudents.length > 0) {
      if (associationMode === 'replace') {
        const unavailSet = new Set(planToLoad.unavailableCells || []);

        const baseOccupiedSeats: number[] = [];
        (planToLoad.placements || []).forEach(p => {
          if (typeof p.location === 'number' && !unavailSet.has(p.location)) {
            if (!baseOccupiedSeats.includes(p.location)) {
              baseOccupiedSeats.push(p.location);
            }
          }
        });

        studentsToUse = activeTargetStudents;
        placementsToUse = activeTargetStudents.map((st, idx) => {
          const assignedSeat = (!shouldForceEmpty && baseOccupiedSeats.length > 0 && idx < baseOccupiedSeats.length)
            ? baseOccupiedSeats[idx]
            : 'bank';
          return {
            id: st.id || idx + 1,
            name: st.name,
            rollNumber: st.rollNumber || `${idx + 1}`,
            location: assignedSeat,
          };
        });
      } else {
        // 'merge': Keep existing placements and append unplaced roster students
        const mergedPlacements = planToLoad.placements.map(p => ({
          ...p,
          location: shouldForceEmpty ? ('bank' as StudentLocation) : p.location
        }));
        const existingNames = new Set(planToLoad.placements.map(p => p.name.trim().toLowerCase()));

        activeTargetStudents.forEach(st => {
          if (!existingNames.has(st.name.trim().toLowerCase())) {
            mergedPlacements.push({
              id: st.id || mergedPlacements.length + 1,
              name: st.name,
              rollNumber: st.rollNumber || `${mergedPlacements.length + 1}`,
              location: 'bank',
            });
          }
        });

        placementsToUse = mergedPlacements;
        studentsToUse = mergedPlacements.map(p => ({
          id: p.id,
          name: p.name,
          rollNumber: p.rollNumber || '',
        }));
      }
    } else {
      studentsToUse = planToLoad.placements.map(p => ({
        id: p.id,
        name: p.name,
        rollNumber: p.rollNumber || '',
      }));
      placementsToUse = planToLoad.placements.map(p => ({
        ...p,
        location: shouldForceEmpty ? ('bank' as StudentLocation) : p.location
      }));
    }

    if (shouldForceEmpty) {
      setPlacementMode('empty');
      setEditabilityMode('students_allowed');
    } else {
      const placedCountInLoaded = placementsToUse.filter(p => typeof p.location === 'number').length;
      if (placedCountInLoaded === 0) {
        setPlacementMode('empty');
        setEditabilityMode('students_allowed');
      } else {
        setPlacementMode('base_plan');
        setEditabilityMode(planToLoad.isFrozen ? 'teacher_only' : (planToLoad.allowStudentSelfPlacement ? 'students_allowed' : 'teacher_only'));
      }
    }

    const shouldAllowSelfPlacement = shouldForceEmpty || planToLoad.allowStudentSelfPlacement;

    // Save/publish immediately to Cloud Firestore so the plan is accessible to students in Student Portal
    try {
      for (const cName of targetClassesList) {
        await savePublishedPlan({
          teacherName: planToLoad.teacherName || teacherName || 'M. / Mme Enseignant',
          className: cName,
          period: planToLoad.period || periodName || 'Période 1',
          allowStudentSelfPlacement: shouldAllowSelfPlacement,
          isFrozen: shouldForceEmpty ? false : (planToLoad.isFrozen || false),
          gridDimensions: planToLoad.gridDimensions,
          unavailableCells: planToLoad.unavailableCells || [],
          placements: placementsToUse,
        });
      }
      const freshPlans = await getPublishedPlans();
      setPublishedDbPlans(freshPlans);
    } catch (pubErr) {
      console.error("Cloud publish error on plan assignment:", pubErr);
    }

    // Format student roster as a clean list for Step 3
    const formattedStudentText = studentsToUse
      .map((p, idx) => `${idx + 1}. ${p.name}`)
      .join('\n');

    setText(formattedStudentText);
    setTeacherName(planToLoad.teacherName || teacherName);
    setPeriodName(planToLoad.period || periodName);

    const adjustedPlan: PublishedPlan = {
      ...planToLoad,
      className: targetClassesList.join(', '),
      placements: placementsToUse,
    };

    // Pass assigned plan to Step 3
    setAssignedPlanForStep3({
      plan: adjustedPlan,
      targetClasses: targetClassesList,
    });

    setStep3Notice(`✅ Plan "${planToLoad.period}" validé et immédiatement publié dans la base Cloud pour (${targetClassesList.join(', ')}) avec ${studentsToUse.length} élève(s) ! Il est désormais immédiatement visible par les élèves.`);

    // Scroll smoothly to Step 3
    setTimeout(() => {
      document.getElementById('step-3-section')?.scrollIntoView({ behavior: 'smooth' });
    }, 150);
  };

  const handleDuplicatePlanPeriodInStep1 = async (planToDup: PublishedPlan, targetPeriod: string) => {
    if (!targetPeriod.trim()) return;
    try {
      await duplicatePlanToPeriod(planToDup, targetPeriod.trim());
      setAssignmentNotice({
        type: 'success',
        text: `✅ Plan de ${planToDup.className} dupliqué avec succès vers la période "${targetPeriod.trim()}" !`
      });
      setStep1DuplicatePlanId(null);
      const freshPlans = await getPublishedPlans();
      setPublishedDbPlans(freshPlans);
    } catch (e) {
      console.error(e);
      setAssignmentNotice({
        type: 'error',
        text: "Erreur lors de la duplication du plan pour la période."
      });
    }
  };

  const handleDeletePlanFromPreview = async (planId: string) => {
    try {
      await deletePublishedPlan(planId);
      setAssignmentNotice({
        type: 'success',
        text: '✅ Le plan a été supprimé avec succès de la base de données.'
      });
      setSelectedPreviewPlanId('');
      const freshPlans = await getPublishedPlans();
      setPublishedDbPlans(freshPlans);
    } catch (err) {
      console.error("Delete plan error:", err);
      setAssignmentNotice({
        type: 'error',
        text: 'Erreur lors de la suppression du plan.'
      });
    }
  };

  const handleUpdatePeriodFromPreview = async (planId: string, newPeriod: string) => {
    try {
      await updatePlanPeriod(planId, newPeriod);
      setAssignmentNotice({
        type: 'success',
        text: `✅ La période du plan a été mise à jour vers "${newPeriod}" avec succès.`
      });
      const freshPlans = await getPublishedPlans();
      setPublishedDbPlans(freshPlans);
    } catch (err) {
      console.error("Update period error:", err);
      setAssignmentNotice({
        type: 'error',
        text: 'Erreur lors de la mise à jour de la période.'
      });
    }
  };

  // Step 3 Validation & Launch Handler
  const handleValidateAndLaunchStep3 = async () => {
    if (!text.trim()) {
      setError("Veuillez renseigner ou vérifier la liste d'élèves ci-dessus.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const parsedData = await parseStudentList(text);
      if (!parsedData || parsedData.length === 0) {
        setError("Aucun élève valide n'a pu être identifié dans la liste ci-dessus.");
        setIsLoading(false);
        return;
      }

      if (assignedPlanForStep3) {
        const { gridDimensions, unavailableCells } = assignedPlanForStep3.plan;
        const totalCells = gridDimensions.rows * gridDimensions.cols;
        const unavailSet = new Set(unavailableCells || []);

        // Available seat indices
        const availableSeatIndices: number[] = [];
        for (let i = 0; i < totalCells; i++) {
          if (!unavailSet.has(i)) availableSeatIndices.push(i);
        }

        // Collect base occupied seats from assigned plan that are valid & not in unavailSet
        const baseOccupiedSeats: number[] = [];
        (assignedPlanForStep3.plan.placements || []).forEach(p => {
          if (typeof p.location === 'number' && !unavailSet.has(p.location)) {
            if (!baseOccupiedSeats.includes(p.location)) {
              baseOccupiedSeats.push(p.location);
            }
          }
        });

        // Shuffle available seats if placementMode === 'random'
        const shuffledSeatIndices = [...availableSeatIndices];
        if (placementMode === 'random') {
          for (let i = shuffledSeatIndices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledSeatIndices[i], shuffledSeatIndices[j]] = [shuffledSeatIndices[j], shuffledSeatIndices[i]];
          }
        }

        const updatedPlacements: [number, StudentPlacement][] = parsedData.map((st, idx) => {
          let seatLocation: StudentLocation = 'bank';

          if (placementMode === 'base_plan') {
            seatLocation = (baseOccupiedSeats.length > 0 && idx < baseOccupiedSeats.length)
              ? baseOccupiedSeats[idx]
              : 'bank';
          } else if (placementMode === 'random') {
            seatLocation = idx < shuffledSeatIndices.length ? shuffledSeatIndices[idx] : 'bank';
          } else {
            // placementMode === 'empty'
            seatLocation = 'bank';
          }

          const placementObj: StudentPlacement = {
            id: st.id || idx + 1,
            name: st.name,
            rollNumber: st.rollNumber || `${idx + 1}`,
            photoUrl: st.photoUrl || getStudentPhoto(st.name),
            location: seatLocation,
            gender: st.gender,
            notes: st.notes,
          };

          return [st.id || idx + 1, placementObj];
        });

        // Publish directly to Cloud Firestore so the student portal picks up these exact placements
        try {
          const activePlacementsArray: StudentPlacement[] = updatedPlacements.map(t => t[1]);
          const targetClassesToSave = assignedPlanForStep3.targetClasses.length > 0
            ? assignedPlanForStep3.targetClasses
            : (selectedClasses.length > 0 ? selectedClasses : ['Classe']);

          const targetPeriodsToSave = selectedPublishPeriods.length > 0
            ? selectedPublishPeriods
            : [periodName || assignedPlanForStep3.plan.period || 'Période 1'];

          const isSelfPlacementAllowed = editabilityMode === 'students_allowed' || placementMode === 'empty';
          const isPlanFrozen = editabilityMode === 'teacher_only' && placementMode !== 'empty';

          for (const cName of targetClassesToSave) {
            for (const pName of targetPeriodsToSave) {
              await savePublishedPlan({
                teacherName: teacherName || assignedPlanForStep3.plan.teacherName || 'M. / Mme Enseignant',
                className: cName,
                period: pName,
                allowStudentSelfPlacement: isSelfPlacementAllowed,
                isFrozen: isPlanFrozen,
                gridDimensions: assignedPlanForStep3.plan.gridDimensions,
                unavailableCells: assignedPlanForStep3.plan.unavailableCells || [],
                placements: activePlacementsArray,
              });
            }
          }
          const freshPlans = await getPublishedPlans();
          setPublishedDbPlans(freshPlans);
        } catch (pubErr) {
          console.error("Cloud auto-publish error on Step 3 launch:", pubErr);
        }

        const layoutToRestore: SavedLayout = {
          students: parsedData,
          placements: updatedPlacements,
          gridDimensions: assignedPlanForStep3.plan.gridDimensions,
          unavailableCells: assignedPlanForStep3.plan.unavailableCells || [],
          groups: [],
        };

        onRestore(layoutToRestore, {
          selectedClasses: assignedPlanForStep3.targetClasses,
          teacherName: teacherName || assignedPlanForStep3.plan.teacherName,
          periodName: periodName || assignedPlanForStep3.plan.period,
        });
      } else {
        // Standard launch without pre-assigned plan
        await handleSubmit();
      }
    } catch (err: any) {
      setError(`Erreur lors de la validation : ${err.message || 'Format invalide'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddCustomClass = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newClassInput.trim();
    if (!trimmed) return;
    
    // Add to teacher profile automatically
    if (!profile.classes.includes(trimmed)) {
      const updatedProfile = {
        ...profile,
        classes: [...profile.classes, trimmed],
      };
      setProfile(updatedProfile);
      try {
        localStorage.setItem('teacher_profile_v2', JSON.stringify(updatedProfile));
      } catch (err) {
        console.error("Erreur sauvegarde profil:", err);
      }
    }

    if (!selectedClasses.includes(trimmed)) {
      setSelectedClasses([...selectedClasses, trimmed]);
    }
    setNewClassInput('');
  };

  const handleSelectAllClasses = () => {
    setSelectedClasses(displayedClasses.map(c => c.name));
  };

  const handleDeselectAllClasses = () => {
    if (displayedClasses.length > 0) {
      setSelectedClasses([displayedClasses[0].name]);
    }
  };

  const buildMetaPayload = (extraGrid?: { gridDimensions: { rows: number; cols: number }; unavailableCells: number[] }) => {
    return {
      ...(extraGrid || {}),
      selectedClasses: selectedClasses.length > 0 ? selectedClasses : ['3ème A'],
      teacherName: teacherName.trim() || 'M. / Mme Enseignant',
      periodName: periodName.trim() || 'Trimestre 1 - 2026',
    };
  };

  const handleLoadPlanFromDb = (planToLoad: PublishedPlan) => {
    const students: Student[] = planToLoad.placements.map(p => ({
      id: p.id,
      name: p.name,
      rollNumber: p.rollNumber || '',
      photoUrl: p.photoUrl || getStudentPhoto(p.name),
    }));

    const placementTuples: [number, StudentPlacement][] = planToLoad.placements.map(p => [
      p.id,
      {
        ...p,
        photoUrl: p.photoUrl || getStudentPhoto(p.name),
      }
    ]);

    const layoutToRestore: SavedLayout = {
      students,
      placements: placementTuples,
      gridDimensions: planToLoad.gridDimensions,
      unavailableCells: planToLoad.unavailableCells || [],
      groups: [],
    };

    onRestore(layoutToRestore, {
      selectedClasses: [planToLoad.className],
      teacherName: planToLoad.teacherName,
      periodName: planToLoad.period,
    });
  };

  const filteredDbPlans = publishedDbPlans.filter(p => {
    if (!filterBySelectedClass) return true;
    return selectedClasses.includes(p.className);
  });

  const handleSubmit = useCallback(async () => {
    if (!text.trim()) {
      setError("La liste d'élèves ne peut pas être vide.");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const parsedData = await parseStudentList(text);
      const studentsWithIds: Student[] = parsedData.map((s, index) => ({
        id: index,
        name: s.name,
        rollNumber: s.rollNumber,
        photoUrl: getStudentPhoto(s.name),
      }));
      onStudentsParsed(studentsWithIds, buildMetaPayload());
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Une erreur inconnue est survenue.");
      }
    } finally {
      setIsLoading(false);
    }
  }, [text, onStudentsParsed, selectedClasses, teacherName, periodName]);

  const handleJsonFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const fileText = e.target?.result as string;
        const data = JSON.parse(fileText);

        if (!data.gridDimensions || !data.unavailableCells) {
          setError("Fichier de plan invalide. La structure de la grille (gridDimensions, unavailableCells) est manquante.");
          return;
        }

        const templateData = buildMetaPayload({
          gridDimensions: data.gridDimensions,
          unavailableCells: data.unavailableCells,
        });

        if (text.trim()) {
          setIsLoading(true);
          setError(null);
          try {
            const parsedData = await parseStudentList(text);
            const studentsWithIds: Student[] = parsedData.map((s, index) => ({
              id: index,
              name: s.name,
              rollNumber: s.rollNumber,
              photoUrl: getStudentPhoto(s.name),
            }));
            onStudentsParsed(studentsWithIds, templateData);
          } catch (err) {
            if (err instanceof Error) {
              setError(`Erreur lors de l'analyse de la liste collée: ${err.message}`);
            } else {
              setError("Une erreur inconnue est survenue lors de l'analyse de la liste collée.");
            }
          } finally {
            setIsLoading(false);
          }
        } else {
          const layoutToRestore: SavedLayout = {
            students: data.students || [],
            placements: (data.placements || []) as [number, StudentPlacement][],
            gridDimensions: data.gridDimensions,
            unavailableCells: data.unavailableCells,
            groups: data.groups || [],
          };
          onRestore(layoutToRestore, buildMetaPayload());
        }
      } catch {
        setError("Erreur lors de la lecture du fichier. Assurez-vous que c'est un fichier JSON valide.");
      }
    };
    reader.onerror = () => {
      setError("Impossible de lire le fichier.");
    };
    reader.readAsText(file);

    if (event.target) event.target.value = '';
  };

  const handleSheetFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setIsLoading(true);
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        const students: Student[] = json
          .map((row): Omit<Student, 'id'> | null => {
            const rollNumber = row[0] ? String(row[0]).trim() : undefined;
            const lastName = row[1] ? String(row[1]).trim() : '';
            const firstName = row[2] ? String(row[2]).trim() : '';
            const name = `${firstName} ${lastName}`.trim();
            if (name) return { name, rollNumber };
            return null;
          })
          .filter((s): s is Omit<Student, 'id'> => s !== null)
          .map((s, index) => ({ ...s, id: index }));

        if (students.length > 0) {
          onStudentsParsed(students, buildMetaPayload());
        } else {
          setError("Le fichier XLS(X) ne contient pas de données valides dans la colonne B (Nom) et/ou la colonne C (Prénom).");
        }
      } catch (err) {
        console.error("Erreur analyse XLS:", err);
        setError("Erreur lors de l'analyse du fichier XLS(X). Assurez-vous que le format est correct.");
      } finally {
        setIsLoading(false);
      }
    };
    reader.onerror = () => {
      setError("Impossible de lire le fichier.");
      setIsLoading(false);
    };
    reader.readAsArrayBuffer(file);

    if (event.target) event.target.value = '';
  };

  const handleLoadJsonClick = () => jsonInputRef.current?.click();
  const handleLoadSheetClick = () => sheetInputRef.current?.click();

  const handleStartWithBlankPlan = () => {
    onStudentsParsed([], buildMetaPayload({
      gridDimensions: { rows: 5, cols: 6 },
      unavailableCells: [],
    }));
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      
      {/* TEACHER AUTHENTICATION & SUPER ADMIN HEADER */}
      <TeacherAuthHeader
        currentTeacher={currentTeacher}
        onTeacherChange={handleTeacherChange}
        onOpenEditProfile={handleOpenProfileEditor}
      />

      {/* SECTION 1: SELECTION & ATTRIBUTION DES CLASSES */}
      <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white font-bold text-lg shadow-sm">
              1
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <span>🏫 Choisir la ou les Classe(s) concernée(s)</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Sélectionnez vos classes pour charger un plan existant ou en créer un nouveau.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => {
                const targetClass = selectedClasses[0] || (displayedClasses.length > 0 ? displayedClasses[0].name : profile.classes[0]) || (allAvailableClassesList.length > 0 ? allAvailableClassesList[0].name : '');
                if (targetClass) {
                  handleOpenClassModal(targetClass);
                } else {
                  setEditingClass('');
                  setEditClassNameInput('');
                  setIsCreatingNewClass(true);
                  setModalStudents([]);
                  setModalStudentPasswords({});
                  setModalActiveTab('list');
                }
              }}
              className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-black text-xs sm:text-sm rounded-xl shadow-md hover:shadow-lg transition-all cursor-pointer ring-2 ring-indigo-400/30 active:scale-98"
              title="Ouvrir le gestionnaire de classe et des photos d'élèves"
            >
              <span>👥 Gestionnaire de classes & photos</span>
            </button>
            <button
              type="button"
              onClick={handleOpenProfileEditor}
              className="flex items-center gap-2 px-3.5 py-2 bg-indigo-50 dark:bg-indigo-950/80 hover:bg-indigo-100 dark:hover:bg-indigo-900 text-indigo-700 dark:text-indigo-300 font-bold text-xs rounded-xl border border-indigo-200 dark:border-indigo-800 shadow-sm transition-all cursor-pointer"
            >
              <span>✏️ Éditer mes infos personnelles</span>
            </button>
          </div>
        </div>

        {/* TEACHER PROFILE SUMMARY CARD */}
        <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200/80 dark:border-slate-700/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-base shadow-sm">
              👨‍🏫
            </div>
            <div>
              <div className="font-extrabold text-slate-900 dark:text-white text-sm">
                Enseignant : {profile.firstName} {profile.lastName}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-1 text-slate-600 dark:text-slate-400 font-semibold">
                <span>Discipline(s) :</span>
                {profile.disciplines.map(d => (
                  <span key={d} className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-950/80 text-indigo-800 dark:text-indigo-300 rounded-md text-[11px] font-bold">
                    {d}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="text-slate-500 dark:text-slate-400 text-right">
            <span className="font-bold text-indigo-600 dark:text-indigo-400">{profile.classes.length}</span> classe(s) attribuée(s)
          </div>
        </div>

        {/* GLOBAL PERIOD SELECTOR & MULTI-PERIOD MANAGEMENT BANNER */}
        <div className="p-4 bg-indigo-50/70 dark:bg-indigo-950/50 rounded-2xl border border-indigo-200 dark:border-indigo-800 space-y-3 text-xs shadow-2xs">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xl">📅</span>
              <div>
                <span className="font-extrabold text-indigo-950 dark:text-indigo-100 text-sm block">
                  Période active de travail / de publication :
                </span>
                <span className="text-slate-600 dark:text-slate-400 text-[11px]">
                  Sélectionnez ou modifiez la période globale pour affecter et publier vos plans de classe.
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              <select
                value={STANDARD_PERIODS.includes(periodName) ? periodName : 'custom'}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val !== 'custom') {
                    setPeriodName(val);
                    if (!selectedPublishPeriods.includes(val)) {
                      setSelectedPublishPeriods([...selectedPublishPeriods, val]);
                    }
                  }
                }}
                className="px-3 py-2 text-xs font-bold rounded-xl border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-800 text-indigo-950 dark:text-indigo-100 shadow-2xs focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                <option value="custom">-- Périodes prédéfinies --</option>
                {STANDARD_PERIODS.map(sp => (
                  <option key={`step1-period-${sp}`} value={sp}>{sp}</option>
                ))}
              </select>

              <input
                type="text"
                value={periodName}
                onChange={(e) => {
                  const val = e.target.value;
                  setPeriodName(val);
                  if (val.trim()) {
                    setSelectedPublishPeriods([val.trim()]);
                  }
                }}
                placeholder="Ex : Trimestre 1 - 2026"
                className="flex-1 sm:w-48 px-3 py-2 text-xs font-extrabold rounded-xl border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-2xs focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Quick period chips */}
          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-indigo-200/60 dark:border-indigo-800/60 text-[11px]">
            <span className="font-bold text-slate-600 dark:text-slate-400 mr-1">Raccourcis rapides :</span>
            {['Trimestre 1', 'Trimestre 2', 'Trimestre 3', 'Période 1', 'Période 2', 'Semestre 1', 'Semestre 2'].map(pChip => (
              <button
                key={`pchip-${pChip}`}
                type="button"
                onClick={() => {
                  setPeriodName(pChip);
                  if (!selectedPublishPeriods.includes(pChip)) {
                    setSelectedPublishPeriods([...selectedPublishPeriods, pChip]);
                  }
                }}
                className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold transition-all cursor-pointer ${
                  periodName === pChip
                    ? 'bg-indigo-600 text-white border-indigo-700 shadow-2xs'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-indigo-50 dark:hover:bg-indigo-900/50'
                }`}
              >
                {pChip}
              </button>
            ))}
          </div>
        </div>

        {/* PROFILE EDITOR MODAL / DRAWER */}
        {isEditingProfile && (
          <div className="p-5 bg-indigo-50/90 dark:bg-indigo-950/90 rounded-2xl border-2 border-indigo-300 dark:border-indigo-700 space-y-4 shadow-md animate-fadeIn">
            <div className="flex items-center justify-between border-b border-indigo-200 dark:border-indigo-800 pb-2">
              <h3 className="font-extrabold text-indigo-950 dark:text-indigo-100 text-sm flex items-center gap-2">
                <span>👤 Édition du Profil Enseignant & Données Personnelles</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsEditingProfile(false)}
                className="text-indigo-700 dark:text-indigo-300 font-bold hover:text-red-600 text-xs"
              >
                ✖ Fermer
              </button>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-4 text-xs">
              {/* Names */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-800 dark:text-slate-200 mb-1">
                    Prénom :
                  </label>
                  <input
                    type="text"
                    value={editFirstName}
                    onChange={e => setEditFirstName(e.target.value)}
                    placeholder="Mathieu"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold"
                    required
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-800 dark:text-slate-200 mb-1">
                    Nom :
                  </label>
                  <input
                    type="text"
                    value={editLastName}
                    onChange={e => setEditLastName(e.target.value)}
                    placeholder="Abgrall"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold"
                    required
                  />
                </div>
              </div>

              {/* Email Edit */}
              <div>
                <label className="block font-bold text-slate-800 dark:text-slate-200 mb-1">
                  Adresse E-mail :
                </label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={e => setEditEmail(e.target.value)}
                  placeholder="m.abgrall@etablissement.fr"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold"
                  required
                />
              </div>

              {/* Disciplines Edit */}
              <div className="space-y-2">
                <label className="block font-bold text-slate-800 dark:text-slate-200">
                  Disciplines / Matières enseignées :
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {editDisciplines.map(d => (
                    <span key={d} className="inline-flex items-center gap-1.5 px-3 py-1 bg-white dark:bg-slate-800 text-indigo-900 dark:text-indigo-200 font-bold rounded-lg border border-indigo-200 dark:border-indigo-700">
                      <span>📚 {d}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveDisciplineFromEdit(d)}
                        className="text-slate-400 hover:text-red-600 font-extrabold ml-1"
                        title="Supprimer cette discipline"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newDisciplineInput}
                    onChange={e => setNewDisciplineInput(e.target.value)}
                    placeholder="+ Ajouter une discipline (ex : Physique-Chimie, Histoire-Géo)"
                    className="flex-1 px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={handleAddDisciplineToEdit}
                    className="px-3 py-1.5 bg-indigo-700 text-white font-bold rounded-xl hover:bg-indigo-800"
                  >
                    Ajouter
                  </button>
                </div>
              </div>

              {/* Classes Edit */}
              <div className="space-y-2">
                <label className="block font-bold text-slate-800 dark:text-slate-200">
                  Ma liste de classes attribuées :
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {editClasses.map(c => (
                    <span key={c} className="inline-flex items-center gap-1.5 px-3 py-1 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-bold rounded-lg border border-slate-300 dark:border-slate-600">
                      <span>🏫 {c}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveClassFromEditProfile(c)}
                        className="text-slate-400 hover:text-red-600 font-extrabold ml-1"
                        title="Retirer cette classe de mon profil"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newProfileClassInput}
                    onChange={e => setNewProfileClassInput(e.target.value)}
                    placeholder="+ Ajouter une classe à ma liste (ex : 6ème C, Terminale SNT)"
                    className="flex-1 px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={handleAddClassToEditProfile}
                    className="px-3 py-1.5 bg-indigo-700 text-white font-bold rounded-xl hover:bg-indigo-800"
                  >
                    Ajouter
                  </button>
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-2 border-t border-indigo-200 dark:border-indigo-800">
                <button
                  type="button"
                  onClick={() => setIsEditingProfile(false)}
                  className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold rounded-xl"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-md"
                >
                  💾 Enregistrer mon profil enseignant
                </button>
              </div>
            </form>
          </div>
        )}

        {/* NOTICES FOR CLASS ASSIGNMENTS */}
        {assignmentNotice && (
          <div className={`p-3.5 rounded-xl border font-bold text-xs flex items-center justify-between animate-fadeIn ${
            assignmentNotice.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-800'
              : 'bg-red-50 dark:bg-red-950/80 text-red-800 dark:text-red-200 border-red-300 dark:border-red-800'
          }`}>
            <span>{assignmentNotice.text}</span>
            <button type="button" onClick={() => setAssignmentNotice(null)} className="ml-2 font-black text-slate-400 hover:text-slate-600">✕</button>
          </div>
        )}

        {/* Classes Multi-Select Chips */}
        <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-700/60">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                Classes disponibles ({displayedClasses.length}) :
              </span>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Vous pouvez sélectionner les classes et les affecter aux profils d'enseignants.
              </p>
            </div>

            {/* DEFAULT FILTER TOGGLE */}
            <label className="flex items-center gap-2 text-xs font-bold text-indigo-900 dark:text-indigo-200 bg-indigo-50 dark:bg-indigo-950/80 px-3 py-1.5 rounded-xl border border-indigo-200 dark:border-indigo-800 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showOnlyTeacherClasses}
                onChange={(e) => setShowOnlyTeacherClasses(e.target.checked)}
                className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
              />
              <span>Uniquement mes classes ({profile.classes.length})</span>
            </label>
          </div>

          <div className="flex items-center justify-between text-xs pt-1">
            <span className="text-slate-500 italic text-[11px]">
              {showOnlyTeacherClasses 
                ? `🔒 Filtre actif par défaut : seules les classes attribuées à ${profile.firstName} ${profile.lastName} sont affichées.`
                : `🌐 Affichage de toutes les classes disponibles.`
              }
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAllClasses}
                className="text-indigo-600 dark:text-indigo-400 hover:underline font-semibold"
              >
                Tout sélectionner
              </button>
              <span className="text-slate-300 dark:text-slate-600">•</span>
              <button
                type="button"
                onClick={handleDeselectAllClasses}
                className="text-slate-500 hover:underline font-semibold"
              >
                Réinitialiser
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 max-h-80 overflow-y-auto p-2 bg-slate-50/50 dark:bg-slate-900/30 rounded-xl border border-slate-200/60 dark:border-slate-700">
            {displayedClasses.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-500 italic w-full">
                Aucune classe ne correspond au filtre. Décochez « Uniquement mes classes » pour afficher les autres classes disponibles.
              </div>
            ) : (
              displayedClasses.map((item) => {
                const cls = item.name;
                const isSelected = selectedClasses.includes(cls);
                const roster = classRosters[cls] || [];
                // Find active student portal plan for this class in Firestore
                const classPlans = publishedDbPlans.filter(p => {
                  if (!p.className) return false;
                  const list = p.className.split(',').map(c => c.trim().toLowerCase());
                  return list.includes(cls.trim().toLowerCase()) || p.className.trim().toLowerCase() === cls.trim().toLowerCase();
                });
                const activeStudentPlan = classPlans.length > 0 ? classPlans[0] : null;
                const activePlanStudentCount = activeStudentPlan
                  ? (Array.isArray(activeStudentPlan.placements)
                      ? activeStudentPlan.placements.length
                      : (activeStudentPlan.placements && typeof activeStudentPlan.placements === 'object' ? Object.keys(activeStudentPlan.placements).length : 0))
                  : 0;
                const studentCount = roster.length > 0 ? roster.length : activePlanStudentCount;

                return (
                  <div
                    key={cls}
                    className={`p-3.5 rounded-2xl transition-all border flex flex-col lg:flex-row lg:items-center justify-between gap-3 select-none ${
                      isSelected
                        ? 'bg-indigo-50/90 dark:bg-indigo-950/80 border-indigo-300 dark:border-indigo-700 shadow-xs ring-2 ring-indigo-400/50'
                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-indigo-300'
                    }`}
                  >
                    {/* Checkbox and Prominent Class Title */}
                    <div
                      onClick={() => toggleClassSelection(cls)}
                      className="flex items-center gap-3 cursor-pointer min-w-0 shrink-0"
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4 pointer-events-none shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="font-black text-sm sm:text-base text-slate-900 dark:text-white flex flex-wrap items-center gap-2">
                          <span className="tracking-tight text-indigo-950 dark:text-indigo-100 bg-indigo-100/70 dark:bg-indigo-900/60 px-2.5 py-0.5 rounded-lg border border-indigo-200 dark:border-indigo-700">
                            🏫 Classe {cls}
                          </span>
                          {studentCount > 0 ? (
                            <span className="px-2.5 py-0.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 rounded-full text-xs font-extrabold border border-emerald-300 dark:border-emerald-700 shrink-0">
                              👥 {studentCount} élève(s)
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700/60 text-slate-500 rounded-full text-[10px] font-semibold shrink-0">
                              0 élève
                            </span>
                          )}
                        </div>

                        {!showOnlyTeacherClasses && (
                          <div className="flex items-center gap-1 mt-1 text-[10px]">
                            {item.isTeacher && (
                              <span className={`px-1.5 py-0.2 rounded font-semibold ${isSelected ? 'bg-indigo-800 text-indigo-100' : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200'}`}>
                                👨‍🏫 Attribuée à mon profil
                              </span>
                            )}
                            {item.isDb && (
                              <span className={`px-1.5 py-0.2 rounded font-semibold ${isSelected ? 'bg-amber-700 text-amber-100' : 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-200'}`}>
                                ☁️ Firestore
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions: Published Plans Dropdown Menu, Teacher Assignment Control & Edit */}
                    <div className="flex flex-wrap items-center gap-2 border-t lg:border-t-0 pt-2 lg:pt-0 border-slate-200 dark:border-slate-700">
                      {/* Dropdown Selector for Published Class Plans */}
                      <div className="flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/60 p-1.5 rounded-xl border border-emerald-300 dark:border-emerald-800 shadow-2xs">
                        <span className="text-xs shrink-0 font-extrabold text-emerald-950 dark:text-emerald-200 pl-1 flex items-center gap-1">
                          <span>🎓 Plan Élève :</span>
                        </span>
                        <select
                          value={activeStudentPlan ? activeStudentPlan.id : ''}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (!selectedClasses.includes(cls)) {
                              setSelectedClasses([cls]);
                            }
                            if (val && val !== 'new') {
                              setSelectedPreviewPlanId(val);
                            } else {
                              setSelectedPreviewPlanId('');
                            }
                            document.getElementById('step-2-section')?.scrollIntoView({ behavior: 'smooth' });
                          }}
                          className="text-xs font-black py-1 px-2 rounded-lg border border-emerald-400 dark:border-emerald-700 bg-white dark:bg-slate-800 text-emerald-950 dark:text-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer max-w-[210px] sm:max-w-[280px] truncate"
                          title="Sélectionnez le plan actif pour les élèves de cette classe dans leur Espace Élève"
                        >
                          {classPlans.length > 0 ? (
                            <>
                              {classPlans.map((p, idx) => {
                                const count = Array.isArray(p.placements)
                                  ? p.placements.length
                                  : (p.placements && typeof p.placements === 'object' ? Object.keys(p.placements).length : 0);
                                return (
                                  <option key={`cplan-opt-${p.id}-${idx}`} value={p.id}>
                                    🎓 {p.period} ({count} él.) — par {p.teacherName}
                                  </option>
                                );
                              })}
                              <option value="new">➕ Affecter / Créer un autre plan...</option>
                            </>
                          ) : (
                            <>
                              <option value="">⚠️ Aucun plan actuellement publié</option>
                              <option value="new">➕ Créer / Affecter un plan à {cls}</option>
                            </>
                          )}
                        </select>
                        {activeStudentPlan && (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!selectedClasses.includes(cls)) {
                                  setSelectedClasses([cls]);
                                }
                                setActiveLiveClass(cls);
                                setIsLivePlanCollapsed(false);
                                setTimeout(() => {
                                  document.getElementById('live-class-plan-section')?.scrollIntoView({ behavior: 'smooth' });
                                }, 50);
                              }}
                              className="px-2.5 py-1 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-extrabold text-[11px] rounded-md transition-all shadow-xs flex items-center gap-1 cursor-pointer shrink-0"
                              title="Afficher et ajuster en direct le plan de cette classe pendant le cours (élèves et photos synchronisés en temps réel)"
                            >
                              <span>⚡ Plan en direct</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedPreviewPlanId(activeStudentPlan.id);
                                if (!selectedClasses.includes(cls)) {
                                  setSelectedClasses([cls]);
                                }
                                document.getElementById('step-2-section')?.scrollIntoView({ behavior: 'smooth' });
                              }}
                              className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-[11px] rounded-md transition-all shadow-2xs shrink-0 cursor-pointer"
                              title="Voir la prévisualisation et modifier à l'Étape 2"
                            >
                              Voir ➔
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setStep1DuplicatePlanId(step1DuplicatePlanId === activeStudentPlan.id ? null : activeStudentPlan.id);
                                setStep1DuplicatePeriodTarget('Trimestre 2');
                              }}
                              className="px-2 py-1 bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-200 hover:bg-amber-200 font-extrabold text-[11px] rounded-md transition-all border border-amber-300 dark:border-amber-700 shrink-0 cursor-pointer"
                              title="Dupliquer le plan de cette classe vers une autre période"
                            >
                              📋 Copier Période
                            </button>
                          </div>
                        )}
                        {!activeStudentPlan && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!selectedClasses.includes(cls)) {
                                setSelectedClasses([cls]);
                              }
                              setActiveLiveClass(cls);
                              setIsLivePlanCollapsed(false);
                              setTimeout(() => {
                                document.getElementById('live-class-plan-section')?.scrollIntoView({ behavior: 'smooth' });
                              }, 50);
                            }}
                            className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-[11px] rounded-md transition-all shadow-xs flex items-center gap-1 cursor-pointer shrink-0"
                            title="Créer et afficher le plan en direct pour cette classe"
                          >
                            <span>⚡ Créer Plan en direct</span>
                          </button>
                        )}
                      </div>

                      {/* Step 1 Period Duplication Drawer */}
                      {activeStudentPlan && step1DuplicatePlanId === activeStudentPlan.id && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="w-full mt-2 p-3 bg-amber-50 dark:bg-amber-950/80 rounded-xl border border-amber-300 dark:border-amber-700 space-y-2 text-xs animate-fadeIn"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-extrabold text-amber-950 dark:text-amber-100 flex items-center gap-1">
                              <span>📋 Dupliquer le plan ({activeStudentPlan.period}) vers une autre période</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => setStep1DuplicatePlanId(null)}
                              className="text-slate-400 hover:text-slate-600 font-bold"
                            >
                              ✕
                            </button>
                          </div>
                          <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                            <select
                              value={step1DuplicatePeriodTarget}
                              onChange={(e) => setStep1DuplicatePeriodTarget(e.target.value)}
                              className="px-3 py-1.5 text-xs font-bold rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                            >
                              {STANDARD_PERIODS.map(sp => (
                                <option key={`step1-dup-${sp}`} value={sp}>{sp}</option>
                              ))}
                            </select>
                            <input
                              type="text"
                              value={step1DuplicatePeriodTarget}
                              onChange={(e) => setStep1DuplicatePeriodTarget(e.target.value)}
                              placeholder="Saisir période cible"
                              className="flex-1 px-3 py-1.5 text-xs font-semibold rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                            />
                            <button
                              type="button"
                              onClick={() => handleDuplicatePlanPeriodInStep1(activeStudentPlan, step1DuplicatePeriodTarget)}
                              className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-extrabold rounded-lg shadow-2xs shrink-0 cursor-pointer"
                            >
                              🚀 Dupliquer vers {step1DuplicatePeriodTarget}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Teacher Profile Assignment UI */}
                      {isAdmin ? (
                        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-700/80 p-1 rounded-xl border border-slate-300 dark:border-slate-600">
                          <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 pl-1">
                            Affecter à :
                          </span>
                          <select
                            id={`select-teacher-${cls}`}
                            defaultValue={selectedTeacherForClassAssign || (allTeachersList[0]?.uid || '')}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const targetVal = e.target.value;
                              if (targetVal) {
                                handleAssignClassToTargetTeacher(cls, targetVal);
                              }
                            }}
                            className="text-[11px] font-bold p-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white"
                          >
                            <option value="">-- Choisir Enseignant --</option>
                            {allTeachersList.map(t => (
                              <option key={t.uid} value={t.uid}>
                                {t.firstName} {t.lastName} {t.role === 'super_admin' ? '(Admin)' : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAssignClassToTargetTeacher(cls, currentTeacher?.uid || currentTeacher?.email || '');
                          }}
                          className="px-2.5 py-1.5 bg-purple-100 dark:bg-purple-950/80 hover:bg-purple-200 text-purple-900 dark:text-purple-200 font-bold text-[11px] rounded-xl border border-purple-300 dark:border-purple-800 transition-all"
                          title="Affecter cette classe à mon profil"
                        >
                          🎯 Affecter à mon profil
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenClassModal(cls);
                        }}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-[11px] rounded-xl shadow-xs transition-all flex items-center gap-1 shrink-0 cursor-pointer"
                        title="Éditer le nom de la classe, importer des élèves par CSV ou par copié-collé"
                      >
                        <span>✏️ Éditer & Importer</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Add custom class form */}
          <form onSubmit={handleAddCustomClass} className="flex gap-2 pt-1">
            <input
              type="text"
              value={newClassInput}
              onChange={(e) => setNewClassInput(e.target.value)}
              placeholder="+ Ajouter une nouvelle classe à mon profil (ex : 6ème C, Groupe SNT 2)"
              className="flex-1 px-3.5 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-xs font-bold rounded-xl shadow-sm"
            >
              Ajouter
            </button>
          </form>
        </div>

        {/* Selected Classes Attribution Banner & Batch Assign Control */}
        <div className="p-4 bg-indigo-50/90 dark:bg-indigo-950/70 border-2 border-indigo-200 dark:border-indigo-800 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs shadow-xs">
          <div className="flex items-center gap-2">
            <span className="text-xl">🎯</span>
            <div>
              <span className="font-extrabold text-indigo-950 dark:text-indigo-100">
                Classe(s) sélectionnée(s) :
              </span>
              <span className="ml-1 text-slate-700 dark:text-slate-300 font-bold">
                {selectedClasses.join(', ')}
              </span>
            </div>
          </div>

          {/* Batch assignment button & Live plan button */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setIsLivePlanCollapsed(false);
                document.getElementById('live-class-plan-section')?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="px-3 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
              title="Gérer le plan en direct de la classe sélectionnée"
            >
              <span>⚡ Plan en direct ({activeLiveClass || selectedClasses[0]})</span>
            </button>

            {isAdmin ? (
              <div className="flex items-center gap-1">
                <select
                  value={selectedTeacherForClassAssign}
                  onChange={(e) => setSelectedTeacherForClassAssign(e.target.value)}
                  className="px-2 py-1 text-xs font-bold rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white"
                >
                  {allTeachersList.map(t => (
                    <option key={t.uid} value={t.uid}>
                      {t.firstName} {t.lastName} {t.role === 'super_admin' ? '(Admin)' : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => handleBatchAssignClassesToTargetTeacher(selectedClasses, selectedTeacherForClassAssign)}
                  disabled={selectedClasses.length === 0}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-extrabold rounded-xl shadow-xs transition-all"
                >
                  Affecter les classes sélectionnées
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleBatchAssignClassesToTargetTeacher(selectedClasses, currentTeacher?.uid || currentTeacher?.email || '')}
                disabled={selectedClasses.length === 0}
                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-extrabold rounded-xl shadow-xs transition-all"
              >
                🎯 Affecter la/les classe(s) à mon profil ({profile.firstName} {profile.lastName})
              </button>
            )}
          </div>
        </div>
      </div>

      {/* SECTION PLAN EN DIRECT : GESTION DE CLASSE PENDANT LE COURS */}
      {selectedClasses.length > 0 && (
        <div id="live-class-plan-section" className="bg-slate-900 rounded-2xl shadow-xl border-2 border-indigo-500/80 p-4 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="w-3 h-3 rounded-full bg-emerald-400 animate-ping" />
              <h2 className="text-lg font-black text-white flex items-center gap-2">
                <span>🎓 Plan de Classe en Direct — Période en cours</span>
              </h2>
              {selectedClasses.length > 1 && (
                <div className="flex items-center gap-1.5 bg-slate-800 px-2 py-1 rounded-xl border border-slate-700">
                  <span className="text-xs text-slate-300 font-bold">Classe :</span>
                  <div className="flex items-center gap-1">
                    {selectedClasses.map(c => (
                      <button
                        key={`tab-live-${c}`}
                        type="button"
                        onClick={() => setActiveLiveClass(c)}
                        className={`px-2.5 py-0.5 text-xs font-black rounded-lg transition-all ${
                          (activeLiveClass || selectedClasses[0]) === c
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'bg-slate-700 text-slate-300 hover:text-white'
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsLivePlanCollapsed(!isLivePlanCollapsed)}
                className="px-3 py-1.5 text-xs font-extrabold rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <span>{isLivePlanCollapsed ? '👁️ Déplier le plan en direct' : '🔽 Réduire'}</span>
              </button>
            </div>
          </div>

          {!isLivePlanCollapsed && (
            <LiveTeacherClassPlan
              key={`live-plan-${activeLiveClass || selectedClasses[0]}`}
              selectedClass={activeLiveClass || selectedClasses[0]}
              allPublishedPlans={publishedDbPlans}
              classRoster={classRosters[activeLiveClass || selectedClasses[0]] || []}
              currentTeacherName={`${profile.firstName} ${profile.lastName}`.trim()}
              currentTeacherId={profile.uid || ''}
              onPlanUpdated={(updatedPlan) => {
                setPublishedDbPlans(prev => {
                  const idx = prev.findIndex(p => p.id === updatedPlan.id);
                  if (idx >= 0) {
                    const copy = [...prev];
                    copy[idx] = updatedPlan;
                    return copy;
                  }
                  return [updatedPlan, ...prev];
                });
              }}
            />
          )}
        </div>
      )}

      {/* SECTION 2: CHARGEMENT D'UN PLAN DEPUIS LA BASE DE DONNÉES */}
      <div id="step-2-section" className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500 text-white font-bold text-lg shadow-sm">
              2
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <span>📂 Étape 2 : Choisir & Affecter un Plan de la Base de Données</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Consultez la liste des plans disponibles, affichez leur prévisualisation interne et affectez le plan choisi à votre classe.
              </p>
            </div>
          </div>

          {/* Filter toggle */}
          <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700/60 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={filterBySelectedClass}
              onChange={(e) => setFilterBySelectedClass(e.target.checked)}
              className="rounded text-amber-600 focus:ring-amber-500 h-4 w-4"
            />
            <span>Filtrer uniquement ({selectedClasses.join(', ')})</span>
          </label>
        </div>

        {/* ACTIVE ROSTER FROM STEP 1 CARD */}
        {activeStudentsForSelectedClasses.length > 0 ? (
          <div className="p-4 bg-indigo-900/90 text-white rounded-2xl border-2 border-indigo-400 shadow-lg space-y-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-indigo-700/80 pb-2.5">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 bg-indigo-400 text-slate-950 font-black text-xs rounded-md uppercase tracking-wider">
                    👥 Élèves prêts depuis l'Étape 1
                  </span>
                  <span className="font-extrabold text-white text-sm">
                    Classe(s) sélectionnée(s) : {selectedClasses.join(', ')}
                  </span>
                </div>
                <p className="text-xs text-indigo-200 mt-1">
                  <strong>{activeStudentsForSelectedClasses.length} élève(s)</strong> sont enregistrés pour la/les classe(s) sélectionnée(s) à l'Étape 1.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setAssignedPlanForStep3(null);
                  setText(activeStudentsForSelectedClasses.map((s, i) => `${i + 1}. ${s.name}`).join('\n'));
                  document.getElementById('step-3-section')?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black rounded-xl text-xs shadow-md transition-all shrink-0 cursor-pointer flex items-center gap-1.5"
              >
                <span>🎯 Utiliser directement ces {activeStudentsForSelectedClasses.length} élèves → Passer à l'Étape 3</span>
              </button>
            </div>

            <div className="text-xs text-indigo-200 flex flex-wrap items-center gap-1.5 bg-indigo-950/60 p-2.5 rounded-xl border border-indigo-800/80">
              <span className="font-bold text-amber-300">📋 Liste des élèves :</span>
              <span className="text-slate-200 font-medium">
                {activeStudentsForSelectedClasses.map(s => s.name).slice(0, 15).join(', ')}
                {activeStudentsForSelectedClasses.length > 15 && ` ... (+${activeStudentsForSelectedClasses.length - 15} autres)`}
              </span>
            </div>
          </div>
        ) : (
          <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-xl text-xs text-amber-900 dark:text-amber-200 flex items-center justify-between gap-2">
            <span>ℹ️ Aucun élève enregistré dans la liste de la classe <strong>{selectedClasses.join(', ')}</strong>. Vous pouvez cliquer sur l'icône d'édition de la classe à l'Étape 1 pour importer ou coller vos élèves.</span>
          </div>
        )}

        {/* Database Plans List / Preview Window */}
        {loadingDbPlans ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400 animate-pulse">
            🔄 Connexion et chargement des plans de la base de données...
          </div>
        ) : publishedDbPlans.length === 0 ? (
          <div className="p-6 bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-900 dark:text-amber-200 space-y-2">
            <div className="flex items-center gap-2 font-bold text-sm">
              <span>ℹ️ Aucun plan enregistré dans la base de données.</span>
            </div>
            <p className="text-amber-700 dark:text-amber-300">
              Vous pouvez passer à l'Étape 3 ci-dessous pour créer un nouveau plan à partir d'une liste d'élèves ou d'un fichier.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {/* PLAN SELECTOR DROPDOWN & PREVIEW WINDOW */}
            {(() => {
              const currentPreviewPlan = selectedPreviewPlanId ? publishedDbPlans.find(p => p.id === selectedPreviewPlanId) : null;
              const targetClassesForPreview = currentPreviewPlan ? (planAssignTargetClasses[currentPreviewPlan.id] || selectedClasses) : selectedClasses;

              return (
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-slate-100 dark:bg-slate-900/60 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                    <label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                      <span>📋 Choisir un plan à prévisualiser :</span>
                    </label>
                    <select
                      value={selectedPreviewPlanId}
                      onChange={(e) => setSelectedPreviewPlanId(e.target.value)}
                      className="w-full sm:w-auto px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 font-extrabold text-xs text-slate-900 dark:text-white"
                    >
                      <option value="">-- Aucun plan sélectionné / Affecter un nouveau plan --</option>
                      {publishedDbPlans.map((p, idx) => (
                        <option key={`prev-plan-opt-${p.id}-${idx}`} value={p.id}>
                          🏫 Classe : {p.className} — 👨‍🏫 {p.teacherName} ({p.period}) — {p.placements.length} élèves
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* INTERNAL PREVIEW WINDOW OR DIRECT NEW PLAN CARD */}
                  {selectedPreviewPlanId && currentPreviewPlan ? (
                    <PlanPreviewGridComponent
                      plan={currentPreviewPlan}
                      targetClasses={targetClassesForPreview}
                      activeRoster={activeStudentsForSelectedClasses}
                      allDbPlans={publishedDbPlans}
                      onSelectPlanForPreview={(planId) => setSelectedPreviewPlanId(planId)}
                      onAssignAndProceed={(plan, classes, mode) => handleAssignDbPlanToClassesAndLoad(plan, classes, mode)}
                      onDeletePlan={handleDeletePlanFromPreview}
                      onUpdatePeriod={handleUpdatePeriodFromPreview}
                    />
                  ) : (
                    <div className="p-5 bg-gradient-to-r from-slate-900 to-indigo-950 text-white rounded-2xl border-2 border-indigo-500 shadow-xl space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500 text-slate-950 font-black text-xl shrink-0">
                          🎯
                        </div>
                        <div>
                          <h4 className="font-extrabold text-sm text-indigo-200">
                            Aucun plan de la base sélectionné pour ({selectedClasses.join(', ')})
                          </h4>
                          <p className="text-xs text-slate-300 mt-0.5">
                            Vous souhaitez affecter et configurer un <strong>nouveau plan de classe</strong> pour la classe sélectionnée ? Cliquez sur le bouton ci-dessous pour passer directement à l'Étape 3.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setAssignedPlanForStep3(null);
                          document.getElementById('step-3-section')?.scrollIntoView({ behavior: 'smooth' });
                        }}
                        className="w-full sm:w-auto px-5 py-2.5 bg-indigo-500 hover:bg-indigo-400 text-white font-extrabold rounded-xl text-xs shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <span>🎯 Affecter un nouveau plan à ({selectedClasses.join(', ')}) → Passer à l'Étape 3</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Plan Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              {filteredDbPlans.map((p, pIdx) => {
                const studentCount = p.placements.length;
                const placedCount = p.placements.filter(st => typeof st.location === 'number').length;
                const isSelectedClassMatch = selectedClasses.includes(p.className);
                const targetClassesForThisPlan = planAssignTargetClasses[p.id] || selectedClasses;

                return (
                  <div
                    key={`card-plan-${p.id}-${pIdx}`}
                    className={`p-4 rounded-2xl border transition-all flex flex-col justify-between space-y-3 ${
                      isSelectedClassMatch
                        ? 'bg-amber-50/60 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700 shadow-sm'
                        : 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <div className="space-y-2.5">
                      {/* Card Header: Origin Class & Badges */}
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="px-2.5 py-1 bg-amber-600 text-white font-extrabold rounded-lg text-xs shadow-xs">
                          🏫 Classe d'origine : {p.className}
                        </span>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {p.isPast ? (
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200 font-extrabold rounded-md text-[10px] border border-amber-300 dark:border-amber-700">
                              📦 Plan Passé (Historique)
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200 font-extrabold rounded-md text-[10px] border border-emerald-300 dark:border-emerald-700">
                              🟢 Plan Actuel
                            </span>
                          )}

                          {/* Toggle Freeze / Modifiable Interactive Button */}
                          <button
                            type="button"
                            onClick={async () => {
                              await toggleFreezePlan(p.id, !p.isFrozen);
                              const fresh = await getPublishedPlans();
                              setPublishedDbPlans(fresh);
                              setAssignmentNotice({
                                type: 'success',
                                text: `✅ Le plan (${p.className} - ${p.period}) est maintenant ${!p.isFrozen ? 'Figé 🔒' : 'Modifiable ✏️'}.`
                              });
                            }}
                            className={`px-2 py-0.5 font-extrabold rounded-md text-[10px] flex items-center gap-1 cursor-pointer transition-all border ${
                              p.isFrozen
                                ? 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-600'
                                : 'bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-950 dark:hover:bg-indigo-900 text-indigo-900 dark:text-indigo-200 border-indigo-300 dark:border-indigo-700'
                            }`}
                            title={p.isFrozen ? "Cliquer pour débloquer (rendre Modifiable)" : "Cliquer pour Figer le plan"}
                          >
                            <span>{p.isFrozen ? '🔒 Figé' : '✏️ Modifiable'}</span>
                          </button>
                        </div>
                      </div>

                      {/* Teacher & Period */}
                      <div className="space-y-1">
                        <h3 className="font-extrabold text-slate-900 dark:text-white text-sm">
                          👨‍🏫 Enseignant : {p.teacherName}
                        </h3>

                        {/* Inline Period Editor on Card */}
                        {step2CardEditingPeriodId === p.id ? (
                          <div className="mt-1 p-2 bg-indigo-50 dark:bg-indigo-950/80 rounded-xl border border-indigo-300 dark:border-indigo-700 space-y-1.5 animate-fadeIn">
                            <span className="text-[11px] font-extrabold text-indigo-900 dark:text-indigo-200 block">
                              📅 Changer la période pour {p.className} :
                            </span>
                            <div className="flex gap-1.5 flex-wrap sm:flex-nowrap">
                              <select
                                value={STANDARD_PERIODS.includes(step2CardPeriodValue) ? step2CardPeriodValue : 'custom'}
                                onChange={(e) => {
                                  if (e.target.value !== 'custom') {
                                    setStep2CardPeriodValue(e.target.value);
                                  }
                                }}
                                className="px-2 py-1 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg border border-slate-300 dark:border-slate-600 font-bold"
                              >
                                <option value="custom">Période type...</option>
                                {STANDARD_PERIODS.map(sp => (
                                  <option key={`card-period-opt-${sp}`} value={sp}>{sp}</option>
                                ))}
                              </select>
                              <input
                                type="text"
                                value={step2CardPeriodValue}
                                onChange={(e) => setStep2CardPeriodValue(e.target.value)}
                                className="flex-1 px-2 py-1 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg border border-slate-300 dark:border-slate-600 font-extrabold"
                                placeholder="Ex: Trimestre 1 - 2026"
                              />
                              <button
                                type="button"
                                onClick={async () => {
                                  if (step2CardPeriodValue.trim()) {
                                    await updatePlanPeriod(p.id, step2CardPeriodValue.trim());
                                    setStep2CardEditingPeriodId(null);
                                    const fresh = await getPublishedPlans();
                                    setPublishedDbPlans(fresh);
                                    setAssignmentNotice({
                                      type: 'success',
                                      text: `✅ Période mise à jour vers "${step2CardPeriodValue.trim()}".`
                                    });
                                  }
                                }}
                                className="px-2.5 py-1 bg-indigo-600 text-white font-extrabold text-xs rounded-lg hover:bg-indigo-700 shadow-2xs cursor-pointer"
                              >
                                💾
                              </button>
                              <button
                                type="button"
                                onClick={() => setStep2CardEditingPeriodId(null)}
                                className="px-2 py-1 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-lg cursor-pointer"
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <p className="text-xs text-slate-600 dark:text-slate-300 font-bold">
                              📅 Période : <span className="text-indigo-900 dark:text-indigo-200 font-black">{p.period}</span>
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                setStep2CardEditingPeriodId(p.id);
                                setStep2CardPeriodValue(p.period);
                              }}
                              className="text-[10px] font-extrabold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer flex items-center gap-0.5"
                            >
                              <span>✏️ Modifier</span>
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Interactive Student & Grid Stats Line ("👥 27 élèves (27 placés) • 📐 Grille 15×8") */}
                      <div className="p-2.5 bg-white/90 dark:bg-slate-800/90 rounded-xl border border-slate-200/80 dark:border-slate-700 space-y-2">
                        <div className="flex items-center justify-between flex-wrap gap-1 text-[11px] font-bold text-slate-700 dark:text-slate-200">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span>👥 <strong className="text-indigo-700 dark:text-indigo-300">{studentCount}</strong> élèves ({placedCount} placés)</span>
                            <label
                              className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-indigo-50 dark:bg-indigo-950/80 text-indigo-900 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800 rounded-lg text-[11px] font-extrabold cursor-pointer hover:bg-indigo-100 dark:hover:bg-indigo-900 transition-all shadow-2xs select-none"
                              title="Cocher pour placer les élèves sur la grille dès le départ, décocher pour les laisser non placés en réserve (chaises libres)."
                            >
                              <input
                                type="checkbox"
                                checked={placedCount > 0}
                                onChange={async (e) => {
                                  const shouldPlace = e.target.checked;
                                  if (shouldPlace) {
                                    await fillPlanPlacements(p.id);
                                    setAssignmentNotice({
                                      type: 'success',
                                      text: `✅ Les élèves de ${p.className} (${p.period}) ont été placés sur la grille.`
                                    });
                                  } else {
                                    await clearPlanPlacements(p.id);
                                    setAssignmentNotice({
                                      type: 'success',
                                      text: `✅ Les élèves de ${p.className} (${p.period}) sont désormais non placés (grille vide).`
                                    });
                                  }
                                  const fresh = await getPublishedPlans();
                                  setPublishedDbPlans(fresh);
                                }}
                                className="w-3.5 h-3.5 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                              />
                              <span>{placedCount > 0 ? '✅ Placés' : '⏳ Non placés'}</span>
                            </label>
                            <span>•</span>
                            <span>📐 Grille <strong className="text-indigo-700 dark:text-indigo-300">{p.gridDimensions.rows}×{p.gridDimensions.cols}</strong></span>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            {placedCount > 0 && (
                              <button
                                type="button"
                                onClick={async () => {
                                  await clearPlanPlacements(p.id);
                                  const fresh = await getPublishedPlans();
                                  setPublishedDbPlans(fresh);
                                  setAssignmentNotice({
                                    type: 'success',
                                    text: `✅ Toutes les places de la classe ${p.className} (${p.period}) ont été vidées (0 élèves placés).`
                                  });
                                }}
                                className="text-[10px] font-extrabold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer flex items-center gap-0.5"
                                title="Libérer toutes les places sur la grille (garder les élèves non placés)"
                              >
                                <span>🧹 Vider la grille</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                if (step2CardEditingGridId === p.id) {
                                  setStep2CardEditingGridId(null);
                                } else {
                                  setStep2CardEditingGridId(p.id);
                                  setStep2CardEditingRows(p.gridDimensions.rows);
                                  setStep2CardEditingCols(p.gridDimensions.cols);
                                }
                              }}
                              className="text-[10px] font-extrabold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer flex items-center gap-0.5"
                            >
                              <span>✏️ Ajuster grille/effectif</span>
                            </button>
                          </div>
                        </div>

                        {/* Dropdown to choose another plan present in database for this period */}
                        <div className="pt-2 border-t border-slate-200/80 dark:border-slate-700/80 space-y-1">
                          <label className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                            🔄 Choisir un autre plan présent dans la base pour la période ({p.period}) :
                          </label>
                          <select
                            onChange={async (e) => {
                              const selectedVal = e.target.value;
                              if (selectedVal === 'clear_all') {
                                await clearPlanPlacements(p.id);
                                const fresh = await getPublishedPlans();
                                setPublishedDbPlans(fresh);
                                setAssignmentNotice({
                                  type: 'success',
                                  text: `✅ Plan réinitialisé : toutes les places de la classe ${p.className} sont maintenant vides.`
                                });
                              } else if (selectedVal) {
                                const foundPlan = publishedDbPlans.find(plan => plan.id === selectedVal);
                                if (foundPlan) {
                                  await handleAssignDbPlanToClassesAndLoad(foundPlan, [p.className], 'replace');
                                  setAssignmentNotice({
                                    type: 'success',
                                    text: `✅ Plan "${foundPlan.className} (${foundPlan.period})" attribué avec succès à la classe ${p.className}.`
                                  });
                                }
                              }
                            }}
                            defaultValue=""
                            className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-bold rounded-lg border border-slate-300 dark:border-slate-600 focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                          >
                            <option value="" disabled>-- Sélectionner un plan de la base à attribuer --</option>
                            <option value="clear_all">🧹 Plan Vierge (Conserver effectif, vider toutes les places)</option>
                            
                            {/* Plans matching this exact period */}
                            {publishedDbPlans.filter(plan => plan.period.trim().toLowerCase() === p.period.trim().toLowerCase() && plan.id !== p.id).length > 0 && (
                              <optgroup label={`📅 Plans disponibles pour "${p.period}"`}>
                                {publishedDbPlans
                                  .filter(plan => plan.period.trim().toLowerCase() === p.period.trim().toLowerCase() && plan.id !== p.id)
                                  .map(plan => (
                                    <option key={`card-switch-plan-${p.id}-${plan.id}`} value={plan.id}>
                                      🏫 {plan.className} — 👨‍🏫 {plan.teacherName} (Grille {plan.gridDimensions.rows}×{plan.gridDimensions.cols}, {plan.placements.filter(st => typeof st.location === 'number').length} placés)
                                    </option>
                                  ))}
                              </optgroup>
                            )}

                            {/* All other published plans */}
                            {publishedDbPlans.filter(plan => plan.id !== p.id && plan.period.trim().toLowerCase() !== p.period.trim().toLowerCase()).length > 0 && (
                              <optgroup label="🌐 Autres plans enregistrés en base">
                                {publishedDbPlans
                                  .filter(plan => plan.id !== p.id && plan.period.trim().toLowerCase() !== p.period.trim().toLowerCase())
                                  .map(plan => (
                                    <option key={`card-switch-other-plan-${p.id}-${plan.id}`} value={plan.id}>
                                      🏫 {plan.className} ({plan.period}) — 👨‍🏫 {plan.teacherName}
                                    </option>
                                  ))}
                              </optgroup>
                            )}
                          </select>
                        </div>

                        {/* Inline Editor for Grid Dimensions & Roster Sync */}
                        {step2CardEditingGridId === p.id && (
                          <div className="mt-2 p-2.5 bg-indigo-50 dark:bg-slate-900 rounded-xl border border-indigo-300 dark:border-indigo-700 space-y-2 animate-fadeIn text-xs">
                            <span className="font-extrabold text-indigo-900 dark:text-indigo-200 block text-[11px]">
                              📐 Modifier la grille & l'effectif attribué à la classe {p.className} ({p.period}) :
                            </span>

                            <div className="flex flex-wrap items-center gap-3">
                              <div className="flex items-center gap-1">
                                <label className="font-bold text-[11px]">Lignes :</label>
                                <input
                                  type="number"
                                  min={1}
                                  max={25}
                                  value={step2CardEditingRows}
                                  onChange={(e) => setStep2CardEditingRows(parseInt(e.target.value) || 1)}
                                  className="w-14 px-2 py-1 text-xs border rounded-md font-extrabold text-center bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                                />
                              </div>
                              <div className="flex items-center gap-1">
                                <label className="font-bold text-[11px]">Colonnes :</label>
                                <input
                                  type="number"
                                  min={1}
                                  max={25}
                                  value={step2CardEditingCols}
                                  onChange={(e) => setStep2CardEditingCols(parseInt(e.target.value) || 1)}
                                  className="w-14 px-2 py-1 text-xs border rounded-md font-extrabold text-center bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                                />
                              </div>
                              <button
                                type="button"
                                onClick={async () => {
                                  await updatePlanGridDimensions(p.id, step2CardEditingRows, step2CardEditingCols);
                                  setStep2CardEditingGridId(null);
                                  const fresh = await getPublishedPlans();
                                  setPublishedDbPlans(fresh);
                                  setAssignmentNotice({
                                    type: 'success',
                                    text: `✅ Dimensions de la grille mises à jour vers ${step2CardEditingRows}×${step2CardEditingCols}.`
                                  });
                                }}
                                className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-lg shadow-2xs cursor-pointer"
                              >
                                💾 Valider grille
                              </button>
                            </div>

                            {/* Synchronize active roster button */}
                            {classRosters[p.className] && classRosters[p.className].length > 0 && (
                              <div className="pt-2 border-t border-indigo-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2">
                                <span className="text-[11px] text-slate-700 dark:text-slate-300 font-medium">
                                  Effectif enregistré pour {p.className} : <strong>{classRosters[p.className].length} élèves</strong>
                                </span>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    const activeTeacherName = teacherName.trim() || (profile.fullName && profile.fullName !== 'M. / Mme Enseignant' ? profile.fullName : 'M. Abgrall (Mathématiques)');
                                    await syncClassRosterWithCurrentPlans(p.className, classRosters[p.className], activeTeacherName);
                                    const fresh = await getPublishedPlans();
                                    setPublishedDbPlans(fresh);
                                    setAssignmentNotice({
                                      type: 'success',
                                      text: `✅ Effectif du plan synchronisé avec les ${classRosters[p.className].length} élèves de la classe ${p.className}.`
                                    });
                                  }}
                                  className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-[10px] rounded-lg shadow-2xs cursor-pointer flex items-center gap-1"
                                >
                                  <span>🔄 Synchro à l'effectif actuel ({classRosters[p.className].length} élèves)</span>
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Duplication Drawer */}
                      {step2CardDuplicatingId === p.id && (
                        <div className="p-3 bg-amber-50 dark:bg-amber-950/80 rounded-xl border border-amber-300 dark:border-amber-700 space-y-2.5 animate-fadeIn text-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-extrabold text-amber-900 dark:text-amber-200 block text-[11px]">
                              📋 Dupliquer le plan de {p.className} ({p.period}) :
                            </span>
                            <button
                              type="button"
                              onClick={() => setStep2CardDuplicatingId(null)}
                              className="text-slate-400 hover:text-slate-600 text-xs font-bold"
                            >
                              ✕
                            </button>
                          </div>

                          <div className="space-y-2">
                            {/* Duplicate to another Period */}
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                              <span className="text-[11px] font-extrabold text-slate-700 dark:text-slate-300 shrink-0">Vers Période :</span>
                              <select
                                value={STANDARD_PERIODS.includes(step2CardDuplicateTargetPeriod) ? step2CardDuplicateTargetPeriod : 'custom'}
                                onChange={(e) => {
                                  if (e.target.value !== 'custom') {
                                    setStep2CardDuplicateTargetPeriod(e.target.value);
                                  }
                                }}
                                className="px-2 py-1 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg border border-slate-300 dark:border-slate-600 font-bold"
                              >
                                <option value="custom">Autre période...</option>
                                {STANDARD_PERIODS.map(sp => (
                                  <option key={`dup-period-opt-${sp}`} value={sp}>{sp}</option>
                                ))}
                              </select>
                              <input
                                type="text"
                                value={step2CardDuplicateTargetPeriod}
                                onChange={(e) => setStep2CardDuplicateTargetPeriod(e.target.value)}
                                className="flex-1 px-2 py-1 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg border border-slate-300 dark:border-slate-600 font-extrabold"
                                placeholder="Trimestre 2"
                              />
                              <button
                                type="button"
                                onClick={async () => {
                                  if (step2CardDuplicateTargetPeriod.trim()) {
                                    await duplicatePlanToPeriod(p, step2CardDuplicateTargetPeriod.trim());
                                    setStep2CardDuplicatingId(null);
                                    const fresh = await getPublishedPlans();
                                    setPublishedDbPlans(fresh);
                                    setAssignmentNotice({
                                      type: 'success',
                                      text: `✅ Plan dupliqué pour la période "${step2CardDuplicateTargetPeriod.trim()}".`
                                    });
                                  }
                                }}
                                className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs rounded-lg shadow-2xs shrink-0 cursor-pointer"
                              >
                                📋 Dupliquer Période
                              </button>
                            </div>

                            {/* Duplicate to another Class */}
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1.5 border-t border-amber-200 dark:border-amber-800">
                              <span className="text-[11px] font-extrabold text-slate-700 dark:text-slate-300 shrink-0">Vers Classe :</span>
                              <select
                                value={step2CardDuplicateTargetClass}
                                onChange={(e) => setStep2CardDuplicateTargetClass(e.target.value)}
                                className="flex-1 px-2 py-1 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg border border-slate-300 dark:border-slate-600 font-bold"
                              >
                                <option value="">-- Choisir classe cible --</option>
                                {displayedClasses.map(c => (
                                  <option key={`dup-class-opt-${c.name}`} value={c.name}>{c.name}</option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={async () => {
                                  if (step2CardDuplicateTargetClass.trim()) {
                                    await duplicatePublishedPlanForClass(p.id, step2CardDuplicateTargetClass.trim());
                                    setStep2CardDuplicatingId(null);
                                    const fresh = await getPublishedPlans();
                                    setPublishedDbPlans(fresh);
                                    setAssignmentNotice({
                                      type: 'success',
                                      text: `✅ Plan dupliqué pour la classe "${step2CardDuplicateTargetClass.trim()}".`
                                    });
                                  }
                                }}
                                disabled={!step2CardDuplicateTargetClass.trim()}
                                className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-extrabold text-xs rounded-lg shadow-2xs shrink-0 cursor-pointer"
                              >
                                📋 Dupliquer Classe
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Deletion confirmation banner */}
                      {step2CardDeletingId === p.id && (
                        <div className="p-3 bg-rose-950 border-2 border-rose-600 rounded-xl space-y-2 animate-fadeIn text-xs">
                          <span className="text-rose-200 font-extrabold block">
                            ⚠️ Supprimer définitivement ce plan pour {p.className} ({p.period}) ?
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={async () => {
                                await deletePublishedPlan(p.id);
                                setStep2CardDeletingId(null);
                                const fresh = await getPublishedPlans();
                                setPublishedDbPlans(fresh);
                                setAssignmentNotice({
                                  type: 'success',
                                  text: `✅ Le plan (${p.className} - ${p.period}) a été supprimé.`
                                });
                              }}
                              className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white font-black text-xs rounded-lg shadow-2xs cursor-pointer"
                            >
                              Oui, Supprimer
                            </button>
                            <button
                              type="button"
                              onClick={() => setStep2CardDeletingId(null)}
                              className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold text-xs rounded-lg cursor-pointer"
                            >
                              Annuler
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Class Selector for Assignment */}
                      <div className="p-2.5 bg-white dark:bg-slate-800 rounded-xl border border-amber-200 dark:border-amber-800 space-y-1.5 text-xs">
                        <span className="font-bold text-amber-900 dark:text-amber-200 block text-[11px]">
                          🎯 Affecter à la/aux classe(s) :
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {displayedClasses.map(cItem => {
                            const cName = cItem.name;
                            const isChecked = targetClassesForThisPlan.includes(cName);
                            return (
                              <button
                                key={cName}
                                type="button"
                                onClick={() => {
                                  const currentList = planAssignTargetClasses[p.id] || [...selectedClasses];
                                  const nextList = isChecked
                                    ? currentList.filter(x => x !== cName)
                                    : [...currentList, cName];
                                  setPlanAssignTargetClasses({
                                    ...planAssignTargetClasses,
                                    [p.id]: nextList.length > 0 ? nextList : [cName]
                                  });
                                }}
                                className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border transition-all ${
                                  isChecked
                                    ? 'bg-amber-600 text-white border-amber-700 shadow-2xs'
                                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600'
                                }`}
                              >
                                {isChecked ? '✓ ' : '+ '}{cName}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* Card Actions Footer */}
                    <div className="pt-2 flex flex-col gap-1.5">
                      <div className="flex items-center gap-1.5 justify-between">
                        <button
                          type="button"
                          onClick={() => {
                            if (step2CardDuplicatingId === p.id) {
                              setStep2CardDuplicatingId(null);
                            } else {
                              setStep2CardDuplicatingId(p.id);
                              setStep2CardDuplicateTargetPeriod('Trimestre 2');
                              setStep2CardDuplicateTargetClass(displayedClasses[0]?.name || '');
                            }
                          }}
                          className="flex-1 py-1 px-2 bg-amber-100 hover:bg-amber-200 dark:bg-amber-950 dark:hover:bg-amber-900 text-amber-900 dark:text-amber-200 font-extrabold rounded-lg text-[11px] border border-amber-300 dark:border-amber-700 transition-all flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <span>📋 Dupliquer</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setStep2CardDeletingId(p.id)}
                          className="py-1 px-2.5 bg-rose-100 hover:bg-rose-200 dark:bg-rose-950 dark:hover:bg-rose-900 text-rose-800 dark:text-rose-200 font-extrabold rounded-lg text-[11px] border border-rose-300 dark:border-rose-700 transition-all flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <span>🗑️ Supprimer</span>
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={async () => {
                          await togglePastPlan(p.id, !p.isPast);
                          const fresh = await getPublishedPlans();
                          setPublishedDbPlans(fresh);
                        }}
                        className="text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:text-amber-600 dark:hover:text-amber-400 underline transition-all text-center cursor-pointer py-0.5"
                      >
                        {p.isPast ? '🟢 Marquer comme Plan Actuel (synchro effectif)' : '📦 Marquer comme Plan Passé (gèle l\'effectif)'}
                      </button>

                      <button
                        type="button"
                        onClick={() => setSelectedPreviewPlanId(p.id)}
                        className="w-full py-1.5 px-3 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-white font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <span>👀 Prévisualiser dans la fenêtre ci-dessus</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleAssignDbPlanToClassesAndLoad(p, targetClassesForThisPlan)}
                        className="w-full py-2.5 px-4 bg-amber-600 hover:bg-amber-700 text-white font-extrabold rounded-xl text-xs shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <span>🎯 Affecter & Charger ce Plan pour ({targetClassesForThisPlan.join(', ')}) → Aller à l'Étape 3</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* SECTION 3: VERIFICATION, DISPOSITION ET VALIDATION DU PLAN */}
      <div id="step-3-section" className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700 space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white font-bold text-lg shadow-sm">
            3
          </div>
          <div>
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
              📝 Étape 3 : Vérification, Disposition & Validation du Plan
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Vérifiez la liste des élèves, contrôlez leur disposition et validez l'étape pour accéder à l'éditeur interactif.
            </p>
          </div>
        </div>

        {/* ACTIVE ASSIGNED PLAN BANNER IF LOADED FROM STEP 2 */}
        {assignedPlanForStep3 && (
          <div className="p-5 bg-gradient-to-r from-emerald-950/90 to-slate-900 border-2 border-emerald-500 rounded-2xl text-white shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-emerald-800/80 pb-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500 text-slate-950 font-black text-xl shrink-0 shadow-md">
                  ✅
                </div>
                <div>
                  <div className="font-extrabold text-white text-base">
                    Plan d'origine d'Étape 2 affecté à : <span className="underline font-black text-emerald-300">{assignedPlanForStep3.targetClasses.join(', ')}</span>
                  </div>
                  <div className="text-slate-300 font-medium text-xs mt-0.5 flex flex-wrap gap-2">
                    <span>👨‍🏫 Prof : <strong className="text-emerald-200">{assignedPlanForStep3.plan.teacherName}</strong></span>
                    <span>•</span>
                    <span>📅 {assignedPlanForStep3.plan.period}</span>
                    <span>•</span>
                    <span>📐 Grille {assignedPlanForStep3.plan.gridDimensions.rows}×{assignedPlanForStep3.plan.gridDimensions.cols}</span>
                    <span>•</span>
                    <span>👥 {assignedPlanForStep3.plan.placements.length} élèves</span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAssignedPlanForStep3(null)}
                className="px-3.5 py-1.5 bg-emerald-900/80 hover:bg-emerald-800 border border-emerald-600 text-emerald-100 font-bold rounded-xl text-xs transition-all shrink-0 cursor-pointer"
              >
                🔄 Choisir un autre plan
              </button>
            </div>

            {/* Placement & Modifiability Toggles */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
              {/* 1. Placement Mode Selector */}
              <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-700 space-y-2">
                <label className="block text-xs font-bold text-emerald-300">
                  🎯 Mode de placement par défaut :
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setPlacementMode('base_plan')}
                    className={`px-2 py-2 rounded-lg text-xs font-black transition-all flex items-center justify-center gap-1 cursor-pointer ${
                      placementMode === 'base_plan'
                        ? 'bg-amber-500 text-slate-950 shadow-md ring-2 ring-amber-400 font-black'
                        : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700'
                    }`}
                  >
                    <span>📐 Plan de base</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlacementMode('random')}
                    className={`px-2 py-2 rounded-lg text-xs font-black transition-all flex items-center justify-center gap-1 cursor-pointer ${
                      placementMode === 'random'
                        ? 'bg-amber-500 text-slate-950 shadow-md ring-2 ring-amber-400 font-black'
                        : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700'
                    }`}
                  >
                    <span>🎲 Aléatoire</span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setPlacementMode('empty');
                      setEditabilityMode('students_allowed');
                      if (assignedPlanForStep3) {
                        try {
                          const emptyPlacements: StudentPlacement[] = (assignedPlanForStep3.plan.placements || []).map(p => ({
                            ...p,
                            location: 'bank' as StudentLocation
                          }));
                          const targets = assignedPlanForStep3.targetClasses.length > 0
                            ? assignedPlanForStep3.targetClasses
                            : (selectedClasses.length > 0 ? selectedClasses : ['Classe']);
                          const periods = selectedPublishPeriods.length > 0
                            ? selectedPublishPeriods
                            : [periodName || assignedPlanForStep3.plan.period || 'Période 1'];

                          for (const cName of targets) {
                            for (const pName of periods) {
                              await savePublishedPlan({
                                teacherName: teacherName || assignedPlanForStep3.plan.teacherName || 'M. / Mme Enseignant',
                                className: cName,
                                period: pName,
                                allowStudentSelfPlacement: true,
                                isFrozen: false,
                                gridDimensions: assignedPlanForStep3.plan.gridDimensions,
                                unavailableCells: assignedPlanForStep3.plan.unavailableCells || [],
                                placements: emptyPlacements,
                              });
                            }
                          }
                          const freshPlans = await getPublishedPlans();
                          setPublishedDbPlans(freshPlans);
                        } catch (err) {
                          console.error("Error auto-publishing empty plan:", err);
                        }
                      }
                    }}
                    className={`px-2 py-2 rounded-lg text-xs font-black transition-all flex items-center justify-center gap-1 cursor-pointer ${
                      placementMode === 'empty'
                        ? 'bg-amber-500 text-slate-950 shadow-md ring-2 ring-amber-400 font-black'
                        : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700'
                    }`}
                  >
                    <span>🪑 Vides</span>
                  </button>
                </div>
                <p className="text-[10px] text-slate-400">
                  {placementMode === 'base_plan'
                    ? 'Conserve la disposition originale des places du plan de base (en ignorant les tables masquées).'
                    : placementMode === 'random'
                    ? 'Les élèves seront automatiquement répartis sur les bureaux utilisables.'
                    : 'Aucun élève ne sera placé initialement sur la grille (placement libre/manuel).'}
                </p>
              </div>

              {/* 2. Modifiability Selector */}
              <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-700 space-y-2">
                <label className="block text-xs font-bold text-indigo-300">
                  🔒 Droit de modification du plan :
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setEditabilityMode('teacher_only')}
                    className={`px-3 py-2 rounded-lg text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      editabilityMode === 'teacher_only'
                        ? 'bg-indigo-600 text-white shadow-md ring-2 ring-indigo-400 font-black'
                        : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700'
                    }`}
                  >
                    <span>🔒 Figé (Professeur)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditabilityMode('students_allowed')}
                    className={`px-3 py-2 rounded-lg text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      editabilityMode === 'students_allowed'
                        ? 'bg-indigo-600 text-white shadow-md ring-2 ring-indigo-400 font-black'
                        : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700'
                    }`}
                  >
                    <span>✏️ Modifiable (Élèves)</span>
                  </button>
                </div>
                <p className="text-[10px] text-slate-400">
                  {editabilityMode === 'teacher_only'
                    ? 'Placement figé : modifiable uniquement par le professeur.'
                    : 'Modifiable par les élèves qui pourront réorganiser leur disposition.'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3 TABS / MODES */}
        <div className="flex border-b border-slate-200 dark:border-slate-700 gap-3">
          <button
            type="button"
            onClick={() => setStep3Mode('create')}
            className={`pb-3 px-4 font-extrabold text-xs sm:text-sm border-b-2 transition-all flex items-center gap-2 ${
              step3Mode === 'create'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 font-black'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <span>{assignedPlanForStep3 ? "✏️ Vérifier & Valider le Plan Charger" : "🆕 Créer un Nouveau Plan"}</span>
          </button>
          <button
            type="button"
            onClick={() => setStep3Mode('open')}
            className={`pb-3 px-4 font-extrabold text-xs sm:text-sm border-b-2 transition-all flex items-center gap-2 ${
              step3Mode === 'open'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 font-black'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <span>📂 Ouvrir un Autre Plan de la Base</span>
          </button>
        </div>

        {/* MODE A: VERIFY & CREATE/VALIDATE PLAN */}
        {step3Mode === 'create' && (
          <div className="space-y-5">
            {/* Teacher & Period Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs bg-slate-50 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  👨‍🏫 Nom de l'Enseignant
                </label>
                <input
                  type="text"
                  value={teacherName}
                  onChange={(e) => setTeacherName(e.target.value)}
                  placeholder="M. Abgrall"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-white font-semibold focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div className="space-y-2">
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  📅 Période principale de publication
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <select
                    value={STANDARD_PERIODS.includes(periodName) ? periodName : 'custom'}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val !== 'custom') {
                        setPeriodName(val);
                        if (!selectedPublishPeriods.includes(val)) {
                          setSelectedPublishPeriods([...selectedPublishPeriods, val]);
                        }
                      }
                    }}
                    className="px-3 py-2 text-xs font-bold rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value="custom">-- Choisir période type --</option>
                    {STANDARD_PERIODS.map(sp => (
                      <option key={`step3-period-${sp}`} value={sp}>{sp}</option>
                    ))}
                  </select>

                  <input
                    type="text"
                    value={periodName}
                    onChange={(e) => {
                      const val = e.target.value;
                      setPeriodName(val);
                      if (val.trim()) {
                        setSelectedPublishPeriods([val.trim()]);
                      }
                    }}
                    placeholder="Trimestre 1 - 2026"
                    className="flex-1 px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-white font-semibold focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>

                {/* Multi-Period selection checkboxes */}
                <div className="mt-2 p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5">
                  <span className="font-extrabold text-[11px] text-indigo-900 dark:text-indigo-200 block">
                    🎯 Publier simultanément sur plusieurs périodes :
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {['Trimestre 1', 'Trimestre 2', 'Trimestre 3', 'Période 1', 'Période 2', 'Semestre 1', 'Semestre 2'].map(pOption => {
                      const isChecked = selectedPublishPeriods.includes(pOption);
                      return (
                        <label
                          key={`step3-pcheck-${pOption}`}
                          className={`px-2 py-1 rounded-lg border cursor-pointer select-none font-bold text-[11px] transition-all flex items-center gap-1 ${
                            isChecked
                              ? 'bg-indigo-600 text-white border-indigo-700 shadow-2xs'
                              : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedPublishPeriods([...selectedPublishPeriods, pOption]);
                              } else {
                                setSelectedPublishPeriods(selectedPublishPeriods.filter(p => p !== pOption));
                              }
                            }}
                            className="hidden"
                          />
                          <span>{isChecked ? '✓' : '+'}</span>
                          <span>{pOption}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Student List Verification Textarea */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block font-bold text-slate-800 dark:text-slate-200 text-xs">
                  📋 Liste des Élèves de la classe ({selectedClasses.join(', ')}) :
                </label>
                <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400">
                  {text.split('\n').filter(t => t.trim()).length} élève(s) détecté(s)
                </span>
              </div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Collez la liste d'élèves ici...&#10;1. Jean Dupont&#10;2. Marie Curie&#10;3. Louis Pasteur"
                className="w-full h-40 p-3.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-700/50 focus:ring-2 focus:ring-indigo-500 focus:outline-none text-xs font-medium text-slate-800 dark:text-slate-200 font-mono"
                disabled={isLoading}
              />
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                ℹ️ Vous pouvez librement ajouter, modifier ou corriger des noms dans le champ ci-dessus avant de valider l'étape.
              </p>
            </div>

            {/* Disposition Grid Mini Preview if Plan Assigned */}
            {assignedPlanForStep3 && (
              <div className="p-4 bg-slate-900 text-white rounded-2xl border border-slate-700 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-xs text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                    <span>🎯 Aperçu de la Disposition des Élèves</span>
                  </span>
                  <span className="text-[11px] font-bold text-slate-300">
                    📐 Grille {assignedPlanForStep3.plan.gridDimensions.rows}×{assignedPlanForStep3.plan.gridDimensions.cols}
                  </span>
                </div>
                <div 
                  className="grid gap-1.5 p-3 bg-slate-950 rounded-xl overflow-x-auto max-h-48"
                  style={{
                    gridTemplateColumns: `repeat(${assignedPlanForStep3.plan.gridDimensions.cols}, minmax(65px, 1fr))`
                  }}
                >
                  {Array.from({ length: assignedPlanForStep3.plan.gridDimensions.rows * assignedPlanForStep3.plan.gridDimensions.cols }).map((_, idx) => {
                    const studentAtIdx = assignedPlanForStep3.plan.placements.find(p => p.location === idx);
                    const isUnavailable = assignedPlanForStep3.plan.unavailableCells?.includes(idx);

                    if (isUnavailable) {
                      return (
                        <div key={idx} className="h-10 rounded bg-slate-800/40 text-[8px] text-slate-600 flex items-center justify-center">
                          🚫
                        </div>
                      );
                    }

                    if (studentAtIdx) {
                      return (
                        <div key={idx} className="h-10 p-1 rounded bg-indigo-900/90 border border-indigo-500/70 text-[9px] text-white truncate flex items-center justify-center font-bold" title={studentAtIdx.name}>
                          {studentAtIdx.name}
                        </div>
                      );
                    }

                    return (
                      <div key={idx} className="h-10 rounded bg-slate-900/60 border border-dashed border-slate-800 text-[8px] text-slate-600 flex items-center justify-center">
                        🪑
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Validation & Launch Button */}
            <div>
              <button
                type="button"
                onClick={handleValidateAndLaunchStep3}
                disabled={isLoading || !text.trim()}
                className="w-full flex justify-center items-center gap-2 py-4 px-5 border border-transparent rounded-2xl shadow-xl text-sm font-black text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-500/50 disabled:bg-indigo-400 disabled:cursor-not-allowed transition-all cursor-pointer"
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Validation & Chargement de l'Éditeur...
                  </>
                ) : (
                  <span>✅ Valider l'Étape 3 & Lancer le Plan de Classe pour ({selectedClasses.join(', ')})</span>
                )}
              </button>
            </div>

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center" aria-hidden="true">
                <div className="w-full border-t border-slate-200 dark:border-slate-700"></div>
              </div>
              <div className="relative flex justify-center">
                <span className="bg-white dark:bg-slate-800 px-3 text-xs font-bold text-slate-400 uppercase">OU IMPORTER UN FICHIER</span>
              </div>
            </div>
            
            <input
              type="file"
              ref={jsonInputRef}
              onChange={handleJsonFileChange}
              accept=".json"
              className="hidden"
            />
            <input
              type="file"
              ref={sheetInputRef}
              onChange={handleSheetFileChange}
              accept=".xls,.xlsx"
              className="hidden"
            />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                type="button"
                onClick={handleLoadJsonClick}
                className="w-full flex justify-center items-center py-2.5 px-3 border border-slate-300 dark:border-slate-600 rounded-xl shadow-sm text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
              >
                <UploadIcon className="h-4 w-4 mr-1.5"/>
                Charger fichier JSON (.json)
              </button>
              <button
                type="button"
                onClick={handleLoadSheetClick}
                className="w-full flex justify-center items-center py-2.5 px-3 border border-slate-300 dark:border-slate-600 rounded-xl shadow-sm text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
              >
                <SheetIcon className="h-4 w-4 mr-1.5"/>
                Importer Excel (.xlsx)
              </button>
              <button
                type="button"
                onClick={handleStartWithBlankPlan}
                className="w-full flex justify-center items-center py-2.5 px-3 border border-slate-300 dark:border-slate-600 rounded-xl shadow-sm text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
              >
                <FilePlusIcon className="h-4 w-4 mr-1.5"/>
                Créer un Plan vide
              </button>
            </div>
          </div>
        )}

        {/* MODE B: OPEN EXISTING PLAN FROM DATABASE */}
        {step3Mode === 'open' && (
          <div className="space-y-4 p-4 bg-indigo-50/50 dark:bg-indigo-950/30 rounded-2xl border border-indigo-200 dark:border-indigo-800">
            <h3 className="font-extrabold text-sm text-indigo-950 dark:text-indigo-200">
              📂 Choisir un Plan Existant dans la Base Firestore
            </h3>
            
            {publishedDbPlans.length === 0 ? (
              <p className="text-xs text-slate-500 italic p-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                Aucun plan enregistré n'est disponible pour l'instant dans la base de données.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Sélectionnez le plan à ouvrir :
                  </label>
                  <select
                    value={step3SelectedPlanId || (publishedDbPlans[0]?.id || '')}
                    onChange={(e) => setStep3SelectedPlanId(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 font-bold text-xs text-slate-900 dark:text-white"
                  >
                    {publishedDbPlans.map((p, pIdx) => (
                      <option key={`step3-plan-opt-${p.id}-${pIdx}`} value={p.id}>
                        🏫 Classe : {p.className} — 👨‍🏫 Prof : {p.teacherName} ({p.period}) — {p.placements.length} élèves
                      </option>
                    ))}
                  </select>
                </div>

                <div className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2 text-xs">
                  <span className="font-extrabold text-slate-800 dark:text-slate-200 block">
                    🎯 Affecter et ouvrir ce plan pour la/les classe(s) suivante(s) :
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {displayedClasses.map(cItem => {
                      const cName = cItem.name;
                      const isChecked = (step3TargetClasses.length > 0 ? step3TargetClasses : selectedClasses).includes(cName);
                      return (
                        <button
                          key={cName}
                          type="button"
                          onClick={() => {
                            const currentList = step3TargetClasses.length > 0 ? step3TargetClasses : [...selectedClasses];
                            const nextList = isChecked
                              ? currentList.filter(x => x !== cName)
                              : [...currentList, cName];
                            setStep3TargetClasses(nextList.length > 0 ? nextList : [cName]);
                          }}
                          className={`px-2.5 py-1 rounded-xl text-xs font-bold border transition-all ${
                            isChecked
                              ? 'bg-indigo-600 text-white border-indigo-700 shadow-2xs'
                              : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600'
                          }`}
                        >
                          {isChecked ? '✓ ' : '+ '}{cName}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const chosenId = step3SelectedPlanId || publishedDbPlans[0]?.id;
                    const foundPlan = publishedDbPlans.find(p => p.id === chosenId);
                    if (foundPlan) {
                      const targets = step3TargetClasses.length > 0 ? step3TargetClasses : selectedClasses;
                      handleAssignDbPlanToClassesAndLoad(foundPlan, targets);
                    }
                  }}
                  className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-xl text-xs shadow-md transition-all flex items-center justify-center gap-2"
                >
                  <span>🚀 Ouvrir & Affecter ce Plan aux classes ({ (step3TargetClasses.length > 0 ? step3TargetClasses : selectedClasses).join(', ') })</span>
                </button>
              </div>
            )}
          </div>
        )}

        {error && <p className="mt-4 text-xs font-bold text-center text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/50 p-3 rounded-xl border border-red-200 dark:border-red-800">⚠️ {error}</p>}

      </div>

      {/* CLASS EDITION & STUDENT IMPORT MODAL */}
      {editingClass && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-fadeIn">
          <div className="bg-white dark:bg-slate-800 w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden my-6">
            {/* MODAL HEADER */}
            <div className="p-5 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white flex items-center justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-extrabold flex items-center gap-2">
                    <span>🏫 Classe : {editingClass}</span>
                  </h3>
                  <span className="px-2.5 py-0.5 bg-white/20 text-white rounded-full text-xs font-bold backdrop-blur-xs">
                    👥 {modalStudents.length} élève(s)
                  </span>
                </div>
                <p className="text-xs text-indigo-100 mt-1">
                  Modifiez les noms, les codes PIN / mots de passe des élèves, ajoutez ou retirez des élèves, ou importez un fichier.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingClass(null)}
                className="p-2 text-indigo-100 hover:text-white hover:bg-indigo-700/80 rounded-xl transition-all font-bold text-lg cursor-pointer"
                title="Fermer la fenêtre"
              >
                ✖
              </button>
            </div>

            <div className="p-5 sm:p-6 space-y-4 text-xs">
              {/* SYNC INFO BANNER */}
              <div className="p-3 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 rounded-xl text-xs text-indigo-900 dark:text-indigo-200 flex items-center gap-2">
                <span>💡 <strong>Synchronisation automatique :</strong> Les modifications des noms, mots de passe, ajouts et retraits d'élèves seront automatiquement reportés sur les <strong>plans actuels</strong> de la classe. Les <strong>plans passés/archivés</strong> restent protégés.</span>
              </div>

              {/* 1. SÉLECTION & GESTION DU NOM DE LA CLASSE (MENU DÉROULANT DE LA BASE) */}
              <div className="p-3.5 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2 flex-1 flex-wrap">
                    <label className="font-extrabold text-slate-800 dark:text-slate-200 shrink-0 flex items-center gap-1.5">
                      <span>✏️</span>
                      <span>Nom de la classe :</span>
                    </label>
                    <select
                      value={editingClass || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '__NEW__') {
                          setIsCreatingNewClass(true);
                          setIsRenamingClass(false);
                          setNewModalClassName('');
                        } else if (val) {
                          setIsCreatingNewClass(false);
                          setIsRenamingClass(false);
                          handleOpenClassModal(val);
                        }
                      }}
                      className="flex-1 min-w-[220px] px-3 py-1.5 text-xs rounded-xl border border-indigo-300 dark:border-indigo-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-extrabold focus:ring-2 focus:ring-indigo-500 focus:outline-none cursor-pointer"
                    >
                      {allAvailableClassesList.length === 0 && (
                        <option value="">-- Aucune classe dans la base --</option>
                      )}
                      {allAvailableClassesList.map(c => {
                        const rosterCount = (classRosters[c.name] || []).length;
                        return (
                          <option key={`modal-select-class-${c.name}`} value={c.name}>
                            🏫 {c.name} {rosterCount > 0 ? `(${rosterCount} élève${rosterCount > 1 ? 's' : ''})` : ''}
                          </option>
                        );
                      })}
                      <option value="__NEW__">➕ Créer une nouvelle classe...</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    {editingClass && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsRenamingClass(!isRenamingClass);
                          setIsCreatingNewClass(false);
                        }}
                        className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 font-bold text-xs rounded-xl transition-all cursor-pointer"
                        title="Renommer cette classe"
                      >
                        ✏️ Renommer
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setIsCreatingNewClass(true);
                        setIsRenamingClass(false);
                        setNewModalClassName('');
                      }}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all cursor-pointer"
                      title="Créer une nouvelle classe"
                    >
                      ➕ Nouvelle classe
                    </button>
                  </div>
                </div>

                {/* Sub-drawer: Rename current class */}
                {isRenamingClass && editingClass && (
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-2 border-t border-slate-200 dark:border-slate-700 animate-fadeIn">
                    <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400">Nouveau nom pour {editingClass} :</span>
                    <input
                      type="text"
                      value={editClassNameInput}
                      onChange={(e) => setEditClassNameInput(e.target.value)}
                      placeholder="Ex : 3ème B"
                      className="flex-1 px-3 py-1.5 text-xs rounded-xl border border-indigo-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-bold"
                    />
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          handleRenameClassInModal();
                          setIsRenamingClass(false);
                        }}
                        disabled={!editClassNameInput.trim() || editClassNameInput.trim() === editingClass}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-bold text-xs rounded-xl cursor-pointer"
                      >
                        Valider
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsRenamingClass(false)}
                        className="px-2.5 py-1.5 text-slate-500 hover:text-slate-700 text-xs font-bold"
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                )}

                {/* Sub-drawer: Create new class */}
                {isCreatingNewClass && (
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-2 border-t border-indigo-200 dark:border-indigo-800 animate-fadeIn">
                    <span className="text-[11px] font-bold text-indigo-900 dark:text-indigo-300">Nom de la nouvelle classe :</span>
                    <input
                      type="text"
                      value={newModalClassName}
                      onChange={(e) => setNewModalClassName(e.target.value)}
                      placeholder="Ex : 5ème A, Terminale SNT"
                      className="flex-1 px-3 py-1.5 text-xs rounded-xl border border-indigo-400 dark:border-indigo-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-bold"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const trimmed = newModalClassName.trim();
                          if (trimmed) {
                            if (!profile.classes.includes(trimmed)) {
                              const updatedProf = { ...profile, classes: [...profile.classes, trimmed] };
                              setProfile(updatedProf);
                              try {
                                localStorage.setItem('teacher_profile_v2', JSON.stringify(updatedProf));
                              } catch (err) {
                                console.error(err);
                              }
                            }
                            handleOpenClassModal(trimmed);
                            setIsCreatingNewClass(false);
                            setNewModalClassName('');
                          }
                        }
                      }}
                    />
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          const trimmed = newModalClassName.trim();
                          if (trimmed) {
                            if (!profile.classes.includes(trimmed)) {
                              const updatedProf = { ...profile, classes: [...profile.classes, trimmed] };
                              setProfile(updatedProf);
                              try {
                                localStorage.setItem('teacher_profile_v2', JSON.stringify(updatedProf));
                              } catch (err) {
                                console.error(err);
                              }
                            }
                            handleOpenClassModal(trimmed);
                            setIsCreatingNewClass(false);
                            setNewModalClassName('');
                          }
                        }}
                        disabled={!newModalClassName.trim()}
                        className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-bold text-xs rounded-xl cursor-pointer"
                      >
                        ➕ Créer
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsCreatingNewClass(false)}
                        className="px-2.5 py-1.5 text-slate-500 hover:text-slate-700 text-xs font-bold"
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* NOTICES */}
              {modalNotice && (
                <div className={`p-3 rounded-xl border font-bold text-xs flex items-center justify-between animate-fadeIn ${
                  modalNotice.type === 'success'
                    ? 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-800'
                    : 'bg-red-50 dark:bg-red-950/80 text-red-800 dark:text-red-200 border-red-300 dark:border-red-800'
                }`}>
                  <span>{modalNotice.text}</span>
                  <button type="button" onClick={() => setModalNotice(null)} className="ml-2 font-black text-slate-400 hover:text-slate-600 cursor-pointer">×</button>
                </div>
              )}

              {/* TABS NAVIGATION */}
              <div className="flex border-b border-slate-200 dark:border-slate-700 gap-2">
                <button
                  type="button"
                  onClick={() => setModalActiveTab('list')}
                  className={`pb-2.5 px-3.5 font-bold text-xs border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
                    modalActiveTab === 'list'
                      ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 font-extrabold'
                      : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  <span>👥 Liste des élèves ({modalStudents.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setModalActiveTab('csv')}
                  className={`pb-2.5 px-3.5 font-bold text-xs border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
                    modalActiveTab === 'csv'
                      ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 font-extrabold'
                      : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  <span>📄 Importer CSV / Excel</span>
                </button>
                <button
                  type="button"
                  onClick={() => setModalActiveTab('paste')}
                  className={`pb-2.5 px-3.5 font-bold text-xs border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
                    modalActiveTab === 'paste'
                      ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 font-extrabold'
                      : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  <span>📋 Copier-Coller du texte</span>
                </button>
              </div>

              {/* TAB 1: CURRENT LIST VIEW & DIRECT EDIT */}
              {modalActiveTab === 'list' && (
                <div className="space-y-3.5">
                  {/* Quick Add Single Student Form */}
                  <form onSubmit={handleAddSingleStudentInModal} className="p-3 bg-indigo-50/70 dark:bg-indigo-950/40 rounded-xl border border-indigo-200 dark:border-indigo-800 flex flex-col sm:flex-row gap-2 items-center">
                    <div className="flex-1 w-full flex gap-2">
                      <input
                        type="text"
                        value={newStudentNameInput}
                        onChange={(e) => setNewStudentNameInput(e.target.value)}
                        placeholder="+ Nom & Prénom de l'élève (ex: Martin Thomas)"
                        className="flex-1 px-3 py-2 text-xs border border-indigo-300 dark:border-indigo-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      />
                      <input
                        type="text"
                        value={newStudentRollInput}
                        onChange={(e) => setNewStudentRollInput(e.target.value)}
                        placeholder="N°"
                        title="Numéro d'appel"
                        className="w-16 px-2 py-2 text-xs text-center border border-indigo-300 dark:border-indigo-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono font-bold focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <div className="flex items-center gap-1 bg-white dark:bg-slate-800 px-2 py-1.5 rounded-lg border border-indigo-300 dark:border-indigo-700 shrink-0">
                        <span className="text-[10px] text-slate-500 font-bold">PIN :</span>
                        <input
                          type="text"
                          value={newStudentPasswordInput}
                          onChange={(e) => setNewStudentPasswordInput(e.target.value)}
                          placeholder="0000"
                          maxLength={8}
                          className="w-16 text-center text-xs font-mono font-bold bg-transparent text-slate-900 dark:text-white focus:outline-none"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={!newStudentNameInput.trim()}
                        className="flex-1 sm:flex-none px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-lg shadow-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1 shrink-0 cursor-pointer"
                      >
                        <span>+ Ajouter l'élève</span>
                      </button>
                    </div>
                  </form>

                  {/* Search and Bulk Actions Toolbar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    {/* Search filter */}
                    <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
                      <span className="text-slate-400">🔍</span>
                      <input
                        type="text"
                        value={modalSearchFilter}
                        onChange={(e) => setModalSearchFilter(e.target.value)}
                        placeholder="Filtrer les élèves par nom ou numéro..."
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                      {modalSearchFilter && (
                        <button
                          type="button"
                          onClick={() => setModalSearchFilter('')}
                          className="text-slate-400 hover:text-slate-600 font-bold text-xs cursor-pointer"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {/* Quick Bulk Actions & Trombi Integration */}
                    <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setIsTrombiModalOpen(true)}
                        className="px-3 py-1.5 text-xs font-black bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
                        title="Associer un trombinoscope PDF ou photo à cette classe avec détection automatique des noms"
                      >
                        <span>📸</span>
                        <span>Associer Trombinoscope PDF</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowModalPasswords(!showModalPasswords)}
                        className="px-2.5 py-1 text-[11px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-all border border-slate-300 dark:border-slate-600 cursor-pointer"
                        title={showModalPasswords ? "Masquer les mots de passe" : "Afficher les mots de passe en clair"}
                      >
                        {showModalPasswords ? '🙈 Masquer PINs' : '👁️ Afficher PINs'}
                      </button>
                      <button
                        type="button"
                        onClick={handleResetAllPasswordsToDefault}
                        className="px-2.5 py-1 text-[11px] font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200 rounded-lg hover:bg-amber-100 border border-amber-300 dark:border-amber-800 transition-all cursor-pointer"
                        title="Réinitialiser tous les mots de passe à 0000"
                      >
                        🔑 Tous à 0000
                      </button>
                      <button
                        type="button"
                        onClick={handleGenerateRandomPins}
                        className="px-2.5 py-1 text-[11px] font-bold bg-purple-50 dark:bg-purple-950/60 text-purple-800 dark:text-purple-200 rounded-lg hover:bg-purple-100 border border-purple-300 dark:border-purple-800 transition-all cursor-pointer"
                        title="Générer des PINs aléatoires à 4 chiffres pour tous les élèves"
                      >
                        🎲 PINs aléatoires
                      </button>
                      {modalStudents.length > 0 && (
                        <button
                          type="button"
                          onClick={handleClearModalStudents}
                          className="px-2 py-1 text-[11px] font-bold text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-all cursor-pointer"
                          title="Vider toute la liste"
                        >
                          🗑️ Vider
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Students List Display */}
                  {modalStudents.length === 0 ? (
                    <div className="p-8 text-center bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 space-y-3">
                      <div className="text-3xl">👥</div>
                      <div className="font-extrabold text-sm text-slate-800 dark:text-slate-200">
                        Aucun élève dans la classe {editingClass || ''} pour le moment.
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                        Vous pouvez ajouter des élèves manuellement avec le formulaire ci-dessus, ou importer en 1 clic un fichier Pronote/Excel via l'onglet <strong>Importer CSV / Excel</strong>, ou directement associer un <strong>Trombinoscope PDF</strong>.
                      </p>
                      <div className="flex justify-center gap-2 pt-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => setIsTrombiModalOpen(true)}
                          className="px-3.5 py-2 bg-indigo-600 text-white font-bold rounded-lg text-xs hover:bg-indigo-700 cursor-pointer shadow-xs"
                        >
                          📸 Associer Trombinoscope PDF
                        </button>
                        <button
                          type="button"
                          onClick={() => setModalActiveTab('csv')}
                          className="px-3.5 py-2 bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-bold rounded-lg border border-indigo-200 dark:border-indigo-800 text-xs hover:bg-indigo-100 cursor-pointer"
                        >
                          📄 Importer un fichier Excel / CSV
                        </button>
                        <button
                          type="button"
                          onClick={() => setModalActiveTab('paste')}
                          className="px-3.5 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-lg border border-slate-200 dark:border-slate-600 text-xs hover:bg-slate-200 cursor-pointer"
                        >
                          📋 Copier-Coller une liste
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-2xs">
                      {/* Table Header: Notice Photo is placed between roll number and student name */}
                      <div className="bg-slate-100 dark:bg-slate-900/80 px-3 py-2 border-b border-slate-200 dark:border-slate-700 grid grid-cols-12 gap-2 text-[11px] font-extrabold text-slate-600 dark:text-slate-300 uppercase tracking-wider items-center">
                        <span className="col-span-1 text-center">N°</span>
                        <span className="col-span-2 text-center">N° Appel</span>
                        <span className="col-span-1 text-center">Photo</span>
                        <span className="col-span-4 sm:col-span-4">Nom & Prénom</span>
                        <span className="col-span-3 sm:col-span-3 text-center">Code PIN / Mot de Passe</span>
                        <span className="col-span-1 text-right">Retirer</span>
                      </div>

                      {/* Table Rows */}
                      <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-800/90">
                        {modalStudents
                          .filter(st => {
                            if (!modalSearchFilter.trim()) return true;
                            const q = modalSearchFilter.toLowerCase();
                            return st.name.toLowerCase().includes(q) || (st.rollNumber && st.rollNumber.toLowerCase().includes(q));
                          })
                          .map((st, index) => {
                            const passEntry = modalStudentPasswords[st.id] || { password: '0000', isDefault: true };
                            const isDefaultPass = passEntry.isDefault || passEntry.password === '0000';

                            return (
                              <div
                                key={`modal-st-${st.id}-${index}`}
                                className="px-3 py-2 grid grid-cols-12 gap-2 items-center hover:bg-slate-50/80 dark:hover:bg-slate-700/30 transition-all text-xs"
                              >
                                {/* 1. Index */}
                                <span className="col-span-1 text-center font-mono font-bold text-slate-400 dark:text-slate-500 text-[11px]">
                                  #{index + 1}
                                </span>

                                {/* 2. Roll Number Input */}
                                <div className="col-span-2 flex justify-center">
                                  <input
                                    type="text"
                                    value={st.rollNumber || ''}
                                    onChange={(e) => handleUpdateStudentRollNumber(st.id, e.target.value)}
                                    placeholder={String(index + 1)}
                                    className="w-14 px-1.5 py-1 text-center font-mono text-xs font-bold text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-900/60 rounded-lg border border-transparent hover:border-slate-300 dark:hover:border-slate-600 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 focus:outline-none"
                                    title="Numéro d'appel de l'élève"
                                  />
                                </div>

                                {/* 3. Photo (between roll number and student name as requested) */}
                                <div className="col-span-1 flex justify-center items-center">
                                  {st.photoUrl ? (
                                    <div className="relative group/photo flex items-center justify-center">
                                      <button
                                        type="button"
                                        onClick={() => setPhotoModalData({
                                          name: st.name,
                                          photoUrl: st.photoUrl,
                                          rollNumber: st.rollNumber,
                                          className: editingClass || undefined,
                                        })}
                                        className="w-7 h-8 rounded overflow-hidden border border-slate-400 dark:border-slate-600 bg-slate-200 dark:bg-slate-700 shadow-2xs hover:scale-110 transition-transform cursor-pointer"
                                        title="Cliquer pour voir la photo en grand ou la modifier"
                                      >
                                        <img
                                          src={st.photoUrl}
                                          alt={st.name}
                                          className="w-full h-full object-cover"
                                          referrerPolicy="no-referrer"
                                        />
                                      </button>
                                      {/* Quick hover erase button */}
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (confirm(`Effacer la photo de ${st.name} ?`)) {
                                            handleDeleteStudentPhoto(st.id);
                                          }
                                        }}
                                        className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 text-white rounded-full flex items-center justify-center text-[9px] opacity-0 group-hover/photo:opacity-100 hover:scale-120 transition-all shadow-xs cursor-pointer"
                                        title="Effacer la photo"
                                      >
                                        ✕
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const input = document.createElement('input');
                                        input.type = 'file';
                                        input.accept = 'image/webp,image/jpeg,image/png,image/*';
                                        input.onchange = async (ev: any) => {
                                          const file = ev.target.files?.[0];
                                          if (file) {
                                            await handleUpdateStudentPhoto(st.id, file);
                                          }
                                        };
                                        input.click();
                                      }}
                                      className="w-7 h-8 rounded border border-dashed border-slate-300 dark:border-slate-600 text-slate-400 dark:text-slate-500 hover:border-indigo-500 hover:text-indigo-400 flex items-center justify-center text-[10px] transition-colors cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                                      title="Ajouter une photo (WebP/JPG) pour cet élève"
                                    >
                                      📷+
                                    </button>
                                  )}
                                </div>

                                {/* 4. Student Name Input */}
                                <div className="col-span-4 sm:col-span-4 flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    value={st.name}
                                    onChange={(e) => handleUpdateStudentName(st.id, e.target.value)}
                                    placeholder="Nom et prénom de l'élève"
                                    className="w-full px-2.5 py-1 font-semibold text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-900/60 rounded-lg border border-transparent hover:border-slate-300 dark:hover:border-slate-600 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-all text-xs"
                                  />
                                </div>

                                {/* 5. Password Edit & Reset */}
                                <div className="col-span-3 sm:col-span-3 flex items-center justify-center gap-1.5">
                                  <input
                                    type={showModalPasswords ? "text" : "password"}
                                    value={passEntry.password}
                                    onChange={(e) => handleUpdateStudentPassword(st.id, e.target.value)}
                                    placeholder="0000"
                                    maxLength={12}
                                    className={`w-20 px-2 py-1 text-center font-mono text-xs font-black rounded-lg border focus:outline-none transition-all ${
                                      isDefaultPass
                                        ? 'bg-amber-50 dark:bg-amber-950/60 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-100'
                                        : 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100'
                                    }`}
                                    title="Mot de passe ou code PIN de cet élève pour se connecter au portail"
                                  />
                                  {!isDefaultPass && (
                                    <button
                                      type="button"
                                      onClick={() => handleResetSinglePassword(st.id)}
                                      className="px-1.5 py-0.5 text-[10px] font-bold bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-600 dark:text-slate-300 rounded border border-slate-300 dark:border-slate-600 shrink-0 cursor-pointer"
                                      title="Réinitialiser ce mot de passe à 0000"
                                    >
                                      ↺
                                    </button>
                                  )}
                                </div>

                                {/* 6. Remove button */}
                                <div className="col-span-1 flex justify-end">
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveStudentInModal(st.id)}
                                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/50 rounded-lg transition-all font-bold cursor-pointer"
                                    title={`Retirer "${st.name}" de la classe`}
                                  >
                                    🗑️
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: CSV / EXCEL IMPORT */}
              {modalActiveTab === 'csv' && (
                <div className="space-y-3">
                  <input
                    type="file"
                    ref={classFileInputRef}
                    onChange={handleModalClassFileChange}
                    accept=".csv,.xlsx,.xls"
                    className="hidden"
                  />
                  <div
                    onClick={() => classFileInputRef.current?.click()}
                    className="p-6 border-2 border-dashed border-indigo-300 dark:border-indigo-700 hover:border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30 rounded-2xl text-center cursor-pointer transition-all space-y-2"
                  >
                    <div className="text-3xl">📥</div>
                    <div className="font-extrabold text-slate-800 dark:text-slate-200 text-sm">
                      Cliquez pour choisir un fichier CSV ou Excel (.xlsx, .xls, .csv)
                    </div>
                    <p className="text-slate-500 dark:text-slate-400 text-[11px]">
                      Compatible avec les exports Pronote, EcoleDirecte ou fichiers Excel personnalisés.
                    </p>
                  </div>
                  {isModalParsing && (
                    <div className="text-center font-bold text-indigo-600 animate-pulse">
                      🔄 Traitement et extraction du fichier en cours...
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: COPIE-COLLE IMPORT */}
              {modalActiveTab === 'paste' && (
                <div className="space-y-3">
                  <textarea
                    value={modalPasteText}
                    onChange={(e) => setModalPasteText(e.target.value)}
                    placeholder="Collez ici la liste des élèves de cette classe...&#10;Exemple :&#10;Dupont Jean&#10;Martin Marie&#10;1. Bernard Lucas"
                    className="w-full h-32 p-3 border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-900/60 font-mono text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleModalParseCopyPaste}
                    disabled={isModalParsing || !modalPasteText.trim()}
                    className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-md transition-all disabled:bg-indigo-300 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isModalParsing ? '⏳ Analyse IA en cours...' : '⚡ Analyser et importer la liste collée dans la classe'}
                  </button>
                </div>
              )}
            </div>

            {/* MODAL FOOTER */}
            <div className="p-4 bg-slate-100 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs">
              <button
                type="button"
                onClick={() => setEditingClass(null)}
                className="w-full sm:w-auto px-4 py-2.5 bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold rounded-xl hover:bg-slate-300 cursor-pointer"
              >
                Fermer
              </button>

              <div className="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={handleSaveModalRosterOnly}
                  className="w-full sm:w-auto px-4 py-2.5 bg-slate-800 dark:bg-slate-700 text-white font-bold rounded-xl hover:bg-slate-900 shadow-sm cursor-pointer"
                >
                  💾 Enregistrer la classe ({modalStudents.length} élèves)
                </button>

                <button
                  type="button"
                  onClick={handleSaveModalAndLaunchPlan}
                  className="w-full sm:w-auto px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-xl shadow-md transition-all cursor-pointer"
                >
                  🚀 Valider & Lancer le Plan de Classe
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Trombinoscope PDF / Image Extraction & Matching Modal */}
      {isTrombiModalOpen && (
        <TrombinoscopeModal
          isOpen={isTrombiModalOpen}
          onClose={() => setIsTrombiModalOpen(false)}
          currentStudents={modalStudents}
          currentClassName={editingClass || ''}
          availableClasses={profile.classes}
          onApplyPhotos={async (updatedStudents) => {
            setModalStudents(updatedStudents);
            const studentsWithPhotos = updatedStudents.filter(s => !!s.photoUrl);
            if (studentsWithPhotos.length > 0) {
              await registerPhotosBatch(studentsWithPhotos.map(s => ({
                name: s.name,
                photoUrl: s.photoUrl!,
                className: editingClass || undefined,
              }))).catch(console.error);
            }
            if (editingClass) {
              const updatedRosters = {
                ...classRosters,
                [editingClass]: updatedStudents,
              };
              setClassRosters(updatedRosters);
              try {
                localStorage.setItem('class_rosters_v2', JSON.stringify(updatedRosters));
              } catch (e) {
                console.warn('Error persisting rosters on photo apply:', e);
              }
              const activeTeacherName = teacherName.trim() || (profile.fullName && profile.fullName !== 'M. / Mme Enseignant' ? profile.fullName : 'M. Abgrall (Mathématiques)');
              syncClassRosterWithCurrentPlans(editingClass, updatedStudents, activeTeacherName, modalStudentPasswords).catch(console.error);
            }
            setModalNotice({
              type: 'success',
              text: `Photos associées avec succès (${updatedStudents.filter(s => !!s.photoUrl).length} élèves avec photo) !`,
            });
          }}
        />
      )}

      {/* Enlarged Student Photo View Modal with Replace and Delete capabilities */}
      {photoModalData && (
        <StudentPhotoModal
          data={photoModalData}
          onClose={() => setPhotoModalData(null)}
          onDeletePhoto={async (name) => {
            const student = modalStudents.find((s) => s.name === name);
            if (student) {
              await handleDeleteStudentPhoto(student.id);
            } else {
              await deleteStudentPhoto(name);
            }
          }}
          onReplacePhoto={async (name, newPhotoUrl) => {
            const student = modalStudents.find((s) => s.name === name);
            if (student) {
              await handleUpdateStudentPhoto(student.id, newPhotoUrl);
            } else {
              await saveStudentPhoto(name, newPhotoUrl, editingClass || undefined);
            }
            setPhotoModalData((prev) => (prev ? { ...prev, photoUrl: newPhotoUrl } : null));
          }}
        />
      )}
    </div>
  );
};

export default StudentInput;
