import React from 'react';
import { useDrop } from 'react-dnd';
import { StudentPlacement, ItemTypes, DragItem, StudentLocation } from '../types';
import DraggableStudent from './DraggableStudent';
import { useSeatingColors, getSeatBorderStyle } from '../services/seatingColorService';
import { ObstacleRenderer } from './ObstacleRenderer';

interface GridCellProps {
  cellId: number;
  seatNumber?: number;
  student?: StudentPlacement;
  moveStudent: (id: number, location: StudentLocation) => void;
  isUnavailable: boolean;
  selectedStudentIds: Set<number>;
  onStudentClick: (studentId: number, event: React.MouseEvent) => void;
  onDeleteStudent: (studentId: number) => void;
  onToggleAvailability: (cellId: number) => void;
  onClearSelection: () => void;
  groupColor?: string;
  cellObstacles?: Record<number | string, { icon: string; label: string }>;
  onConfigureObstacle?: (cellId: number) => void;
  onShowPhoto?: (student: StudentPlacement) => void;
}

const GridCell: React.FC<GridCellProps> = ({ 
  cellId, 
  seatNumber,
  student, 
  moveStudent, 
  isUnavailable,
  selectedStudentIds, 
  onStudentClick, 
  onDeleteStudent,
  onToggleAvailability,
  onClearSelection,
  groupColor,
  cellObstacles,
  onConfigureObstacle,
  onShowPhoto,
}) => {
  const { colors } = useSeatingColors();

  const [{ isOver, canDrop }, drop] = useDrop(() => ({
    accept: ItemTypes.STUDENT,
    drop: (item: DragItem) => moveStudent(item.id, cellId),
    canDrop: (item: DragItem) => !isUnavailable && student?.id !== item.id,
    collect: (monitor) => ({
      isOver: !!monitor.isOver(),
      canDrop: !!monitor.canDrop(),
    }),
  }), [cellId, student, moveStudent, isUnavailable]);

  const cellStatus: 'available' | 'occupied' | 'unavailable' = isUnavailable
    ? 'unavailable'
    : student
    ? 'occupied'
    : 'available';

  const frameStyle = getSeatBorderStyle(cellStatus, colors);
  const obstacle = cellObstacles ? (cellObstacles[cellId] || cellObstacles[String(cellId)]) : undefined;

  const handleCellClick = (e: React.MouseEvent) => {
    if (student) {
      onStudentClick(student.id, e);
    } else if (isUnavailable && onConfigureObstacle) {
      onConfigureObstacle(cellId);
    } else {
      onToggleAvailability(cellId);
      onClearSelection();
    }
    e.stopPropagation();
  };
  
  const handleDelete = () => {
      if (student) {
          onDeleteStudent(student.id);
      }
  }

  return (
    <div
      ref={drop as any}
      onClick={handleCellClick}
      style={{
        borderColor: isOver && canDrop ? '#818cf8' : frameStyle.borderColor,
        borderWidth: frameStyle.borderWidth,
        borderStyle: frameStyle.borderStyle,
        boxShadow: isOver && canDrop ? '0 0 0 3px rgba(99, 102, 241, 0.4)' : frameStyle.boxShadow,
      }}
      className={`relative aspect-[2/1] rounded-xl flex items-center justify-center p-1 transition-all duration-150 ${
        isUnavailable
          ? 'bg-slate-200/50 dark:bg-slate-900/60'
          : isOver && canDrop
          ? 'bg-indigo-100 dark:bg-indigo-950/80 ring-2 ring-indigo-500'
          : student
          ? 'bg-white dark:bg-[#161F30]'
          : 'bg-white/80 dark:bg-[#0E1524]/70 hover:bg-white dark:hover:bg-[#131D2E]'
      }`}
    >
      {student ? (
        <DraggableStudent 
          student={student} 
          isSelected={selectedStudentIds.has(student.id)}
          onDelete={handleDelete}
          context="grid"
          groupColor={groupColor}
          onShowPhoto={onShowPhoto}
        />
      ) : isUnavailable ? (
        <div 
          className="absolute inset-0 bg-unavailable-pattern rounded-lg flex flex-col items-center justify-center p-1 cursor-pointer hover:bg-slate-300/30 dark:hover:bg-slate-800/40 transition-colors group"
          title={obstacle ? `${obstacle.label} (Cliquer pour changer l'icône)` : "Place indisponible (Cliquer pour choisir une icône ou débloquer)"}
        >
          <ObstacleRenderer
            obstacle={obstacle}
            labelColor={colors.unavailable}
            size="md"
          />
          {onConfigureObstacle && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onConfigureObstacle(cellId);
              }}
              className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-0.5 bg-black/40 hover:bg-black/70 text-white rounded text-[10px] transition-opacity"
              title="Configurer l'icône / dessin SVG"
            >
              ⚙️
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center select-none">
          <span className="text-xs font-bold text-slate-400 dark:text-slate-400 leading-tight">
            #{seatNumber}
          </span>
          <span className="text-[9px] font-bold" style={{ color: colors.available }}>
            Libre
          </span>
        </div>
      )}
    </div>
  );
};

export default GridCell;