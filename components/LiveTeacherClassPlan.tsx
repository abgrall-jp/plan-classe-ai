import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { PublishedPlan, StudentPlacement, Student } from '../types';
import {
  moveStudentByTeacher,
  updatePlanPlacementsByTeacher,
  updatePlanObstaclesByTeacher,
  toggleFreezePlan,
  savePublishedPlan,
  STANDARD_PERIODS,
  enrichPlacementsWithPhotos,
  cleanForFirestore,
  getStudentRemarks
} from '../services/planSharingService';
import { getStudentPhoto } from '../services/photoLibraryService';
import { PlanZoomPanContainer } from './PlanZoomPanContainer';
import { TeacherStudentRemarksModal } from './TeacherStudentRemarksModal';
import { ObstacleRenderer } from './ObstacleRenderer';
import { ObstaclePickerModal } from './ObstaclePickerModal';
import { PRESET_OBSTACLES } from '../services/obstacleService';

interface LiveTeacherClassPlanProps {
  selectedClass: string;
  allPublishedPlans: PublishedPlan[];
  classRoster?: Student[];
  currentTeacherName?: string;
  currentTeacherId?: string;
  onPlanUpdated?: (updatedPlan: PublishedPlan) => void;
  onClose?: () => void;
}

export const LiveTeacherClassPlan: React.FC<LiveTeacherClassPlanProps> = ({
  selectedClass,
  allPublishedPlans,
  classRoster = [],
  currentTeacherName = 'Enseignant',
  currentTeacherId = '',
  onPlanUpdated,
  onClose,
}) => {
  // Find all plans published for this class
  const classPlans = useMemo(() => {
    if (!selectedClass) return [];
    const target = selectedClass.trim().toLowerCase();
    return allPublishedPlans.filter(p => {
      if (!p.className) return false;
      const list = p.className.split(',').map(c => c.trim().toLowerCase());
      return list.includes(target) || p.className.trim().toLowerCase() === target;
    });
  }, [allPublishedPlans, selectedClass]);

  // Selected period / plan ID
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');

  // Synchronize selected plan when class or plans change
  useEffect(() => {
    if (classPlans.length > 0) {
      // Pick existing selected plan or the first non-past plan, or just the first plan
      const current = classPlans.find(p => p.id === selectedPlanId);
      if (!current) {
        const activeNonPast = classPlans.find(p => !p.isPastPlan) || classPlans[0];
        setSelectedPlanId(activeNonPast.id);
      }
    } else {
      setSelectedPlanId('');
    }
  }, [classPlans, selectedPlanId]);

  const activePlan = useMemo(() => {
    return classPlans.find(p => p.id === selectedPlanId) || null;
  }, [classPlans, selectedPlanId]);

  // Local optimistic plan state so drag / click movements feel instant
  const [localPlan, setLocalPlan] = useState<PublishedPlan | null>(activePlan);
  useEffect(() => {
    setLocalPlan(activePlan);
  }, [activePlan]);

  // Selection state for click-to-move / swap
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);
  const [hoveredCellIndex, setHoveredCellIndex] = useState<number | null>(null);
  const [draggedStudentId, setDraggedStudentId] = useState<number | null>(null);

  // Multi-cell selection state for unavailable places / obstacles
  const [isObstacleMode, setIsObstacleMode] = useState<boolean>(false);
  const [selectedCellIds, setSelectedCellIds] = useState<number[]>([]);
  const [showObstacleModal, setShowObstacleModal] = useState<boolean>(false);

  // Toggle cell selection for bulk obstacle assignment
  const handleToggleCellSelection = (cellIdx: number) => {
    setSelectedStudentId(null); // Clear student selection
    setSelectedCellIds(prev => {
      if (prev.includes(cellIdx)) {
        return prev.filter(id => id !== cellIdx);
      } else {
        return [...prev, cellIdx];
      }
    });
  };

  // Bulk assign or remove obstacle on selected cells
  const handleApplyObstacleToCells = async (
    targetIds: number[],
    obstacle: { icon: string; label: string; svgKey?: string } | null
  ) => {
    if (!localPlan || targetIds.length === 0) return;

    const currentUnavail = new Set(localPlan.unavailableCells || []);
    const currentObstacles = { ...(localPlan.cellObstacles || {}) };

    if (obstacle === null) {
      // Remove unavailable state and obstacle
      targetIds.forEach(id => {
        currentUnavail.delete(id);
        delete currentObstacles[id];
        delete currentObstacles[String(id)];
      });
    } else {
      // Add unavailable state and assign obstacle
      targetIds.forEach(id => {
        currentUnavail.add(id);
        currentObstacles[id] = obstacle;
      });
    }

    const updatedUnavailList = Array.from(currentUnavail);

    // Call service to update local and Firestore live plan
    try {
      const res = await updatePlanObstaclesByTeacher(localPlan.id, updatedUnavailList, currentObstacles);
      if (res.success && res.plan) {
        setLocalPlan(res.plan);
        if (onPlanUpdated) onPlanUpdated(res.plan);
        if (obstacle === null) {
          showStatus(`🟢 ${targetIds.length} place(s) rendues à nouveau disponibles (chaises libres)`);
        } else {
          showStatus(`✨ Icône "${obstacle.label}" affectée à ${targetIds.length} place(s) — visible en direct par les élèves !`);
        }
      }
    } catch (err) {
      console.error('Error updating obstacles:', err);
      showStatus('Erreur lors de la mise à jour des places indisponibles', 'error');
    }

    setSelectedCellIds([]);
  };

  // Status feedback message
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'info' | 'error' } | null>(null);

  const showStatus = useCallback((text: string, type: 'success' | 'info' | 'error' = 'success') => {
    setStatusMessage({ text, type });
    setTimeout(() => {
      setStatusMessage(null);
    }, 3500);
  }, []);

  // Photo modal zoom
  const [photoModalData, setPhotoModalData] = useState<{
    name: string;
    photoUrl: string;
    seatInfo: string;
  } | null>(null);

  // Student remarks modal
  const [remarksModalStudent, setRemarksModalStudent] = useState<StudentPlacement | null>(null);

  // Extract placements safely
  const placements = useMemo(() => {
    if (!localPlan) return [];
    if (Array.isArray(localPlan.placements)) return localPlan.placements;
    if (localPlan.placements && typeof localPlan.placements === 'object') {
      return Object.values(localPlan.placements);
    }
    return [];
  }, [localPlan]);

  // Placements map: seat index -> StudentPlacement
  const placementMap = useMemo(() => {
    const map = new Map<number, StudentPlacement>();
    placements.forEach(p => {
      if (typeof p.location === 'number') {
        map.set(p.location, p);
      }
    });
    return map;
  }, [placements]);

  // Unplaced students in bank
  const unplacedStudents = useMemo(() => {
    return placements.filter(p => p.location === 'bank' || typeof p.location !== 'number');
  }, [placements]);

  // Handle moving a student to a target seat or bank
  const handleExecuteMove = async (studentId: number, targetLocation: number | 'bank') => {
    if (!localPlan) return;
    const student = placements.find(p => p.id === studentId);
    if (!student) return;

    // Determine swap if target seat is already occupied
    const currentLoc = student.location;
    let targetOccupantName = '';

    const newPlacements = placements.map(p => {
      if (p.id === studentId) {
        return { ...p, location: targetLocation };
      }
      if (typeof targetLocation === 'number' && p.location === targetLocation && p.id !== studentId) {
        targetOccupantName = p.name;
        // Swap or move old occupant to bank
        return { ...p, location: typeof currentLoc === 'number' ? currentLoc : 'bank' };
      }
      return p;
    });

    // Optimistic local update
    const updatedPlan: PublishedPlan = {
      ...localPlan,
      placements: enrichPlacementsWithPhotos(newPlacements),
      updatedAt: new Date().toISOString(),
    };
    setLocalPlan(updatedPlan);
    setSelectedStudentId(null);
    setDraggedStudentId(null);

    // Call service to write to Firestore and broadcast
    try {
      const res = await moveStudentByTeacher(localPlan.id, studentId, targetLocation);
      if (res.success && res.plan) {
        if (onPlanUpdated) onPlanUpdated(res.plan);
        if (targetOccupantName) {
          showStatus(`🔄 ${student.name} et ${targetOccupantName} ont été échangés — visible en direct par les élèves`);
        } else if (targetLocation === 'bank') {
          showStatus(`📥 ${student.name} placé(e) en réserve — synchronisé en direct`);
        } else {
          showStatus(`✅ ${student.name} placé(e) à la table #${targetLocation + 1} — synchronisé en direct`);
        }
      } else {
        showStatus(res.message || 'Erreur lors du déplacement', 'error');
      }
    } catch (err) {
      console.error('Error moving student:', err);
      showStatus('Erreur de synchronisation Firestore', 'error');
    }
  };

  // Click on a seat
  const handleSeatClick = (cellIndex: number) => {
    if (!localPlan) return;
    const isUnavailable = localPlan.unavailableCells?.includes(cellIndex);

    // If in obstacle selection mode or clicking on an unavailable cell or already multi-selecting cells:
    if (isObstacleMode || isUnavailable || selectedCellIds.length > 0) {
      handleToggleCellSelection(cellIndex);
      return;
    }

    const occupant = placementMap.get(cellIndex);

    // If a student is currently selected
    if (selectedStudentId !== null) {
      if (occupant && occupant.id === selectedStudentId) {
        // Deselect
        setSelectedStudentId(null);
        return;
      }
      // Move or swap selected student to this seat
      handleExecuteMove(selectedStudentId, cellIndex);
      return;
    }

    // Otherwise, if this seat has an occupant, select them
    if (occupant) {
      setSelectedStudentId(occupant.id);
    }
  };

  // Click on bank student
  const handleBankStudentClick = (studentId: number) => {
    if (selectedStudentId === studentId) {
      setSelectedStudentId(null);
    } else {
      setSelectedStudentId(studentId);
    }
  };

  // Toggle freeze plan
  const handleToggleFreeze = async () => {
    if (!localPlan) return;
    const newFrozen = !localPlan.isFrozen;
    const res = await toggleFreezePlan(localPlan.id, newFrozen);
    if (res) {
      setLocalPlan(res);
      if (onPlanUpdated) onPlanUpdated(res);
      showStatus(newFrozen ? '🔒 Plan figé pour les élèves' : '🔓 Plan modifiable par les élèves');
    }
  };

  // Quick initial plan creation if none exists for this class
  const handleCreateInitialPlan = async () => {
    const defaultRows = 5;
    const defaultCols = 6;
    const defaultPeriod = 'Trimestre 1';

    // Build initial placements from class roster or placeholder
    const initialStudents = classRoster && classRoster.length > 0
      ? classRoster
      : Array.from({ length: 24 }).map((_, i) => ({
          id: i + 1,
          name: `Élève ${i + 1}`,
          rollNumber: `${i + 1}`,
        }));

    const placementsToSave: StudentPlacement[] = initialStudents.map((st, i) => ({
      id: st.id || i + 1,
      name: st.name,
      rollNumber: st.rollNumber || `${i + 1}`,
      location: i < defaultRows * defaultCols ? i : 'bank',
    }));

    const newPlan: PublishedPlan = {
      id: `plan-${Date.now()}`,
      className: selectedClass,
      teacherName: currentTeacherName,
      teacherId: currentTeacherId,
      period: defaultPeriod,
      academicYear: '2026-2027',
      gridDimensions: { rows: defaultRows, cols: defaultCols },
      unavailableCells: [],
      cellObstacles: {},
      placements: enrichPlacementsWithPhotos(placementsToSave),
      isFrozen: false,
      allowStudentSelfPlacement: true,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    try {
      const saved = await savePublishedPlan(newPlan);
      if (saved) {
        setSelectedPlanId(saved.id);
        setLocalPlan(saved);
        if (onPlanUpdated) onPlanUpdated(saved);
        showStatus(`🚀 Plan en direct créé pour la classe ${selectedClass} (${defaultPeriod}) !`);
      }
    } catch (err) {
      console.error('Error creating plan:', err);
      showStatus('Erreur lors de la création du plan', 'error');
    }
  };

  // Selected student object
  const selectedStudent = useMemo(() => {
    if (selectedStudentId === null) return null;
    return placements.find(p => p.id === selectedStudentId) || null;
  }, [selectedStudentId, placements]);

  return (
    <div className="w-full bg-slate-900 text-white rounded-2xl border-2 border-indigo-500/80 shadow-2xl p-4 sm:p-6 space-y-4 animate-fadeIn">
      {/* Top Header & Context */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-700/80 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="px-3 py-1 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-black text-xs rounded-lg uppercase tracking-wider shadow-sm flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-white animate-ping" />
              <span>⚡ En Direct — Espace Élève</span>
            </span>

            <span className="text-base sm:text-lg font-black text-white bg-indigo-950/80 px-3 py-1 rounded-xl border border-indigo-500/50">
              🏫 Classe : <span className="text-amber-400">{selectedClass}</span>
            </span>

            {activePlan && (
              <span className="text-xs font-extrabold text-indigo-200 bg-slate-800 px-2.5 py-1 rounded-lg border border-slate-700">
                📅 {activePlan.period}
              </span>
            )}
          </div>

          <p className="text-xs text-slate-300">
            Ce plan est celui que visualisent les élèves dans leur <strong>Espace Élève</strong>. Tout déplacement d'élève effectué ici est répercuté <strong>instantanément</strong> sur leurs écrans pendant votre cours.
          </p>
        </div>

        {/* Right Controls: Period Switcher & Close button */}
        <div className="flex items-center gap-2 flex-wrap">
          {classPlans.length > 1 && (
            <div className="flex items-center gap-1.5 bg-slate-800/90 px-2 py-1 rounded-xl border border-slate-700">
              <span className="text-[11px] font-bold text-slate-300">Période :</span>
              <select
                value={selectedPlanId}
                onChange={(e) => setSelectedPlanId(e.target.value)}
                className="text-xs font-black bg-slate-900 text-amber-300 border border-slate-600 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-amber-400 cursor-pointer"
              >
                {classPlans.map(p => (
                  <option key={`live-period-opt-${p.id}`} value={p.id}>
                    {p.period} ({p.placements.length} él.)
                  </option>
                ))}
              </select>
            </div>
          )}

          {activePlan && (
            <button
              type="button"
              onClick={handleToggleFreeze}
              className={`px-3 py-1.5 text-xs font-extrabold rounded-xl border transition-all flex items-center gap-1.5 cursor-pointer ${
                activePlan.isFrozen
                  ? 'bg-rose-950/80 text-rose-300 border-rose-700 hover:bg-rose-900'
                  : 'bg-emerald-950/80 text-emerald-300 border-emerald-700 hover:bg-emerald-900'
              }`}
              title={activePlan.isFrozen ? "Les élèves ne peuvent pas modifier leur place" : "Les élèves peuvent modifier leur place si autorisé"}
            >
              <span>{activePlan.isFrozen ? '🔒 Plan Figé' : '🔓 Plan Ouvert'}</span>
            </button>
          )}

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
              title="Fermer cette fenêtre en direct"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Real-time Status Toast notification */}
      {statusMessage && (
        <div
          className={`p-2.5 rounded-xl text-xs font-bold flex items-center justify-between transition-all animate-slideDown ${
            statusMessage.type === 'error'
              ? 'bg-rose-900/90 border border-rose-500 text-white'
              : 'bg-emerald-900/90 border border-emerald-500 text-emerald-100 shadow-lg'
          }`}
        >
          <div className="flex items-center gap-2">
            <span>{statusMessage.type === 'error' ? '⚠️' : '⚡'}</span>
            <span>{statusMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            className="text-white/70 hover:text-white font-bold ml-3"
          >
            ✕
          </button>
        </div>
      )}

      {/* Selected Student Active Banner */}
      {selectedStudent && (
        <div className="p-3 bg-amber-500/20 border-2 border-amber-400 rounded-xl flex items-center justify-between gap-3 text-xs animate-pulse flex-wrap">
          <div className="flex items-center gap-2.5">
            {(() => {
              const photo = getStudentPhoto(selectedStudent.name, selectedStudent.photoUrl);
              return photo ? (
                <img
                  src={photo}
                  alt={selectedStudent.name}
                  className="w-8 h-10 object-cover rounded border border-amber-300 shrink-0"
                />
              ) : (
                <div className="w-8 h-10 bg-slate-800 rounded border border-amber-300 flex items-center justify-center font-bold text-amber-300">
                  👤
                </div>
              );
            })()}
            <div>
              <div className="font-extrabold text-amber-300 text-sm">
                Élève sélectionné(e) : {selectedStudent.name}
              </div>
              <div className="text-[11px] text-slate-200">
                {typeof selectedStudent.location === 'number'
                  ? `Actuellement à la place #${selectedStudent.location + 1}`
                  : 'Actuellement en réserve / non placé(e)'}
                {' — '}
                <span className="font-bold underline">
                  Cliquez sur une table libre pour le placer, sur un autre élève pour échanger, ou sur la réserve.
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Direct remarks button under photo / student */}
            <button
              type="button"
              onClick={() => setRemarksModalStudent(selectedStudent)}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs rounded-lg shadow-sm flex items-center gap-1.5 cursor-pointer"
              title="Ajouter ou consulter les remarques de séance sur cet élève"
            >
              <span>📝 Remarques & Suivi</span>
              {(() => {
                const count = getStudentRemarks(localPlan, selectedStudent.name, selectedStudent.id).length;
                return count > 0 ? (
                  <span className="px-1.5 py-0.2 bg-indigo-900 text-amber-300 text-[10px] font-black rounded-full border border-indigo-400">
                    {count}
                  </span>
                ) : null;
              })()}
            </button>

            {typeof selectedStudent.location === 'number' && (
              <button
                type="button"
                onClick={() => handleExecuteMove(selectedStudent.id, 'bank')}
                className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white font-extrabold text-xs rounded-lg shadow-sm cursor-pointer"
              >
                📥 Vers Réserve
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelectedStudentId(null)}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-lg border border-slate-600 cursor-pointer"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Content: If No Plan Exists for this class yet */}
      {!activePlan ? (
        <div className="p-8 bg-slate-800/80 rounded-2xl border border-slate-700 text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-indigo-600/30 border border-indigo-500 flex items-center justify-center text-3xl">
            🎓
          </div>
          <div className="space-y-1">
            <h3 className="text-base sm:text-lg font-extrabold text-white">
              Aucun plan de classe publié pour {selectedClass}
            </h3>
            <p className="text-xs text-slate-300 max-w-md mx-auto">
              Pour que les élèves puissent visualiser leur plan dans leur espace élève et que vous puissiez les déplacer en temps réel pendant le cours, initialisez le plan de la classe ci-dessous.
            </p>
          </div>
          <button
            type="button"
            onClick={handleCreateInitialPlan}
            className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-black rounded-xl text-xs shadow-lg transition-all transform hover:scale-105 cursor-pointer inline-flex items-center gap-2"
          >
            <span>🚀 Initialiser & Publier le Plan en Direct (Trimestre 1)</span>
          </button>
        </div>
      ) : (
        /* Main Classroom Live Grid Canvas */
        <div className="space-y-4">
          {/* Quick instructions & Grid stats & Obstacle Mode Bar */}
          <div className="flex flex-wrap items-center justify-between text-xs text-slate-300 gap-2 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
            <div className="flex items-center gap-2">
              <span className="text-amber-400 font-bold">💡 Interaction en direct :</span>
              <span>
                Déplacez les élèves ou cliquez sur des places pour leur affecter un pictogramme SVG (Passage, Ordinateur, Table vide...).
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  setIsObstacleMode(prev => !prev);
                  if (isObstacleMode) setSelectedCellIds([]);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 cursor-pointer ${
                  isObstacleMode
                    ? 'bg-indigo-600 text-white border-indigo-400 ring-2 ring-indigo-400/50 shadow-md'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                }`}
                title="Activer la sélection de places indisponibles pour leur assigner une icône (Passage, Ordinateur, etc.)"
              >
                <span>🛠️</span>
                <span>{isObstacleMode ? 'Mode Sélection Activé' : 'Sélectionner des places'}</span>
              </button>

              <div className="flex items-center gap-2 font-mono font-bold text-[11px] ml-1">
                <span className="text-emerald-400">
                  🪑 {placementMap.size} placé(s)
                </span>
                <span className="text-amber-400">
                  📥 {unplacedStudents.length} en réserve
                </span>
                <span className="text-slate-400">
                  📐 {activePlan.gridDimensions.rows}×{activePlan.gridDimensions.cols}
                </span>
              </div>
            </div>
          </div>

          {/* Bulk Selection Action Bar if cells are selected */}
          {selectedCellIds.length > 0 && (
            <div className="p-3 bg-gradient-to-r from-indigo-950 via-slate-900 to-indigo-950 border-2 border-indigo-400 rounded-2xl shadow-xl space-y-2 animate-fadeIn">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-indigo-500 text-white font-black text-xs rounded-lg">
                    {selectedCellIds.length} place(s) sélectionnée(s)
                  </span>
                  <span className="text-xs text-indigo-200 font-medium">
                    Affecter un dessin SVG / icône simultanément :
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedCellIds([])}
                  className="text-xs text-slate-400 hover:text-white font-bold underline cursor-pointer"
                >
                  Désélectionner tout
                </button>
              </div>

              {/* Quick Preset Buttons */}
              <div className="flex items-center gap-2 flex-wrap">
                {PRESET_OBSTACLES.slice(0, 6).map(preset => (
                  <button
                    key={`bulk-preset-${preset.id}`}
                    type="button"
                    onClick={() => handleApplyObstacleToCells(selectedCellIds, {
                      icon: preset.icon,
                      label: preset.label,
                      svgKey: preset.svgKey
                    })}
                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 hover:border-indigo-400 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
                  >
                    <ObstacleRenderer obstacle={{ icon: preset.icon, label: preset.label, svgKey: preset.svgKey }} size="sm" showLabel={false} />
                    <span>{preset.label}</span>
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => setShowObstacleModal(true)}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl flex items-center gap-1 shadow-sm cursor-pointer"
                >
                  <span>➕ Toutes les icônes...</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleApplyObstacleToCells(selectedCellIds, null)}
                  className="px-3 py-1.5 bg-emerald-950 hover:bg-emerald-900 border border-emerald-600 text-emerald-200 font-bold text-xs rounded-xl flex items-center gap-1 shadow-sm cursor-pointer ml-auto"
                >
                  <span>🟢 Libérer (Rendre disponible)</span>
                </button>
              </div>
            </div>
          )}

          {/* Blackboard / Front of class */}
          <div className="w-full py-2.5 bg-gradient-to-r from-slate-800 via-slate-700 to-slate-800 text-slate-200 text-center text-xs font-black uppercase tracking-widest rounded-xl shadow-md border border-slate-600 flex items-center justify-center gap-2 select-none">
            <span>📺</span>
            <span>Tableau & Bureau du Professeur (Devant de la classe)</span>
          </div>

          {/* Scrollable Seating Grid with Zoom & Right-click Pan */}
          <PlanZoomPanContainer
            theme="dark"
            helperText="🖱️ Clic droit enfoncé pour naviguer dans la salle • Bouton 📐 Ajuster pour tout afficher"
            footerContent={
              /* Student Bank / Reserve Container */
              <div className="p-3 sm:p-4 bg-[#0E1524] rounded-2xl border border-slate-800 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base">👥</span>
                    <h4 className="font-extrabold text-xs sm:text-sm text-slate-200">
                      Élèves en Réserve / Non encore placés ({unplacedStudents.length})
                    </h4>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Cliquez sur un élève en réserve pour le sélectionner, puis cliquez sur une table vide pour l'y asseoir.
                  </p>
                </div>

                {unplacedStudents.length === 0 ? (
                  <div className="p-3 text-center text-xs text-slate-500 italic bg-slate-900/50 rounded-xl border border-slate-800/80">
                    ✨ Tous les élèves de la classe sont actuellement placés sur une table !
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2 max-h-44 overflow-y-auto p-2 bg-slate-950/60 rounded-xl border border-slate-800">
                    {unplacedStudents.map((st) => {
                      const isSelected = selectedStudentId === st.id;
                      const photo = getStudentPhoto(st.name, st.photoUrl);
                      const bankRemCount = getStudentRemarks(localPlan, st.name, st.id).length;

                      return (
                        <div
                          key={`bank-st-${st.id}`}
                          onClick={() => handleBankStudentClick(st.id)}
                          draggable={true}
                          onDragStart={(e) => {
                            setDraggedStudentId(st.id);
                            e.dataTransfer.setData('text/plain', st.id.toString());
                          }}
                          onDragEnd={() => setDraggedStudentId(null)}
                          className={`flex items-center gap-2 p-1.5 rounded-xl border transition-all cursor-pointer select-none group ${
                            isSelected
                              ? 'bg-amber-500 text-slate-950 border-amber-400 font-black shadow-md ring-2 ring-amber-300 scale-105'
                              : 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700 hover:border-amber-400'
                          }`}
                        >
                          {photo ? (
                            <img
                              src={photo}
                              alt={st.name}
                              className="w-7 h-8.5 object-cover rounded border border-slate-600 shrink-0"
                            />
                          ) : (
                            <div className="w-7 h-8.5 bg-slate-900 rounded border border-slate-700 flex items-center justify-center text-xs">
                              👤
                            </div>
                          )}

                          <div className="min-w-0 pr-1">
                            <div className="font-bold text-xs truncate max-w-[120px] sm:max-w-[150px]">
                              {st.name}
                            </div>
                            {st.rollNumber && (
                              <div className={`text-[9px] font-mono ${isSelected ? 'text-slate-900' : 'text-slate-400'}`}>
                                N°{st.rollNumber}
                              </div>
                            )}
                          </div>

                          {bankRemCount > 0 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setRemarksModalStudent(st);
                              }}
                              className="px-1.5 py-0.5 bg-indigo-900 text-amber-300 rounded text-[9px] font-black border border-indigo-500 hover:bg-indigo-800"
                              title="Voir/Ajouter des remarques"
                            >
                              📝 {bankRemCount}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRemarksModalStudent(st);
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 text-[10px] hover:text-amber-300 transition-opacity"
                            title="Ajouter une remarque pour cet élève"
                          >
                            📝
                          </button>

                          <span className="text-[10px] opacity-75">
                            {isSelected ? '🎯' : '🪑'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            }
          >
            <div className="w-full rounded-2xl border border-slate-800 bg-[#0B0F17]/90 p-3 sm:p-4 shadow-inner">
              <div
                style={{
                  minWidth: `${Math.max(activePlan.gridDimensions.cols * 120, 340)}px`,
                  width: '100%',
                }}
                className="space-y-3 mx-0"
              >
              <div
                className="grid gap-2.5 sm:gap-3 rounded-xl bg-[#111827] border border-slate-800/90 p-3 sm:p-4"
                style={{
                  gridTemplateColumns: `repeat(${activePlan.gridDimensions.cols}, minmax(105px, 1fr))`,
                  width: '100%',
                }}
              >
                {Array.from({ length: activePlan.gridDimensions.rows * activePlan.gridDimensions.cols }).map((_, cellIdx) => {
                  const isUnavailable = activePlan.unavailableCells?.includes(cellIdx);
                  const occupant = placementMap.get(cellIdx);
                  const isOccupantSelected = occupant && selectedStudentId === occupant.id;
                  const isCellSelectedForObstacle = selectedCellIds.includes(cellIdx);

                  if (isUnavailable) {
                    const obstacle = activePlan.cellObstacles?.[cellIdx];
                    return (
                      <div
                        key={`cell-${cellIdx}`}
                        onClick={() => handleSeatClick(cellIdx)}
                        className={`h-24 rounded-xl border transition-all flex flex-col items-center justify-center text-[10px] select-none p-1 text-center cursor-pointer relative group ${
                          isCellSelectedForObstacle
                            ? 'bg-indigo-950/80 border-2 border-indigo-400 ring-2 ring-indigo-400/60 shadow-lg scale-102 z-10'
                            : 'bg-slate-900/60 border-slate-800 hover:border-slate-600 hover:bg-slate-800/60'
                        }`}
                      >
                        <ObstacleRenderer
                          obstacle={obstacle}
                          size="md"
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedCellIds([cellIdx]);
                            setShowObstacleModal(true);
                          }}
                          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-1 bg-black/60 hover:bg-black/90 text-white rounded text-[10px] transition-opacity cursor-pointer"
                          title="Changer l'icône de cette place"
                        >
                          ⚙️
                        </button>
                      </div>
                    );
                  }

                  const occupantPhoto = occupant ? getStudentPhoto(occupant.name, occupant.photoUrl) : undefined;
                  const canDropHere = selectedStudentId !== null && (!occupant || occupant.id !== selectedStudentId);

                  return (
                    <div
                      key={`seat-${cellIdx}`}
                      onClick={() => handleSeatClick(cellIdx)}
                      onMouseEnter={() => setHoveredCellIndex(cellIdx)}
                      onMouseLeave={() => setHoveredCellIndex(null)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const draggedIdStr = e.dataTransfer.getData('text/plain');
                        const idNum = parseInt(draggedIdStr, 10);
                        if (!isNaN(idNum)) {
                          handleExecuteMove(idNum, cellIdx);
                        }
                      }}
                      className={`h-24 rounded-xl p-1.5 sm:p-2 flex flex-col justify-between transition-all select-none relative cursor-pointer ${
                        isCellSelectedForObstacle
                          ? 'bg-indigo-950/80 border-2 border-indigo-400 ring-2 ring-indigo-400/60 shadow-lg scale-102 z-10'
                          : isOccupantSelected
                          ? 'bg-amber-500/30 border-2 border-amber-400 ring-2 ring-amber-300 shadow-lg scale-105 z-10'
                          : occupant
                          ? 'bg-[#161F30] border border-indigo-500/40 hover:border-amber-400 hover:shadow-md'
                          : canDropHere
                          ? 'bg-emerald-950/40 border-2 border-dashed border-emerald-400 ring-1 ring-emerald-300 hover:bg-emerald-900/50'
                          : 'bg-[#0E1524]/70 border border-slate-800 hover:border-slate-600 hover:bg-slate-800/40'
                      }`}
                    >
                      {/* Seat Top Bar: Desk Number & Action Hint */}
                      <div className="flex items-center justify-between text-[10px] font-mono font-bold text-slate-400">
                        <div className="flex items-center gap-1">
                          <span>#{cellIdx + 1}</span>
                          {occupant && (() => {
                            const remCount = getStudentRemarks(localPlan, occupant.name, occupant.id).length;
                            return remCount > 0 ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRemarksModalStudent(occupant);
                                }}
                                className="text-[9px] px-1 py-0.1 bg-indigo-950 hover:bg-indigo-900 text-amber-300 font-black rounded border border-indigo-500/80 transition-colors cursor-pointer"
                                title={`${remCount} remarque(s) d'enseignant pour cette période - Cliquer pour ouvrir`}
                              >
                                📝 {remCount}
                              </button>
                            ) : null;
                          })()}
                        </div>

                        {isOccupantSelected ? (
                          <span className="text-[9px] px-1.5 py-0.2 bg-amber-500 text-slate-950 font-black rounded">
                            CHOISI
                          </span>
                        ) : canDropHere ? (
                          <span className="text-[9px] px-1.5 py-0.2 bg-emerald-600 text-white font-extrabold rounded animate-pulse">
                            {occupant ? 'ÉCHANGER' : 'PLACER'}
                          </span>
                        ) : !occupant ? (
                          <span className="text-[9px] text-slate-500">Libre</span>
                        ) : null}
                      </div>

                      {/* Seat Content: Student Details with Photo */}
                      {occupant ? (
                        <div
                          draggable={true}
                          onDragStart={(e) => {
                            setDraggedStudentId(occupant.id);
                            e.dataTransfer.setData('text/plain', occupant.id.toString());
                          }}
                          onDragEnd={() => setDraggedStudentId(null)}
                          className="flex-1 flex items-center justify-center gap-1.5 px-0.5 cursor-grab active:cursor-grabbing"
                        >
                          {/* Student Photo */}
                          {occupantPhoto ? (
                            <div
                              onClick={(e) => {
                                e.stopPropagation();
                                setPhotoModalData({
                                  name: occupant.name,
                                  photoUrl: occupantPhoto,
                                  seatInfo: `Table #${cellIdx + 1}`,
                                });
                              }}
                              className="w-7 h-9 shrink-0 rounded-md overflow-hidden border border-indigo-400/50 bg-slate-800 shadow-2xs hover:scale-115 transition-transform"
                              title="Agrandir la photo"
                            >
                              <img
                                src={occupantPhoto}
                                alt={occupant.name}
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                            </div>
                          ) : (
                            <div className="w-7 h-9 shrink-0 rounded-md border border-slate-700 bg-slate-800 flex items-center justify-center text-[10px] text-slate-400">
                              👤
                            </div>
                          )}

                          {/* Student Name and Actions */}
                          <div className="flex flex-col text-center min-w-0 flex-1">
                            <span
                              className={`text-[11px] font-bold truncate leading-tight ${
                                isOccupantSelected ? 'text-amber-300 font-extrabold' : 'text-slate-100'
                              }`}
                              title={occupant.name}
                            >
                              {occupant.name}
                            </span>
                            {occupant.rollNumber && (
                              <span className="text-[9px] text-slate-400 font-mono">
                                N°{occupant.rollNumber}
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-slate-600 text-xs">
                          <span className="text-sm">🪑</span>
                          <span className="text-[9px]">Table vide</span>
                        </div>
                      )}

                      {/* Quick action buttons on hover if occupied */}
                      {occupant && (
                        <div className="flex items-center justify-end gap-1 opacity-0 hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRemarksModalStudent(occupant);
                            }}
                            className="text-[9px] px-1.5 py-0.2 bg-indigo-700 hover:bg-indigo-600 text-white rounded transition-colors cursor-pointer"
                            title="Ajouter ou modifier des remarques pour cet élève"
                          >
                            📝 Remarque
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleExecuteMove(occupant.id, 'bank');
                            }}
                            className="text-[9px] px-1 py-0.2 bg-slate-800 hover:bg-amber-600 text-slate-300 hover:text-white rounded transition-colors"
                            title="Renvoyer en réserve"
                          >
                            📥 Réserve
                          </button>
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
      )}

      {/* Photo Preview Modal Zoom */}
      {photoModalData && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPhotoModalData(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-900 border-2 border-indigo-500 text-white rounded-3xl p-6 max-w-sm w-full shadow-2xl flex flex-col items-center text-center space-y-4 animate-scaleUp"
          >
            <div className="w-36 h-44 rounded-2xl overflow-hidden border-2 border-indigo-400 shadow-lg bg-slate-800">
              <img
                src={photoModalData.photoUrl}
                alt={photoModalData.name}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-black text-white">{photoModalData.name}</h3>
              <p className="text-xs text-indigo-300 font-bold">{selectedClass} — {photoModalData.seatInfo}</p>
            </div>
            <button
              type="button"
              onClick={() => setPhotoModalData(null)}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black rounded-xl cursor-pointer"
            >
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* Teacher Student Remarks Modal */}
      {remarksModalStudent && localPlan && (
        <TeacherStudentRemarksModal
          student={remarksModalStudent}
          plan={localPlan}
          currentTeacherName={currentTeacherName}
          onClose={() => setRemarksModalStudent(null)}
          onPlanUpdated={(updatedPlan) => {
            setLocalPlan(updatedPlan);
            if (onPlanUpdated) onPlanUpdated(updatedPlan);
          }}
        />
      )}

      {/* Obstacle Picker Modal for Multi-Cell or Single Cell selection */}
      {showObstacleModal && (
        <ObstaclePickerModal
          isOpen={showObstacleModal}
          cellIds={selectedCellIds}
          onSelectObstacle={(cellId, obstacle) => handleApplyObstacleToCells([cellId], obstacle)}
          onSelectObstacleForMultipleCells={handleApplyObstacleToCells}
          onClose={() => setShowObstacleModal(false)}
        />
      )}
    </div>
  );
};
export default LiveTeacherClassPlan;
