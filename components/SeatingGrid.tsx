

import React from 'react';
import { StudentPlacement, StudentLocation, Group } from '../types';
import GridCell from './GridCell';
import { useSeatingColors } from '../services/seatingColorService';
import { PlanZoomPanContainer } from './PlanZoomPanContainer';

interface SeatingGridProps {
  placements: Map<number, StudentPlacement>;
  moveStudent: (id: number, location: StudentLocation) => void;
  gridDimensions: { rows: number, cols: number };
  unavailableCells: Set<number>;
  selectedStudentIds: Set<number>;
  onStudentClick: (studentId: number, event: React.MouseEvent) => void;
  onDeleteStudent: (studentId: number) => void;
  onToggleCellAvailability: (cellId: number) => void;
  onClearSelection: () => void;
  groups: Group[];
  cellObstacles?: Record<number | string, { icon: string; label: string }>;
  onConfigureObstacle?: (cellId: number) => void;
  onShowPhoto?: (student: StudentPlacement) => void;
  activeObstacleTool?: string | null;
  onSelectObstacleTool?: (toolId: string | null) => void;
}

const QUICK_OBSTACLE_BUTTONS = [
  { id: null, label: 'Mode Normal', icon: '🖱️', desc: 'Déplacer élèves ou cliquer pour bloquer' },
  { id: 'none', label: 'Bloqué', icon: '🚫', desc: 'Place bloquée standard' },
  { id: 'computer', label: 'Ordinateur', icon: '💻', desc: 'Poste informatique / PC élève' },
  { id: 'passage', label: 'Passage', icon: '🚶', desc: 'Couloir ou allée de circulation' },
  { id: 'desk', label: 'Bureau', icon: '🧑‍🏫', desc: 'Bureau enseignant' },
  { id: 'storage', label: 'Armoire', icon: '📦', desc: 'Meuble de rangement' },
  { id: 'window', label: 'Fenêtre', icon: '🪟', desc: 'Côté fenêtre' },
  { id: 'door', label: 'Porte', icon: '🚪', desc: 'Entrée / sortie' },
];

const SeatingGrid: React.FC<SeatingGridProps> = ({ 
  placements, 
  moveStudent, 
  gridDimensions, 
  unavailableCells, 
  selectedStudentIds, 
  onStudentClick, 
  onDeleteStudent,
  onToggleCellAvailability,
  onClearSelection,
  groups,
  cellObstacles,
  onConfigureObstacle,
  onShowPhoto,
  activeObstacleTool = null,
  onSelectObstacleTool,
}) => {
  const { colors } = useSeatingColors();
  const totalCells = gridDimensions.rows * gridDimensions.cols;
  const cells = Array.from({ length: totalCells }, (_, i) => i);
  
  const studentsByLocation = new Map<StudentLocation, StudentPlacement>();
  placements.forEach(p => {
    if(p.location !== 'bank') {
        studentsByLocation.set(p.location, p);
    }
  });

  const availableSeatNumbers = new Map<number, number>();
  let seatCounter = 1;
  for (let i = 0; i < totalCells; i++) {
    if (!unavailableCells.has(i)) {
      availableSeatNumbers.set(i, seatCounter);
      seatCounter++;
    }
  }

  const groupColorMap = new Map(groups.map(g => [g.id, g.color]));

  return (
    <div className="bg-white dark:bg-[#111827]/90 p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 space-y-3">
       <div className="flex flex-wrap justify-between items-center gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
        <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <span>📐</span>
          <span>Plan de classe ({gridDimensions.rows}×{gridDimensions.cols} places)</span>
        </h3>

        {/* Seat Status Frame Legend */}
        <div className="flex items-center gap-3 flex-wrap text-xs">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors.available }} />
            <span className="font-semibold text-slate-700 dark:text-slate-300">Libre</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors.occupied }} />
            <span className="font-semibold text-slate-700 dark:text-slate-300">Occupé</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors.unavailable }} />
            <span className="font-semibold text-slate-700 dark:text-slate-300">Indisponible</span>
          </div>
        </div>

        {/* Obstacle Palette Bar */}
        {onSelectObstacleTool && (
          <div className="w-full flex items-center gap-1.5 flex-wrap p-2 rounded-xl bg-slate-100/80 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mr-1 shrink-0 flex items-center gap-1">
              <span>🛠️</span>
              <span>Outils de place :</span>
            </span>
            {QUICK_OBSTACLE_BUTTONS.map((tool) => {
              const isActive = activeObstacleTool === tool.id;
              return (
                <button
                  key={tool.id ?? 'normal'}
                  type="button"
                  onClick={() => onSelectObstacleTool(tool.id)}
                  title={tool.desc}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold transition-all ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-xs scale-105 ring-2 ring-indigo-400'
                      : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <span className="text-sm">{tool.icon}</span>
                  <span className="hidden sm:inline">{tool.label}</span>
                </button>
              );
            })}
            {onConfigureObstacle && (
              <button
                type="button"
                onClick={() => onConfigureObstacle(-1)}
                className="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-all"
                title="Consulter et choisir parmi toutes les icônes de mobilier et obstacles"
              >
                <span>➕</span>
                <span>Toutes les icônes...</span>
              </button>
            )}
          </div>
        )}

        {groups && groups.length > 0 && (
          <div className="flex items-center gap-x-4 gap-y-2 flex-wrap text-xs w-full pt-1">
            <span className="font-semibold text-slate-700 dark:text-slate-300">Groupes:</span>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {groups.map(group => (
                <div key={group.id} className="flex items-center gap-1.5">
                  <span className="block w-3 h-3 rounded-full" style={{ backgroundColor: group.color }}></span>
                  <span className="text-slate-600 dark:text-slate-400">{group.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Plan Viewport with Zoom and Right-Click Panning */}
      <PlanZoomPanContainer
        helperText="🖱️ Clic droit enfoncé pour déplacer la salle • Boutons de zoom ou 📐 Ajuster pour adapter la taille"
      >
        <div 
          className="grid gap-2 sm:gap-3"
          style={{ 
            gridTemplateColumns: `repeat(${gridDimensions.cols}, minmax(100px, 1fr))`,
            minWidth: `${Math.max(gridDimensions.cols * 110, 300)}px`,
            width: '100%'
          }}
        >
          {cells.map((cellId) => {
            const student = studentsByLocation.get(cellId);
            const seatNumber = availableSeatNumbers.get(cellId);
            const groupColor = student?.groupId ? groupColorMap.get(student.groupId) : undefined;
            return (
              <GridCell
                key={cellId}
                cellId={cellId}
                seatNumber={seatNumber}
                student={student}
                moveStudent={moveStudent}
                isUnavailable={unavailableCells.has(cellId)}
                selectedStudentIds={selectedStudentIds}
                onStudentClick={onStudentClick}
                onDeleteStudent={onDeleteStudent}
                onToggleAvailability={onToggleCellAvailability}
                onClearSelection={onClearSelection}
                groupColor={groupColor}
                cellObstacles={cellObstacles}
                onConfigureObstacle={onConfigureObstacle}
                onShowPhoto={onShowPhoto}
              />
            );
          })}
        </div>
      </PlanZoomPanContainer>
    </div>
  );
};

export default SeatingGrid;