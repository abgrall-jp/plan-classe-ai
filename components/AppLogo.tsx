import React from 'react';

interface AppLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  className?: string;
}

export const AppLogo: React.FC<AppLogoProps> = ({
  size = 'md',
  showText = false,
  className = '',
}) => {
  const sizeClasses = {
    xs: 'w-6 h-6',
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-14 h-14',
    xl: 'w-20 h-20',
  };

  const iconDimensions = {
    xs: 24,
    sm: 32,
    md: 40,
    lg: 56,
    xl: 80,
  };

  const dim = iconDimensions[size] || 40;

  return (
    <div className={`inline-flex items-center gap-3 select-none ${className}`}>
      <div className={`relative ${sizeClasses[size]} shrink-0 flex items-center justify-center`}>
        <svg
          width={dim}
          height={dim}
          viewBox="0 0 100 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full drop-shadow-md transition-transform hover:scale-105"
        >
          <defs>
            {/* Background container gradient */}
            <linearGradient id="logoBgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#4F46E5" />
              <stop offset="50%" stopColor="#7C3AED" />
              <stop offset="100%" stopColor="#06B6D4" />
            </linearGradient>

            {/* Glowing Accent Gradient */}
            <linearGradient id="logoSparkGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#F59E0B" />
              <stop offset="100%" stopColor="#F43F5E" />
            </linearGradient>

            {/* Inner Desk Gradient */}
            <linearGradient id="deskGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#E2E8F0" stopOpacity="0.85" />
            </linearGradient>

            {/* Board / Screen Gradient */}
            <linearGradient id="boardGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#10B981" />
              <stop offset="100%" stopColor="#06B6D4" />
            </linearGradient>

            <filter id="glowEffect" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Squircle Icon Base */}
          <rect
            x="4"
            y="4"
            width="92"
            height="92"
            rx="24"
            fill="url(#logoBgGrad)"
            stroke="rgba(255,255,255,0.2)"
            strokeWidth="2"
          />

          {/* Teacher Board / Horizon Line */}
          <rect
            x="24"
            y="18"
            width="52"
            height="9"
            rx="4.5"
            fill="url(#boardGrad)"
            stroke="#FFFFFF"
            strokeWidth="1.5"
            strokeOpacity="0.8"
          />
          <circle cx="50" cy="22.5" r="2" fill="#FFFFFF" />

          {/* Neural Connection Lines between desks */}
          <path
            d="M32 44 L50 44 L68 44 M32 68 L50 68 L68 68 M32 44 L32 68 M50 44 L50 68 M68 44 L68 68"
            stroke="rgba(255,255,255,0.25)"
            strokeWidth="1.5"
            strokeDasharray="2 3"
          />

          {/* Classroom Desks Layout (Grid of 6 Desks with chairs) */}
          {/* Row 1 Desks */}
          <rect x="23" y="38" width="18" height="12" rx="3.5" fill="url(#deskGrad)" />
          <circle cx="32" cy="44" r="2" fill="#4F46E5" />

          <rect x="41" y="38" width="18" height="12" rx="3.5" fill="url(#deskGrad)" />
          <circle cx="50" cy="44" r="2" fill="#7C3AED" />

          <rect x="59" y="38" width="18" height="12" rx="3.5" fill="url(#deskGrad)" />
          <circle cx="68" cy="44" r="2" fill="#06B6D4" />

          {/* Row 2 Desks */}
          <rect x="23" y="62" width="18" height="12" rx="3.5" fill="url(#deskGrad)" />
          <circle cx="32" cy="68" r="2" fill="#10B981" />

          <rect x="41" y="62" width="18" height="12" rx="3.5" fill="url(#deskGrad)" />
          <circle cx="50" cy="68" r="2" fill="#F59E0B" />

          <rect x="59" y="62" width="18" height="12" rx="3.5" fill="url(#deskGrad)" />
          <circle cx="68" cy="68" r="2" fill="#EC4899" />

          {/* AI Sparkle / Star on top right */}
          <g transform="translate(64, 10)" filter="url(#glowEffect)">
            <path
              d="M12 0 L14.5 7.5 L22 10 L14.5 12.5 L12 20 L9.5 12.5 L2 10 L9.5 7.5 Z"
              fill="url(#logoSparkGrad)"
            />
          </g>

          {/* Small Graduation Cap detail on center bottom */}
          <path
            d="M50 78 L58 82 L50 86 L42 82 Z"
            fill="#FFFFFF"
            fillOpacity="0.9"
          />
          <path
            d="M45 83.5 L45 88 C45 89.5 55 89.5 55 88 L55 83.5"
            stroke="#FFFFFF"
            strokeWidth="1.2"
            fill="none"
          />
        </svg>
      </div>

      {showText && (
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5 font-black tracking-tight text-slate-900 dark:text-white text-base sm:text-lg">
            <span>Plan de Classe</span>
            <span className="bg-gradient-to-r from-indigo-500 via-purple-500 to-cyan-500 bg-clip-text text-transparent">
              IA
            </span>
          </div>
          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium leading-none">
            Gestion Pédagogique & Optimisation
          </span>
        </div>
      )}
    </div>
  );
};
