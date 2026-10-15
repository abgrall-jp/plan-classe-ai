import React from 'react';
import { UserIcon } from './icons/UserIcon';
import { GridIcon } from './icons/GridIcon';
import { AppLogo } from './AppLogo';
import { RgpdLogo } from './RgpdLogo';

interface RoleSelectionHomeProps {
  onSelectRole: (role: 'student' | 'teacher' | 'parent') => void;
  onOpenRgpd?: () => void;
}

export const RoleSelectionHome: React.FC<RoleSelectionHomeProps> = ({
  onSelectRole,
  onOpenRgpd,
}) => {
  return (
    <div className="max-w-5xl mx-auto py-8 px-4 sm:px-6 space-y-10">
      {/* Hero Welcome Header with Official AppLogo */}
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <div className="flex justify-center mb-2">
          <AppLogo size="xl" showText={false} />
        </div>

        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-500/10 text-indigo-400 text-xs font-bold uppercase tracking-wider border border-indigo-500/30 backdrop-blur-md shadow-sm">
          <GridIcon className="h-4 w-4 text-indigo-400" />
          <span>Plateforme de Plan de Classe Intelligente & Pédagogique</span>
        </div>

        <h1 className="text-3xl sm:text-5xl font-extrabold text-slate-900 dark:text-white tracking-tight">
          Bienvenue sur <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">Plan de Classe IA</span>
        </h1>

        <p className="text-base text-slate-600 dark:text-slate-400 max-w-2xl mx-auto leading-relaxed">
          La solution ergonomique et intelligente pour concevoir vos plans de classe, optimiser les apprentissages et partager les dispositions avec vos élèves et parents.
        </p>
      </div>

      {/* 3 Role Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* CARD 1: ÉLÈVE */}
        <div
          onClick={() => onSelectRole('student')}
          className="group relative bg-white dark:bg-[#111827]/90 rounded-2xl p-6 shadow-md hover:shadow-2xl border border-slate-200 dark:border-slate-800 hover:border-emerald-500/60 dark:hover:border-emerald-500/60 transition-all duration-300 cursor-pointer flex flex-col justify-between backdrop-blur-sm"
        >
          <div className="space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center text-2xl font-bold shadow-inner group-hover:scale-110 transition-transform">
              🎓
            </div>
            <div>
              <span className="inline-block px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[11px] font-bold uppercase tracking-wider mb-2">
                Accès Élève
              </span>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white group-hover:text-emerald-400 transition-colors">
                Espace Élève
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                Sélectionnez votre enseignant, votre classe et votre nom. Saisissez votre mot de passe (par défaut <code className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded font-mono font-bold text-emerald-400 border border-slate-200 dark:border-slate-700">0000</code>) pour visualiser votre place ou vous installer en classe.
              </p>
            </div>
          </div>

          <div className="pt-6 mt-4 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs font-bold text-emerald-600 dark:text-emerald-400">
            <span>Accéder à mon plan</span>
            <span className="text-lg group-hover:translate-x-1 transition-transform">&rarr;</span>
          </div>
        </div>

        {/* CARD 2: PROFESSEUR */}
        <div
          onClick={() => onSelectRole('teacher')}
          className="group relative bg-white dark:bg-[#111827]/90 rounded-2xl p-6 shadow-md hover:shadow-2xl border border-slate-200 dark:border-slate-800 hover:border-indigo-500/60 dark:hover:border-indigo-500/60 transition-all duration-300 cursor-pointer flex flex-col justify-between backdrop-blur-sm"
        >
          <div className="space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center text-2xl font-bold shadow-inner group-hover:scale-110 transition-transform">
              👨‍🏫
            </div>
            <div>
              <span className="inline-block px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 text-[11px] font-bold uppercase tracking-wider mb-2">
                Espace Enseignant
              </span>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white group-hover:text-indigo-400 transition-colors">
                Espace Professeur
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                Importez vos listes, configurez la salle, optimisez les groupes par l'IA CPS, publiez les plans et figez/dégelez les places à la fin de chaque période.
              </p>
            </div>
          </div>

          <div className="pt-6 mt-4 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs font-bold text-indigo-600 dark:text-indigo-400">
            <span>Configurer mes classes</span>
            <span className="text-lg group-hover:translate-x-1 transition-transform">&rarr;</span>
          </div>
        </div>

        {/* CARD 3: PARENT */}
        <div
          onClick={() => onSelectRole('parent')}
          className="group relative bg-white dark:bg-[#111827]/90 rounded-2xl p-6 shadow-md hover:shadow-2xl border border-slate-200 dark:border-slate-800 hover:border-amber-500/60 dark:hover:border-amber-500/60 transition-all duration-300 cursor-pointer flex flex-col justify-between backdrop-blur-sm"
        >
          <div className="space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center text-2xl font-bold shadow-inner group-hover:scale-110 transition-transform">
              👨‍👩‍👧
            </div>
            <div>
              <span className="inline-block px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 text-[11px] font-bold uppercase tracking-wider mb-2">
                Accès Parents
              </span>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white group-hover:text-amber-400 transition-colors">
                Espace Parent
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                Sélectionnez l'enseignant, la classe et le nom de votre enfant. Authentifiez-vous pour consulter exclusivement le placement de votre enfant en classe.
              </p>
            </div>
          </div>

          <div className="pt-6 mt-4 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs font-bold text-amber-600 dark:text-amber-400">
            <span>Consulter le placement</span>
            <span className="text-lg group-hover:translate-x-1 transition-transform">&rarr;</span>
          </div>
        </div>

      </div>

      {/* Official RGPD & Security Compliance Section */}
      <div className="space-y-3">
        <RgpdLogo
          variant="full"
          onClick={onOpenRgpd}
          className="cursor-pointer"
        />

        {/* Security Note */}
        <div className="bg-white dark:bg-[#111827]/60 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="text-base">🔒</span>
            <span>
              <strong>Sécurité & Confidentialité :</strong> Les mots de passe élèves/parents sont initialisés à <code className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded font-mono font-bold text-indigo-400 border border-slate-200 dark:border-slate-700">0000</code> et doivent être personnalisés dès la première connexion. Aucune donnée n'est cédée à des tiers.
            </span>
          </div>

          {onOpenRgpd && (
            <button
              type="button"
              onClick={onOpenRgpd}
              className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline shrink-0 flex items-center gap-1 cursor-pointer"
            >
              <span>En savoir plus sur le RGPD</span>
              <span>&rarr;</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
