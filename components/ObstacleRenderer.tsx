import React from 'react';

export interface ObstacleData {
  icon: string;
  label: string;
  svgKey?: string;
}

interface ObstacleRendererProps {
  obstacle?: ObstacleData | null;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  labelColor?: string;
  className?: string;
}

/**
 * Renders vector SVG illustrations for unavailable seats (Passage, Ordinateur, Table vide, etc.)
 * or falls back to emoji icons with high contrast styling.
 */
export const ObstacleRenderer: React.FC<ObstacleRendererProps> = ({
  obstacle,
  size = 'md',
  showLabel = true,
  labelColor,
  className = '',
}) => {
  if (!obstacle) {
    return (
      <div className={`flex flex-col items-center justify-center select-none ${className}`}>
        <span className="text-[10px] font-bold opacity-75" style={{ color: labelColor }}>
          ✕ Indisponible
        </span>
      </div>
    );
  }

  // Determine key either from explicit svgKey or by searching icon/label keywords
  const rawKey = (obstacle.svgKey || '').toLowerCase();
  const labelLower = (obstacle.label || '').toLowerCase();
  const icon = obstacle.icon || '';

  let key = rawKey;
  if (!key) {
    if (labelLower.includes('passage') || labelLower.includes('allée') || labelLower.includes('couloir') || icon === '🚶') {
      key = 'passage';
    } else if (labelLower.includes('ordinateur') || labelLower.includes('pc') || labelLower.includes('informatique') || icon === '💻') {
      key = 'computer';
    } else if (labelLower.includes('vide') || labelLower.includes('chaise') || labelLower.includes('bloqué') || icon === '✕' || icon === '🪑' || icon === '🚫') {
      key = 'empty_table';
    } else if (labelLower.includes('bureau') || labelLower.includes('prof') || icon === '🧑‍🏫') {
      key = 'desk';
    } else if (labelLower.includes('armoire') || labelLower.includes('casier') || labelLower.includes('rangement') || icon === '📦') {
      key = 'storage';
    } else if (labelLower.includes('fenêtre') || labelLower.includes('fenetre') || icon === '🪟') {
      key = 'window';
    } else if (labelLower.includes('porte') || icon === '🚪') {
      key = 'door';
    } else if (labelLower.includes('imprimante') || icon === '🖨️') {
      key = 'printer';
    } else if (labelLower.includes('paillasse') || labelLower.includes('labo') || icon === '🔬') {
      key = 'lab';
    } else if (labelLower.includes('prise') || icon === '🔌') {
      key = 'plug';
    } else if (labelLower.includes('eau') || labelLower.includes('évier') || labelLower.includes('evier') || icon === '🚰') {
      key = 'sink';
    } else if (labelLower.includes('pilier') || labelLower.includes('poutre') || icon === '🧱') {
      key = 'pillar';
    } else if (labelLower.includes('poubelle') || icon === '🗑️') {
      key = 'trash';
    }
  }

  const svgDimensions = size === 'sm' ? 'w-5 h-5' : size === 'lg' ? 'w-9 h-9' : 'w-7 h-7';
  const iconFontSize = size === 'sm' ? 'text-base' : size === 'lg' ? 'text-2xl' : 'text-xl';

  const renderSvg = () => {
    switch (key) {
      case 'passage':
        return (
          <svg className={`${svgDimensions} text-indigo-400 dark:text-indigo-300 drop-shadow-sm`} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="3" y="3" width="26" height="26" rx="6" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeWidth="2" strokeDasharray="3 3" />
            <path d="M12 22C12 22 13 18 16 18C19 18 20 22 20 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M10 10L16 6L22 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M16 6V18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="16" cy="24" r="1.5" fill="currentColor" />
          </svg>
        );

      case 'computer':
        return (
          <svg className={`${svgDimensions} text-cyan-500 dark:text-cyan-300 drop-shadow-sm`} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="4" y="6" width="24" height="15" rx="3" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="2" />
            <line x1="8" y1="11" x2="24" y2="11" stroke="currentColor" strokeWidth="1" strokeOpacity="0.4" />
            <path d="M13 21L11 26H21L19 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="9" y1="26" x2="23" y2="26" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        );

      case 'empty_table':
        return (
          <svg className={`${svgDimensions} text-slate-400 dark:text-slate-400 drop-shadow-sm`} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="4" y="8" width="24" height="6" rx="2" stroke="currentColor" strokeWidth="2" fill="currentColor" fillOpacity="0.1" />
            <line x1="7" y1="14" x2="7" y2="24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="25" y1="14" x2="25" y2="24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M12 24C12 21 20 21 20 24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 2" />
          </svg>
        );

      case 'desk':
        return (
          <svg className={`${svgDimensions} text-amber-500 dark:text-amber-400 drop-shadow-sm`} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="3" y="10" width="26" height="7" rx="2" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="2" />
            <rect x="5" y="17" width="8" height="9" rx="1" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.1" />
            <line x1="25" y1="17" x2="25" y2="26" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M18 7L21 10H15L18 7Z" fill="currentColor" fillOpacity="0.6" />
          </svg>
        );

      case 'storage':
        return (
          <svg className={`${svgDimensions} text-emerald-500 dark:text-emerald-400 drop-shadow-sm`} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="6" y="4" width="20" height="24" rx="3" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeWidth="2" />
            <line x1="16" y1="4" x2="16" y2="28" stroke="currentColor" strokeWidth="1.5" />
            <line x1="6" y1="16" x2="26" y2="16" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="13" cy="10" r="1" fill="currentColor" />
            <circle cx="19" cy="10" r="1" fill="currentColor" />
            <circle cx="13" cy="22" r="1" fill="currentColor" />
            <circle cx="19" cy="22" r="1" fill="currentColor" />
          </svg>
        );

      case 'window':
        return (
          <svg className={`${svgDimensions} text-sky-400 dark:text-sky-300 drop-shadow-sm`} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="5" y="5" width="22" height="22" rx="3" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeWidth="2" />
            <line x1="16" y1="5" x2="16" y2="27" stroke="currentColor" strokeWidth="2" />
            <line x1="5" y1="16" x2="27" y2="16" stroke="currentColor" strokeWidth="2" />
          </svg>
        );

      case 'door':
        return (
          <svg className={`${svgDimensions} text-teal-400 dark:text-teal-300 drop-shadow-sm`} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="7" y="4" width="18" height="24" rx="2" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="2" />
            <circle cx="21" cy="16" r="1.5" fill="currentColor" />
            <line x1="4" y1="28" x2="28" y2="28" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        );

      case 'printer':
        return (
          <svg className={`${svgDimensions} text-indigo-400 dark:text-indigo-300 drop-shadow-sm`} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 10V4H24V10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="4" y="10" width="24" height="12" rx="3" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="2" />
            <path d="M8 18V28H24V18" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="23" cy="14" r="1" fill="currentColor" />
          </svg>
        );

      case 'lab':
        return (
          <svg className={`${svgDimensions} text-purple-400 dark:text-purple-300 drop-shadow-sm`} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M14 6H18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M15 6V13L8 24C7 25.5 8 27 10 27H22C24 27 25 25.5 24 24L17 13V6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M10 21H22" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" />
          </svg>
        );

      case 'plug':
        return (
          <svg className={`${svgDimensions} text-yellow-500 dark:text-yellow-400 drop-shadow-sm`} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="16" cy="16" r="11" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeWidth="2" />
            <circle cx="12" cy="14" r="2" fill="currentColor" />
            <circle cx="20" cy="14" r="2" fill="currentColor" />
            <path d="M16 20V23" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        );

      case 'sink':
        return (
          <svg className={`${svgDimensions} text-blue-400 dark:text-blue-300 drop-shadow-sm`} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6 14H26V18C26 22 22 25 16 25C10 25 6 22 6 18V14Z" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="2" />
            <path d="M16 5V10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M16 10H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="16" cy="12" r="1" fill="currentColor" />
          </svg>
        );

      case 'pillar':
        return (
          <svg className={`${svgDimensions} text-orange-400 dark:text-orange-300 drop-shadow-sm`} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="6" y="4" width="20" height="4" rx="1" fill="currentColor" fillOpacity="0.4" stroke="currentColor" strokeWidth="2" />
            <rect x="9" y="8" width="14" height="16" stroke="currentColor" strokeWidth="2" fill="currentColor" fillOpacity="0.1" />
            <line x1="13" y1="8" x2="13" y2="24" stroke="currentColor" strokeWidth="1" />
            <line x1="19" y1="8" x2="19" y2="24" stroke="currentColor" strokeWidth="1" />
            <rect x="6" y="24" width="20" height="4" rx="1" fill="currentColor" fillOpacity="0.4" stroke="currentColor" strokeWidth="2" />
          </svg>
        );

      case 'trash':
        return (
          <svg className={`${svgDimensions} text-rose-400 dark:text-rose-300 drop-shadow-sm`} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6 10H26" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M12 10V6H20V10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M8 10L10 26H22L24 10" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="14" y1="15" x2="14" y2="22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="18" y1="15" x2="18" y2="22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        );

      default:
        return (
          <span className={`${iconFontSize} leading-none filter drop-shadow-xs transform transition-transform`}>
            {icon || '📍'}
          </span>
        );
    }
  };

  return (
    <div className={`flex flex-col items-center justify-center text-center select-none px-1 ${className}`}>
      {renderSvg()}
      {showLabel && obstacle.label && (
        <span
          className="text-[10px] font-extrabold tracking-tight mt-0.5 line-clamp-1 leading-tight"
          style={{ color: labelColor }}
        >
          {obstacle.label}
        </span>
      )}
    </div>
  );
};
