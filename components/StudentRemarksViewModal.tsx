import React from 'react';
import { StudentPlacement, PublishedPlan } from '../types';
import { getStudentPhoto } from '../services/photoLibraryService';
import { getStudentRemarks } from '../services/planSharingService';

interface StudentRemarksViewModalProps {
  student: StudentPlacement | { name: string; id?: number; photoUrl?: string; rollNumber?: string; location?: number | 'bank' };
  plan: PublishedPlan;
  onClose: () => void;
}

export const StudentRemarksViewModal: React.FC<StudentRemarksViewModalProps> = ({
  student,
  plan,
  onClose,
}) => {
  const remarks = getStudentRemarks(plan, student.name, student.id);
  const photo = getStudentPhoto(student.name, student.photoUrl);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-white rounded-3xl p-5 sm:p-6 max-w-xl w-full shadow-2xl space-y-5 my-auto max-h-[90vh] flex flex-col animate-scaleUp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Photo & Student details */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4 shrink-0">
          <div className="flex items-center gap-3.5">
            <div className="w-16 h-20 sm:w-18 sm:h-22 rounded-2xl overflow-hidden border-2 border-emerald-500 bg-slate-100 dark:bg-slate-800 shrink-0 shadow-md">
              {photo ? (
                <img
                  src={photo}
                  alt={student.name}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-3xl text-slate-400">
                  👤
                </div>
              )}
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="px-2.5 py-0.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 font-extrabold text-[11px] rounded-lg border border-emerald-300 dark:border-emerald-700">
                  🏫 {plan.className}
                </span>
                <span className="px-2.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-[11px] rounded-lg border border-slate-300 dark:border-slate-700">
                  📅 {plan.period}
                </span>
              </div>

              <h3 className="text-xl font-black text-slate-900 dark:text-white">
                {student.name}
              </h3>

              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                {student.rollNumber && <span>N°{student.rollNumber}</span>}
                {typeof student.location === 'number' && (
                  <span>• Table #{student.location + 1}</span>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title="Fermer"
          >
            ✕
          </button>
        </div>

        {/* Title & Badge */}
        <div className="flex items-center justify-between shrink-0 bg-emerald-50 dark:bg-emerald-950/40 p-3 rounded-2xl border border-emerald-200 dark:border-emerald-900/60">
          <div className="flex items-center gap-2">
            <span className="text-lg">📝</span>
            <div>
              <h4 className="text-xs sm:text-sm font-extrabold text-emerald-900 dark:text-emerald-200">
                Remarques et indications de l'enseignant
              </h4>
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                Consignes et observations sur cette période de cours
              </p>
            </div>
          </div>
          <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-200 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-200 rounded-full">
            Lecture seule
          </span>
        </div>

        {/* Remarks list (Read-Only) */}
        <div className="overflow-y-auto pr-1 space-y-3 flex-1">
          {remarks.length === 0 ? (
            <div className="p-6 text-center space-y-2 bg-slate-50 dark:bg-slate-950/50 rounded-2xl border border-slate-200 dark:border-slate-800">
              <span className="text-3xl">✨</span>
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                Aucune remarque particulière pour le moment
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                Ton enseignant n'a pas encore ajouté d'indication spécifique sur ce plan de classe. Continue ton travail avec sérieux !
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {remarks.map((rem, idx) => (
                <div
                  key={`student-rem-${rem.id || idx}`}
                  className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#161F30] shadow-xs space-y-2.5"
                >
                  <div className="flex items-center justify-between flex-wrap gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 font-extrabold text-xs rounded-md">
                        📅 {rem.date}
                      </span>
                      {rem.sessionNumber && (
                        <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-bold text-[11px] rounded-md border border-amber-200 dark:border-amber-800/60">
                          🔢 {rem.sessionNumber}
                        </span>
                      )}
                      {rem.sequenceNumber && (
                        <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-300 font-bold text-[11px] rounded-md border border-indigo-200 dark:border-indigo-800/60">
                          📚 {rem.sequenceNumber}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                      🧑‍🏫 {rem.teacherName || plan.teacherName}
                    </span>
                  </div>

                  {/* The remark text */}
                  <div className="text-xs text-slate-800 dark:text-slate-100 font-medium leading-relaxed whitespace-pre-wrap p-2.5 bg-slate-50 dark:bg-slate-900/80 rounded-xl border border-slate-100 dark:border-slate-800">
                    {rem.text}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-800 shrink-0">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {remarks.length} remarque{remarks.length > 1 ? 's' : ''} enregistrée{remarks.length > 1 ? 's' : ''}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs cursor-pointer transition-colors"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
