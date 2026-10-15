import React, { useState } from 'react';
import { StudentPlacement, StudentPeriodRemark, PublishedPlan } from '../types';
import { getStudentPhoto } from '../services/photoLibraryService';
import { saveStudentRemark, deleteStudentRemark, getStudentRemarks } from '../services/planSharingService';

interface TeacherStudentRemarksModalProps {
  student: StudentPlacement;
  plan: PublishedPlan;
  currentTeacherName?: string;
  onClose: () => void;
  onPlanUpdated?: (updatedPlan: PublishedPlan) => void;
}

export const TeacherStudentRemarksModal: React.FC<TeacherStudentRemarksModalProps> = ({
  student,
  plan,
  currentTeacherName = 'Enseignant',
  onClose,
  onPlanUpdated,
}) => {
  // Current remarks for this student
  const remarks = getStudentRemarks(plan, student.name, student.id);

  // Form state for adding / editing a remark
  const todayStr = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState<string>(todayStr);
  const [sessionNumber, setSessionNumber] = useState<string>('');
  const [sequenceNumber, setSequenceNumber] = useState<string>('');
  const [remarkText, setRemarkText] = useState<string>('');
  const [editingRemarkId, setEditingRemarkId] = useState<string | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const studentPhoto = getStudentPhoto(student.name, student.photoUrl);

  const handleStartEdit = (rem: StudentPeriodRemark) => {
    setEditingRemarkId(rem.id);
    setDate(rem.date || todayStr);
    setSessionNumber(rem.sessionNumber || '');
    setSequenceNumber(rem.sequenceNumber || '');
    setRemarkText(rem.text || '');
  };

  const handleCancelEdit = () => {
    setEditingRemarkId(null);
    setDate(todayStr);
    setSessionNumber('');
    setSequenceNumber('');
    setRemarkText('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!remarkText.trim()) {
      setStatusMsg({ text: 'Veuillez saisir le texte de la remarque.', type: 'error' });
      return;
    }

    setIsSaving(true);
    setStatusMsg(null);

    try {
      const res = await saveStudentRemark(
        plan.id,
        student.name,
        student.id,
        {
          date: date || todayStr,
          sessionNumber: sessionNumber.trim() || undefined,
          sequenceNumber: sequenceNumber.trim() || undefined,
          text: remarkText.trim(),
          teacherName: currentTeacherName || plan.teacherName,
        },
        editingRemarkId || undefined
      );

      if (res.success && res.plan) {
        if (onPlanUpdated) onPlanUpdated(res.plan);
        setStatusMsg({
          text: editingRemarkId ? '✅ Remarque modifiée et synchronisée !' : '✅ Nouvelle remarque enregistrée !',
          type: 'success',
        });
        handleCancelEdit();
      } else {
        setStatusMsg({ text: res.message || "Erreur lors de l'enregistrement.", type: 'error' });
      }
    } catch (err) {
      console.error('Error saving remark:', err);
      setStatusMsg({ text: 'Erreur lors de la sauvegarde.', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (remarkId: string) => {
    if (!window.confirm('Voulez-vous vraiment supprimer cette remarque ?')) return;

    try {
      const res = await deleteStudentRemark(plan.id, student.name, student.id, remarkId);
      if (res.success && res.plan) {
        if (onPlanUpdated) onPlanUpdated(res.plan);
        setStatusMsg({ text: '🗑️ Remarque supprimée.', type: 'success' });
        if (editingRemarkId === remarkId) {
          handleCancelEdit();
        }
      }
    } catch (err) {
      console.error('Error deleting remark:', err);
    }
  };

  const quickTemplates = [
    '⭐ Très bonne participation et implication active.',
    '💡 Travail autonome et soigné, excellents résultats.',
    '🤝 Bonne entraide et coopération avec ses pairs.',
    '🎯 Consignes et objectifs de la séance bien acquis.',
    '⚠️ Attention aux bavardages et à la concentration.',
    '🔍 Des difficultés sur l\'exercice, prévoir un soutien ou étayage.',
  ];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border-2 border-indigo-500 text-white rounded-3xl p-5 sm:p-6 max-w-2xl w-full shadow-2xl space-y-5 my-auto max-h-[92vh] flex flex-col animate-scaleUp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Student Photo & Summary */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4 shrink-0">
          <div className="flex items-center gap-4">
            {/* Student Photo */}
            <div className="relative w-16 h-20 sm:w-20 sm:h-24 rounded-2xl overflow-hidden border-2 border-indigo-400 bg-slate-800 shrink-0 shadow-md">
              {studentPhoto ? (
                <img
                  src={studentPhoto}
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
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2.5 py-0.5 bg-indigo-950 text-indigo-300 font-extrabold text-[11px] rounded-lg border border-indigo-700">
                  🏫 {plan.className}
                </span>
                <span className="px-2.5 py-0.5 bg-slate-800 text-slate-300 font-bold text-[11px] rounded-lg border border-slate-700">
                  📅 {plan.period}
                </span>
                <span className="px-2.5 py-0.5 bg-amber-500/20 text-amber-300 font-bold text-[11px] rounded-lg border border-amber-500/40">
                  {typeof student.location === 'number' ? `🪑 Table #${student.location + 1}` : '📥 En réserve'}
                </span>
              </div>

              <h3 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                {student.name}
              </h3>

              {student.rollNumber && (
                <p className="text-xs text-slate-400 font-mono">
                  Identifiant : N°{student.rollNumber}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
            title="Fermer"
          >
            ✕
          </button>
        </div>

        {/* Status Toast */}
        {statusMsg && (
          <div
            className={`p-3 rounded-xl text-xs font-bold flex items-center justify-between shrink-0 ${
              statusMsg.type === 'error'
                ? 'bg-rose-950/80 border border-rose-600 text-rose-200'
                : 'bg-emerald-950/80 border border-emerald-500 text-emerald-200'
            }`}
          >
            <span>{statusMsg.text}</span>
            <button
              type="button"
              onClick={() => setStatusMsg(null)}
              className="text-white/70 hover:text-white ml-2 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* Scrollable Body: Form under photo & Remarks History */}
        <div className="overflow-y-auto pr-1 space-y-5 flex-1">
          
          {/* Saisie / Édition de Remarque */}
          <form
            onSubmit={handleSave}
            className="p-4 bg-slate-950/70 border border-indigo-500/40 rounded-2xl space-y-3.5 shadow-inner"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">✍️</span>
                <h4 className="text-xs sm:text-sm font-extrabold text-indigo-200 uppercase tracking-wider">
                  {editingRemarkId ? 'Modifier la remarque' : 'Ajouter une remarque / consigne de séance'}
                </h4>
              </div>
              {editingRemarkId && (
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="text-[11px] font-bold text-slate-400 hover:text-amber-300 underline cursor-pointer"
                >
                  Annuler la modification
                </button>
              )}
            </div>

            {/* Fields: Date, Séance, Séquence */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {/* Date */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1">
                  <span>📅 Date :</span>
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                  className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-xs font-bold text-white focus:outline-none focus:border-indigo-400"
                />
              </div>

              {/* Numéro de séance */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1">
                  <span>🔢 Séance :</span>
                </label>
                <input
                  type="text"
                  placeholder="Ex: Séance 3"
                  value={sessionNumber}
                  onChange={(e) => setSessionNumber(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-400"
                />
              </div>

              {/* Séquence */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1">
                  <span>📚 Séquence :</span>
                </label>
                <input
                  type="text"
                  placeholder="Ex: Séquence 2 (Géométrie)"
                  value={sequenceNumber}
                  onChange={(e) => setSequenceNumber(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-400"
                />
              </div>
            </div>

            {/* Cadre Texte sous la photo pour la remarque */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-300 flex items-center justify-between">
                <span>📝 Remarque & Indications de l'enseignant :</span>
                <span className="text-[10px] text-slate-400">
                  Visible par l'élève dans son espace
                </span>
              </label>
              <textarea
                rows={3}
                value={remarkText}
                onChange={(e) => setRemarkText(e.target.value)}
                placeholder="Saisissez vos observations au fur et à mesure du cours (travail, participation, difficultés, encouragements, consignes particulières...)"
                required
                className="w-full p-3 bg-slate-900 border border-slate-700 focus:border-indigo-400 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none resize-y leading-relaxed"
              />
            </div>

            {/* Quick Templates Chips */}
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Exemples rapides :
              </span>
              <div className="flex flex-wrap gap-1.5">
                {quickTemplates.map((tpl, i) => (
                  <button
                    key={`tpl-${i}`}
                    type="button"
                    onClick={() => setRemarkText(prev => prev ? `${prev} ${tpl}` : tpl)}
                    className="text-[10px] px-2 py-0.5 bg-slate-800 hover:bg-indigo-900/60 text-slate-300 hover:text-white rounded-lg border border-slate-700 transition-colors cursor-pointer text-left"
                  >
                    {tpl}
                  </button>
                ))}
              </div>
            </div>

            {/* Form Actions */}
            <div className="flex items-center justify-between pt-1">
              <div className="text-[10px] text-slate-400 italic">
                Par {currentTeacherName || plan.teacherName}
              </div>
              <div className="flex items-center gap-2">
                {remarkText && (
                  <button
                    type="button"
                    onClick={() => setRemarkText('')}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    Effacer
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-extrabold rounded-xl text-xs shadow-md transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <span>{isSaving ? '⏳ Enregistrement...' : editingRemarkId ? '💾 Mettre à jour' : '💾 Enregistrer la remarque'}</span>
                </button>
              </div>
            </div>
          </form>

          {/* Historique des remarques de la période */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs sm:text-sm font-extrabold text-white flex items-center gap-2">
                <span>📋</span>
                <span>Historique des remarques ({remarks.length})</span>
              </h4>
              <span className="text-[11px] text-slate-400">
                Période : {plan.period}
              </span>
            </div>

            {remarks.length === 0 ? (
              <div className="p-5 text-center text-xs text-slate-400 bg-slate-950/40 rounded-2xl border border-slate-800/80 space-y-1">
                <p className="text-xl">📝</p>
                <p className="font-semibold text-slate-300">Aucune remarque enregistrée pour {student.name} sur cette période.</p>
                <p className="text-[11px] text-slate-500">Utilisez le formulaire ci-dessus pour consigner vos observations de séance.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {remarks.map((rem) => (
                  <div
                    key={`rem-item-${rem.id}`}
                    className={`p-3.5 rounded-2xl border transition-all space-y-2 ${
                      editingRemarkId === rem.id
                        ? 'bg-amber-950/40 border-amber-400/80 shadow-md'
                        : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {/* Top Row: Date, Séance, Séquence, Actions */}
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2.5 py-0.5 bg-indigo-900/60 text-indigo-200 font-extrabold text-xs rounded-md border border-indigo-700/60">
                          📅 {rem.date}
                        </span>
                        {rem.sessionNumber && (
                          <span className="px-2 py-0.5 bg-slate-800 text-amber-300 font-bold text-[11px] rounded-md border border-slate-700">
                            🔢 {rem.sessionNumber}
                          </span>
                        )}
                        {rem.sequenceNumber && (
                          <span className="px-2 py-0.5 bg-slate-800 text-emerald-300 font-bold text-[11px] rounded-md border border-slate-700">
                            📚 {rem.sequenceNumber}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleStartEdit(rem)}
                          className="px-2 py-1 bg-slate-800 hover:bg-indigo-700 text-slate-200 rounded-lg text-[10px] font-bold transition-colors cursor-pointer"
                          title="Modifier"
                        >
                          ✏️ Modifier
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(rem.id)}
                          className="px-2 py-1 bg-slate-800 hover:bg-rose-700 text-rose-300 hover:text-white rounded-lg text-[10px] font-bold transition-colors cursor-pointer"
                          title="Supprimer"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>

                    {/* Text of remark */}
                    <div className="text-xs text-slate-100 font-medium leading-relaxed bg-slate-900/80 p-2.5 rounded-xl border border-slate-800/80 whitespace-pre-wrap">
                      {rem.text}
                    </div>

                    {/* Teacher signature & update stamp */}
                    <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5">
                      <span>🧑‍🏫 Par {rem.teacherName || 'Enseignant'}</span>
                      {rem.updatedAt && rem.updatedAt !== rem.createdAt && (
                        <span className="italic text-slate-500">Modifié</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-800 shrink-0">
          <span className="text-[11px] text-slate-400">
            💡 Synchronisé instantanément avec le plan de classe en direct
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl cursor-pointer"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
