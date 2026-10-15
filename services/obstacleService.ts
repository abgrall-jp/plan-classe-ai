export interface ObstacleType {
  id: string;
  icon: string;
  label: string;
  description: string;
  svgKey: string;
}

export const PRESET_OBSTACLES: ObstacleType[] = [
  { id: 'passage', icon: '🚶', label: 'Passage', description: 'Allée de circulation / Couloir', svgKey: 'passage' },
  { id: 'computer', icon: '💻', label: 'Ordinateur', description: 'Poste informatique / PC fixe', svgKey: 'computer' },
  { id: 'none', icon: '🪑', label: 'Table vide', description: 'Espace vide / Chaise retirée', svgKey: 'empty_table' },
  { id: 'desk', icon: '🧑‍🏫', label: 'Bureau Prof', description: 'Bureau enseignant / Table spécifique', svgKey: 'desk' },
  { id: 'storage', icon: '📦', label: 'Armoire', description: 'Meuble de rangement / Casier', svgKey: 'storage' },
  { id: 'window', icon: '🪟', label: 'Fenêtre', description: 'Accès fenêtre / Radiateur', svgKey: 'window' },
  { id: 'door', icon: '🚪', label: 'Porte', description: 'Porte d’entrée / Sortie de secours', svgKey: 'door' },
  { id: 'printer', icon: '🖨️', label: 'Imprimante', description: 'Imprimante / Scanner / Borne', svgKey: 'printer' },
  { id: 'lab', icon: '🔬', label: 'Paillasse', description: 'Paillasse de sciences / Labo', svgKey: 'lab' },
  { id: 'trash', icon: '🗑️', label: 'Poubelle', description: 'Poubelle / Tri sélectif', svgKey: 'trash' },
  { id: 'plug', icon: '🔌', label: 'Prise', description: 'Prises électriques / Réseau', svgKey: 'plug' },
  { id: 'sink', icon: '🚰', label: 'Point d’eau', description: 'Évier / Lavabo', svgKey: 'sink' },
  { id: 'pillar', icon: '🧱', label: 'Pilier', description: 'Pilier / Poutre porteuse', svgKey: 'pillar' },
];

export const getObstacleForCell = (
  cellId: number,
  cellObstacles?: Record<number | string, { icon: string; label: string; svgKey?: string }>
): { icon: string; label: string; svgKey?: string } | undefined => {
  if (!cellObstacles) return undefined;
  return cellObstacles[cellId] || cellObstacles[String(cellId)];
};
