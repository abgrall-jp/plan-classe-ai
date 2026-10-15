import React, { useState } from 'react';
import { PRESET_OBSTACLES, ObstacleType } from '../services/obstacleService';
import { ObstacleRenderer } from './ObstacleRenderer';

interface ObstaclePickerModalProps {
  isOpen: boolean;
  cellId?: number | null;
  cellIds?: number[];
  currentObstacle?: { icon: string; label: string; svgKey?: string };
  onSelectObstacle: (cellId: number, obstacle: { icon: string; label: string; svgKey?: string } | null) => void;
  onSelectObstacleForMultipleCells?: (cellIds: number[], obstacle: { icon: string; label: string; svgKey?: string } | null) => void;
  onClose: () => void;
}

export const ObstaclePickerModal: React.FC<ObstaclePickerModalProps> = ({
  isOpen,
  cellId,
  cellIds,
  currentObstacle,
  onSelectObstacle,
  onSelectObstacleForMultipleCells,
  onClose,
}) => {
  const [customIcon, setCustomIcon] = useState<string>('');
  const [customLabel, setCustomLabel] = useState<string>('');

  if (!isOpen) return null;

  // Determine target cell IDs array
  const targetIds: number[] = cellIds && cellIds.length > 0
    ? cellIds
    : cellId !== undefined && cellId !== null
    ? [cellId]
    : [];

  const handleApplyObstacle = (obs: { icon: string; label: string; svgKey?: string } | null) => {
    if (onSelectObstacleForMultipleCells && targetIds.length > 0) {
      onSelectObstacleForMultipleCells(targetIds, obs);
    } else if (cellId !== undefined && cellId !== null) {
      onSelectObstacle(cellId, obs);
    } else if (targetIds.length > 0) {
      targetIds.forEach(id => onSelectObstacle(id, obs));
    }
    onClose();
  };

  const handleSelectPreset = (preset: ObstacleType) => {
    handleApplyObstacle({
      icon: preset.icon,
      label: preset.label,
      svgKey: preset.svgKey,
    });
  };

  const handleApplyCustom = () => {
    if (customIcon.trim() || customLabel.trim()) {
      handleApplyObstacle({
        icon: customIcon.trim() || '📍',
        label: customLabel.trim() || 'Élément',
      });
    }
  };

  const handleMakeAvailable = () => {
    handleApplyObstacle(null); // remove obstacle and make available as free seat
  };

  const titleText = targetIds.length > 1
    ? `Mobilier & Obstacle (${targetIds.length} places sélectionnées)`
    : targetIds.length === 1
    ? `Mobilier & Obstacle (Place #${targetIds[0] + 1})`
    : 'Mobilier & Obstacle';

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-slate-900 border border-slate-700/80 rounded-3xl max-w-lg w-full overflow-hidden shadow-2xl text-slate-100 flex flex-col p-5 space-y-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">🛠️</span>
            <div>
              <h3 className="font-bold text-white text-base leading-snug">
                {titleText}
              </h3>
              {targetIds.length > 1 && (
                <p className="text-[11px] text-amber-400 font-medium">
                  L'élément choisi sera affecté simultanément à ces {targetIds.length} places.
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center text-sm font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>

        <p className="text-xs text-slate-300">
          Sélectionnez un dessin vectoriel SVG ou une icône pour indiquer le type de place indisponible (Passage, Ordinateur, Table vide, etc.) :
        </p>

        {/* Presets Grid */}
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 max-h-64 overflow-y-auto pr-1">
          {PRESET_OBSTACLES.map((obs) => {
            const isSelected =
              currentObstacle?.icon === obs.icon ||
              (currentObstacle?.svgKey && currentObstacle.svgKey === obs.svgKey);

            return (
              <button
                key={obs.id}
                type="button"
                onClick={() => handleSelectPreset(obs)}
                className={`p-2.5 rounded-2xl border flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer text-center group ${
                  isSelected
                    ? 'bg-indigo-600/30 border-indigo-400 text-white ring-2 ring-indigo-400/50 shadow-md scale-102'
                    : 'bg-slate-800/80 border-slate-700 hover:bg-slate-700/80 hover:border-indigo-500 text-slate-200'
                }`}
              >
                <ObstacleRenderer
                  obstacle={{ icon: obs.icon, label: obs.label, svgKey: obs.svgKey }}
                  size="md"
                  showLabel={false}
                />
                <span className="text-[11px] font-bold leading-tight line-clamp-1 group-hover:text-amber-300 transition-colors">
                  {obs.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Custom icon / label input */}
        <div className="bg-slate-800/60 p-3 rounded-2xl border border-slate-700/60 space-y-2">
          <span className="text-[11px] font-bold text-slate-300 block">
            Ou personnaliser (icône & libellé) :
          </span>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Ex: 🖲️"
              maxLength={4}
              value={customIcon}
              onChange={(e) => setCustomIcon(e.target.value)}
              className="w-14 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-center text-sm text-white focus:outline-none focus:border-indigo-500"
            />
            <input
              type="text"
              placeholder="Ex: Borne tactile"
              maxLength={20}
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              className="flex-1 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-indigo-500"
            />
            <button
              type="button"
              onClick={handleApplyCustom}
              disabled={!customIcon.trim() && !customLabel.trim()}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-bold rounded-xl text-xs transition-all cursor-pointer"
            >
              Appliquer
            </button>
          </div>
        </div>

        {/* Bottom actions */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800 gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleMakeAvailable}
            className="px-3 py-1.5 bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/60 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
          >
            <span>🟢</span>
            <span>Rendre disponible (chaise libre)</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold cursor-pointer"
          >
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
};
