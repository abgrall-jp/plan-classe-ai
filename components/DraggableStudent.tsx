import React from 'react';
import { useDrag } from 'react-dnd';
import { StudentPlacement, ItemTypes } from '../types';
import { UserIcon } from './icons/UserIcon';
import { TrashIcon } from './icons/TrashIcon';
import { getStudentPhoto } from '../services/photoLibraryService';

interface DraggableStudentProps {
  student: StudentPlacement;
  isSelected?: boolean;
  onDelete?: () => void;
  context?: 'bank' | 'grid';
  groupColor?: string;
  onShowPhoto?: (student: StudentPlacement) => void;
}

const DraggableStudent: React.FC<DraggableStudentProps> = ({
  student,
  isSelected,
  onDelete,
  context = 'bank',
  groupColor,
  onShowPhoto,
}) => {
  const effectivePhotoUrl = getStudentPhoto(student.name, student.photoUrl);
  const effectiveStudent = { ...student, photoUrl: effectivePhotoUrl };

  const [{ isDragging }, drag] = useDrag(() => ({
    type: ItemTypes.STUDENT,
    item: { id: student.id, type: ItemTypes.STUDENT },
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(),
    }),
  }), [student.id]);

  const title = [
    student.name,
    student.grade !== undefined ? `Note: ${student.grade.toFixed(2)}` : null,
    student.cpsProfile?.globalScore !== undefined ? `CPS: ${Math.round(student.cpsProfile.globalScore)}/100` : null,
    student.cpsProfile?.rawCategory ? `Profil CPS: ${student.cpsProfile.rawCategory}` : null,
  ].filter(Boolean).join(' • ');

  const nameParts = student.name.trim().split(/\s+/);
  const firstName = nameParts.shift() || '';
  const lastName = nameParts.join(' ');

  const handlePhotoClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onShowPhoto?.(effectiveStudent);
  };

  if (context === 'grid') {
    const selectionClasses = isSelected ? 'ring-2 ring-indigo-500' : 'shadow-sm';
    return (
      <div
        ref={drag as any}
        title={title}
        style={{ 
          opacity: isDragging ? 0.5 : 1,
          borderLeft: groupColor ? `4px solid ${groupColor}` : undefined
        }}
        className={`w-full h-full group bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-md cursor-grab active:cursor-grabbing flex flex-col items-center justify-center text-center transition-all duration-150 relative ${selectionClasses}`}
      >
        <div className="flex-1 flex flex-row items-center justify-center min-h-0 w-full p-0.5 gap-1">
          {effectivePhotoUrl && (
            <div
              onClick={handlePhotoClick}
              className="w-6 h-7 sm:w-7 sm:h-8 rounded overflow-hidden border border-slate-400 dark:border-slate-500 bg-slate-200 dark:bg-slate-800 shrink-0 cursor-pointer hover:scale-115 transition-transform shadow-2xs"
              title="Cliquer pour voir la photo en grand"
            >
              <img
                src={effectivePhotoUrl}
                alt={student.name}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>
          )}
          <div className="flex-1 flex flex-col items-center justify-center min-w-0">
            {student.rollNumber && (
              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 select-none leading-none">
                #{student.rollNumber}
              </span>
            )}
            <div
              onClick={handlePhotoClick}
              className="text-xs font-semibold text-slate-800 dark:text-slate-200 leading-tight px-0.5 cursor-pointer hover:underline hover:text-indigo-600 dark:hover:text-indigo-400 truncate w-full"
              title="Cliquer sur le nom pour agrandir la photo"
            >
              <div className="truncate w-full">{firstName}</div>
              {lastName && <div className="truncate w-full text-[11px] font-normal">{lastName}</div>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 mt-auto mb-0.5 flex-shrink-0">
          {student.grade !== undefined && (
              <span className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-900/50 px-1 py-0.2 rounded-full">
                  {student.grade.toFixed(1)}
              </span>
          )}
          {student.cpsProfile?.globalScore !== undefined && (
              <span
                title={`Score CPS: ${Math.round(student.cpsProfile.globalScore)}/100${student.cpsProfile.rawCategory ? ` (${student.cpsProfile.rawCategory})` : ''}`}
                className="text-[9px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/60 px-1 py-0.2 rounded-full flex items-center gap-0.5"
              >
                  CPS {Math.round(student.cpsProfile.globalScore)}
              </span>
          )}
        </div>
        {onDelete && (
         <button
           onClick={(e) => { e.stopPropagation(); e.preventDefault(); onDelete?.(); }}
           className="absolute top-0 right-0 m-0.5 text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400 p-0.5 rounded-full transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 bg-white/50 dark:bg-slate-800/50"
           aria-label={`Supprimer ${student.name}`}
         >
           <TrashIcon className="h-3 w-3" />
         </button>
       )}
      </div>
    );
  }

  // Bank context
  const selectionClasses = isSelected ? 'ring-2 ring-offset-2 dark:ring-offset-slate-800 ring-indigo-500 shadow-lg' : 'shadow-sm';
  return (
    <div
      ref={drag as any}
      title={title}
      style={{ 
        opacity: isDragging ? 0.5 : 1,
        borderLeft: groupColor ? `4px solid ${groupColor}` : undefined,
      }}
      className={`w-full group p-2 py-1 ${groupColor ? 'pl-1' : ''} bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-md cursor-grab active:cursor-grabbing flex items-center gap-2 transition-all duration-150 ${selectionClasses}`}
    >
       <div
         onClick={handlePhotoClick}
         className="flex-shrink-0 w-7 h-8 rounded overflow-hidden bg-slate-200 dark:bg-slate-600 flex items-center justify-center cursor-pointer hover:scale-110 transition-transform shadow-2xs border border-slate-300 dark:border-slate-500"
         title="Cliquer pour voir la photo"
       >
         {effectivePhotoUrl ? (
           <img
             src={effectivePhotoUrl}
             alt={student.name}
             className="w-full h-full object-cover"
             referrerPolicy="no-referrer"
           />
         ) : student.rollNumber ? (
           <span className="text-xs font-bold text-slate-600 dark:text-slate-300 select-none">{student.rollNumber}</span>
         ) : (
           <UserIcon className="h-4 w-4 text-slate-600 dark:text-slate-300"/>
         )}
       </div>
      <div
        onClick={handlePhotoClick}
        className="flex-grow text-sm font-medium text-slate-800 dark:text-slate-200 overflow-hidden cursor-pointer hover:underline"
        title="Cliquer pour agrandir la photo de l'élève"
      >
        <div className="truncate">{firstName}</div>
        {lastName && <div className="truncate text-xs text-slate-500 dark:text-slate-400">{lastName}</div>}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {student.grade !== undefined && (
            <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-900/50 px-1.5 py-0.5 rounded-full">
              {student.grade.toFixed(1)}
            </span>
        )}
        {student.cpsProfile?.globalScore !== undefined && (
            <span
              title={`Score CPS: ${Math.round(student.cpsProfile.globalScore)}/100${student.cpsProfile.rawCategory ? ` (${student.cpsProfile.rawCategory})` : ''}`}
              className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/60 px-1.5 py-0.5 rounded-full"
            >
              CPS {Math.round(student.cpsProfile.globalScore)}
            </span>
        )}
      </div>
       {onDelete && (
         <button
           onClick={(e) => {
             e.stopPropagation();
             e.preventDefault(); // Prevent cell click event
             onDelete();
           }}
           className="flex-shrink-0 text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400 p-1 rounded-full transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
           aria-label={`Supprimer ${student.name}`}
         >
           <TrashIcon className="h-4 w-4" />
         </button>
       )}
    </div>
  );
};

export default DraggableStudent;