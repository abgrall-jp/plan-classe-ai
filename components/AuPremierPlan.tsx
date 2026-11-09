import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Affiche une fenêtre (photo agrandie, etc.) au premier plan, y compris en mode Plein Écran.
 * En plein écran, le navigateur n'affiche que l'élément mis en plein écran : une fenêtre
 * rendue ailleurs dans la page reste cachée dessous. On la place donc dans cet élément.
 */
export const AuPremierPlan: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [hote, setHote] = useState<Element | null>(() =>
    typeof document === 'undefined' ? null : document.fullscreenElement || document.body);
  useEffect(() => {
    const maj = () => setHote(document.fullscreenElement || document.body);
    document.addEventListener('fullscreenchange', maj);
    return () => document.removeEventListener('fullscreenchange', maj);
  }, []);
  return hote ? createPortal(children, hote) : <>{children}</>;
};

export default AuPremierPlan;
