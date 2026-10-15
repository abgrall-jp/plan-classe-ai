import React, { useState } from 'react';
import { useDrop } from 'react-dnd';
import { StudentPlacement, ItemTypes, DragItem, StudentLocation, Group } from '../types';
import DraggableStudent from './DraggableStudent';
import { PlusIcon } from './icons/PlusIcon';

interface StudentBankProps {
  students: StudentPlacement[];
  moveStudent: (id: number, location: StudentLocation) => void;
  onDeleteStudent: (id: number) => void;
  onAddStudent: (name: string) => void;
  groups: Group[];
  onShowPhoto?: (student: StudentPlacement) => void;
}

const StudentBank: React.FC<StudentBankProps> = ({ students, moveStudent, onDeleteStudent, onAddStudent, groups, onShowPhoto }) => {
  const [newStudentName, setNewStudentName] = useState('');

  const [{ isOver }, drop] = useDrop(() => ({
    accept: ItemTypes.STUDENT,
    drop: (item: DragItem) => moveStudent(item.id, 'bank'),
    collect: (monitor) => ({
      isOver: !!monitor.isOver(),
    }),
  }), [moveStudent]);

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newStudentName.trim()) {
      onAddStudent(newStudentName.trim());
      setNewStudentName('');
    }
  };

  const groupColorMap = new Map(groups.map(g => [g.id, g.color]));

  return (
    <div
      ref={drop as any}
      className={`bg-white dark:bg-slate-800 p-4 rounded-lg shadow-md h-full transition-colors duration-200 flex flex-col ${isOver ? 'bg-indigo-50 dark:bg-indigo-900/50' : ''}`}
    >
      <h3 className="text-lg font-semibold mb-4 border-b border-slate-200 dark:border-slate-700 pb-2">
        Liste d'élèves ({students.length})
      </h3>
      <div className="space-y-2 min-h-[100px] flex-grow">
        {students.length > 0 ? (
          students.map((student, idx) => {
            const groupColor = student.groupId ? groupColorMap.get(student.groupId) : undefined;
            return (
              <DraggableStudent 
                key={`bank-st-${student.id}-${student.name}-${idx}`} 
                student={student} 
                onDelete={() => onDeleteStudent(student.id)}
                context="bank"
                groupColor={groupColor}
                onShowPhoto={onShowPhoto}
              />
            )
          })
        ) : (
          <div className="text-slate-500 dark:text-slate-400 text-sm p-4 text-center h-full flex items-center justify-center">
            <p>Tous les élèves sont placés !</p>
          </div>
        )}
      </div>
       <form onSubmit={handleAddSubmit} className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 flex gap-2">
        <input
          type="text"
          value={newStudentName}
          onChange={(e) => setNewStudentName(e.target.value)}
          placeholder="Ajouter un élève..."
          className="flex-grow w-full p-2 border border-slate-300 dark:border-slate-600 rounded-md bg-slate-50 dark:bg-slate-700/50 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition duration-150 ease-in-out text-sm"
        />
        <button
          type="submit"
          disabled={!newStudentName.trim()}
          className="flex-shrink-0 px-3 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-indigo-400 disabled:cursor-not-allowed flex items-center justify-center"
          aria-label="Ajouter l'élève"
        >
          <PlusIcon className="h-5 w-5" />
        </button>
      </form>
    </div>
  );
};

export default StudentBank;