export interface CPSDimensionScore {
  score: number; // 0 - 100
  level?: 'low' | 'medium' | 'high';
}

export interface StudentCPSProfile {
  studentName: string;
  globalScore?: number; // 0 - 100 overall CPS score
  emotionalScore?: number; // Régulation émotionnelle / Gestion du stress
  socialScore?: number; // Compétences relationnelles / Empathie / Coopération
  cognitiveScore?: number; // Résolution de problèmes / Prise de décision / Attention
  rawCategory?: string; // e.g. "Médiateur", "Autonome", "Besoin d'étayage", "Dynamique"
  preferredPartners?: string[]; // Pairs recommandés
  avoidPartners?: string[]; // Pairs à éviter
  notes?: string;
}

export interface CPSAnalysisResult {
  profiles: Map<string, StudentCPSProfile>;
  fileName: string;
  count: number;
}

export interface Student {
  id: number;
  name: string;
  rollNumber?: string;
  photoUrl?: string; // Data URL or remote image URL
  grade?: number;
  groupId?: string;
  cpsProfile?: StudentCPSProfile;
}

export type StudentLocation = 'bank' | number; // 'bank' or a cell ID

export interface StudentPlacement {
  id: number;
  name: string;
  rollNumber?: string;
  photoUrl?: string; // Data URL or remote image URL
  grade?: number;
  groupId?: string;
  cpsProfile?: StudentCPSProfile;
  location: StudentLocation;
}

export const ItemTypes = {
  STUDENT: 'student',
};

export interface DragItem {
  id: number;
  type: string;
}

export interface Group {
  id: string;
  name: string;
  color: string;
}

export interface CellObstacle {
  icon: string; // e.g. "💻", "🚶", "🧑‍🏫", "📦", "🪟", "🚪", "🖨️", "🔬", "🗑️", "🔌"
  label: string; // e.g. "Ordinateur", "Passage", "Bureau", etc.
}

export interface SavedLayout {
  students: Student[];
  placements: [number, StudentPlacement][];
  gridDimensions: { rows: number; cols: number };
  unavailableCells: number[];
  cellObstacles?: Record<number, CellObstacle>;
  groups?: Group[];
}

export interface StudentPeriodRemark {
  id: string;
  studentId?: number;
  studentName: string;
  date: string; // e.g. "2026-09-17"
  sessionNumber?: string; // e.g. "Séance 3" ou "3"
  sequenceNumber?: string; // e.g. "Séquence 2 : Les fonctions"
  text: string; // Remarques, observations, consignes
  teacherName?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface StudentPasswordEntry {
  password?: string;
  isDefault: boolean;
  updatedAt?: string;
}

export interface PublishedPlan {
  id: string;
  teacherName: string;
  teacherId?: string;
  className: string;
  period: string;
  academicYear?: string;
  allowStudentSelfPlacement: boolean;
  isFrozen?: boolean;
  isPast?: boolean;
  isPastPlan?: boolean;
  gridDimensions: { rows: number; cols: number };
  unavailableCells: number[];
  cellObstacles?: Record<string | number, { icon: string; label: string }>;
  placements: StudentPlacement[];
  studentPasswords?: Record<string | number, StudentPasswordEntry>;
  studentRemarks?: Record<string, StudentPeriodRemark[]>; // Key: normalized student name or studentId
  createdAt?: string;
  updatedAt: string;
}

export interface ActivePlan {
  id: string;
  students: Student[];
  initialPlacements?: [number, StudentPlacement][];
  initialGridDimensions?: { rows: number; cols: number };
  initialUnavailableCells?: number[];
  initialCellObstacles?: Record<number, CellObstacle>;
  initialGroups?: Group[];
  selectedClasses?: string[];
  teacherName?: string;
  periodName?: string;
}