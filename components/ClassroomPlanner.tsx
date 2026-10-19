

import React, { useState, useCallback, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { StudentPlacement, StudentLocation, SavedLayout, ActivePlan, Student, Group, StudentCPSProfile } from '../types';
import StudentBank from './StudentBank';
import SeatingGrid from './SeatingGrid';
import { UserIcon } from './icons/UserIcon';
import { SettingsIcon } from './icons/SettingsIcon';
import { LoadIcon } from './icons/LoadIcon';
import { RandomIcon } from './icons/RandomIcon';
import { GroupIcon } from './icons/GroupIcon';
import { ArrowExpandVerticalIcon } from './icons/ArrowExpandVerticalIcon';
import { ArrowExpandHorizontalIcon } from './icons/ArrowExpandHorizontalIcon';
import { HelpIcon } from './icons/HelpIcon';
import { SheetIcon } from './icons/SheetIcon';
import { HomogeneousIcon } from './icons/HomogeneousIcon';
import { HeterogeneousIcon } from './icons/HeterogeneousIcon';
import { HistoryIcon } from './icons/HistoryIcon';
import { UploadIcon } from './icons/UploadIcon';
import { TrashIcon } from './icons/TrashIcon';
import { AffinityIcon } from './icons/AffinityIcon';
import { BrainIcon } from './icons/BrainIcon';
import { parseStudentList } from '../services/geminiService';
import { parseCPSExport, normalizeStudentName } from '../services/cpsService';
import { PlusIcon } from './icons/PlusIcon';
import { CodeIcon } from './icons/CodeIcon';
import { SeatingColorSettings } from './SeatingColorSettings';
import {
  savePublishedPlan,
  getPublishedPlans,
  subscribeToPublishedPlans,
  reconcileLocalPlansToFirestore,
  toggleFreezePlan,
  deletePublishedPlan,
  resetStudentPasswordToDefault,
  reassignPublishedPlanClass,
  duplicatePublishedPlanForClass,
  duplicatePlanToPeriod,
  filterPlansForOwner,
  getActivePlanOwner,
  enrichPlacementsWithPhotos,
  STANDARD_PERIODS,
  PublishedPlan
} from '../services/planSharingService';
import {
  getLocalTeacherAccount,
  getImpersonatedTeacher
} from '../services/teacherAuthService';
import { ObstaclePickerModal } from './ObstaclePickerModal';
import { PRESET_OBSTACLES } from '../services/obstacleService';
import { StudentPhotoModal, PhotoModalData } from './StudentPhotoModal';
import { saveStudentPhoto, deleteStudentPhoto, getStudentPhoto } from '../services/photoLibraryService';


interface ClassroomPlannerProps {
  plan: ActivePlan;
  onReset: () => void;
  step: number;
  setStep: (step: number) => void;
}

const ClassroomPlanner: React.FC<ClassroomPlannerProps> = ({ plan, onReset, step, setStep }) => {
  const [allStudents, setAllStudents] = useState<Student[]>(() => [...(plan.students || [])]);
  const [groups, setGroups] = useState<Group[]>(() => plan.initialGroups || []);
  
  const [gridDimensions, setGridDimensions] = useState(() => 
    plan.initialGridDimensions || { rows: 5, cols: 6 }
  );
  
  const [unavailableCells, setUnavailableCells] = useState<Set<number>>(() => new Set(plan.initialUnavailableCells || []));
  const [cellObstacles, setCellObstacles] = useState<Record<number, { icon: string; label: string }>>(() => {
    return plan.initialCellObstacles || {};
  });
  const [obstaclePickerCellId, setObstaclePickerCellId] = useState<number | null>(null);
  const [activeObstacleTool, setActiveObstacleTool] = useState<string | null>(null);
  const [plannerPhotoModalData, setPlannerPhotoModalData] = useState<PhotoModalData | null>(null);

  const [placements, setPlacements] = useState<Map<number, StudentPlacement>>(() => {
    if (plan.initialPlacements) {
      return new Map(plan.initialPlacements);
    }
    return new Map((plan.students || []).map(student => [student.id, { ...student, location: 'bank' }]));
  });

  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<number>>(new Set());
  const [saveConfirmation, setSaveConfirmation] = useState(false);
  const [autoPlacementOptions, setAutoPlacementOptions] = useState({
      sort: 'none' as 'none' | 'roll' | 'random',
      groupSize: 2,
      isGroupingEnabled: false,
      groupLayout: 'line' as 'line' | 'block',
      spaceVertical: 1,
      spaceHorizontal: 1,
  });
  const [isHelpVisible, setIsHelpVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New list state
  const [studentListText, setStudentListText] = useState('');
  const [isUpdatingList, setIsUpdatingList] = useState(false);

  // Grade state
  const gradeInputRef = useRef<HTMLInputElement>(null);
  const [isProcessingGrades, setIsProcessingGrades] = useState(false);
  
  // History state
  const historyInputRef = useRef<HTMLInputElement>(null);
  const [historicalGroups, setHistoricalGroups] = useState<Map<string, number>>(new Map());
  const [maxGroupRepeats, setMaxGroupRepeats] = useState<number>(1);
  const [loadedHistoryFiles, setLoadedHistoryFiles] = useState<string[]>([]);

  // Affinity state
  const affinityInputRef = useRef<HTMLInputElement>(null);
  const [affinityMatrix, setAffinityMatrix] = useState<Map<string, number> | null>(null);
  const [useAffinities, setUseAffinities] = useState(false);
  const [isProcessingAffinities, setIsProcessingAffinities] = useState(false);
  const [loadedAffinityFile, setLoadedAffinityFile] = useState<string | null>(null);

  // AI CPS state (https://ai-cps.ai.studio/)
  const cpsInputRef = useRef<HTMLInputElement>(null);
  const [cpsProfiles, setCpsProfiles] = useState<Map<string, StudentCPSProfile>>(new Map());
  const [loadedCPSFile, setLoadedCPSFile] = useState<string | null>(null);
  const [isProcessingCPS, setIsProcessingCPS] = useState(false);
  const [useCPSOptimization, setUseCPSOptimization] = useState(true);
  const [cpsStrategy, setCpsStrategy] = useState<'tutoring' | 'balance' | 'affinity'>('tutoring');

  // Class & Multi-class Attribution state
  const [targetClasses, setTargetClasses] = useState<string[]>(() => {
    if (plan.selectedClasses && plan.selectedClasses.length > 0) {
      return plan.selectedClasses;
    }
    return ['3ème A'];
  });
  const [className, setClassName] = useState(() => {
    if (plan.selectedClasses && plan.selectedClasses.length > 0) {
      return plan.selectedClasses.join(', ');
    }
    return '3ème A';
  });

  const teacherAccount = getImpersonatedTeacher() || getLocalTeacherAccount();
  const teacherClasses = teacherAccount?.classes && teacherAccount.classes.length > 0
    ? teacherAccount.classes
    : ['3ème A', '3ème B', '4ème A', '4ème B', '5ème A', '5ème B', '6ème A', '6ème B', 'Option SNT'];

  const [newTargetClassInput, setNewTargetClassInput] = useState('');
  const [classAssignmentMsg, setClassAssignmentMsg] = useState<string | null>(null);
  const [selectedPlanToReassignClass, setSelectedPlanToReassignClass] = useState<string | null>(null);
  const [reassignClassInputValue, setReassignClassInputValue] = useState<string>('');

  // Assign class to active plan
  const handleAssignClass = (cName: string) => {
    const cls = cName.trim();
    if (!cls) return;
    if (targetClasses.includes(cls)) return;
    const next = [...targetClasses, cls];
    setTargetClasses(next);
    setClassName(next.join(', '));
    setClassAssignmentMsg(`Plan affecté à la classe "${cls}"`);
    setTimeout(() => setClassAssignmentMsg(null), 3500);
  };

  // Unassign class from active plan (désaffecter de la classe d'origine)
  const handleUnassignClass = (clsToRemove: string) => {
    const next = targetClasses.filter(c => c !== clsToRemove);
    setTargetClasses(next);
    setClassName(next.length > 0 ? next.join(', ') : 'Sans classe');
    setClassAssignmentMsg(`Plan désaffecté de la classe "${clsToRemove}"`);
    setTimeout(() => setClassAssignmentMsg(null), 3500);
  };

  // Database Published Plans Reassignment Handlers
  const handleReassignDbPlanClass = async (planId: string, newClass: string) => {
    if (!newClass.trim()) return;
    await reassignPublishedPlanClass(planId, newClass.trim());
    setSelectedPlanToReassignClass(null);
    setReassignClassInputValue('');
    const fresh = await getPublishedPlans();
    setAllPublishedPlans(fresh);
  };

  const handleDuplicateDbPlanForClass = async (planId: string, newClass: string) => {
    if (!newClass.trim()) return;
    await duplicatePublishedPlanForClass(planId, newClass.trim());
    setSelectedPlanToReassignClass(null);
    setReassignClassInputValue('');
    const fresh = await getPublishedPlans();
    setAllPublishedPlans(fresh);
  };

  // Room Layout without students state
  const roomLayoutInputRef = useRef<HTMLInputElement>(null);
  const [selectedDbPlanIdForLayout, setSelectedDbPlanIdForLayout] = useState<string>('');
  const [roomLayoutMsg, setRoomLayoutMsg] = useState<string | null>(null);
  const [jsonPasteInput, setJsonPasteInput] = useState<string>('');
  const [showPasteJsonArea, setShowPasteJsonArea] = useState<boolean>(false);

  const [customRoomModels, setCustomRoomModels] = useState<Array<{
    id: string;
    name: string;
    desc: string;
    gridDimensions: { rows: number; cols: number };
    unavailableCells: number[];
  }>>(() => {
    try {
      const saved = localStorage.getItem('custom_room_models');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const saveCustomRoomModel = (model: {
    name: string;
    desc: string;
    gridDimensions: { rows: number; cols: number };
    unavailableCells: number[];
  }) => {
    const newModel = {
      ...model,
      id: `custom-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    };
    setCustomRoomModels(prev => {
      const updated = [newModel, ...prev];
      try {
        localStorage.setItem('custom_room_models', JSON.stringify(updated));
      } catch (err) {
        console.error("Erreur sauvegarde modèle:", err);
      }
      return updated;
    });
    return newModel;
  };

  const deleteCustomRoomModel = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCustomRoomModels(prev => {
      const updated = prev.filter(m => m.id !== id);
      try {
        localStorage.setItem('custom_room_models', JSON.stringify(updated));
      } catch (err) {
        console.error("Erreur suppression modèle:", err);
      }
      return updated;
    });
  };

  // Publishing & Cloud Sync state
  const [teacherName, setTeacherName] = useState(plan.teacherName || '');
  const [periodName, setPeriodName] = useState(plan.periodName || 'Trimestre 1 - 2026');
  const [selectedPublishPeriods, setSelectedPublishPeriods] = useState<string[]>(['Trimestre 1 - 2026']);
  const [allowSelfPlacement, setAllowSelfPlacement] = useState(true);
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [publishSuccessMsg, setPublishSuccessMsg] = useState<string | null>(null);
  const [allPublishedPlans, setAllPublishedPlans] = useState<PublishedPlan[]>([]);
  const publishedPlansList = useMemo(() => filterPlansForOwner(allPublishedPlans, getActivePlanOwner()), [allPublishedPlans]);
  const [isPublishing, setIsPublishing] = useState(false);
  const [selectedPlanToManagePasswords, setSelectedPlanToManagePasswords] = useState<string | null>(null);
  const [selectedPlanToDuplicatePeriod, setSelectedPlanToDuplicatePeriod] = useState<string | null>(null);
  const [duplicateTargetPeriodInput, setDuplicateTargetPeriodInput] = useState<string>('Trimestre 2');

  // Collapsible settings & DB plan load modal state
  const [isAdvancedSettingsOpen, setIsAdvancedSettingsOpen] = useState(false);
  const [showLoadDbPlanModal, setShowLoadDbPlanModal] = useState(false);

  // Synchronize internal state when active plan prop is updated
  React.useEffect(() => {
    if (plan) {
      if (plan.students && plan.students.length > 0) setAllStudents([...plan.students]);
      if (plan.initialGridDimensions) setGridDimensions(plan.initialGridDimensions);
      
      const unavailSet = new Set(plan.initialUnavailableCells || []);
      setUnavailableCells(unavailSet);

      if (plan.initialPlacements) {
        // Ensure no student is initialized on an unavailable cell
        const sanitized = new Map<number, StudentPlacement>();
        plan.initialPlacements.forEach(([id, p]) => {
          const photo = p.photoUrl || getStudentPhoto(p.name, p.photoUrl);
          if (typeof p.location === 'number' && unavailSet.has(p.location)) {
            sanitized.set(id, { ...p, photoUrl: photo, location: 'bank' });
          } else {
            sanitized.set(id, { ...p, photoUrl: photo });
          }
        });
        setPlacements(sanitized);
      } else if (plan.students) {
        setPlacements(new Map(plan.students.map(s => [
          s.id,
          {
            ...s,
            photoUrl: s.photoUrl || getStudentPhoto(s.name, s.photoUrl),
            location: 'bank'
          }
        ])));
      }
      if (plan.initialGroups) setGroups(plan.initialGroups);
      if (plan.selectedClasses && plan.selectedClasses.length > 0) {
        setTargetClasses(plan.selectedClasses);
        setClassName(plan.selectedClasses.join(', '));
      }
      if (plan.teacherName) setTeacherName(plan.teacherName);
      if (plan.periodName) setPeriodName(plan.periodName);
    }
  }, [plan]);

  // Subscribe to real-time published plans in Firestore
  React.useEffect(() => {
    const unsubscribe = subscribeToPublishedPlans((plans) => {
      setAllPublishedPlans(plans);
    });

    // Safely reconcile local plans once in the background after planner mounts
    const timer = setTimeout(() => {
      reconcileLocalPlansToFirestore().catch(console.error);
    }, 2500);

    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  const PRESET_ROOM_LAYOUTS = [
    {
      id: 'ilots-4',
      name: '👥 Îlots de 4 tables',
      desc: '4 groupes de 4 tables séparés par des allées (6x6)',
      gridDimensions: { rows: 6, cols: 6 },
      getUnavailable: () => {
        const set = new Set<number>();
        for (let r = 0; r < 6; r++) {
          for (let c = 0; c < 6; c++) {
            if (r === 2 || c === 2) set.add(r * 6 + c);
          }
        }
        return Array.from(set);
      }
    },
    {
      id: 'u-shape',
      name: '⭕ Disposition en U',
      desc: 'Tables en U avec espace central libre (5x7)',
      gridDimensions: { rows: 5, cols: 7 },
      getUnavailable: () => {
        const set = new Set<number>();
        for (let r = 1; r < 5; r++) {
          for (let c = 1; c < 6; c++) {
            set.add(r * 7 + c);
          }
        }
        return Array.from(set);
      }
    },
    {
      id: 'trad-allee',
      name: '🏛️ Rangées avec Allée Centrale',
      desc: 'Rangées de tables séparées par une allée centrale (5x7)',
      gridDimensions: { rows: 5, cols: 7 },
      getUnavailable: () => {
        const set = new Set<number>();
        for (let r = 0; r < 5; r++) set.add(r * 7 + 3);
        return Array.from(set);
      }
    },
    {
      id: 'double-u',
      name: '🚌 Double U / Autobus',
      desc: 'Deux U imbriqués pour grand groupe (6x8)',
      gridDimensions: { rows: 6, cols: 8 },
      getUnavailable: () => {
        const set = new Set<number>();
        for (let r = 1; r < 5; r++) {
          for (let c = 1; c < 7; c++) {
            if (!(r === 2 && c >= 2 && c <= 5) && !(r >= 2 && r <= 4 && (c === 2 || c === 5))) {
              set.add(r * 8 + c);
            }
          }
        }
        return Array.from(set);
      }
    },
    {
      id: 'special-15x8',
      name: '🏫 Salle de Classe 15×8 (32 places)',
      desc: 'Disposition 15×8 avec 32 tables disposées (Salles informatiques / Examens)',
      gridDimensions: { rows: 15, cols: 8 },
      getUnavailable: () => [
        8, 9, 16, 17, 3, 11, 19, 4, 12, 20, 14, 15, 22, 23, 39, 38, 37, 34, 33, 32, 27, 28, 43, 44, 52, 51, 59, 60, 48, 49, 56, 57, 72, 73, 74, 75, 66, 42, 26, 2, 5, 29, 46, 45, 47, 53, 54, 55, 63, 62, 61, 82, 89, 88, 96, 97, 106, 83, 91, 99, 107, 115, 114, 113, 112, 116, 117, 118, 119, 108, 109, 102, 103, 95, 94, 92, 100, 84, 85, 76, 77, 78, 79, 71, 70, 69, 68, 67
      ]
    },
    {
      id: 'ilots-6',
      name: '🧩 Îlots de 6 tables',
      desc: '2 grands îlots de 6 tables (6x6)',
      gridDimensions: { rows: 6, cols: 6 },
      getUnavailable: () => {
        const set = new Set<number>();
        for (let r = 0; r < 6; r++) {
          set.add(r * 6 + 2);
          set.add(r * 6 + 3);
        }
        return Array.from(set);
      }
    },
  ];

  const applyRoomLayout = (
    newGridDimensions: { rows: number; cols: number },
    newUnavailableCells: number[] | Set<number>,
    msg?: string
  ) => {
    const unavailSet = new Set(newUnavailableCells);
    const newGridSize = newGridDimensions.rows * newGridDimensions.cols;

    setGridDimensions(newGridDimensions);
    setUnavailableCells(unavailSet);

    // Evict any students on newly unavailable or out-of-range cells back to bank
    setPlacements(prev => {
      const next = new Map(prev);
      next.forEach(p => {
        if (typeof p.location === 'number') {
          if (p.location >= newGridSize || unavailSet.has(p.location)) {
            p.location = 'bank';
          }
        }
      });
      return next;
    });

    const finalMsg = msg || `✅ Disposition de salle appliquée (${newGridDimensions.rows}×${newGridDimensions.cols}) !`;
    setRoomLayoutMsg(finalMsg);
    setTimeout(() => setRoomLayoutMsg(null), 4000);
  };

  const processRoomLayoutJsonData = (data: any, sourceName: string) => {
    if (data && data.gridDimensions && Array.isArray(data.unavailableCells)) {
      const totalCells = data.gridDimensions.rows * data.gridDimensions.cols;
      const availableSeats = totalCells - data.unavailableCells.length;
      const rawName = data.title && data.title !== 'Modèle de disposition des tables et chaises (sans élèves)'
        ? data.title
        : sourceName;
      const modelName = rawName.startsWith('Salle') || rawName.startsWith('📁') ? rawName : `Salle ${rawName}`;

      // Save into custom models list so it appears in "Modèles de salles prêts à l'emploi"
      const saved = saveCustomRoomModel({
        name: `📁 ${modelName}`,
        desc: `${availableSeats} places sur grille ${data.gridDimensions.rows}×${data.gridDimensions.cols}`,
        gridDimensions: data.gridDimensions,
        unavailableCells: data.unavailableCells,
      });

      applyRoomLayout(
        data.gridDimensions,
        data.unavailableCells,
        `✅ Modèle "${saved.name}" appliqué ET ajouté à vos modèles de salles prêts à l'emploi !`
      );
      return true;
    } else {
      alert("Format JSON invalide : les propriétés 'gridDimensions' ou 'unavailableCells' sont manquantes.");
      return false;
    }
  };

  const handleRoomLayoutFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        processRoomLayoutJsonData(data, file.name.replace('.json', ''));
      } catch {
        alert("Erreur lors de la lecture du fichier JSON de disposition.");
      }
    };
    reader.readAsText(file);
    if (e.target) e.target.value = '';
  };

  const handlePasteJsonSubmit = () => {
    if (!jsonPasteInput.trim()) return;
    try {
      const data = JSON.parse(jsonPasteInput.trim());
      const success = processRoomLayoutJsonData(data, 'Personnalisée (Coller)');
      if (success) {
        setJsonPasteInput('');
        setShowPasteJsonArea(false);
      }
    } catch {
      alert("Code JSON invalide. Veuillez vérifier la syntaxe de votre extrait JSON.");
    }
  };

  const handleApplyLayoutFromDbPlan = () => {
    if (!selectedDbPlanIdForLayout) return;
    const targetPlan = publishedPlansList.find(p => p.id === selectedDbPlanIdForLayout);
    if (targetPlan) {
      applyRoomLayout(
        targetPlan.gridDimensions,
        targetPlan.unavailableCells || [],
        `✅ Disposition des tables extraite avec succès du plan "${targetPlan.className} - ${targetPlan.period}" !`
      );
    }
  };

  const handleExportRoomLayout = () => {
    const roomModel = {
      title: 'Modèle de disposition des tables et chaises (sans élèves)',
      createdAt: new Date().toISOString(),
      gridDimensions,
      unavailableCells: Array.from(unavailableCells),
    };
    const dataStr = JSON.stringify(roomModel, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `modele-salle-${gridDimensions.rows}x${gridDimensions.cols}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleOpenPublishModal = async () => {
    setIsPublishModalOpen(true);
    setPublishSuccessMsg(null);
    try {
      const existing = await getPublishedPlans();
      setPublishedPlansList(existing);
    } catch (e) {
      console.error(e);
    }
  };

  const handleExecutePublish = async () => {
    setIsPublishing(true);
    setPublishSuccessMsg(null);

    const activePlacementsArray: StudentPlacement[] = enrichPlacementsWithPhotos(
      Array.from(placements.values()).map(p => ({
        ...p,
        photoUrl: p.photoUrl || getStudentPhoto(p.name, p.photoUrl),
      }))
    );
    const classesList = targetClasses.length > 0
      ? targetClasses
      : className.split(',').map(s => s.trim()).filter(Boolean);

    const targetPeriods = selectedPublishPeriods.length > 0
      ? selectedPublishPeriods
      : [periodName.trim() || 'Trimestre 1'];

    let count = 0;
    for (const cName of classesList) {
      for (const pName of targetPeriods) {
        await savePublishedPlan({
          teacherName: teacherName.trim() || 'Enseignant',
          className: cName,
          period: pName,
          allowStudentSelfPlacement: allowSelfPlacement,
          isFrozen: false,
          gridDimensions,
          unavailableCells: Array.from(unavailableCells),
          cellObstacles: cellObstacles,
          placements: activePlacementsArray,
        });
        count++;
      }
    }

    setIsPublishing(false);
    setPublishSuccessMsg(`✅ Plan publié avec succès (${count} publication(s)) pour ${classesList.join(', ')} sur la/les période(s) : ${targetPeriods.join(', ')} !`);
    
    const fresh = await getPublishedPlans();
    setPublishedPlansList(fresh);
  };

  const handleDuplicateToPeriod = async (planToDup: PublishedPlan, targetPeriod: string) => {
    if (!targetPeriod.trim()) return;
    try {
      await duplicatePlanToPeriod(planToDup, targetPeriod.trim());
      setPublishSuccessMsg(`✅ Plan de ${planToDup.className} dupliqué avec succès vers la période "${targetPeriod.trim()}" !`);
      setSelectedPlanToDuplicatePeriod(null);
      const fresh = await getPublishedPlans();
      setPublishedPlansList(fresh);
    } catch (e) {
      console.error(e);
      alert("Erreur lors de la duplication du plan.");
    }
  };

  const handleToggleFreeze = async (planId: string, currentFreezeState: boolean) => {
    await toggleFreezePlan(planId, !currentFreezeState);
    const fresh = await getPublishedPlans();
    setPublishedPlansList(fresh);
  };

  const handleDeletePlan = async (planId: string) => {
    await deletePublishedPlan(planId);
    const fresh = await getPublishedPlans();
    setPublishedPlansList(fresh);
  };

  const handleResetPassword = async (planId: string, studentId: number, studentName: string) => {
    await resetStudentPasswordToDefault(planId, studentId);
    const fresh = await getPublishedPlans();
    setPublishedPlansList(fresh);
    alert(`Le mot de passe de ${studentName} a été réinitialisé à 0000.`);
  };


  const clearSelection = useCallback(() => {
    setSelectedStudentIds(new Set());
  }, []);

  const handleStudentClick = useCallback((studentId: number, event: React.MouseEvent) => {
    event.stopPropagation();
    const isCtrlPressed = event.ctrlKey || event.metaKey;

    setSelectedStudentIds(currentSelection => {
      const newSelection = new Set(currentSelection);
      if (!isCtrlPressed) {
        newSelection.clear();
        newSelection.add(studentId);
      } else {
        if (newSelection.has(studentId)) {
          newSelection.delete(studentId);
        } else {
          newSelection.add(studentId);
        }
      }
      return newSelection;
    });
  }, []);

  const moveStudentOrGroup = useCallback((draggedStudentId: number, newLocation: StudentLocation) => {
    const isGroupMove = selectedStudentIds.has(draggedStudentId) && selectedStudentIds.size > 1;
    const { rows, cols } = gridDimensions;
    const gridSize = rows * cols;

    setPlacements(prevPlacements => {
        const newPlacements = new Map(prevPlacements);
        
        if (newLocation === 'bank') {
            const studentsToMoveToBank = isGroupMove ? Array.from(selectedStudentIds) : [draggedStudentId];
            studentsToMoveToBank.forEach(id => {
                 const student = newPlacements.get(id);
                 if (student) {
                    student.location = 'bank';
                    newPlacements.set(id, student);
                 }
            });
            return newPlacements;
        }

        if (!isGroupMove || typeof newLocation !== 'number') {
            const studentToMove = newPlacements.get(draggedStudentId);
            if (!studentToMove) return prevPlacements;

            const originalLocation = studentToMove.location;
            const studentAtTarget = Array.from(newPlacements.values()).find(p => p.location === newLocation);

            studentToMove.location = newLocation;
            if (studentAtTarget) {
                studentAtTarget.location = originalLocation;
                newPlacements.set(studentAtTarget.id, studentAtTarget);
            }
            return newPlacements;
        }
        
        const anchorStudent = prevPlacements.get(draggedStudentId);
        if (!anchorStudent || typeof anchorStudent.location !== 'number') return prevPlacements;

        const anchorOriginCell = anchorStudent.location;
        const anchorTargetCell = newLocation;

        const deltaRow = Math.floor(anchorTargetCell / cols) - Math.floor(anchorOriginCell / cols);
        const deltaCol = (anchorTargetCell % cols) - (anchorOriginCell % cols);

        const movedStudentsInfo: { id: number; oldCell: number; newCell: number }[] = [];
        for (const studentId of selectedStudentIds) {
            const student = prevPlacements.get(studentId);
            if (student && typeof student.location === 'number') {
                const oldCell = student.location;
                const oldRow = Math.floor(oldCell / cols);
                const oldCol = oldCell % cols;
                const newRow = oldRow + deltaRow;
                const newCol = oldCol + deltaCol;

                if (newRow < 0 || newRow >= rows || newCol < 0 || newCol >= cols) {
                    return prevPlacements;
                }
                const newCell = newRow * cols + newCol;
                if (unavailableCells.has(newCell)) return prevPlacements; // Don't move into an unavailable cell

                movedStudentsInfo.push({ id: studentId, oldCell, newCell });
            }
        }

        const targetCells = new Set(movedStudentsInfo.map(info => info.newCell));
        const vacatedCells = new Set(movedStudentsInfo.map(info => info.oldCell));
        const displacedStudents: { id: number; oldCell: number }[] = [];

        prevPlacements.forEach((p, id) => {
            if (targetCells.has(p.location as number) && !selectedStudentIds.has(id)) {
                displacedStudents.push({ id, oldCell: p.location as number });
            }
        });
        
        const tempPlacements = new Map(newPlacements);
        movedStudentsInfo.forEach(({ id, newCell }) => tempPlacements.get(id)!.location = newCell);
        
        const availableVacatedCells = Array.from(vacatedCells).filter(cell => !targetCells.has(cell));
        displacedStudents.forEach((displaced, index) => {
            if (index < availableVacatedCells.length) {
                tempPlacements.get(displaced.id)!.location = availableVacatedCells[index];
            } else {
                tempPlacements.get(displaced.id)!.location = 'bank';
            }
        });
        
        return tempPlacements;
    });

    clearSelection();
  }, [selectedStudentIds, gridDimensions, clearSelection, unavailableCells]);
  
    const handleDeleteStudent = useCallback((studentIdToDelete: number) => {
        setAllStudents(currentStudents => currentStudents.filter(s => s.id !== studentIdToDelete));
        setPlacements(currentPlacements => {
            const newPlacements = new Map(currentPlacements);
            newPlacements.delete(studentIdToDelete);
            return newPlacements;
        });
        setSelectedStudentIds(currentSelection => {
            const newSelection = new Set(currentSelection);
            newSelection.delete(studentIdToDelete);
            return newSelection;
        });
    }, []);

    const handleAddStudent = useCallback((name: string) => {
        if (!name.trim()) return;

        const newId = allStudents.length > 0 ? Math.max(...allStudents.map(s => s.id)) + 1 : 0;
        
        const newStudent: Student = {
            id: newId,
            name: name.trim(),
        };

        setAllStudents(current => [...current, newStudent]);

        setPlacements(currentPlacements => {
            const newPlacements = new Map(currentPlacements);
            const newStudentPlacement: StudentPlacement = {
                ...newStudent,
                location: 'bank',
            };
            newPlacements.set(newId, newStudentPlacement);
            return newPlacements;
        });
    }, [allStudents]);


    const handleDimensionChange = (dimension: 'rows' | 'cols', value: number) => {
        const newDimensions = { ...gridDimensions, [dimension]: value };
        const newGridSize = newDimensions.rows * newDimensions.cols;

        if (newGridSize < allStudents.length) return;

        setPlacements(currentPlacements => {
            const newPlacements = new Map(currentPlacements);
            newPlacements.forEach(p => {
                if (typeof p.location === 'number' && p.location >= newGridSize) {
                    p.location = 'bank';
                }
            });
            return newPlacements;
        });

        setUnavailableCells(current => {
            const newSet = new Set(current);
            current.forEach(cellId => {
                if (cellId >= newGridSize) {
                    newSet.delete(cellId);
                }
            });
            return newSet;
        });
        
        setGridDimensions(newDimensions);
    };

    const handleToggleCellAvailability = (cellId: number) => {
        // If an active obstacle tool is chosen (like computer, passage, desk...):
        if (activeObstacleTool) {
            if (activeObstacleTool === 'none') {
                // Standard blocked seat
                setUnavailableCells(current => {
                    const newSet = new Set(current);
                    newSet.add(cellId);
                    return newSet;
                });
                setCellObstacles(prev => {
                    const next = { ...prev };
                    delete next[cellId];
                    return next;
                });
            } else {
                const preset = PRESET_OBSTACLES.find(o => o.id === activeObstacleTool);
                if (preset) {
                    setUnavailableCells(current => {
                        const newSet = new Set(current);
                        newSet.add(cellId);
                        return newSet;
                    });
                    setCellObstacles(prev => ({
                        ...prev,
                        [cellId]: { icon: preset.icon, label: preset.label }
                    }));
                }
            }

            // Evict student if sitting on this newly blocked cell
            setPlacements(prev => {
                const next = new Map(prev);
                for (const [id, placement] of next.entries()) {
                    if (placement.location === cellId) {
                        next.set(id, { ...placement, location: 'bank' });
                    }
                }
                return next;
            });
            return;
        }

        // Standard toggle availability
        setUnavailableCells(current => {
            const newSet = new Set(current);
            if (newSet.has(cellId)) {
                newSet.delete(cellId);
                setCellObstacles(prev => {
                    const next = { ...prev };
                    delete next[cellId];
                    return next;
                });
            } else {
                newSet.add(cellId);
                // Evict student if any
                setPlacements(prev => {
                    const next = new Map(prev);
                    for (const [id, placement] of next.entries()) {
                        if (placement.location === cellId) {
                            next.set(id, { ...placement, location: 'bank' });
                        }
                    }
                    return next;
                });
            }
            return newSet;
        });
    };

    const handleConfigureObstacle = (cellId: number) => {
        setObstaclePickerCellId(cellId);
    };

    const handleSelectObstaclesForCells = (cellIds: number[], obstacle: { icon: string; label: string; svgKey?: string } | null) => {
        if (obstacle === null) {
            setUnavailableCells(prev => {
                const next = new Set(prev);
                cellIds.forEach(id => next.delete(id));
                return next;
            });
            setCellObstacles(prev => {
                const next = { ...prev };
                cellIds.forEach(id => delete next[id]);
                return next;
            });
        } else {
            setUnavailableCells(prev => {
                const next = new Set(prev);
                cellIds.forEach(id => next.add(id));
                return next;
            });
            setCellObstacles(prev => {
                const next = { ...prev };
                cellIds.forEach(id => {
                    next[id] = obstacle;
                });
                return next;
            });
            // Evict students from blocked cells to bank
            const cellSet = new Set(cellIds);
            setPlacements(prev => {
                const next = new Map(prev);
                for (const [id, placement] of next.entries()) {
                    if (typeof placement.location === 'number' && cellSet.has(placement.location)) {
                        next.set(id, { ...placement, location: 'bank' });
                    }
                }
                return next;
            });
        }
    };

    const handleSelectObstacleFromModal = (cellId: number, obstacle: { icon: string; label: string; svgKey?: string } | null) => {
        handleSelectObstaclesForCells([cellId], obstacle);
    };
  
  const handleSave = async () => {
      const layoutToSave: SavedLayout = {
          students: allStudents,
          placements: Array.from(placements.entries()),
          gridDimensions: gridDimensions,
          unavailableCells: Array.from(unavailableCells),
          cellObstacles: cellObstacles,
          groups: groups,
      };
      const dataStr = JSON.stringify(layoutToSave, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'plan-de-classe.json';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      // Auto-save to Cloud Firestore so the plan is immediately published & visible to students
      try {
        const activePlacementsArray: StudentPlacement[] = Array.from(placements.values());
        const classesList = targetClasses.length > 0
          ? targetClasses
          : className.split(',').map(s => s.trim()).filter(Boolean);

        for (const cName of classesList) {
          await savePublishedPlan({
            teacherName: teacherName || 'M. / Mme Enseignant',
            className: cName || 'Classe sans nom',
            period: periodName || 'Période 1',
            allowStudentSelfPlacement: allowSelfPlacement,
            isFrozen: false,
            gridDimensions,
            unavailableCells: Array.from(unavailableCells),
            cellObstacles: cellObstacles,
            placements: activePlacementsArray,
          });
        }
        const fresh = await getPublishedPlans();
        setPublishedPlansList(fresh);
      } catch (e) {
        console.error("Cloud auto-save error:", e);
      }

      setSaveConfirmation(true);
      setTimeout(() => setSaveConfirmation(false), 3000);
  };

  const handleUpdateStudentList = useCallback(async () => {
    if (!studentListText.trim()) return;

    setIsUpdatingList(true);
    setError(null);

    try {
        const parsedData = await parseStudentList(studentListText);
        const newStudents: Student[] = parsedData.map((s, index) => ({
            id: index,
            name: s.name,
            rollNumber: s.rollNumber,
        }));

        setAllStudents(newStudents);

        const newPlacements = new Map<number, StudentPlacement>();
        newStudents.forEach(student => {
            newPlacements.set(student.id, { ...student, location: 'bank' });
        });
        setPlacements(newPlacements);

        setSelectedStudentIds(new Set());
        setStudentListText('');
        
        // Clear related data as it's tied to the old student list
        setHistoricalGroups(new Map());
        setLoadedHistoryFiles([]);
        setAffinityMatrix(null);
        setLoadedAffinityFile(null);
        setUseAffinities(false);

    } catch (err) {
        if (err instanceof Error) {
            setError(`Erreur lors de l'analyse de la nouvelle liste : ${err.message}`);
        } else {
            setError("Une erreur inconnue est survenue.");
        }
    } finally {
        setIsUpdatingList(false);
    }
  }, [studentListText]);
    
    // --- CONSTRAINTS LOGIC (HISTORY, AFFINITIES & AI CPS) ---

    const calculatePairingScore = useCallback((studentA: Student, studentB: Student): number => {
        if (!studentA?.name || !studentB?.name) return 0;
        
        let score = 0;
        const key = [studentA.name.toLowerCase(), studentB.name.toLowerCase()].sort().join('||');

        // 1. History constraint (hard constraint)
        const historyCount = historicalGroups.get(key) || 0;
        if (historyCount >= maxGroupRepeats) {
            return -Infinity; // Hard "no"
        }
        // Penalize for being together before, but less than max.
        score -= historyCount * 20; // Heavy penalty for each past pairing

        // 2. Affinity constraint (soft constraint, weighted)
        if (useAffinities && affinityMatrix) {
            const affinityValue = affinityMatrix.get(key) || 0;
            // Give a strong weight to affinities
            score += affinityValue * 10; // e.g., +3 affinity adds 30 points, -3 subtracts 30
        }

        // 3. AI CPS constraints (Psychosocial competencies from https://ai-cps.ai.studio/)
        if (useCPSOptimization && cpsProfiles.size > 0) {
            const normA = normalizeStudentName(studentA.name);
            const normB = normalizeStudentName(studentB.name);
            const profileA = cpsProfiles.get(normA) || studentA.cpsProfile;
            const profileB = cpsProfiles.get(normB) || studentB.cpsProfile;

            // Direct partner choices / avoidances from CPS sociogram
            if (profileA?.preferredPartners && profileA.preferredPartners.some(p => normalizeStudentName(p) === normB)) {
                score += 35;
            }
            if (profileB?.preferredPartners && profileB.preferredPartners.some(p => normalizeStudentName(p) === normA)) {
                score += 35;
            }
            if (profileA?.avoidPartners && profileA.avoidPartners.some(p => normalizeStudentName(p) === normB)) {
                score -= 60;
            }
            if (profileB?.avoidPartners && profileB.avoidPartners.some(p => normalizeStudentName(p) === normA)) {
                score -= 60;
            }

            // Strategy-specific CPS weighting
            if (profileA?.globalScore !== undefined && profileB?.globalScore !== undefined) {
                const diff = Math.abs(profileA.globalScore - profileB.globalScore);

                if (cpsStrategy === 'tutoring') {
                    // Tutoring & Support: Pair a high CPS/emotional regulation student with one who needs support
                    if (diff >= 25 && diff <= 55) {
                        score += 30; // Optimal tutoring gap
                    } else if (diff > 70) {
                        score += 10; // Too wide gap
                    }
                } else if (cpsStrategy === 'balance') {
                    // Balance: Keep similar CPS levels to ensure smooth pace
                    if (diff <= 20) {
                        score += 25;
                    } else {
                        score -= diff * 0.3;
                    }
                } else if (cpsStrategy === 'affinity') {
                    // Sociogram priority: complement social + cognitive scores
                    if (profileA.socialScore !== undefined && profileB.socialScore !== undefined) {
                        const socialDiff = Math.abs(profileA.socialScore - profileB.socialScore);
                        if (socialDiff >= 20) score += 20; // One extrovert/mediator with one more reserved
                    }
                }
            }
        }

        return score;
    }, [historicalGroups, maxGroupRepeats, useAffinities, affinityMatrix, useCPSOptimization, cpsProfiles, cpsStrategy]);


    const createGroupsWithConstraints = useCallback((studentList: Student[], groupSize: number): Student[][] => {
        let studentPool = [...studentList];
        const groups: Student[][] = [];
        
        if (groupSize <= 1) {
             return studentPool.map(s => [s]);
        }
        
        while (studentPool.length > 0) {
            const newGroup: Student[] = [];
            // Seed the group with the first student from the pool
            newGroup.push(studentPool.shift()!); 
            
            // Fill the rest of the group by finding the best fit
            while (newGroup.length < groupSize && studentPool.length > 0) {
                let bestCandidateIndex = -1;
                let maxScore = -Infinity;

                // Find the best student in the pool to add to the current group
                for (let i = 0; i < studentPool.length; i++) {
                    const candidate = studentPool[i];
                    let currentScore = 0;
                    // Calculate how well this candidate fits with the existing members of the group
                    for (const member of newGroup) {
                        currentScore += calculatePairingScore(candidate, member);
                    }

                    if (currentScore > maxScore) {
                        maxScore = currentScore;
                        bestCandidateIndex = i;
                    }
                }

                if (bestCandidateIndex !== -1) {
                    // Add the best candidate and remove them from the pool
                    newGroup.push(studentPool[bestCandidateIndex]);
                    studentPool.splice(bestCandidateIndex, 1);
                } else {
                    // No suitable candidate found (e.g., all remaining are incompatible)
                    // Add the first available student to prevent an infinite loop, even if the score is bad
                     if (studentPool.length > 0) {
                        newGroup.push(studentPool.shift()!);
                    }
                }
            }
            groups.push(newGroup);
        }
        return groups;
    }, [calculatePairingScore]);


    // --- HISTORY LOGIC ---

    const processHistoryLayout = (layout: SavedLayout, groupMap: Map<string, number>) => {
        const { placements, gridDimensions, students } = layout;
        const { cols } = gridDimensions;
        const studentNameMap = new Map(students.map(s => [s.id, s.name]));
        
        const grid = new Map<number, number>(); // cellId -> studentId
        placements.forEach(([studentId, placement]) => {
            if (typeof placement.location === 'number') {
                grid.set(placement.location, studentId);
            }
        });

        grid.forEach((studentId, cellId) => {
            const r = Math.floor(cellId / cols);
            const c = cellId % cols;
            const studentName1 = studentNameMap.get(studentId)?.toLowerCase();
            if (!studentName1) return;

            // Check right neighbor
            if (c + 1 < cols) {
                const rightNeighborId = grid.get(cellId + 1);
                if (rightNeighborId) {
                    const studentName2 = studentNameMap.get(rightNeighborId)?.toLowerCase();
                    if(studentName2) {
                        const key = [studentName1, studentName2].sort().join('||');
                        groupMap.set(key, (groupMap.get(key) || 0) + 1);
                    }
                }
            }
            // Check bottom neighbor
            if (r + 1 < gridDimensions.rows) {
                const bottomNeighborId = grid.get(cellId + cols);
                if (bottomNeighborId) {
                    const studentName2 = studentNameMap.get(bottomNeighborId)?.toLowerCase();
                    if(studentName2) {
                        const key = [studentName1, studentName2].sort().join('||');
                        groupMap.set(key, (groupMap.get(key) || 0) + 1);
                    }
                }
            }
        });
    };

    const handleHistoryFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files) return;

        const newFileNames: string[] = [];
        const newHistoricalGroups = new Map(historicalGroups);

        const filePromises = Array.from(files).map(file => {
            if (!loadedHistoryFiles.includes(file.name)) {
                newFileNames.push(file.name);
            }
            return file.text().then(text => {
                try {
                    const layout: SavedLayout = JSON.parse(text);
                    if (layout.students && layout.placements && layout.gridDimensions) {
                        processHistoryLayout(layout, newHistoricalGroups);
                    }
                } catch (e) {
                    console.error(`Error parsing history file ${file.name}:`, e);
                    setError(`Erreur de lecture du fichier d'historique : ${file.name}`);
                }
            });
        });

        Promise.all(filePromises).then(() => {
            setHistoricalGroups(newHistoricalGroups);
            setLoadedHistoryFiles(prev => [...new Set([...prev, ...newFileNames])]);
        });

        if(event.target) event.target.value = '';
    }, [historicalGroups, loadedHistoryFiles]);

    const handleClearHistory = useCallback(() => {
        setHistoricalGroups(new Map());
        setLoadedHistoryFiles([]);
    }, []);

    
    // --- AFFINITY LOGIC ---

    const handleDownloadAffinityTemplate = () => {
        const studentNames = allStudents.map(s => s.name);
        const header = ["Élève v Souhaite être avec >", ...studentNames];
        const data = [header];

        studentNames.forEach(name => {
            const row = Array(studentNames.length + 1).fill('');
            row[0] = name;
            data.push(row);
        });

        const ws = XLSX.utils.aoa_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Affinités");
        XLSX.writeFile(wb, "modele_affinites.xlsx");
    };

    const handleAffinityFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setError(null);
        setLoadedAffinityFile(null);
        setIsProcessingAffinities(true);
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const sheetData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                const newAffinityMatrix = new Map<string, number>();
                const headerNames = (sheetData[0] || []).slice(1).map(String);
                const studentNameMap = new Map(allStudents.map(s => [s.name.toLowerCase(), s.name]));
                
                const unmatchedNames = new Set<string>();

                for (let i = 1; i < sheetData.length; i++) {
                    const row = sheetData[i];
                    const rowStudentNameRaw = String(row[0] || '');
                    if (!rowStudentNameRaw) continue;

                    const rowStudentName = studentNameMap.get(rowStudentNameRaw.toLowerCase());
                    if (!rowStudentName) {
                        unmatchedNames.add(rowStudentNameRaw);
                        continue;
                    }

                    for (let j = 1; j < row.length; j++) {
                        const colStudentNameRaw = headerNames[j-1];
                        const colStudentName = studentNameMap.get(colStudentNameRaw.toLowerCase());
                        
                        if (!colStudentName || rowStudentName === colStudentName) continue;

                        const affinityValue = parseInt(String(row[j] || '0'), 10);
                        if (!isNaN(affinityValue) && affinityValue >= -3 && affinityValue <= 3 && affinityValue !== 0) {
                            const key = [rowStudentName.toLowerCase(), colStudentName.toLowerCase()].sort().join('||');
                            // Ensure symmetrical values are handled (e.g., last one wins)
                            newAffinityMatrix.set(key, affinityValue);
                        }
                    }
                }
                
                if (unmatchedNames.size > 0) {
                    setError(`Noms non trouvés dans la liste d'élèves actuelle : ${Array.from(unmatchedNames).join(', ')}.`);
                }
                setAffinityMatrix(newAffinityMatrix);
                setLoadedAffinityFile(file.name);
            } catch (err) {
                 setError("Erreur d'analyse du fichier d'affinités.");
            } finally {
                setIsProcessingAffinities(false);
            }
        };
        reader.onerror = () => {
            setError("Impossible de lire le fichier d'affinités.");
            setIsProcessingAffinities(false);
        };
        reader.readAsArrayBuffer(file);
        
        if(event.target) event.target.value = '';
    };

    const handleClearAffinities = useCallback(() => {
        setAffinityMatrix(null);
        setLoadedAffinityFile(null);
        if (affinityInputRef.current) affinityInputRef.current.value = '';
    }, []);

    // --- AI CPS LOGIC (https://ai-cps.ai.studio/) ---

    const handleCPSFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setError(null);
        setIsProcessingCPS(true);

        const isJson = file.name.endsWith('.json');
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const data = e.target?.result;
                if (!data) throw new Error("Fichier vide.");

                const { profiles, count } = parseCPSExport(data, file.name);

                if (count === 0) {
                    throw new Error("Aucun profil ou score CPS n'a pu être extrait. Vérifiez l'export de l'application AI CPS.");
                }

                // Match with current students list
                const updatedStudents = allStudents.map(student => {
                    const norm = normalizeStudentName(student.name);
                    const profile = profiles.get(norm);
                    if (profile) {
                        return { ...student, cpsProfile: profile };
                    }
                    return student;
                });

                setAllStudents(updatedStudents);
                setCpsProfiles(profiles);
                setLoadedCPSFile(file.name);
                setUseCPSOptimization(true);

                // Update placements with new cpsProfile
                setPlacements(currentPlacements => {
                    const newPlacements = new Map<number, StudentPlacement>();
                    updatedStudents.forEach(s => {
                        const existing = currentPlacements.get(s.id);
                        newPlacements.set(s.id, {
                            ...s,
                            location: existing ? existing.location : 'bank',
                        });
                    });
                    return newPlacements;
                });

            } catch (err: any) {
                console.error("Erreur lecture AI CPS:", err);
                setError(err.message || "Erreur lors de l'import des données AI CPS.");
            } finally {
                setIsProcessingCPS(false);
            }
        };

        reader.onerror = () => {
            setError("Impossible d'ouvrir le fichier AI CPS.");
            setIsProcessingCPS(false);
        };

        if (isJson) {
            reader.readAsText(file);
        } else {
            reader.readAsArrayBuffer(file);
        }

        if (event.target) event.target.value = '';
    };

    const handleClearCPS = useCallback(() => {
        setCpsProfiles(new Map());
        setLoadedCPSFile(null);
        if (cpsInputRef.current) cpsInputRef.current.value = '';
        
        // Remove cpsProfile from students
        setAllStudents(current => current.map(s => {
            const copy = { ...s };
            delete copy.cpsProfile;
            return copy;
        }));
        setPlacements(current => {
            const next = new Map(current);
            next.forEach(p => {
                delete p.cpsProfile;
            });
            return next;
        });
    }, []);

    const handleCPSPlacementAndVisualize = (strategy?: 'tutoring' | 'balance' | 'affinity') => {
        if (strategy) {
            setCpsStrategy(strategy);
        }
        setUseCPSOptimization(true);
        handleGenerateLayout();
        setStep(3);
    };


    // --- PLACEMENT LOGIC ---

    const placeGroupsOnGrid = (groups: Student[][]) => {
        const studentsInGroups = new Set(groups.flat().map(s => s.id));
        const { rows, cols } = gridDimensions;
    
        const newPlacements: Map<number, StudentPlacement> = new Map();
        allStudents.forEach(s => {
            const location = studentsInGroups.has(s.id) ? 'bank' : placements.get(s.id)?.location || 'bank';
            newPlacements.set(s.id, { ...s, location });
        });
    
        const occupiedCells = new Set([
            ...unavailableCells,
            ...Array.from(newPlacements.values())
                .filter(p => p.location !== 'bank' && !studentsInGroups.has(p.id))
                .map(p => p.location as number)
        ]);
        
        let currentRow = 0;
        let currentCol = 0;
        let maxHeightInRow = 0;
        
        for (const group of groups) {
            if (group.length === 0) continue;
    
            const isGrouping = autoPlacementOptions.isGroupingEnabled && group.length > 1;
            const hSpace = isGrouping ? autoPlacementOptions.spaceHorizontal : 0;
            const vSpace = isGrouping ? autoPlacementOptions.spaceVertical : 0;
    
            const isBlockLayout = isGrouping && autoPlacementOptions.groupLayout === 'block' && group.length > 2;
            const groupWidth = isBlockLayout ? 2 : group.length;
            const groupHeight = isBlockLayout ? Math.ceil(group.length / 2) : 1;
    
            let placed = false;
            while (!placed) {
                if (currentRow >= rows) break;
    
                if (currentCol > 0 && (currentCol + groupWidth > cols)) {
                    currentRow += maxHeightInRow + vSpace;
                    currentCol = 0;
                    maxHeightInRow = 0;
                    continue;
                }
    
                let areaIsClear = true;
                const cellsToOccupy: { studentId: number; cellId: number }[] = [];
                
                for (let i = 0; i < group.length; i++) {
                    const rOffset = isBlockLayout ? Math.floor(i / 2) : 0;
                    const cOffset = isBlockLayout ? i % 2 : i;
                    const targetRow = currentRow + rOffset;
                    const targetCol = currentCol + cOffset;
    
                    if (targetRow >= rows || targetCol >= cols) {
                        areaIsClear = false; break;
                    }
                    const targetCell = targetRow * cols + targetCol;
                    if (occupiedCells.has(targetCell)) {
                        areaIsClear = false; break;
                    }
                    cellsToOccupy.push({ studentId: group[i].id, cellId: targetCell });
                }
    
                if (areaIsClear) {
                    cellsToOccupy.forEach(({ studentId, cellId }) => {
                        newPlacements.get(studentId)!.location = cellId;
                        occupiedCells.add(cellId);
                    });
                    
                    currentCol += groupWidth + hSpace;
                    maxHeightInRow = Math.max(maxHeightInRow, groupHeight);
                    placed = true;
                } else {
                    currentCol++;
                    if (currentCol >= cols) {
                         currentRow += maxHeightInRow + vSpace;
                         currentCol = 0;
                         maxHeightInRow = 0;
                    }
                }
            }
        }
        setPlacements(newPlacements);
        clearSelection();
    };

    const handleGenerateLayout = () => {
        let studentList = [...allStudents];

        if (autoPlacementOptions.sort === 'roll') {
            studentList.sort((a, b) => {
                const numA = parseInt(a.rollNumber || '0', 10);
                const numB = parseInt(b.rollNumber || '0', 10);
                if (isNaN(numA)) return 1;
                if (isNaN(numB)) return -1;
                return numA - numB;
            });
        } else if (autoPlacementOptions.sort === 'random') {
            for (let i = studentList.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [studentList[i], studentList[j]] = [studentList[j], studentList[i]];
            }
        }

        const groupSize = autoPlacementOptions.isGroupingEnabled ? autoPlacementOptions.groupSize : 1;
        const groups = createGroupsWithConstraints(studentList, groupSize);
        
        placeGroupsOnGrid(groups);
    };
    
    const handleGenerateAndVisualize = () => {
        handleGenerateLayout();
        setStep(3);
    };

    const handleGroupingPlacement = (type: 'homogeneous' | 'heterogeneous') => {
        setError(null);
        const studentsWithGrades = allStudents.filter(s => s.grade !== undefined);
        if (studentsWithGrades.length === 0) {
            setError("Aucun élève n'a de note. Veuillez importer un fichier de notes.");
            return;
        }

        studentsWithGrades.sort((a, b) => (a.grade as number) - (b.grade as number));
        
        let groups: Student[][] = [];
        const groupSize = autoPlacementOptions.groupSize;

        if (!autoPlacementOptions.isGroupingEnabled || groupSize <= 1) {
            groups = studentsWithGrades.map(s => [s]);
        } else if (type === 'homogeneous') {
            groups = createGroupsWithConstraints(studentsWithGrades, groupSize);
        } else { // heterogeneous
            const numGroups = Math.ceil(studentsWithGrades.length / groupSize);
            for (let i = 0; i < numGroups; i++) groups.push([]);
            
            const studentPool = [...studentsWithGrades];
            
            studentPool.forEach(student => {
                let bestGroupIndex = -1;
                let maxFitScore = -Infinity;
                let bestGroupsForTiebreak: number[] = [];

                for (let i = 0; i < groups.length; i++) {
                    const group = groups[i];
                    if (group.length < groupSize) {
                        let fitScore = 0;
                        for (const member of group) {
                            fitScore += calculatePairingScore(student, member);
                        }
                        if (fitScore > maxFitScore) {
                            maxFitScore = fitScore;
                            bestGroupsForTiebreak = [i];
                        } else if (fitScore === maxFitScore) {
                            bestGroupsForTiebreak.push(i);
                        }
                    }
                }
                
                if (bestGroupsForTiebreak.length > 0) {
                    let chosenIndex = bestGroupsForTiebreak[0];
                    if (bestGroupsForTiebreak.length > 1) {
                        let minGroupSize = Infinity;
                        bestGroupsForTiebreak.forEach(index => {
                            if (groups[index].length < minGroupSize) {
                                minGroupSize = groups[index].length;
                                chosenIndex = index;
                            }
                        });
                    }
                    bestGroupIndex = chosenIndex;
                }

                if (bestGroupIndex !== -1) {
                    groups[bestGroupIndex].push(student);
                } else {
                     const fallbackIndex = groups.findIndex(g => g.length < groupSize);
                     if (fallbackIndex !== -1) groups[fallbackIndex].push(student);
                }
            });
        }
        
        placeGroupsOnGrid(groups);
    };

    const handleGroupingAndVisualize = (type: 'homogeneous' | 'heterogeneous') => {
        handleGroupingPlacement(type);
        if(!error) setStep(3);
    };

    const handleGradeFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setError(null);
        setIsProcessingGrades(true);
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const json: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                
                const gradeDataMap = new Map<string, { grade: number; name: string; rollNumber?: string }>();
                
                json.slice(1).forEach(row => { // Assume header is row 0, data starts from row 1
                    const rollNumber = row[0] ? String(row[0]).trim() : undefined;
                    const lastName = row[1] ? String(row[1]).trim() : '';
                    const firstName = row[2] ? String(row[2]).trim() : '';
                    const name = `${firstName} ${lastName}`.trim();

                    if (!name) return;

                    const grades: number[] = row.slice(3)
                        .map(cell => parseFloat(String(cell)))
                        .filter(n => !isNaN(n));

                    if (grades.length > 0) {
                        const averageGrade = grades.reduce((a, b) => a + b, 0) / grades.length;
                        gradeDataMap.set(name.toLowerCase(), { grade: averageGrade, name, rollNumber });
                    }
                });

                const updatedStudents = new Map<number, Student>();
                const gradeFileStudentNames = new Set(Array.from(gradeDataMap.keys()));

                allStudents.forEach(student => {
                    const gradeInfo = gradeDataMap.get(student.name.toLowerCase());
                    const updatedStudent = { ...student };
                    if (gradeInfo) {
                        updatedStudent.grade = gradeInfo.grade;
                        gradeFileStudentNames.delete(student.name.toLowerCase());
                    } else {
                        delete updatedStudent.grade;
                    }
                    updatedStudents.set(student.id, updatedStudent);
                });

                let nextId = allStudents.length > 0 ? Math.max(...allStudents.map(s => s.id)) + 1 : 0;
                const newStudents: Student[] = [];
                gradeFileStudentNames.forEach(studentNameKey => {
                    const newStudentData = gradeDataMap.get(studentNameKey);
                    if (newStudentData) {
                        newStudents.push({
                            id: nextId++,
                            name: newStudentData.name,
                            rollNumber: newStudentData.rollNumber,
                            grade: newStudentData.grade,
                        });
                    }
                });

                const finalStudentList = [...Array.from(updatedStudents.values()), ...newStudents];
                setAllStudents(finalStudentList);

                setPlacements(currentPlacements => {
                    const newPlacements = new Map<number, StudentPlacement>();
                    finalStudentList.forEach(student => {
                        const existingPlacement = currentPlacements.get(student.id);
                        const location = student.grade === undefined ? 'bank' : (existingPlacement?.location || 'bank');
                        newPlacements.set(student.id, { ...student, location });
                    });
                    return newPlacements;
                });

            } catch (err) {
                console.error("Erreur lors de l'analyse du fichier de notes:", err);
                setError("Erreur lors de l'analyse du fichier de notes. Assurez-vous que le format est correct (colonnes: Numéro, Nom, Prénom, Note1, ...).");
            } finally {
                setIsProcessingGrades(false);
            }
        };
        reader.onerror = () => {
            setError("Impossible de lire le fichier de notes.");
            setIsProcessingGrades(false);
        };
        reader.readAsArrayBuffer(file);
        
        if(event.target) event.target.value = '';
    };

    const handleLoadGradesClick = () => {
        gradeInputRef.current?.click();
    };


    const handleResetPlacement = useCallback(async () => {
        const emptyMap = new Map<number, StudentPlacement>();
        placements.forEach((p, id) => {
            emptyMap.set(id, { ...p, location: 'bank' });
        });
        setPlacements(emptyMap);
        clearSelection();
        setAllowSelfPlacement(true);

        try {
            const activePlacementsArray: StudentPlacement[] = Array.from(emptyMap.values());
            const classesList = targetClasses.length > 0
                ? targetClasses
                : className.split(',').map(s => s.trim()).filter(Boolean);

            for (const cName of classesList) {
                await savePublishedPlan({
                    teacherName: teacherName || 'M. / Mme Enseignant',
                    className: cName || 'Classe sans nom',
                    period: periodName || 'Période 1',
                    allowStudentSelfPlacement: true,
                    isFrozen: false,
                    gridDimensions,
                    unavailableCells: Array.from(unavailableCells),
                    placements: activePlacementsArray,
                });
            }
            const fresh = await getPublishedPlans();
            setPublishedPlansList(fresh);
        } catch (e) {
            console.error("Cloud auto-save error on reset placement:", e);
        }
    }, [clearSelection, placements, targetClasses, className, teacherName, periodName, gridDimensions, unavailableCells]);

    // --- GROUP MANAGEMENT ---
    const handleAddGroup = () => {
        const newGroup: Group = {
            id: crypto.randomUUID(),
            name: `Groupe ${groups.length + 1}`,
            color: `#${Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')}`
        };
        setGroups([...groups, newGroup]);
    };

    const handleUpdateGroup = (groupId: string, field: 'name' | 'color', value: string) => {
        setGroups(currentGroups =>
            currentGroups.map(g => (g.id === groupId ? { ...g, [field]: value } : g))
        );
    };

    const handleDeleteGroup = (groupId: string) => {
        setGroups(currentGroups => currentGroups.filter(g => g.id !== groupId));
        // Unassign students from the deleted group
        const updateStudentGroup = (s: Student) => s.groupId === groupId ? { ...s, groupId: undefined } : s;
        setAllStudents(currentStudents => currentStudents.map(updateStudentGroup));
        setPlacements(currentPlacements => {
            const newPlacements = new Map(currentPlacements);
            newPlacements.forEach((p, id) => {
                if (p.groupId === groupId) {
                    newPlacements.set(id, { ...p, groupId: undefined });
                }
            });
            return newPlacements;
        });
    };

    const handleAssignGroupToSelected = (groupId: string) => {
        const newGroupId = groupId === 'none' ? undefined : groupId;

        const updateStudent = (s: Student): Student =>
            selectedStudentIds.has(s.id) ? { ...s, groupId: newGroupId } : s;
            
        setAllStudents(current => current.map(updateStudent));
        
        setPlacements(current => {
            const newPlacements = new Map(current);
            selectedStudentIds.forEach(studentId => {
                const student = newPlacements.get(studentId);
                if (student) {
                    newPlacements.set(studentId, { ...student, groupId: newGroupId });
                }
            });
            return newPlacements;
        });

        clearSelection();
    };

    const handleExportHtml = () => {
        const { rows, cols } = gridDimensions;
        const groupColorMap = new Map(groups.map(g => [g.id, g.color]));
        const studentsByLocation = new Map<number, StudentPlacement>();
        placements.forEach(p => {
            if (typeof p.location === 'number') {
                studentsByLocation.set(p.location, p);
            }
        });

        let gridHtml = '';
        for (let i = 0; i < rows * cols; i++) {
            const student = studentsByLocation.get(i);
            const isUnavailable = unavailableCells.has(i);
            
            if (isUnavailable) {
                gridHtml += `<div class="cell unavailable"></div>`;
            } else if (student) {
                const groupColor = student.groupId ? groupColorMap.get(student.groupId) : null;
                const nameParts = student.name.trim().split(/\s+/);
                const firstName = nameParts.shift() || '';
                const lastName = nameParts.join(' ');
                
                gridHtml += `
                    <div class="cell student" style="border-left: 4px solid ${groupColor || 'transparent'}">
                        <div class="name">
                            <div class="first-name">${firstName}</div>
                            <div class="last-name">${lastName}</div>
                        </div>
                    </div>
                `;
            } else {
                gridHtml += `<div class="cell empty"></div>`;
            }
        }

        let legendHtml = '';
        if (groups && groups.length > 0) {
            legendHtml = `
            <div class="legend">
                <span class="legend-title">Légende:</span>
                ${groups.map(group => `
                    <div class="legend-item">
                        <span class="legend-color" style="background-color: ${group.color};"></span>
                        <span class="legend-name">${group.name}</span>
                    </div>
                `).join('')}
            </div>
            `;
        }
        
        const classNameHtml = className.trim() ? `<h2 class="class-name">${className.trim()}</h2>` : '';

        const htmlContent = `
        <!DOCTYPE html>
        <html lang="fr">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Plan de Classe</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; background-color: #f0f4f8; color: #333; padding: 20px; }
                h1 { text-align: center; color: #2c3e50; margin-bottom: 5px; }
                h2.class-name { text-align: center; color: #555; font-weight: normal; margin-top: 0; margin-bottom: 20px; font-size: 1.2em; }
                .legend {
                    display: flex;
                    flex-wrap: wrap;
                    justify-content: center;
                    align-items: center;
                    gap: 16px;
                    margin: 0 auto 20px;
                    padding: 10px;
                    max-width: 80%;
                    background-color: #fff;
                    border-radius: 8px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                }
                .legend-title { font-weight: bold; font-size: 14px; margin-right: 8px; }
                .legend-item { display: flex; align-items: center; gap: 6px; }
                .legend-color { width: 14px; height: 14px; border-radius: 50%; display: inline-block; }
                .legend-name { font-size: 12px; }
                .classroom-grid {
                    display: grid;
                    grid-template-columns: repeat(${cols}, 1fr);
                    gap: 10px;
                    max-width: 1200px;
                    margin: 20px auto;
                    padding: 20px;
                    background-color: #ffffff;
                    border-radius: 8px;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                }
                .cell {
                    aspect-ratio: 2 / 1;
                    border: 1px dashed #ccc;
                    border-radius: 6px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    text-align: center;
                    padding: 5px;
                    font-size: 12px;
                    overflow: hidden;
                    box-sizing: border-box;
                }
                .student {
                    background-color: #e3f2fd;
                    border: 1px solid #90caf9;
                    font-weight: 500;
                }
                .name { line-height: 1.2; word-break: break-word; }
                .first-name { font-weight: bold; }
                .unavailable {
                    background-color: #e0e0e0;
                    background-image: repeating-linear-gradient(45deg, #bdbdbd 25%, transparent 25%, transparent 50%, #bdbdbd 50%, #bdbdbd 75%, transparent 75%, transparent 100%);
                    background-size: 8px 8px;
                }
                .empty { background-color: #fafafa; }
            </style>
        </head>
        <body>
            <h1>Plan de Classe</h1>
            ${classNameHtml}
            ${legendHtml}
            <div class="classroom-grid">
                ${gridHtml}
            </div>
        </body>
        </html>
        `;

        const blob = new Blob([htmlContent], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'plan-de-classe.html';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };


  const studentsInBank = Array.from(placements.values()).filter(p => p.location === 'bank');
  const hasGrades = allStudents.some(s => s.grade !== undefined);
  const totalSeats = gridDimensions.rows * gridDimensions.cols;
  const availableSeats = totalSeats - unavailableCells.size;


  if (step === 2) {
     return (
        <div>
            <div className="text-center mb-6">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900">
                    <SettingsIcon className="h-6 w-6 text-indigo-600 dark:text-indigo-300" aria-hidden="true" />
                </div>
                <h2 className="mt-4 text-2xl font-bold text-slate-900 dark:text-white">Étape 2: Réglages et Contraintes</h2>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                    Ajustez les dimensions, importez des notes, et définissez des contraintes pour le placement automatique.
                </p>

                {/* Interactive Class Attribution & Reassignment Control */}
                <div className="max-w-2xl mx-auto mt-5 p-4 bg-gradient-to-r from-indigo-50/90 to-purple-50/90 dark:from-indigo-950/70 dark:to-purple-950/70 border-2 border-indigo-200 dark:border-indigo-800 rounded-2xl shadow-sm text-left space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-indigo-200/80 dark:border-indigo-800/80 pb-2.5">
                    <div>
                      <h3 className="font-extrabold text-sm text-indigo-950 dark:text-indigo-100 flex items-center gap-2">
                        <span className="text-base">🎯</span>
                        Affectation du Plan aux Classes
                      </h3>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300">
                        Affectez ce plan à une ou plusieurs classes, ou désaffectez-le de sa classe d'origine au besoin.
                      </p>
                    </div>
                    <span className="self-start sm:self-auto px-3 py-1 bg-indigo-600 text-white font-bold rounded-full text-xs shadow-xs">
                      {targetClasses.length} classe(s)
                    </span>
                  </div>

                  {/* Feedback Notification */}
                  {classAssignmentMsg && (
                    <div className="p-2.5 bg-emerald-100 text-emerald-900 dark:bg-emerald-950/90 dark:text-emerald-200 text-xs font-semibold rounded-xl border border-emerald-300 flex items-center justify-between">
                      <span>✅ {classAssignmentMsg}</span>
                      <button onClick={() => setClassAssignmentMsg(null)} className="text-slate-500 hover:text-slate-700">✕</button>
                    </div>
                  )}

                  {/* Assigned Classes Tags with Unassign (✕) button */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">
                      Classes actuellement affectées à ce plan :
                    </label>

                    {targetClasses.length === 0 ? (
                      <div className="p-3 bg-amber-50 dark:bg-amber-950/50 border border-amber-300 rounded-xl text-xs text-amber-800 dark:text-amber-200 font-medium">
                        ⚠️ Aucune classe attribuée. Affectez au moins une classe ci-dessous.
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {targetClasses.map((cls) => (
                          <span
                            key={cls}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border-2 border-indigo-300 dark:border-indigo-600 rounded-xl text-xs font-bold text-indigo-900 dark:text-indigo-100 shadow-xs"
                          >
                            <span>🏫 Classe {cls}</span>
                            <button
                              type="button"
                              onClick={() => handleUnassignClass(cls)}
                              className="ml-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 font-extrabold hover:bg-red-100 dark:hover:bg-red-950/50 rounded-full w-4 h-4 inline-flex items-center justify-center text-[11px] transition-all"
                              title={`Désaffecter ce plan de la classe ${cls}`}
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Affect to other classes */}
                  <div className="pt-2 border-t border-indigo-200/60 dark:border-indigo-800/60 space-y-2">
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-200">
                      ➕ Affecter ce plan à d'autres classes :
                    </label>

                    {/* Teacher Classes Suggestions */}
                    <div className="flex flex-wrap gap-1.5 items-center">
                      <span className="text-[11px] font-semibold text-slate-500 mr-1">Mes classes :</span>
                      {teacherClasses
                        .filter((c) => !targetClasses.includes(c))
                        .map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => handleAssignClass(c)}
                            className="px-2.5 py-1 text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/40 text-slate-700 dark:text-slate-200 rounded-lg transition-all"
                          >
                            + {c}
                          </button>
                        ))}
                    </div>

                    {/* Custom Class Name Input */}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newTargetClassInput}
                        onChange={(e) => setNewTargetClassInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAssignClass(newTargetClassInput);
                            setNewTargetClassInput('');
                          }
                        }}
                        placeholder="Tapez un nom de classe (ex: 5ème B, 3ème C)..."
                        className="flex-1 px-3 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white font-medium"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          handleAssignClass(newTargetClassInput);
                          setNewTargetClassInput('');
                        }}
                        disabled={!newTargetClassInput.trim()}
                        className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-bold text-xs rounded-xl shadow-xs transition-all whitespace-nowrap"
                      >
                        ➕ Affecter
                      </button>
                    </div>
                  </div>
                </div>
            </div>
             <div className="text-center mb-4">
                <button 
                    onClick={() => setIsHelpVisible(!isHelpVisible)}
                    className="inline-flex items-center gap-2 px-3 py-1 text-sm text-indigo-700 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-900/50 rounded-full hover:bg-indigo-200 dark:hover:bg-indigo-900"
                >
                    <HelpIcon className="h-4 w-4" />
                    Mode d'emploi
                </button>
            </div>
          {isHelpVisible && (
            <div className="max-w-4xl mx-auto mb-6 p-6 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-indigo-200 dark:border-indigo-800">
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Mode d'emploi détaillé</h3>
            <div className="text-sm text-slate-600 dark:text-slate-400 space-y-6">
                
                <div>
                    <h4 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-2">1. Gestion de Base</h4>
                    <ul className="list-disc list-inside space-y-2">
                        <li><strong>Placer les élèves :</strong> Glissez-déposez un élève de la "Liste d'élèves" vers une case du plan.</li>
                        <li><strong>Gérer la grille :</strong> Cliquez sur une case vide pour la marquer comme indisponible (passage, meuble...). Modifiez les dimensions (largeur/hauteur) dans le panneau de contrôle.</li>
                        <li><strong>Sélection multiple :</strong> Maintenez la touche <code className="text-xs bg-slate-100 dark:bg-slate-700 p-1 rounded">Ctrl</code> (ou <code className="text-xs bg-slate-100 dark:bg-slate-700 p-1 rounded">Cmd</code> sur Mac) enfoncée et cliquez sur plusieurs élèves pour créer une sélection.</li>
                        <li><strong>Déplacer un groupe :</strong> Après avoir sélectionné plusieurs élèves, glissez-en un seul pour déplacer tout le groupe en même temps.</li>
                        <li><strong>Supprimer un élève :</strong> Passez la souris sur une fiche d'élève (dans la liste ou la grille) et cliquez sur l'icône poubelle qui apparaît.</li>
                    </ul>
                </div>

                <div>
                    <h4 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-2">2. Placement Automatique</h4>
                     <p className="mb-2">Le panneau "Placement Automatique" vous permet de configurer comment les élèves seront placés sur la grille.</p>
                    <ul className="list-disc list-inside space-y-2">
                        <li><strong>Ordre de base :</strong> Avant de générer un placement, vous pouvez trier la liste d'élèves par numéro d'appel (<code className="text-xs bg-slate-100 dark:bg-slate-700 p-1 rounded"># Numérique</code>) ou la mélanger (<code className="text-xs bg-slate-100 dark:bg-slate-700 p-1 rounded">Aléatoire</code>).</li>
                        <li><strong>Options de groupement :</strong> Activez "Regrouper par" pour créer des groupes. Vous pouvez ensuite définir leur taille, leur disposition (en ligne ou en bloc compact) et l'espacement entre eux sur la grille.</li>
                        <li><strong>Le bouton "Générer" :</strong> Ce bouton principal applique toutes vos options (ordre, groupement) et prend en compte les contraintes d'historique et d'affinités si elles sont activées pour organiser la classe.</li>
                    </ul>
                </div>

                 <div>
                    <h4 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-2">3. Placements Avancés avec Contraintes</h4>
                     <p className="mb-2">Combinez plusieurs contraintes pour un plan de classe sur-mesure.</p>
                    <dl className="space-y-4">
                        <div>
                           <dt className="font-semibold text-slate-800 dark:text-slate-300">Placement par Notes (Groupes de niveau)</dt>
                           <dd className="pl-4 mt-1 border-l-2 border-slate-200 dark:border-slate-700">
                                <ol className="list-decimal list-inside space-y-1 mt-1">
                                    <li><strong>Préparez votre fichier :</strong> Créez un fichier Excel (.xls, .xlsx) avec les colonnes : <code className="text-xs bg-slate-100 dark:bg-slate-700 p-1 rounded">A: Numéro</code>, <code className="text-xs bg-slate-100 dark:bg-slate-700 p-1 rounded">B: Nom</code>, <code className="text-xs bg-slate-100 dark:bg-slate-700 p-1 rounded">C: Prénom</code>, puis les notes dans les colonnes suivantes. L'application calculera la moyenne.</li>
                                    <li><strong>Importez les notes :</strong> Cliquez sur "Importer les notes" et sélectionnez votre fichier.</li>
                                    <li><strong>Générez :</strong> Utilisez "Groupes Homogènes" (élèves de niveaux similaires ensemble) ou "Groupes Hétérogènes" (élèves de niveaux variés ensemble).</li>
                                </ol>
                           </dd>
                        </div>
                        <div>
                           <dt className="font-semibold text-slate-800 dark:text-slate-300">Contrainte d'Historique</dt>
                           <dd className="pl-4 mt-1 border-l-2 border-slate-200 dark:border-slate-700">
                                <ol className="list-decimal list-inside space-y-1 mt-1">
                                    <li><strong>Chargez des plans :</strong> Cliquez sur "Charger l'historique" et sélectionnez un ou plusieurs de vos anciens plans de classe sauvegardés (.json).</li>
                                    <li><strong>Définissez la limite :</strong> Indiquez combien de fois deux élèves peuvent au maximum se retrouver dans le même groupe.</li>
                                    <li>Cette contrainte est appliquée automatiquement par tous les boutons de génération ("Générer", "Homogènes", "Hétérogènes").</li>
                                </ol>
                           </dd>
                        </div>
                        <div>
                           <dt className="font-semibold text-slate-800 dark:text-slate-300">Contrainte d'Affinités</dt>
                           <dd className="pl-4 mt-1 border-l-2 border-slate-200 dark:border-slate-700">
                                <ol className="list-decimal list-inside space-y-1 mt-1">
                                    <li><strong>Téléchargez le modèle :</strong> Cliquez sur "Télécharger modèle d'affinités".</li>
                                    <li><strong>Remplissez le fichier :</strong> Notez de <code className="text-xs bg-slate-100 dark:bg-slate-700 p-1 rounded">-3</code> (pas du tout envie) à <code className="text-xs bg-slate-100 dark:bg-slate-700 p-1 rounded">+3</code> (très envie) les souhaits des élèves. Laissez vide ou 0 pour neutre.</li>
                                    <li><strong>Importez la grille :</strong> Chargez votre fichier complété.</li>
                                    <li><strong>Activez l'option :</strong> Cochez la case "Utiliser les affinités" pour que l'algorithme en tienne compte lors du prochain placement.</li>
                                </ol>
                           </dd>
                        </div>
                    </dl>
                </div>
            </div>
        </div>
          )}
          <div className="max-w-3xl mx-auto bg-white dark:bg-slate-800 p-4 sm:p-6 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700 space-y-6">
            {/* Header Summary & Quick Launch Banner */}
            <div className="p-5 bg-gradient-to-r from-slate-900 to-indigo-950 text-white rounded-2xl border-2 border-indigo-500 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-700/80 pb-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 bg-amber-400 text-slate-950 font-black text-xs rounded-md uppercase tracking-wider">
                      ⚙️ Étape Réglages du Plan
                    </span>
                    <span className="font-extrabold text-white text-base">
                      Classe : <strong className="text-amber-300 underline">{className}</strong>
                    </span>
                  </div>
                  <div className="text-xs text-slate-300 flex flex-wrap items-center gap-2">
                    <span>👨‍🏫 Prof : <strong className="text-white">{teacherName}</strong></span>
                    <span>•</span>
                    <span>📅 Période : {periodName}</span>
                    <span>•</span>
                    <span>👥 {allStudents.length} élève(s)</span>
                    <span>•</span>
                    <span>📐 Grille {gridDimensions.rows}×{gridDimensions.cols}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="w-full sm:w-auto px-5 py-3 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black rounded-xl text-xs sm:text-sm shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer shrink-0"
                >
                  <span>🚀 Valider & Passer à l'Étape 3 (Visualisation) →</span>
                </button>
              </div>

              {/* Accordion toggle button */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pt-1 text-xs">
                <span className="text-slate-300 italic">
                  {isAdvancedSettingsOpen
                    ? "Les réglages avancés sont affichés ci-dessous."
                    : "Les réglages avancés (notes, groupes, affinités, dimensions) sont masqués par défaut."}
                </span>
                <button
                  type="button"
                  onClick={() => setIsAdvancedSettingsOpen(!isAdvancedSettingsOpen)}
                  className="px-3.5 py-1.5 bg-indigo-900/80 hover:bg-indigo-800 text-indigo-100 font-bold rounded-xl border border-indigo-600 transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
                >
                  <span>{isAdvancedSettingsOpen ? "▲ Masquer les réglages avancés" : "⚙️ Afficher les réglages avancés"}</span>
                </button>
              </div>
            </div>

            {/* ADVANCED SETTINGS COLLAPSIBLE CONTAINER */}
            {isAdvancedSettingsOpen && (
              <div className="space-y-6 pt-2 border-t border-slate-200 dark:border-slate-700 transition-all">
                <h3 className="text-xl font-semibold flex items-center gap-2 text-slate-800 dark:text-white border-b border-slate-200 dark:border-slate-700 pb-3">
                  <SettingsIcon className="h-6 w-6"/>
                  Panneau de Contrôle Avancé
                </h3>

                {/* Personnalisation des Couleurs des Places (Cadre / Statuts) */}
                <SeatingColorSettings />

            <div className="space-y-2">
                <label htmlFor="update-student-list-textarea" className="block text-sm font-semibold text-slate-800 dark:text-white">
                    Mettre à jour la liste d'élèves
                </label>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    Collez une nouvelle liste ici pour remplacer la liste actuelle. La disposition de la classe sera conservée.
                </p>
                <textarea
                    id="update-student-list-textarea"
                    value={studentListText}
                    onChange={(e) => setStudentListText(e.target.value)}
                    placeholder="1. Jean Dupont&#10;2. Marie Curie&#10;..."
                    className="w-full h-32 p-2 border border-slate-300 dark:border-slate-600 rounded-md bg-slate-50 dark:bg-slate-700 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition duration-150 ease-in-out text-sm"
                    disabled={isUpdatingList}
                    aria-label="Coller la nouvelle liste d'élèves"
                />
                <button
                    onClick={handleUpdateStudentList}
                    disabled={isUpdatingList || !studentListText.trim()}
                    className="w-full flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-indigo-400 disabled:cursor-not-allowed"
                >
                    {isUpdatingList ? "Mise à jour..." : "Mettre à jour la liste"}
                </button>
            </div>
            
            <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-2">
                <h4 className="font-semibold text-slate-800 dark:text-white">Importer les notes (facultatif)</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    Importez un fichier .xls/.xlsx pour le placement par groupes de niveau.
                </p>
                <input
                    type="file"
                    ref={gradeInputRef}
                    onChange={handleGradeFileChange}
                    accept=".xls,.xlsx"
                    className="hidden"
                />
                <button
                    onClick={handleLoadGradesClick}
                    disabled={isProcessingGrades}
                    className="w-full flex items-center justify-center px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-wait"
                >
                    <SheetIcon className="h-5 w-5 mr-2"/>
                    {isProcessingGrades ? "Traitement..." : "Importer les notes"}
                </button>
            </div>
            {error && <p className="mt-2 text-xs text-center text-red-600 dark:text-red-400" role="alert">{error}</p>}
            
            <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-2">
                <label htmlFor="class-name-input" className="block text-base font-semibold text-slate-800 dark:text-white">
                    Nom de la classe
                </label>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    Ce nom sera utilisé dans le titre lors de l'export du plan de classe (facultatif).
                </p>
                <input
                    type="text"
                    id="class-name-input"
                    value={className}
                    onChange={(e) => setClassName(e.target.value)}
                    placeholder="Ex: CM2 B"
                    className="w-full p-2 border border-slate-300 dark:border-slate-600 rounded-md bg-slate-50 dark:bg-slate-700/50 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                />
            </div>

             <div>
                <div className="flex justify-between items-center mb-2">
                     <h4 className="font-semibold text-slate-800 dark:text-white">Dimensions de la classe</h4>
                     <span className="text-sm font-medium text-slate-600 dark:text-slate-300">{gridDimensions.rows * gridDimensions.cols} places</span>
                </div>
                <div className="flex gap-4">
                    <div className="flex-1">
                        <label htmlFor="grid-cols" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Largeur</label>
                        <input type="number" id="grid-cols" value={gridDimensions.cols} min="1" max="15" onChange={e => handleDimensionChange('cols', parseInt(e.target.value, 10) || 1)} className="mt-1 block w-full p-2 border border-slate-300 dark:border-slate-600 rounded-md bg-slate-50 dark:bg-slate-700/50 text-sm"/>
                    </div>
                    <div className="flex-1">
                        <label htmlFor="grid-rows" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Hauteur</label>
                        <input type="number" id="grid-rows" value={gridDimensions.rows} min="1" max="20" onChange={e => handleDimensionChange('rows', parseInt(e.target.value, 10) || 1)} className="mt-1 block w-full p-2 border border-slate-300 dark:border-slate-600 rounded-md bg-slate-50 dark:bg-slate-700/50 text-sm"/>
                    </div>
                </div>
            </div>

            {/* Room Layout & Desks positioning without students */}
            <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-4 bg-slate-50/60 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-200/80 dark:border-slate-700/80">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-slate-800 dark:text-white flex items-center gap-2 text-sm">
                  <span className="text-base">🪑</span>
                  Plan de Positionnement des Tables & Chaises (Sans élèves)
                </h4>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Appliquez un modèle de salle pré-configuré, importez la disposition physique des tables depuis un fichier (.json) ou réutilisez la structure d'un plan enregistrée en base sans modifier vos élèves.
              </p>

              {/* Feedback message */}
              {roomLayoutMsg && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-700 rounded-xl text-xs font-bold text-emerald-800 dark:text-emerald-200">
                  {roomLayoutMsg}
                </div>
              )}

              {/* Option 1: Quick presets & Custom saved models */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    ⚡ Modèles de salles prêts à l'emploi :
                  </span>
                  {customRoomModels.length > 0 && (
                    <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/80 px-2 py-0.5 rounded-md">
                      {customRoomModels.length} modèle(s) personnalisé(s)
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {/* Built-in presets */}
                  {PRESET_ROOM_LAYOUTS.map(preset => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyRoomLayout(preset.gridDimensions, preset.getUnavailable(), `✅ Modèle "${preset.name}" appliqué à la salle !`)}
                      className="p-2.5 text-left bg-white dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 border border-slate-200 dark:border-slate-600 hover:border-indigo-400 dark:hover:border-indigo-600 rounded-xl transition-all shadow-sm"
                    >
                      <div className="font-bold text-xs text-slate-800 dark:text-slate-100">
                        {preset.name}
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                        {preset.desc}
                      </div>
                    </button>
                  ))}

                  {/* Custom user imported models */}
                  {customRoomModels.map(custom => (
                    <div
                      key={custom.id}
                      onClick={() => applyRoomLayout(custom.gridDimensions, custom.unavailableCells, `✅ Modèle "${custom.name}" appliqué à la salle !`)}
                      className="p-2.5 text-left bg-indigo-50/80 dark:bg-indigo-950/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/80 border border-indigo-200 dark:border-indigo-700/80 rounded-xl transition-all shadow-sm relative group cursor-pointer"
                    >
                      <div className="flex items-center justify-between pr-6">
                        <div className="font-bold text-xs text-indigo-950 dark:text-indigo-200 truncate">
                          {custom.name}
                        </div>
                      </div>
                      <div className="text-[10px] text-indigo-700 dark:text-indigo-300 mt-0.5">
                        {custom.desc}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => deleteCustomRoomModel(custom.id, e)}
                        title="Supprimer ce modèle personnalisé"
                        className="absolute top-2 right-2 text-slate-400 hover:text-red-600 dark:hover:text-red-400 p-1 rounded-md transition-colors bg-white/60 dark:bg-slate-800/60"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Option 2: Load / Paste / Save JSON file */}
              <div className="space-y-2 pt-2 border-t border-slate-200/60 dark:border-slate-700/60">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  📁 Fichier de disposition de salle (.json) ou Code :
                </span>
                <input
                  type="file"
                  ref={roomLayoutInputRef}
                  onChange={handleRoomLayoutFileChange}
                  accept=".json"
                  className="hidden"
                />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => roomLayoutInputRef.current?.click()}
                    className="flex items-center justify-center gap-1.5 py-2 px-2 text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 shadow-sm transition-all"
                  >
                    <UploadIcon className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                    <span>Charger (.json)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowPasteJsonArea(!showPasteJsonArea)}
                    className="flex items-center justify-center gap-1.5 py-2 px-2 text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 shadow-sm transition-all"
                  >
                    <span className="text-sm">📋</span>
                    <span>Coller JSON</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleExportRoomLayout}
                    className="flex items-center justify-center gap-1.5 py-2 px-2 text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 shadow-sm transition-all"
                  >
                    <LoadIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400 -scale-y-100" />
                    <span>Sauvegarder JSON</span>
                  </button>
                </div>

                {/* Paste Area */}
                {showPasteJsonArea && (
                  <div className="p-3.5 bg-white dark:bg-slate-800 rounded-xl border-2 border-indigo-200 dark:border-indigo-800 space-y-2 mt-2 shadow-md">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                        Collez le code JSON de la salle ci-dessous :
                      </label>
                      <span className="text-[10px] text-slate-500">Ex: {"{ \"gridDimensions\": ..., \"unavailableCells\": [...] }"}</span>
                    </div>
                    <textarea
                      rows={5}
                      value={jsonPasteInput}
                      onChange={(e) => setJsonPasteInput(e.target.value)}
                      placeholder='{"gridDimensions": {"rows": 15, "cols": 8}, "unavailableCells": [8, 9, 16, 17...]}'
                      className="w-full p-2.5 text-xs font-mono border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowPasteJsonArea(false)}
                        className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-800"
                      >
                        Annuler
                      </button>
                      <button
                        type="button"
                        onClick={handlePasteJsonSubmit}
                        disabled={!jsonPasteInput.trim()}
                        className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-bold text-xs rounded-lg shadow-sm"
                      >
                        Ajouter aux Modèles & Appliquer
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Option 3: Extract layout from Database Plan */}
              {publishedPlansList.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-200/60 dark:border-slate-700/60">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    ☁️ Charger les tables d'un plan de la base Firestore :
                  </span>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <select
                      value={selectedDbPlanIdForLayout}
                      onChange={(e) => setSelectedDbPlanIdForLayout(e.target.value)}
                      className="flex-1 text-xs p-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white font-medium"
                    >
                      <option value="">-- Choisir un plan enregistré --</option>
                      {publishedPlansList.map((p, pIdx) => (
                        <option key={`planner-layout-opt-${p.id}-${pIdx}`} value={p.id}>
                          {p.className} - {p.period} ({p.gridDimensions.rows}×{p.gridDimensions.cols}, {p.teacherName})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleApplyLayoutFromDbPlan}
                      disabled={!selectedDbPlanIdForLayout}
                      className="py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-bold text-xs rounded-xl shadow-sm transition-all whitespace-nowrap"
                    >
                      Appliquer les tables
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-3">
                <h4 className="font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                    <GroupIcon className="h-5 w-5"/>
                    Gestion des Groupes
                </h4>
                <div className="space-y-2">
                    {groups.map(group => (
                        <div key={group.id} className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-700/50 rounded-md">
                            <input
                                type="color"
                                value={group.color}
                                onChange={(e) => handleUpdateGroup(group.id, 'color', e.target.value)}
                                className="w-8 h-8 p-0 border-none rounded-md cursor-pointer bg-transparent"
                                aria-label={`Couleur du groupe ${group.name}`}
                            />
                            <input
                                type="text"
                                value={group.name}
                                onChange={(e) => handleUpdateGroup(group.id, 'name', e.target.value)}
                                className="flex-grow p-1 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-sm"
                                aria-label={`Nom du groupe ${group.name}`}
                            />
                            <button
                                onClick={() => handleDeleteGroup(group.id)}
                                className="p-1 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400"
                                aria-label={`Supprimer le groupe ${group.name}`}
                            >
                                <TrashIcon className="h-4 w-4" />
                            </button>
                        </div>
                    ))}
                </div>
                <button
                    onClick={handleAddGroup}
                    className="w-full flex items-center justify-center px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                    <PlusIcon className="h-5 w-5 mr-2" />
                    Ajouter un groupe
                </button>
            </div>
            
            <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-3">
                <h4 className="font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                    <HistoryIcon className="h-5 w-5"/>
                    Historique des groupes
                </h4>
                <input
                    type="file"
                    ref={historyInputRef}
                    onChange={handleHistoryFileChange}
                    accept=".json"
                    multiple
                    className="hidden"
                />
                <button
                    onClick={() => historyInputRef.current?.click()}
                    className="w-full flex items-center justify-center px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                    <UploadIcon className="h-5 w-5 mr-2"/>
                    Charger l'historique (.json)
                </button>
                {loadedHistoryFiles.length > 0 && (
                    <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1 p-2 bg-slate-50 dark:bg-slate-900/50 rounded-md">
                        <p className="font-medium">Fichiers chargés : ({loadedHistoryFiles.length})</p>
                        <ul className="list-disc list-inside max-h-20 overflow-y-auto text-ellipsis">
                            {loadedHistoryFiles.map((name, index) => <li key={index} title={name} className="truncate">{name}</li>)}
                        </ul>
                        <button
                            onClick={handleClearHistory}
                            className="w-full mt-2 flex items-center justify-center px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/50 focus:outline-none rounded-md"
                        >
                            <TrashIcon className="h-4 w-4 mr-1"/>
                            Effacer l'historique
                        </button>
                    </div>
                )}
                <div>
                    <label htmlFor="max-repeats" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                        Répétitions de groupe max.
                    </label>
                    <input 
                        type="number" 
                        id="max-repeats" 
                        value={maxGroupRepeats} 
                        min="1" 
                        onChange={e => setMaxGroupRepeats(parseInt(e.target.value, 10) || 1)} 
                        className="mt-1 block w-full p-2 border border-slate-300 dark:border-slate-600 rounded-md bg-slate-50 dark:bg-slate-700/50 text-sm"
                        aria-describedby="max-repeats-description"
                    />
                </div>
            </div>

             <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-3">
                <h4 className="font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                    <AffinityIcon className="h-5 w-5"/>
                    Affinités des élèves
                </h4>
                <input
                    type="file"
                    ref={affinityInputRef}
                    onChange={handleAffinityFileChange}
                    accept=".xls,.xlsx"
                    className="hidden"
                />
                <div className="grid grid-cols-2 gap-2">
                     <button
                        onClick={handleDownloadAffinityTemplate}
                        className="w-full flex items-center justify-center px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                    >
                        <LoadIcon className="h-5 w-5 mr-2 -scale-y-100"/>
                        Télécharger modèle
                    </button>
                    <button
                        onClick={() => affinityInputRef.current?.click()}
                        disabled={isProcessingAffinities}
                        className="w-full flex items-center justify-center px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                    >
                        <UploadIcon className="h-5 w-5 mr-2"/>
                        {isProcessingAffinities ? "Analyse..." : "Charger grille"}
                    </button>
                </div>
                 {loadedAffinityFile && (
                    <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1 p-2 bg-slate-50 dark:bg-slate-900/50 rounded-md">
                        <p className="font-medium truncate">Fichier chargé : <span className="italic">{loadedAffinityFile}</span></p>
                        <button
                            onClick={handleClearAffinities}
                            className="w-full mt-1 flex items-center justify-center px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/50 focus:outline-none rounded-md"
                        >
                            <TrashIcon className="h-4 w-4 mr-1"/>
                            Effacer la grille
                        </button>
                    </div>
                )}
                 <div className="flex items-center justify-between">
                    <label htmlFor="affinity-enabled" className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                        Utiliser les affinités
                    </label>
                    <input id="affinity-enabled" type="checkbox" checked={useAffinities} onChange={e => setUseAffinities(e.target.checked)} disabled={!affinityMatrix} className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:cursor-not-allowed" />
                 </div>
            </div>

            {/* AI CPS Section (https://ai-cps.ai.studio/) */}
            <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-3">
                <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                        <BrainIcon className="h-5 w-5 text-emerald-600 dark:text-emerald-400"/>
                        Résultats AI-CPS
                    </h4>
                    <a
                        href="https://ai-cps.ai.studio/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
                        title="Ouvrir l'application AI CPS"
                    >
                        ai-cps.ai.studio &nearr;
                    </a>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    Importez les résultats, sociogrammes ou profils CPS pour optimiser la dynamique de classe et l'entraide.
                </p>
                <input
                    type="file"
                    ref={cpsInputRef}
                    onChange={handleCPSFileChange}
                    accept=".json,.xls,.xlsx,.csv"
                    className="hidden"
                />
                <button
                    onClick={() => cpsInputRef.current?.click()}
                    disabled={isProcessingCPS}
                    className="w-full flex items-center justify-center px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700 rounded-md hover:bg-emerald-100 dark:hover:bg-emerald-900/60 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:opacity-50"
                >
                    <BrainIcon className="h-5 w-5 mr-2 text-emerald-600 dark:text-emerald-400"/>
                    {isProcessingCPS ? "Analyse en cours..." : "Importer résultats AI CPS (.json, .xlsx, .csv)"}
                </button>

                {loadedCPSFile && (
                    <div className="text-xs text-slate-600 dark:text-slate-300 space-y-2.5 p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-md">
                        <div className="flex items-center justify-between">
                            <p className="font-semibold text-emerald-800 dark:text-emerald-300 truncate">
                                Données CPS ({cpsProfiles.size} profils associés)
                            </p>
                            <button
                                onClick={handleClearCPS}
                                className="text-red-600 hover:text-red-700 dark:text-red-400 text-xs font-medium flex items-center gap-1"
                            >
                                <TrashIcon className="h-3.5 w-3.5"/>
                                Retirer
                            </button>
                        </div>
                        
                        <div className="space-y-1.5">
                            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                                Stratégie d'optimisation CPS :
                            </label>
                            <div className="grid grid-cols-3 gap-1">
                                <button
                                    type="button"
                                    onClick={() => setCpsStrategy('tutoring')}
                                    className={`px-2 py-1.5 text-xs rounded font-medium transition-colors ${
                                        cpsStrategy === 'tutoring'
                                            ? 'bg-emerald-600 text-white shadow-sm'
                                            : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600 hover:bg-slate-100'
                                    }`}
                                    title="Associe des élèves moteurs/sereins avec des élèves ayant besoin d'étayage"
                                >
                                    Tutorat
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setCpsStrategy('balance')}
                                    className={`px-2 py-1.5 text-xs rounded font-medium transition-colors ${
                                        cpsStrategy === 'balance'
                                            ? 'bg-emerald-600 text-white shadow-sm'
                                            : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600 hover:bg-slate-100'
                                    }`}
                                    title="Équilibre les groupes avec des niveaux CPS homogènes"
                                >
                                    Équilibre
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setCpsStrategy('affinity')}
                                    className={`px-2 py-1.5 text-xs rounded font-medium transition-colors ${
                                        cpsStrategy === 'affinity'
                                            ? 'bg-emerald-600 text-white shadow-sm'
                                            : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600 hover:bg-slate-100'
                                    }`}
                                    title="Privilégie les choix sociométriques et complémentarités relationnelles"
                                >
                                    Sociogramme
                                </button>
                            </div>
                        </div>

                        <div className="flex items-center justify-between pt-1">
                            <label htmlFor="cps-active-toggle" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                                Activer l'optimisation CPS
                            </label>
                            <input
                                id="cps-active-toggle"
                                type="checkbox"
                                checked={useCPSOptimization}
                                onChange={e => setUseCPSOptimization(e.target.checked)}
                                className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                            />
                        </div>
                    </div>
                )}
            </div>

            <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-4">
                <h4 className="font-semibold text-slate-800 dark:text-white">Placement Automatique</h4>
                
                <div className="space-y-2">
                     <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Ordre de base</label>
                     <div className="flex gap-2">
                        <button onClick={() => setAutoPlacementOptions(o => ({...o, sort: o.sort === 'roll' ? 'none' : 'roll'}))} className={`flex-1 text-sm p-2 rounded-md flex items-center justify-center gap-2 transition-colors ${autoPlacementOptions.sort === 'roll' ? 'bg-indigo-600 text-white' : 'bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600'}`}>
                           #
                           <span>Numérique</span>
                        </button>
                        <button onClick={() => setAutoPlacementOptions(o => ({...o, sort: o.sort === 'random' ? 'none' : 'random'}))} className={`flex-1 text-sm p-2 rounded-md flex items-center justify-center gap-2 transition-colors ${autoPlacementOptions.sort === 'random' ? 'bg-indigo-600 text-white' : 'bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600'}`}>
                            <RandomIcon className="h-4 w-4"/>
                           <span>Aléatoire</span>
                        </button>
                     </div>
                </div>

                <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-3">
                    <h5 className="font-semibold text-slate-800 dark:text-white">Options de groupement</h5>
                     <div className="flex items-center justify-between">
                        <label htmlFor="grouping-enabled" className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                            <GroupIcon className="h-5 w-5"/>
                            Regrouper par
                        </label>
                        <input id="grouping-enabled" type="checkbox" checked={autoPlacementOptions.isGroupingEnabled} onChange={e => setAutoPlacementOptions(o => ({...o, isGroupingEnabled: e.target.checked})) } className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                     </div>
                     {autoPlacementOptions.isGroupingEnabled && (
                        <>
                        <div className="flex items-center justify-center gap-4">
                            <button onClick={() => setAutoPlacementOptions(o => ({...o, groupSize: Math.max(2, o.groupSize - 1)}))} className="px-3 py-1 bg-slate-200 dark:bg-slate-700 rounded-md hover:bg-slate-300 dark:hover:bg-slate-600">-</button>
                            <span className="font-semibold">{autoPlacementOptions.groupSize}</span>
                            <button onClick={() => setAutoPlacementOptions(o => ({...o, groupSize: Math.min(10, o.groupSize + 1)}))} className="px-3 py-1 bg-slate-200 dark:bg-slate-700 rounded-md hover:bg-slate-300 dark:hover:bg-slate-600">+</button>
                        </div>
                        
                        {autoPlacementOptions.groupSize > 2 && (
                        <div className="space-y-1">
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Disposition des groupes</label>
                            <div className="flex gap-2">
                                <button onClick={() => setAutoPlacementOptions(o => ({...o, groupLayout: 'line'}))} className={`flex-1 text-sm p-2 rounded-md flex items-center justify-center gap-2 transition-colors ${autoPlacementOptions.groupLayout === 'line' ? 'bg-indigo-600 text-white' : 'bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600'}`}>En Ligne</button>
                                <button onClick={() => setAutoPlacementOptions(o => ({...o, groupLayout: 'block'}))} className={`flex-1 text-sm p-2 rounded-md flex items-center justify-center gap-2 transition-colors ${autoPlacementOptions.groupLayout === 'block' ? 'bg-indigo-600 text-white' : 'bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600'}`}>Regroupé</button>
                            </div>
                        </div>
                        )}
                        
                        <div className="space-y-2">
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Espacement des groupes (cases)</label>
                            <div className="flex gap-4">
                                <div className="flex-1">
                                    <label htmlFor="space-h" className="flex items-center gap-1 text-sm font-medium text-slate-700 dark:text-slate-300"><ArrowExpandHorizontalIcon className="h-4 w-4"/><span>Horiz.</span></label>
                                    <input type="number" id="space-h" value={autoPlacementOptions.spaceHorizontal} min="0" max="5" onChange={e => setAutoPlacementOptions(o => ({...o, spaceHorizontal: parseInt(e.target.value, 10) || 0}))} className="mt-1 block w-full p-2 border border-slate-300 dark:border-slate-600 rounded-md bg-slate-50 dark:bg-slate-700/50 text-sm"/>
                                </div>
                                <div className="flex-1">
                                    <label htmlFor="space-v" className="flex items-center gap-1 text-sm font-medium text-slate-700 dark:text-slate-300"><ArrowExpandVerticalIcon className="h-4 w-4"/><span>Vert.</span></label>
                                    <input type="number" id="space-v" value={autoPlacementOptions.spaceVertical} min="0" max="5" onChange={e => setAutoPlacementOptions(o => ({...o, spaceVertical: parseInt(e.target.value, 10) || 0}))} className="mt-1 block w-full p-2 border border-slate-300 dark:border-slate-600 rounded-md bg-slate-50 dark:bg-slate-700/50 text-sm"/>
                                </div>
                            </div>
                        </div>
                        </>
                     )}

                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                        <button onClick={() => handleGroupingAndVisualize('homogeneous')} disabled={!hasGrades} className="w-full flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-slate-400 dark:disabled:bg-slate-600 disabled:cursor-not-allowed">
                            <HomogeneousIcon className="h-4 w-4 mr-2"/>
                            Homogènes (Notes)
                        </button>
                        <button onClick={() => handleGroupingAndVisualize('heterogeneous')} disabled={!hasGrades} className="w-full flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:bg-slate-400 dark:disabled:bg-slate-600 disabled:cursor-not-allowed">
                            <HeterogeneousIcon className="h-4 w-4 mr-2"/>
                            Hétérogènes (Notes)
                        </button>
                    </div>
                     {!hasGrades && <p className="text-xs text-center text-slate-500 dark:text-slate-400">Importez des notes pour activer ce placement basé sur les notes.</p>}

                    {cpsProfiles.size > 0 && (
                        <div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-2">
                            <button
                                onClick={() => handleCPSPlacementAndVisualize()}
                                className="w-full flex items-center justify-center px-4 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-md hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 shadow-sm"
                            >
                                <BrainIcon className="h-4 w-4 mr-2"/>
                                Placement optimisé AI CPS ({cpsStrategy === 'tutoring' ? 'Tutorat' : cpsStrategy === 'balance' ? 'Équilibre' : 'Sociogramme'})
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-3">
                <button onClick={handleGenerateAndVisualize} className="w-full mt-4 px-4 py-3 text-base font-medium text-white bg-green-600 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500">
                    Générer et passer à l'étape 3
                </button>
                 <button onClick={() => setStep(3)} className="w-full px-4 py-2 text-sm font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-900/50 rounded-md hover:bg-indigo-200 dark:hover:bg-indigo-900">
                    Passer à la visualisation (placement manuel)
                </button>
                <button
                    onClick={onReset}
                    className="w-full px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-500"
                >
                    &larr; Recommencer avec une nouvelle liste
                </button>
            </div>
              </div>
            )}
          </div>
        </div>
     );
  }

  if (step === 3) {
      return (
        <div onClick={clearSelection}>
            <div className="text-center mb-6">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900">
                 <UserIcon className="h-6 w-6 text-indigo-600 dark:text-indigo-300" aria-hidden="true" />
                </div>
                <h2 className="mt-4 text-2xl font-bold text-slate-900 dark:text-white">Étape 3: Visualisation et Ajustements</h2>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                    Glissez-déposez les élèves pour finaliser le plan. Cliquez sur une case vide pour la marquer comme indisponible.
                </p>
            </div>
             
            <div className="flex flex-col lg:flex-row gap-8" onClick={(e) => e.stopPropagation()}>
                <div className="lg:w-72 flex flex-col gap-4">
                    <div className="bg-white dark:bg-slate-800 p-4 rounded-lg shadow-md space-y-3">
                        <h3 className="text-lg font-semibold flex items-center gap-2 text-slate-800 dark:text-white">
                            Actions Rapides
                        </h3>
                         <button
                            onClick={() => setStep(2)}
                            className="w-full flex items-center justify-center px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                        >
                            &larr; Précédent (Réglages)
                        </button>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                              onClick={handleSave}
                              disabled={saveConfirmation}
                              className="w-full flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors duration-200 disabled:bg-indigo-400 disabled:cursor-not-allowed"
                          >
                              <LoadIcon className="h-5 w-5 mr-2"/>
                              {saveConfirmation ? 'Plan !' : 'Enregistrer'}
                          </button>
                           <button
                              onClick={handleExportHtml}
                              className="w-full flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-md hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500"
                          >
                              <CodeIcon className="h-5 w-5 mr-2"/>
                              Exporter HTML
                          </button>
                        </div>

                        {/* Direct Cloud Publication for Students */}
                        <div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-2">
                          <button
                              onClick={handleOpenPublishModal}
                              className="w-full flex items-center justify-center px-4 py-2.5 text-xs font-bold text-white bg-gradient-to-r from-indigo-600 to-purple-600 rounded-md hover:from-indigo-700 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 shadow-sm"
                          >
                              <span>🚀 Publier & Gérer les Plans (Cloud)</span>
                          </button>
                          <button
                              type="button"
                              onClick={() => setShowLoadDbPlanModal(true)}
                              className="w-full flex items-center justify-center px-4 py-2.5 text-xs font-black text-amber-950 bg-amber-400 hover:bg-amber-300 rounded-md shadow-sm transition-all cursor-pointer"
                          >
                              <span>📂 Charger un autre plan de la base</span>
                          </button>
                          {publishSuccessMsg && (
                              <div className="p-2 bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-200 text-[11px] font-semibold rounded">
                                  ✅ {publishSuccessMsg}
                              </div>
                          )}
                        </div>
                         <button
                            onClick={handleResetPlacement}
                            className="w-full px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                        >
                            Réinitialiser le placement
                        </button>
                       {selectedStudentIds.size > 0 && (
                        <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                          <label htmlFor="group-assign" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                            Assigner la sélection ({selectedStudentIds.size}) au groupe :
                          </label>
                          <select
                            id="group-assign"
                            onChange={(e) => handleAssignGroupToSelected(e.target.value)}
                            className="w-full p-2 border border-slate-300 dark:border-slate-600 rounded-md bg-slate-50 dark:bg-slate-700/50 text-sm"
                          >
                            <option value="none">Aucun groupe</option>
                            {groups.map(g => (
                              <option key={g.id} value={g.id}>{g.name}</option>
                            ))}
                          </select>
                         <button
                            onClick={clearSelection}
                            className="w-full px-4 py-2 text-sm font-medium text-slate-700 bg-white rounded-md border border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:bg-slate-700 dark:text-slate-200 dark:border-slate-600 dark:hover:bg-slate-600"
                          >
                            Effacer la sélection
                          </button>
                        </div>
                       )}
                       <button
                            onClick={onReset}
                            className="w-full px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-500"
                        >
                            Recommencer avec une nouvelle liste
                        </button>
                    </div>

                    <StudentBank
                      students={studentsInBank}
                      moveStudent={moveStudentOrGroup}
                      onAddStudent={handleAddStudent}
                      onDeleteStudent={handleDeleteStudent}
                      groups={groups}
                      onShowPhoto={(student) => setPlannerPhotoModalData({
                        name: student.name,
                        photoUrl: student.photoUrl,
                        rollNumber: student.rollNumber,
                        className: targetClasses[0] || undefined,
                      })}
                    />
                </div>
                <div className="lg:flex-1">
                    <SeatingGrid
                        placements={placements}
                        moveStudent={moveStudentOrGroup}
                        gridDimensions={gridDimensions}
                        unavailableCells={unavailableCells}
                        selectedStudentIds={selectedStudentIds}
                        onStudentClick={handleStudentClick}
                        onDeleteStudent={handleDeleteStudent}
                        onToggleCellAvailability={handleToggleCellAvailability}
                        onClearSelection={clearSelection}
                        groups={groups}
                        cellObstacles={cellObstacles}
                        onConfigureObstacle={handleConfigureObstacle}
                        onShowPhoto={(student) => setPlannerPhotoModalData({
                          name: student.name,
                          photoUrl: student.photoUrl,
                          rollNumber: student.rollNumber,
                          className: targetClasses[0] || undefined,
                        })}
                        activeObstacleTool={activeObstacleTool}
                        onSelectObstacleTool={setActiveObstacleTool}
                    />
                </div>
            </div>

            {/* Publish & Freeze Management Modal */}
            {isPublishModalOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm overflow-y-auto">
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-2xl max-w-2xl w-full border border-slate-200 dark:border-slate-700 space-y-6 max-h-[90vh] overflow-y-auto">
                  <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-4">
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <span>🚀 Publication & Gestion des Plans (Cloud)</span>
                    </h3>
                    <button
                      onClick={() => setIsPublishModalOpen(false)}
                      className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 font-bold text-lg"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Publish Form */}
                  <div className="bg-indigo-50 dark:bg-indigo-950/40 p-4 rounded-xl border border-indigo-200 dark:border-indigo-800 space-y-4">
                    <h4 className="text-sm font-bold text-indigo-900 dark:text-indigo-200">
                      Publier le plan actuel pour la classe
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div>
                        <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          Nom de l'enseignant
                        </label>
                        <input
                          type="text"
                          value={teacherName}
                          onChange={(e) => setTeacherName(e.target.value)}
                          placeholder="M. Abgrall"
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                        />
                      </div>

                      <div>
                        <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          Nom de la classe
                        </label>
                        <input
                          type="text"
                          value={className}
                          onChange={(e) => setClassName(e.target.value)}
                          placeholder="Ex : 3ème A"
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                        />
                      </div>

                      <div className="sm:col-span-2 space-y-2">
                        <label className="block font-semibold text-slate-700 dark:text-slate-300">
                          📅 Période(s) de publication
                        </label>
                        
                        {/* Quick Presets Dropdown */}
                        <div className="flex flex-wrap gap-2 items-center">
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
                            className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white"
                          >
                            <option value="custom">-- Choisir une période type --</option>
                            {STANDARD_PERIODS.map(sp => (
                              <option key={sp} value={sp}>{sp}</option>
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
                            placeholder="Saisir ou personnaliser la période (ex : Trimestre 1 - 2026)"
                            className="flex-1 min-w-[200px] px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                          />
                        </div>

                        {/* Multi-Period Selection Checkboxes */}
                        <div className="bg-slate-100 dark:bg-slate-800/80 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5 text-[11px]">
                          <span className="font-extrabold text-indigo-900 dark:text-indigo-200 block">
                            🎯 Publier simultanément sur plusieurs périodes :
                          </span>
                          <div className="flex flex-wrap gap-2">
                            {['Trimestre 1', 'Trimestre 2', 'Trimestre 3', 'Période 1', 'Période 2', 'Semestre 1', 'Semestre 2'].map(pOption => {
                              const isChecked = selectedPublishPeriods.includes(pOption);
                              return (
                                <label
                                  key={pOption}
                                  className={`px-2.5 py-1 rounded-lg border cursor-pointer select-none font-bold transition-all flex items-center gap-1.5 ${
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

                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="allow-self-placement-check"
                        checked={allowSelfPlacement}
                        onChange={(e) => setAllowSelfPlacement(e.target.checked)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                      />
                      <label htmlFor="allow-self-placement-check" className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                        Autoriser les élèves à choisir/modifier leur place dans ce plan
                      </label>
                    </div>

                    <button
                      onClick={handleExecutePublish}
                      disabled={isPublishing}
                      className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow transition-all"
                    >
                      {isPublishing ? "Publication en cours..." : "🚀 Publier / Mettre à jour ce plan"}
                    </button>

                    {publishSuccessMsg && (
                      <div className="p-3 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200 text-xs font-bold rounded-lg border border-emerald-300">
                        ✅ {publishSuccessMsg}
                      </div>
                    )}
                  </div>

                  {/* Managed Published Plans Section */}
                  <div className="space-y-3">
                    <h4 className="text-sm font-extrabold text-slate-800 dark:text-white flex items-center justify-between">
                      <span>📋 Plans Publiés dans la Base de Données</span>
                      <span className="text-xs font-normal text-slate-500">
                        {publishedPlansList.length} plan(s) disponible(s)
                      </span>
                    </h4>

                    {publishedPlansList.length === 0 ? (
                      <p className="text-xs text-slate-500 italic">Aucun plan publié pour le moment.</p>
                    ) : (
                      <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                        {publishedPlansList.map((p, pIdx) => (
                          <div
                            key={`pub-plan-card-${p.id}-${pIdx}`}
                            className="bg-slate-50 dark:bg-slate-700/50 p-3.5 rounded-xl border border-slate-200 dark:border-slate-600 space-y-2 text-xs"
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                              <div>
                                <span className="font-extrabold text-slate-900 dark:text-white text-sm">
                                  🏫 Classe {p.className}
                                </span>
                                <span className="ml-2 text-[11px] font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950 px-2 py-0.5 rounded-md border border-indigo-200 dark:border-indigo-800">
                                  📅 {p.period}
                                </span>
                                <span className="ml-1 text-[10px] text-slate-500">
                                  (par {p.teacherName})
                                </span>
                              </div>

                              <div className="flex flex-wrap items-center gap-1.5">
                                {/* Freeze / Unfreeze toggle */}
                                <button
                                  onClick={() => handleToggleFreeze(p.id, !!p.isFrozen)}
                                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                                    p.isFrozen
                                      ? 'bg-amber-600 text-white border-amber-700 hover:bg-amber-700'
                                      : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700 hover:bg-emerald-200'
                                  }`}
                                  title={p.isFrozen ? "Cliquer pour dégeler" : "Cliquer pour figer"}
                                >
                                  {p.isFrozen ? '🔒 Figé' : '🔓 Dégeler'}
                                </button>

                                {/* Duplicate to another Period */}
                                <button
                                  onClick={() => {
                                    setSelectedPlanToDuplicatePeriod(selectedPlanToDuplicatePeriod === p.id ? null : p.id);
                                    setDuplicateTargetPeriodInput('Trimestre 2');
                                  }}
                                  className="px-2.5 py-1 bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200 hover:bg-amber-200 rounded-lg text-[11px] font-bold border border-amber-300 dark:border-amber-700"
                                  title="Dupliquer ce plan vers une autre période (Trimestre 2, 3...)"
                                >
                                  📋 Copier vers Période...
                                </button>

                                {/* Manage Passwords */}
                                <button
                                  onClick={() =>
                                    setSelectedPlanToManagePasswords(
                                      selectedPlanToManagePasswords === p.id ? null : p.id
                                    )
                                  }
                                  className="px-2.5 py-1 bg-slate-200 dark:bg-slate-600 hover:bg-slate-300 text-slate-800 dark:text-slate-100 rounded-lg text-[11px] font-bold"
                                >
                                  🔑 Mots de passe
                                </button>

                                {/* Reassign or Duplicate Class */}
                                <button
                                  onClick={() => {
                                    setSelectedPlanToReassignClass(selectedPlanToReassignClass === p.id ? null : p.id);
                                    setReassignClassInputValue(p.className);
                                  }}
                                  className="px-2.5 py-1 bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200 hover:bg-indigo-200 rounded-lg text-[11px] font-bold border border-indigo-300 dark:border-indigo-700"
                                  title="Affecter à d'autres classes ou modifier la classe attribuée"
                                >
                                  🔄 Réaffecter classe
                                </button>

                                {/* Delete */}
                                <button
                                  onClick={() => handleDeletePlan(p.id)}
                                  className="px-2 py-1 bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 hover:bg-red-200 rounded-lg text-[11px] font-bold"
                                  title="Supprimer le plan"
                                >
                                  🗑️
                                </button>
                              </div>
                            </div>

                            {/* Passwords Management Panel */}
                            {selectedPlanToManagePasswords === p.id && (
                              <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 p-3 rounded-lg space-y-2">
                                <h5 className="font-bold text-[11px] text-slate-700 dark:text-slate-200 uppercase tracking-wider">
                                  🔑 Mots de Passe Élèves ({p.placements.length} élèves)
                                </h5>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                                  {p.placements.map((st, stIdx) => {
                                    const passEntry = p.studentPasswords?.[st.id] || { isDefault: true };
                                    return (
                                      <div
                                        key={`pass-st-${st.id}-${st.name}-${stIdx}`}
                                        className="p-2 bg-slate-50 dark:bg-slate-700 rounded border border-slate-200 dark:border-slate-600 flex items-center justify-between"
                                      >
                                        <div>
                                          <span className="font-bold text-slate-800 dark:text-slate-100 text-xs">
                                            {st.name}
                                          </span>
                                          <span className="block text-[10px] text-slate-500">
                                            {passEntry.isDefault ? 'Par défaut (0000)' : 'Mot de passe modifié'}
                                          </span>
                                        </div>
                                        <button
                                          onClick={() => handleResetPassword(p.id, st.id, st.name)}
                                          className="px-2 py-0.5 bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200 text-[10px] font-bold rounded border border-amber-300"
                                        >
                                          RAZ 0000
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Duplicate Plan to Another Period Drawer */}
                            {selectedPlanToDuplicatePeriod === p.id && (
                              <div className="mt-3 pt-3 border-t border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/60 p-3 rounded-xl space-y-2.5">
                                <h5 className="font-extrabold text-xs text-amber-950 dark:text-amber-100 flex items-center gap-1.5">
                                  <span>📋 Dupliquer le plan de la classe {p.className} vers une autre période</span>
                                </h5>
                                <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                                  <select
                                    value={duplicateTargetPeriodInput}
                                    onChange={(e) => setDuplicateTargetPeriodInput(e.target.value)}
                                    className="px-3 py-1.5 text-xs font-bold rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                                  >
                                    {STANDARD_PERIODS.map(sp => (
                                      <option key={`dup-period-${sp}`} value={sp}>{sp}</option>
                                    ))}
                                  </select>
                                  <input
                                    type="text"
                                    value={duplicateTargetPeriodInput}
                                    onChange={(e) => setDuplicateTargetPeriodInput(e.target.value)}
                                    placeholder="Période cible custom (ex : Trimestre 3)"
                                    className="flex-1 px-3 py-1.5 text-xs font-semibold rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleDuplicateToPeriod(p, duplicateTargetPeriodInput)}
                                    className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-extrabold rounded-lg shadow-2xs shrink-0 cursor-pointer"
                                  >
                                    📋 Dupliquer
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Reassign / Duplicate Class Panel */}
                            {selectedPlanToReassignClass === p.id && (
                              <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 p-3.5 rounded-xl space-y-3 border-2 border-indigo-200 dark:border-indigo-800 shadow-sm">
                                <div className="flex items-center justify-between">
                                  <h5 className="font-extrabold text-xs text-indigo-950 dark:text-indigo-200 uppercase tracking-wider">
                                    🎯 Réaffecter ou Dupliquer ce plan pour une autre classe
                                  </h5>
                                  <span className="text-[11px] text-slate-500">Classe actuelle : <strong>{p.className}</strong></span>
                                </div>

                                <div className="flex flex-col sm:flex-row gap-2">
                                  <input
                                    type="text"
                                    value={reassignClassInputValue}
                                    onChange={(e) => setReassignClassInputValue(e.target.value)}
                                    placeholder="Ex: 3ème B, 4ème A..."
                                    className="flex-1 px-3 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white font-medium"
                                  />
                                  <div className="flex gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => handleReassignDbPlanClass(p.id, reassignClassInputValue)}
                                      disabled={!reassignClassInputValue.trim()}
                                      className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-bold text-xs rounded-xl shadow-xs transition-all whitespace-nowrap"
                                      title="Modifie la classe attribuée et désaffecte ce plan de la classe d'origine"
                                    >
                                      🔄 Changer de classe
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDuplicateDbPlanForClass(p.id, reassignClassInputValue)}
                                      disabled={!reassignClassInputValue.trim()}
                                      className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white font-bold text-xs rounded-xl shadow-xs transition-all whitespace-nowrap"
                                      title="Conserve le plan d'origine et en crée une copie attribuée à la nouvelle classe"
                                    >
                                      ➕ Affecter aussi (Copier)
                                    </button>
                                  </div>
                                </div>

                                {/* Quick presets for reassignment */}
                                <div className="flex flex-wrap gap-1 items-center pt-1">
                                  <span className="text-[10px] font-bold text-slate-500 mr-1">Raccourcis mes classes :</span>
                                  {teacherClasses.map(c => (
                                    <button
                                      key={c}
                                      type="button"
                                      onClick={() => setReassignClassInputValue(c)}
                                      className={`px-2 py-0.5 text-[10px] font-semibold rounded-md border transition-all ${
                                        reassignClassInputValue === c
                                          ? 'bg-indigo-600 text-white border-indigo-700 shadow-xs'
                                          : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600 hover:bg-indigo-50 dark:hover:bg-indigo-950'
                                      }`}
                                    >
                                      {c}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}

                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="pt-3 border-t border-slate-200 dark:border-slate-700 text-right">
                    <button
                      onClick={() => setIsPublishModalOpen(false)}
                      className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl"
                    >
                      Fermer
                    </button>
                  </div>
                </div>
              </div>
            )}

        {/* MODAL: CHARGER UN AUTRE PLAN DE LA BASE DE DONNÉES */}
        {showLoadDbPlanModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4" onClick={() => setShowLoadDbPlanModal(false)}>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 max-w-lg w-full p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                <h3 className="text-lg font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                  <span>📂 Charger un Plan de la Base Firestore</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setShowLoadDbPlanModal(false)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl font-black cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {publishedPlansList.length === 0 ? (
                <div className="p-4 bg-amber-50 dark:bg-amber-950/80 text-amber-800 dark:text-amber-200 text-xs rounded-xl font-medium">
                  Aucun plan enregistré n'a été trouvé dans la base de données.
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    Sélectionnez le plan de classe à charger directement dans l'éditeur interactif :
                  </p>
                  <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                    {publishedPlansList.map((planItem, itemIdx) => (
                      <div
                        key={`load-plan-${planItem.id}-${itemIdx}`}
                        className="p-3 bg-slate-50 dark:bg-slate-900/60 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3 transition-all cursor-pointer"
                        onClick={() => {
                          setGridDimensions(planItem.gridDimensions);
                          setUnavailableCells(new Set(planItem.unavailableCells || []));
                          setTeacherName(planItem.teacherName || teacherName);
                          setPeriodName(planItem.period || periodName);
                          if (planItem.className) {
                            setClassName(planItem.className);
                            setTargetClasses([planItem.className]);
                          }

                          const nextPlacements = new Map<number, StudentPlacement>();
                          const nextStudents: Student[] = [];

                          planItem.placements.forEach((p, idx) => {
                            const stId = p.id || idx + 1;
                            const studentObj: Student = {
                              id: stId,
                              name: p.name,
                              rollNumber: p.rollNumber || `${idx + 1}`,
                              grade: p.grade,
                              groupId: p.groupId,
                              cpsProfile: p.cpsProfile,
                            };
                            nextStudents.push(studentObj);

                            const placementObj: StudentPlacement = {
                              ...studentObj,
                              location: p.location,
                            };
                            nextPlacements.set(stId, placementObj);
                          });

                          setAllStudents(nextStudents);
                          setPlacements(nextPlacements);
                          setShowLoadDbPlanModal(false);
                          setPublishSuccessMsg(`Plan "${planItem.className}" de ${planItem.teacherName} chargé avec succès !`);
                          setTimeout(() => setPublishSuccessMsg(null), 4000);
                        }}
                      >
                        <div>
                          <div className="font-extrabold text-xs text-slate-900 dark:text-white">
                            🏫 {planItem.className} — 👨‍🏫 {planItem.teacherName}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            📅 {planItem.period} • 📐 {planItem.gridDimensions.rows}×{planItem.gridDimensions.cols} • 👥 {planItem.placements.length} élèves
                          </div>
                        </div>
                        <span className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-[11px] rounded-lg shrink-0">
                          Charger
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowLoadDbPlanModal(false)}
                  className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-slate-800 dark:text-slate-200 text-xs font-bold rounded-xl cursor-pointer"
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Obstacle Picker Modal */}
        {obstaclePickerCellId !== null && (
          <ObstaclePickerModal
            isOpen={obstaclePickerCellId !== null}
            cellId={obstaclePickerCellId >= 0 ? obstaclePickerCellId : undefined}
            cellIds={obstaclePickerCellId < 0 ? Array.from(unavailableCells) : undefined}
            currentObstacle={obstaclePickerCellId >= 0 ? cellObstacles[obstaclePickerCellId] : undefined}
            onSelectObstacle={handleSelectObstacleFromModal}
            onSelectObstacleForMultipleCells={handleSelectObstaclesForCells}
            onClose={() => setObstaclePickerCellId(null)}
          />
        )}

        {/* Student Photo Modal in Planner */}
        {plannerPhotoModalData && (
          <StudentPhotoModal
            data={plannerPhotoModalData}
            onClose={() => setPlannerPhotoModalData(null)}
            onDeletePhoto={async (name) => {
              await deleteStudentPhoto(name);
              setAllStudents((prev) => prev.map((s) => (s.name === name ? { ...s, photoUrl: undefined } : s)));
            }}
            onReplacePhoto={async (name, newPhotoUrl) => {
              await saveStudentPhoto(name, newPhotoUrl, targetClasses[0] || undefined);
              setAllStudents((prev) => prev.map((s) => (s.name === name ? { ...s, photoUrl: newPhotoUrl } : s)));
              setPlannerPhotoModalData((prev) => (prev ? { ...prev, photoUrl: newPhotoUrl } : null));
            }}
          />
        )}
        </div>
      );
  }

  return null; // Should not be reached
};

export default ClassroomPlanner;