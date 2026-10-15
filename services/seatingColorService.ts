import { useState, useEffect } from 'react';

export interface SeatingColorsConfig {
  available: string;   // Vert pour les places disponibles / libres (défaut : #10b981)
  unavailable: string; // Bleu pour les places indisponibles (défaut : #3b82f6)
  occupied: string;    // Orange pour les places occupées (défaut : #f97316)
}

export const DEFAULT_SEATING_COLORS: SeatingColorsConfig = {
  available: '#10b981',   // Vert émeraude
  unavailable: '#3b82f6', // Bleu vif
  occupied: '#f97316',    // Orange chaleureux
};

const STORAGE_KEY = 'seating_colors_config_v1';
const EVENT_NAME = 'seating_colors_changed';

/**
 * Lit la configuration des couleurs des places depuis le stockage local
 */
export function getSeatingColors(): SeatingColorsConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SEATING_COLORS };
    const parsed = JSON.parse(raw);
    return {
      available: parsed.available || DEFAULT_SEATING_COLORS.available,
      unavailable: parsed.unavailable || DEFAULT_SEATING_COLORS.unavailable,
      occupied: parsed.occupied || DEFAULT_SEATING_COLORS.occupied,
    };
  } catch {
    return { ...DEFAULT_SEATING_COLORS };
  }
}

/**
 * Sauvegarde et propage la nouvelle configuration de couleurs
 */
export function saveSeatingColors(colors: SeatingColorsConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(colors));
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: colors }));
  } catch (e) {
    console.error('Erreur lors de la sauvegarde des couleurs de places:', e);
  }
}

/**
 * Réinitialise les couleurs aux valeurs par défaut (vert, bleu, orange)
 */
export function resetSeatingColors(): SeatingColorsConfig {
  saveSeatingColors(DEFAULT_SEATING_COLORS);
  return { ...DEFAULT_SEATING_COLORS };
}

/**
 * Hook React pour synchroniser en temps réel les couleurs des places
 */
export function useSeatingColors(): {
  colors: SeatingColorsConfig;
  updateColors: (colors: SeatingColorsConfig) => void;
  resetToDefaults: () => void;
} {
  const [colors, setColors] = useState<SeatingColorsConfig>(getSeatingColors);

  useEffect(() => {
    const handleUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<SeatingColorsConfig>;
      if (customEvent.detail) {
        setColors(customEvent.detail);
      } else {
        setColors(getSeatingColors());
      }
    };

    window.addEventListener(EVENT_NAME, handleUpdate);
    window.addEventListener('storage', handleUpdate);

    return () => {
      window.removeEventListener(EVENT_NAME, handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, []);

  return {
    colors,
    updateColors: saveSeatingColors,
    resetToDefaults: resetSeatingColors,
  };
}

/**
 * Calcule les styles CSS inline (bordure, lueur, arrière-plan léger)
 * pour un statut de place donné selon la configuration des couleurs
 */
export function getSeatBorderStyle(
  status: 'available' | 'occupied' | 'unavailable',
  colors: SeatingColorsConfig = DEFAULT_SEATING_COLORS,
  isSpecialMe: boolean = false
): React.CSSProperties {
  const color =
    status === 'available'
      ? colors.available
      : status === 'occupied'
      ? colors.occupied
      : colors.unavailable;

  if (isSpecialMe) {
    return {
      borderColor: color,
      borderWidth: '2.5px',
      borderStyle: 'solid',
      boxShadow: `0 0 0 2px ${color}55, 0 4px 12px ${color}33`,
      backgroundColor: `${color}18`,
    };
  }

  if (status === 'unavailable') {
    return {
      borderColor: color,
      borderWidth: '2px',
      borderStyle: 'dashed',
      boxShadow: `0 0 0 1px ${color}33`,
      backgroundColor: `${color}10`,
    };
  }

  // Occupied or Available
  return {
    borderColor: color,
    borderWidth: '2px',
    borderStyle: 'solid',
    boxShadow: `0 0 0 1px ${color}33`,
    backgroundColor: `${color}0D`,
  };
}
