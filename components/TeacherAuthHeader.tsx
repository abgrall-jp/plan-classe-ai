import React, { useState, useEffect } from 'react';
import {
  TeacherAccount,
  loginWithGoogle,
  loginWithEmail,
  registerWithEmail,
  logoutTeacher,
  fetchAllTeachersForAdmin,
  setImpersonatedTeacher,
  getImpersonatedTeacher,
  isSuperAdminEmail,
  sendTeacherPasswordReset
} from '../services/teacherAuthService';
import AiCreditsButton from './AiCreditsButton';
import BillingAdminPanel from './BillingAdminPanel';

interface TeacherAuthHeaderProps {
  currentTeacher: TeacherAccount | null;
  onTeacherChange: (teacher: TeacherAccount | null) => void;
  onOpenEditProfile: () => void;
}

export const TeacherAuthHeader: React.FC<TeacherAuthHeaderProps> = ({
  currentTeacher,
  onTeacherChange,
  onOpenEditProfile,
}) => {
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authTab, setAuthTab] = useState<'login' | 'signup'>('login');
  
  // Login Form State
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  
  // Register Form State
  const [regFirstName, setRegFirstName] = useState('');
  const [regLastName, setRegLastName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regDiscipline, setRegDiscipline] = useState('Mathématiques');
  const [regClass, setRegClass] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [showBillingAdmin, setShowBillingAdmin] = useState(false);

  // Super Admin state
  const [allTeachers, setAllTeachers] = useState<TeacherAccount[]>([]);
  const [impersonatedTarget, setImpersonatedTarget] = useState<TeacherAccount | null>(getImpersonatedTeacher());

  const realTeacher = currentTeacher;
  const isSuperAdmin = realTeacher ? (isSuperAdminEmail(realTeacher.email) || realTeacher.role === 'super_admin') : false;

  useEffect(() => {
    if (isSuperAdmin) {
      fetchAllTeachersForAdmin().then(setAllTeachers);
    }
  }, [isSuperAdmin]);

  const handleGoogleAuth = async () => {
    setIsLoading(true);
    setAuthError(null);
    try {
      const account = await loginWithGoogle();
      onTeacherChange(account);
      setShowAuthModal(false);
    } catch (err: any) {
      setAuthError(err.message || 'Erreur de connexion avec Google.');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    setAuthError(null);
    setInfoMessage(null);
    if (!emailInput.trim()) {
      setAuthError("Saisissez d'abord votre adresse e-mail, puis cliquez à nouveau sur « Mot de passe oublié ? ».");
      return;
    }
    setIsLoading(true);
    try {
      await sendTeacherPasswordReset(emailInput);
      setInfoMessage(`Un e-mail pour choisir un nouveau mot de passe a été envoyé à ${emailInput.trim()}. Pensez à regarder dans les indésirables.`);
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput || !passwordInput) return;
    setIsLoading(true);
    setAuthError(null);
    try {
      const account = await loginWithEmail(emailInput, passwordInput);
      onTeacherChange(account);
      setShowAuthModal(false);
    } catch (err: any) {
      setAuthError(err.message || 'Identifiants incorrects.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regEmail || !regPassword || !regLastName) return;
    setIsLoading(true);
    setAuthError(null);
    try {
      const account = await registerWithEmail(
        regEmail,
        regPassword,
        regFirstName,
        regLastName,
        [regDiscipline],
        [regClass]
      );
      onTeacherChange(account);
      setShowAuthModal(false);
    } catch (err: any) {
      setAuthError(err.message || 'Erreur lors de la création du compte.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    await logoutTeacher();
    setImpersonatedTarget(null);
    onTeacherChange(null);
  };

  const handleImpersonateTeacherSelect = (teacherUid: string) => {
    if (!teacherUid) {
      setImpersonatedTeacher(null);
      setImpersonatedTarget(null);
      onTeacherChange(realTeacher);
      return;
    }
    const target = allTeachers.find(t => t.uid === teacherUid);
    if (target) {
      setImpersonatedTeacher(target);
      setImpersonatedTarget(target);
      onTeacherChange(target);
    }
  };

  const handleClearImpersonation = () => {
    setImpersonatedTeacher(null);
    setImpersonatedTarget(null);
    onTeacherChange(realTeacher);
  };

  // State for Admin Teacher Management Modal
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [adminEditingTeacher, setAdminEditingTeacher] = useState<TeacherAccount | null>(null);
  const [showAdminCreateTeacher, setShowAdminCreateTeacher] = useState(false);

  // Admin teacher edit form state
  const [adminEditFirstName, setAdminEditFirstName] = useState('');
  const [adminEditLastName, setAdminEditLastName] = useState('');
  const [adminEditEmail, setAdminEditEmail] = useState('');
  const [adminEditRole, setAdminEditRole] = useState<'teacher' | 'super_admin'>('teacher');
  const [adminEditDisciplines, setAdminEditDisciplines] = useState<string[]>([]);
  const [adminEditClasses, setAdminEditClasses] = useState<string[]>([]);
  const [adminNewDiscipline, setAdminNewDiscipline] = useState('');
  const [adminNewClass, setAdminNewClass] = useState('');

  // Open edit for a specific teacher
  const handleOpenAdminEdit = (teacher: TeacherAccount) => {
    setAdminEditingTeacher(teacher);
    setAdminEditFirstName(teacher.firstName);
    setAdminEditLastName(teacher.lastName);
    setAdminEditEmail(teacher.email);
    setAdminEditRole(teacher.role || 'teacher');
    setAdminEditDisciplines([...teacher.disciplines]);
    setAdminEditClasses([...teacher.classes]);
    setAdminNewDiscipline('');
    setAdminNewClass('');
  };

  // Save changes to a teacher profile from admin modal
  const handleSaveAdminTeacherEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminEditingTeacher) return;

    const updated: TeacherAccount = {
      ...adminEditingTeacher,
      firstName: adminEditFirstName.trim() || 'Professeur',
      lastName: adminEditLastName.trim() || 'Enseignant',
      email: adminEditEmail.trim() || adminEditingTeacher.email,
      role: adminEditRole,
      disciplines: adminEditDisciplines.length > 0 ? adminEditDisciplines : ['Mathématiques'],
      classes: adminEditClasses.length > 0 ? adminEditClasses : ['3ème A'],
      updatedAt: new Date().toISOString(),
    };

    // Save to Firestore & local storage
    const { syncTeacherProfileToFirestore } = await import('../services/teacherAuthService');
    await syncTeacherProfileToFirestore(updated);

    // Refresh teacher list
    const updatedList = allTeachers.map(t => t.uid === updated.uid ? updated : t);
    setAllTeachers(updatedList);

    // If currently impersonating this teacher, update impersonation target
    if (impersonatedTarget && impersonatedTarget.uid === updated.uid) {
      setImpersonatedTarget(updated);
      setImpersonatedTeacher(updated);
      onTeacherChange(updated);
    } else if (currentTeacher && currentTeacher.uid === updated.uid) {
      onTeacherChange(updated);
    }

    setAdminEditingTeacher(null);
  };

  // Admin Create New Teacher
  const [newTeacherFirstName, setNewTeacherFirstName] = useState('');
  const [newTeacherLastName, setNewTeacherLastName] = useState('');
  const [newTeacherEmail, setNewTeacherEmail] = useState('');
  const [newTeacherDiscipline, setNewTeacherDiscipline] = useState('Mathématiques');
  const [newTeacherClass, setNewTeacherClass] = useState('3ème A');

  const handleCreateNewTeacherByAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeacherEmail || !newTeacherLastName) return;

    const newUid = `prof-custom-${Date.now()}`;
    const newAccount: TeacherAccount = {
      uid: newUid,
      email: newTeacherEmail.trim(),
      firstName: newTeacherFirstName.trim() || 'Professeur',
      lastName: newTeacherLastName.trim() || 'Enseignant',
      disciplines: [newTeacherDiscipline.trim() || 'Mathématiques'],
      classes: [newTeacherClass.trim() || '3ème A'],
      role: 'teacher',
      updatedAt: new Date().toISOString(),
    };

    const { syncTeacherProfileToFirestore } = await import('../services/teacherAuthService');
    await syncTeacherProfileToFirestore(newAccount);

    setAllTeachers(prev => [...prev, newAccount]);
    setShowAdminCreateTeacher(false);
    setNewTeacherFirstName('');
    setNewTeacherLastName('');
    setNewTeacherEmail('');
  };

  const activeViewTeacher = impersonatedTarget || currentTeacher;

  return (
    <div className="space-y-3">
      {/* SUPER ADMIN BANNER (If logged in as alimatlea@gmail.com) */}
      {isSuperAdmin && (
        <div className="bg-gradient-to-r from-amber-600 via-purple-700 to-indigo-800 text-white p-4 rounded-2xl shadow-lg border-2 border-amber-300/40 space-y-3 animate-fadeIn">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl bg-white/20 p-2 rounded-xl backdrop-blur-sm">👑</span>
              <div>
                <div className="font-extrabold text-sm tracking-wide flex items-center gap-2">
                  <span>Espace Administrateur Global</span>
                  <span className="bg-amber-300 text-amber-950 text-[10px] uppercase font-black px-2 py-0.5 rounded-full shadow-sm">
                    Accès Total
                  </span>
                </div>
                <div className="text-xs text-amber-100/90 font-medium mt-0.5">
                  Connecté en tant que <span className="font-bold underline text-white">{realTeacher?.email}</span>
                </div>
              </div>
            </div>

            {/* Account Switcher for Super Admin */}
            <div className="flex flex-wrap items-center gap-2 text-xs w-full sm:w-auto">
              <span className="font-bold whitespace-nowrap hidden lg:inline">Accéder aux comptes :</span>
              <select
                value={impersonatedTarget ? impersonatedTarget.uid : ''}
                onChange={(e) => handleImpersonateTeacherSelect(e.target.value)}
                className="px-3 py-2 rounded-xl text-xs font-bold bg-white/90 text-slate-900 border border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-400 cursor-pointer"
              >
                <option value="">-- Mon compte Administrateur Global --</option>
                {allTeachers.map(teacher => (
                  <option key={teacher.uid} value={teacher.uid}>
                    👨‍🏫 {teacher.firstName} {teacher.lastName} ({teacher.email})
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => setShowAdminModal(true)}
                className="px-3 py-2 bg-amber-300 hover:bg-amber-200 text-amber-950 font-black text-xs rounded-xl shadow-md transition-all flex items-center gap-1.5 whitespace-nowrap"
                title="Ouvrir la liste complète des enseignants pour éditer leurs profils"
              >
                <span>👥 Gérer les profils ({allTeachers.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setShowBillingAdmin(true)}
                className="px-3 py-2 bg-white/90 hover:bg-white text-amber-950 font-black text-xs rounded-xl shadow-md transition-all whitespace-nowrap"
                title="Réglages des crédits IA et soldes des enseignants"
              >
                🪙 Crédits IA
              </button>

              {impersonatedTarget && (
                <button
                  type="button"
                  onClick={handleClearImpersonation}
                  className="px-3 py-2 bg-amber-400 hover:bg-amber-300 text-amber-950 font-black text-xs rounded-xl shadow-md transition-all whitespace-nowrap"
                  title="Revenir à mon propre compte"
                >
                  ↩ Revenir
                </button>
              )}
            </div>
          </div>

          {/* Banner message when impersonating */}
          {impersonatedTarget && (
            <div className="p-2.5 bg-black/30 backdrop-blur-md rounded-xl text-xs flex items-center justify-between border border-amber-300/30">
              <div className="flex items-center gap-2 font-medium text-amber-200">
                <span>👁️ Vous êtes en train d'explorer l'espace de :</span>
                <strong className="text-white font-bold">{impersonatedTarget.firstName} {impersonatedTarget.lastName}</strong>
                <span className="text-amber-300">({impersonatedTarget.email})</span>
              </div>
              <span className="text-[11px] text-amber-200/80 italic">Modifications autorisées en tant qu'administrateur</span>
            </div>
          )}
        </div>
      )}

      {/* REGULAR AUTH HEADER BAR */}
      <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl shadow-md border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
        {activeViewTeacher ? (
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-base shadow-sm">
              {activeViewTeacher.photoURL ? (
                <img src={activeViewTeacher.photoURL} alt="Avatar" className="w-full h-full rounded-full object-cover" />
              ) : (
                '👨‍🏫'
              )}
            </div>
            <div>
              <div className="font-extrabold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                <span>{[activeViewTeacher.firstName, activeViewTeacher.lastName].filter(Boolean).join(' ') || activeViewTeacher.email}</span>
                {activeViewTeacher.role === 'super_admin' && (
                  <span className="bg-amber-100 text-amber-800 dark:bg-amber-900/80 dark:text-amber-200 font-bold text-[10px] px-2 py-0.5 rounded-md border border-amber-300 dark:border-amber-700">
                    👑 Admin Global
                  </span>
                )}
              </div>
              <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                <span className="font-semibold text-slate-700 dark:text-slate-300">{activeViewTeacher.email}</span>{activeViewTeacher.disciplines?.length ? <> • {activeViewTeacher.disciplines.join(', ')}</> : null}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-500 flex items-center justify-center text-lg">
              🔑
            </div>
            <div>
              <div className="font-bold text-slate-800 dark:text-slate-200 text-sm">
                Vous n'êtes pas encore connecté à votre compte enseignant.
              </div>
              <p className="text-slate-500 dark:text-slate-400">
                Connectez-vous par Google ou e-mail pour retrouver vos classes et enregistrer vos plans de classe.
              </p>
            </div>
          </div>
        )}

        {/* Header Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 self-end sm:self-center">
          {activeViewTeacher ? (
            <>
              <AiCreditsButton />
              <button
                type="button"
                onClick={onOpenEditProfile}
                className="px-3.5 py-2 bg-indigo-50 dark:bg-indigo-950/80 hover:bg-indigo-100 dark:hover:bg-indigo-900 text-indigo-700 dark:text-indigo-300 font-bold rounded-xl border border-indigo-200 dark:border-indigo-800 transition-all flex items-center gap-1.5"
              >
                <span>✏️ Mon Profil</span>
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="px-3.5 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/80 text-slate-700 dark:text-slate-200 font-bold rounded-xl border border-slate-200 dark:border-slate-600 transition-all flex items-center gap-1.5"
              >
                <span>🚪 Déconnexion</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setShowAuthModal(true)}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl shadow-md transition-all flex items-center gap-2"
            >
              <span>🔑 Se connecter à mon compte enseignant</span>
            </button>
          )}
        </div>
      </div>

      {/* AUTHENTICATION MODAL */}
      {showAuthModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 max-w-md w-full p-6 space-y-5 relative overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAuthModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-2 text-base font-bold rounded-full"
            >
              ✕
            </button>

            <div className="text-center space-y-1">
              <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center text-2xl mx-auto shadow-md">
                👨‍🏫
              </div>
              <h2 className="text-xl font-black text-slate-900 dark:text-white">
                Connexion Espace Enseignant
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Accédez à votre compte, vos classes et vos plans de classe enregistrés.
              </p>
            </div>

            {/* Network Guidance Banner */}
            <div className="p-3 bg-indigo-50/80 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800 rounded-2xl text-[11px] text-indigo-950 dark:text-indigo-200 font-semibold leading-relaxed flex items-start gap-2 shadow-xs">
              <span className="text-base leading-none mt-0.5">🌐</span>
              <div className="space-y-0.5">
                <div className="font-extrabold text-indigo-950 dark:text-indigo-100">
                  Google ne s'ouvre pas sur le réseau de l'établissement ?
                </div>
                <div className="text-slate-600 dark:text-slate-300 font-medium">
                  Utilisez la connexion par <strong>e-mail</strong> ci-dessous. Si vous vous connectez d'habitude avec Google, cliquez sur « Mot de passe oublié ? » une première fois pour choisir un mot de passe.
                </div>
              </div>
            </div>

            {/* Error banner */}
            {authError && (
              <div className="p-3 bg-red-50 dark:bg-red-950/80 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 rounded-xl text-xs font-bold text-center space-y-2">
                <div>⚠️ {authError}</div>
              </div>
            )}
            {infoMessage && (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs font-bold text-center">
                ✉️ {infoMessage}
              </div>
            )}

            {/* GOOGLE SIGN IN BUTTON */}
            <div className="space-y-2">
              <button
                type="button"
                onClick={handleGoogleAuth}
                disabled={isLoading}
                className="w-full py-3 px-4 bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 text-slate-800 dark:text-white font-extrabold text-xs rounded-2xl border-2 border-slate-200 dark:border-slate-600 shadow-sm transition-all flex items-center justify-center gap-3 cursor-pointer"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                </svg>
                <span>Se connecter avec un compte Google</span>
              </button>

              <div className="flex items-center my-3 text-slate-400">
                <div className="flex-1 border-t border-slate-200 dark:border-slate-700"></div>
                <span className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">ou par e-mail</span>
                <div className="flex-1 border-t border-slate-200 dark:border-slate-700"></div>
              </div>
            </div>

            {/* TAB SELECTOR LOGIN / SIGNUP */}
            <div className="flex rounded-xl bg-slate-100 dark:bg-slate-900 p-1 border border-slate-200 dark:border-slate-700 text-xs font-bold">
              <button
                type="button"
                onClick={() => setAuthTab('login')}
                className={`flex-1 py-1.5 rounded-lg transition-all ${
                  authTab === 'login'
                    ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                Connexion E-mail
              </button>
              <button
                type="button"
                onClick={() => setAuthTab('signup')}
                className={`flex-1 py-1.5 rounded-lg transition-all ${
                  authTab === 'signup'
                    ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                Créer un compte
              </button>
            </div>

            {/* EMAIL LOGIN FORM */}
            {authTab === 'login' && (
              <form onSubmit={handleEmailLoginSubmit} className="space-y-3 text-xs">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">E-mail enseignant :</label>
                  <input
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="prof@etablissement.fr"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-white font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Mot de passe :</label>
                  <input
                    type="password"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-white font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-extrabold rounded-2xl shadow-md transition-all cursor-pointer"
                >
                  {isLoading ? 'Connexion en cours...' : 'Se connecter'}
                </button>
                <button
                  type="button"
                  onClick={handlePasswordReset}
                  disabled={isLoading}
                  className="w-full text-center text-indigo-600 dark:text-indigo-400 hover:underline font-semibold cursor-pointer"
                >
                  Mot de passe oublié ?
                </button>
              </form>
            )}

            {/* EMAIL SIGNUP FORM */}
            {authTab === 'signup' && (
              <form onSubmit={handleEmailSignupSubmit} className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Prénom :</label>
                    <input
                      type="text"
                      value={regFirstName}
                      onChange={(e) => setRegFirstName(e.target.value)}
                      placeholder="Mathieu"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                      required
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Nom :</label>
                    <input
                      type="text"
                      value={regLastName}
                      onChange={(e) => setRegLastName(e.target.value)}
                      placeholder="Abgrall"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">E-mail académique / pro :</label>
                  <input
                    type="email"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="m.abgrall@etablissement.fr"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                    required
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Mot de passe :</label>
                  <input
                    type="password"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="Au moins 6 caractères"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                    minLength={6}
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Discipline principale :</label>
                    <input
                      type="text"
                      value={regDiscipline}
                      onChange={(e) => setRegDiscipline(e.target.value)}
                      placeholder="Mathématiques"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Première classe :</label>
                    <input
                      type="text"
                      value={regClass}
                      onChange={(e) => setRegClass(e.target.value)}
                      placeholder="3ème A"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-extrabold rounded-2xl shadow-md transition-all cursor-pointer"
                >
                  {isLoading ? 'Création en cours...' : 'Créer mon compte enseignant'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ADMINISTRATION DES CRÉDITS IA */}
      {showBillingAdmin && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowBillingAdmin(false)}>
          <div className="bg-[#141414] text-gray-100 rounded-3xl shadow-2xl border border-white/10 max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto relative" onClick={e => e.stopPropagation()}>
            <button type="button" onClick={() => setShowBillingAdmin(false)} className="absolute top-4 right-4 text-gray-400 hover:text-white p-2 font-bold" aria-label="Fermer">✕</button>
            <h2 className="text-lg font-black mb-4">🪙 Crédits IA : réglages et soldes</h2>
            <BillingAdminPanel />
          </div>
        </div>
      )}

      {/* SUPER ADMIN GLOBAL TEACHER MANAGEMENT MODAL */}
      {showAdminModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 max-w-3xl w-full p-6 space-y-5 max-h-[90vh] flex flex-col relative overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAdminModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-2 text-base font-bold rounded-full"
            >
              ✕
            </button>

            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-500 text-white flex items-center justify-center text-xl shadow-md">
                  👥
                </div>
                <div>
                  <h2 className="text-lg font-black text-slate-900 dark:text-white">
                    Gestion des Profils Enseignants (Admin Global)
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Modifiez le profil, les matières et les classes de n'importe quel enseignant.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowAdminCreateTeacher(true)}
                className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <span>➕ Ajouter un enseignant</span>
              </button>
            </div>

            {/* TEACHER ACCOUNTS LIST */}
            <div className="overflow-y-auto space-y-3 pr-1 flex-1">
              {allTeachers.map((teacher) => (
                <div
                  key={teacher.uid}
                  className={`p-4 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    activeViewTeacher?.uid === teacher.uid
                      ? 'bg-amber-50/80 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700'
                      : 'bg-slate-50 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-base shrink-0 shadow-sm">
                      {teacher.photoURL ? (
                        <img src={teacher.photoURL} alt="Avatar" className="w-full h-full rounded-full object-cover" />
                      ) : (
                        '👨‍🏫'
                      )}
                    </div>
                    <div className="space-y-1">
                      <div className="font-extrabold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                        <span>M. {teacher.lastName} ({teacher.firstName})</span>
                        {teacher.role === 'super_admin' ? (
                          <span className="bg-amber-100 text-amber-900 dark:bg-amber-900/80 dark:text-amber-200 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-300">
                            👑 Admin Global
                          </span>
                        ) : (
                          <span className="bg-indigo-100 text-indigo-800 dark:bg-indigo-900/80 dark:text-indigo-200 text-[10px] font-bold px-2 py-0.5 rounded-full border border-indigo-200">
                            👨‍🏫 Enseignant
                          </span>
                        )}
                        {activeViewTeacher?.uid === teacher.uid && (
                          <span className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-300">
                            👁️ Actif
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-400">
                        E-mail : <strong className="text-slate-800 dark:text-slate-200">{teacher.email}</strong>
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap gap-1 items-center">
                        <span className="font-semibold">Matières :</span>
                        {teacher.disciplines.map(d => (
                          <span key={d} className="bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-1.5 py-0.5 rounded text-[10px] font-medium">
                            {d}
                          </span>
                        ))}
                        <span className="ml-2 font-semibold">Classes :</span>
                        {teacher.classes.map(c => (
                          <span key={c} className="bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 px-1.5 py-0.5 rounded text-[10px] font-bold">
                            {c}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Actions for this teacher */}
                  <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                    <button
                      type="button"
                      onClick={() => handleOpenAdminEdit(teacher)}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl shadow transition-all flex items-center gap-1 cursor-pointer"
                    >
                      <span>✏️ Éditer le profil</span>
                    </button>

                    {activeViewTeacher?.uid !== teacher.uid && (
                      <button
                        type="button"
                        onClick={() => {
                          handleImpersonateTeacherSelect(teacher.uid);
                          setShowAdminModal(false);
                        }}
                        className="px-3 py-1.5 bg-amber-100 dark:bg-amber-950 hover:bg-amber-200 text-amber-900 dark:text-amber-200 font-extrabold text-xs rounded-xl border border-amber-300 dark:border-amber-700 transition-all cursor-pointer"
                      >
                        <span>👁️ Basculer</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SPECIFIC TEACHER PROFILE EDITOR MODAL (ADMIN) */}
      {adminEditingTeacher && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 max-w-lg w-full p-6 space-y-5 relative overflow-hidden">
            <button
              type="button"
              onClick={() => setAdminEditingTeacher(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-2 text-base font-bold rounded-full"
            >
              ✕
            </button>

            <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-700 pb-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center text-xl font-bold shadow-md">
                ✏️
              </div>
              <div>
                <h2 className="text-base font-black text-slate-900 dark:text-white">
                  Édition du profil : {adminEditingTeacher.firstName} {adminEditingTeacher.lastName}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Modification par l'administrateur ({adminEditingTeacher.email})
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveAdminTeacherEdit} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Prénom :</label>
                  <input
                    type="text"
                    value={adminEditFirstName}
                    onChange={(e) => setAdminEditFirstName(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-white font-medium"
                    required
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Nom :</label>
                  <input
                    type="text"
                    value={adminEditLastName}
                    onChange={(e) => setAdminEditLastName(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-white font-medium"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Adresse E-mail :</label>
                  <input
                    type="email"
                    value={adminEditEmail}
                    onChange={(e) => setAdminEditEmail(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-white font-medium"
                    required
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Rôle / Statut :</label>
                  <select
                    value={adminEditRole}
                    onChange={(e) => setAdminEditRole(e.target.value as 'teacher' | 'super_admin')}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-white font-bold cursor-pointer"
                  >
                    <option value="teacher">👨‍🏫 Enseignant (Standard)</option>
                    <option value="super_admin">👑 Administrateur Global</option>
                  </select>
                </div>
              </div>

              {/* Disciplines */}
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Matières enseignées :</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {adminEditDisciplines.map((disc) => (
                    <span key={disc} className="px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-bold rounded-lg border border-indigo-200 dark:border-indigo-800 flex items-center gap-1">
                      <span>{disc}</span>
                      <button
                        type="button"
                        onClick={() => setAdminEditDisciplines(adminEditDisciplines.filter(d => d !== disc))}
                        className="text-indigo-400 hover:text-red-500 font-bold ml-1"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={adminNewDiscipline}
                    onChange={(e) => setAdminNewDiscipline(e.target.value)}
                    placeholder="Ajouter une matière (ex: Physique-Chimie)"
                    className="flex-1 px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (adminNewDiscipline.trim() && !adminEditDisciplines.includes(adminNewDiscipline.trim())) {
                        setAdminEditDisciplines([...adminEditDisciplines, adminNewDiscipline.trim()]);
                        setAdminNewDiscipline('');
                      }
                    }}
                    className="px-3 py-1.5 bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200 font-bold rounded-xl"
                  >
                    + Ajouter
                  </button>
                </div>
              </div>

              {/* Classes */}
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Classes attribuées :</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {adminEditClasses.map((cls) => (
                    <span key={cls} className="px-2.5 py-1 bg-amber-50 dark:bg-amber-950 text-amber-900 dark:text-amber-200 font-bold rounded-lg border border-amber-300 dark:border-amber-700 flex items-center gap-1">
                      <span>{cls}</span>
                      <button
                        type="button"
                        onClick={() => setAdminEditClasses(adminEditClasses.filter(c => c !== cls))}
                        className="text-amber-500 hover:text-red-500 font-bold ml-1"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={adminNewClass}
                    onChange={(e) => setAdminNewClass(e.target.value)}
                    placeholder="Ajouter une classe (ex: 5ème C)"
                    className="flex-1 px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (adminNewClass.trim() && !adminEditClasses.includes(adminNewClass.trim())) {
                        setAdminEditClasses([...adminEditClasses, adminNewClass.trim()]);
                        setAdminNewClass('');
                      }
                    }}
                    className="px-3 py-1.5 bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-200 font-bold rounded-xl"
                  >
                    + Ajouter
                  </button>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAdminEditingTeacher(null)}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-xl shadow-md cursor-pointer"
                >
                  💾 Enregistrer les modifications
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE TEACHER BY ADMIN MODAL */}
      {showAdminCreateTeacher && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 max-w-md w-full p-6 space-y-4 relative">
            <button
              type="button"
              onClick={() => setShowAdminCreateTeacher(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-2 font-bold"
            >
              ✕
            </button>

            <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-700 pb-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center text-xl font-bold shadow-md">
                ➕
              </div>
              <div>
                <h2 className="text-base font-black text-slate-900 dark:text-white">
                  Créer un compte enseignant
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Ajout direct à la base de données par l'administrateur.
                </p>
              </div>
            </div>

            <form onSubmit={handleCreateNewTeacherByAdmin} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold mb-1">Prénom :</label>
                  <input
                    type="text"
                    value={newTeacherFirstName}
                    onChange={(e) => setNewTeacherFirstName(e.target.value)}
                    placeholder="Jean"
                    className="w-full px-3 py-2 rounded-xl border dark:bg-slate-900 dark:text-white"
                    required
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Nom :</label>
                  <input
                    type="text"
                    value={newTeacherLastName}
                    onChange={(e) => setNewTeacherLastName(e.target.value)}
                    placeholder="Dupont"
                    className="w-full px-3 py-2 rounded-xl border dark:bg-slate-900 dark:text-white"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold mb-1">Adresse E-mail :</label>
                <input
                  type="email"
                  value={newTeacherEmail}
                  onChange={(e) => setNewTeacherEmail(e.target.value)}
                  placeholder="j.dupont@etablissement.fr"
                  className="w-full px-3 py-2 rounded-xl border dark:bg-slate-900 dark:text-white"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold mb-1">Discipline :</label>
                  <input
                    type="text"
                    value={newTeacherDiscipline}
                    onChange={(e) => setNewTeacherDiscipline(e.target.value)}
                    placeholder="Mathématiques"
                    className="w-full px-3 py-2 rounded-xl border dark:bg-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Classe :</label>
                  <input
                    type="text"
                    value={newTeacherClass}
                    onChange={(e) => setNewTeacherClass(e.target.value)}
                    placeholder="6ème A"
                    className="w-full px-3 py-2 rounded-xl border dark:bg-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="pt-3 border-t flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAdminCreateTeacher(false)}
                  className="px-3 py-2 bg-slate-100 dark:bg-slate-700 font-bold rounded-xl"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-xl shadow"
                >
                  ➕ Créer l'enseignant
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
