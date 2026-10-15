import React from 'react';

interface RgpdLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg';
  variant?: 'shield' | 'badge' | 'full';
  className?: string;
  onClick?: () => void;
}

export const RgpdLogo: React.FC<RgpdLogoProps> = ({
  size = 'md',
  variant = 'badge',
  className = '',
  onClick,
}) => {
  const iconDimensions = {
    xs: 18,
    sm: 24,
    md: 32,
    lg: 48,
  };

  const dim = iconDimensions[size] || 32;

  // European 12 stars coordinates on radius 32 from center (50, 50)
  const stars = Array.from({ length: 12 }, (_, i) => {
    const angle = (i * 30 - 90) * (Math.PI / 180);
    const r = 31;
    const cx = 50 + r * Math.cos(angle);
    const cy = 50 + r * Math.sin(angle);
    return { cx, cy };
  });

  const ShieldSvg = (
    <svg
      width={dim}
      height={dim}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0 drop-shadow-sm transition-transform hover:scale-105"
    >
      <defs>
        {/* Shield background gradient - European Union Blue to Deep Indigo */}
        <linearGradient id="euBlueGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#003399" />
          <stop offset="100%" stopColor="#0B1B4F" />
        </linearGradient>

        {/* Golden Star Gradient */}
        <linearGradient id="goldStarGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFCC00" />
          <stop offset="100%" stopColor="#FFAA00" />
        </linearGradient>

        {/* Inner Shield Gradient */}
        <linearGradient id="innerShieldGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#10B981" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
      </defs>

      {/* Main European Shield Shape */}
      <path
        d="M50 6 C74 6 90 14 90 28 C90 62 66 84 50 94 C34 84 10 62 10 28 C10 14 26 6 50 6 Z"
        fill="url(#euBlueGrad)"
        stroke="#FFCC00"
        strokeWidth="2.5"
      />

      {/* 12 European Golden Stars Circle */}
      {stars.map((s, idx) => (
        <polygon
          key={idx}
          points={`
            ${s.cx},${s.cy - 3.2}
            ${s.cx + 1},${s.cy - 1}
            ${s.cx + 3.2},${s.cy - 0.8}
            ${s.cx + 1.5},${s.cy + 0.8}
            ${s.cx + 2},${s.cy + 3}
            ${s.cx},${s.cy + 1.8}
            ${s.cx - 2},${s.cy + 3}
            ${s.cx - 1.5},${s.cy + 0.8}
            ${s.cx - 3.2},${s.cy - 0.8}
            ${s.cx - 1},${s.cy - 1}
          `}
          fill="url(#goldStarGrad)"
        />
      ))}

      {/* Central Security Padlock & Checkmark Symbol */}
      <g transform="translate(32, 34)">
        {/* Inner Green Shield Badge */}
        <path
          d="M18 2 C28 2 34 6 34 14 C34 28 24 36 18 40 C12 36 2 28 2 14 C2 6 8 2 18 2 Z"
          fill="url(#innerShieldGrad)"
          stroke="#FFFFFF"
          strokeWidth="1.5"
        />

        {/* Checkmark inside */}
        <path
          d="M11 20 L16 25 L26 14"
          stroke="#FFFFFF"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );

  if (variant === 'shield') {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center justify-center cursor-pointer transition-all ${className}`}
        title="Conforme RGPD • CNIL - Cliquer pour consulter la politique de protection des données"
      >
        {ShieldSvg}
      </button>
    );
  }

  if (variant === 'badge') {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-[#071330] text-blue-900 dark:text-blue-200 border border-blue-200 dark:border-blue-800/80 hover:bg-blue-100 dark:hover:bg-[#0c1f4d] transition-all cursor-pointer shadow-xs select-none ${className}`}
        title="Système conforme au Règlement Général sur la Protection des Données (RGPD/CNIL)"
      >
        {ShieldSvg}
        <div className="flex flex-col text-left">
          <span className="text-[10px] font-black tracking-wider uppercase text-blue-700 dark:text-amber-300 leading-none flex items-center gap-1">
            <span>RGPD</span>
            <span className="text-[8px] px-1 py-0.2 bg-emerald-500 text-white rounded font-bold">100% CONFORME</span>
          </span>
          <span className="text-[9px] text-slate-500 dark:text-slate-400 font-medium leading-tight">
            Protection Données Scolaires
          </span>
        </div>
      </button>
    );
  }

  // Full banner variant
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-blue-900/90 via-indigo-900/90 to-slate-900 border border-blue-500/40 text-white shadow-lg cursor-pointer hover:border-blue-400 transition-all ${className}`}
      title="Cliquer pour afficher la Charte de Conformité RGPD"
    >
      {ShieldSvg}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-black tracking-wide text-amber-300 uppercase">
            Conformité RGPD & CNIL
          </span>
          <span className="px-1.5 py-0.2 rounded text-[9px] font-extrabold bg-emerald-500 text-slate-950 uppercase">
            Données Protégées
          </span>
        </div>
        <p className="text-[11px] text-blue-100 mt-0.5 leading-relaxed">
          Minimisation des données, contrôle d'accès strict, hébergement sécurisé et respect des droits des élèves et enseignants (Art. 15-22 RGPD).
        </p>
      </div>
      <div className="text-right shrink-0">
        <span className="px-2 py-1 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-[10px] font-bold text-white transition-colors">
          Consulter &rarr;
        </span>
      </div>
    </div>
  );
};
