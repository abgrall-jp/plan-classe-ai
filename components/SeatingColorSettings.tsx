import React from 'react';
import { useSeatingColors, DEFAULT_SEATING_COLORS, SeatingColorsConfig } from '../services/seatingColorService';

export const SeatingColorSettings: React.FC = () => {
  const { colors, updateColors, resetToDefaults } = useSeatingColors();

  const handleColorChange = (key: keyof SeatingColorsConfig, val: string) => {
    updateColors({
      ...colors,
      [key]: val,
    });
  };

  const presetAvailable = ['#10b981', '#059669', '#14b8a6', '#22c55e', '#84cc16'];
  const presetOccupied = ['#f97316', '#ea580c', '#f59e0b', '#ef4444', '#a855f7'];
  const presetUnavailable = ['#3b82f6', '#2563eb', '#6366f1', '#64748b', '#0284c7'];

  return (
    <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900/90 to-slate-950/90 border border-slate-700/80 shadow-lg space-y-5 text-left">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-700/70 pb-3">
        <div>
          <h4 className="text-base font-extrabold text-white flex items-center gap-2">
            <span className="text-xl">🎨</span>
            <span>Couleurs des Places & Cadres</span>
          </h4>
          <p className="text-xs text-slate-300 mt-0.5">
            Personnalisez la couleur des cadres pour différencier nettement les zones disponibles, occupées et indisponibles.
          </p>
        </div>
        <button
          type="button"
          onClick={resetToDefaults}
          className="self-start sm:self-auto px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-semibold border border-slate-600 transition-all cursor-pointer flex items-center gap-1.5"
          title="Rétablir les couleurs d'origine (Vert, Orange, Bleu)"
        >
          <span>🔄</span>
          <span>Rétablir par défaut</span>
        </button>
      </div>

      {/* 3 Color Selectors */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        
        {/* 1. Places Disponibles */}
        <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700 space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors.available }} />
              Places Disponibles
            </label>
            <span className="text-[10px] px-1.5 py-0.5 bg-emerald-950/80 text-emerald-300 border border-emerald-800 rounded font-mono">
              Libres
            </span>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="color"
              value={colors.available}
              onChange={(e) => handleColorChange('available', e.target.value)}
              className="w-10 h-10 rounded-lg cursor-pointer border-0 bg-transparent p-0"
              title="Choisir la couleur des places disponibles"
            />
            <input
              type="text"
              value={colors.available}
              onChange={(e) => handleColorChange('available', e.target.value)}
              className="flex-1 px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-600 bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 uppercase"
              maxLength={7}
            />
          </div>

          <div className="flex items-center gap-1.5 pt-1">
            <span className="text-[10px] text-slate-400">Nuances:</span>
            {presetAvailable.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => handleColorChange('available', c)}
                className="w-4 h-4 rounded-full border border-slate-600 hover:scale-125 transition-transform"
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
          <p className="text-[11px] text-slate-400">
            Cadre pour les chaises libres (par défaut : <strong>Vert</strong>).
          </p>
        </div>

        {/* 2. Places Occupées */}
        <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700 space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-orange-400 flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors.occupied }} />
              Places Occupées
            </label>
            <span className="text-[10px] px-1.5 py-0.5 bg-orange-950/80 text-orange-300 border border-orange-800 rounded font-mono">
              Avec élève
            </span>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="color"
              value={colors.occupied}
              onChange={(e) => handleColorChange('occupied', e.target.value)}
              className="w-10 h-10 rounded-lg cursor-pointer border-0 bg-transparent p-0"
              title="Choisir la couleur des places occupées"
            />
            <input
              type="text"
              value={colors.occupied}
              onChange={(e) => handleColorChange('occupied', e.target.value)}
              className="flex-1 px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-600 bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-orange-500 uppercase"
              maxLength={7}
            />
          </div>

          <div className="flex items-center gap-1.5 pt-1">
            <span className="text-[10px] text-slate-400">Nuances:</span>
            {presetOccupied.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => handleColorChange('occupied', c)}
                className="w-4 h-4 rounded-full border border-slate-600 hover:scale-125 transition-transform"
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
          <p className="text-[11px] text-slate-400">
            Cadre pour les chaises attribuées (par défaut : <strong>Orange</strong>).
          </p>
        </div>

        {/* 3. Places Indisponibles */}
        <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700 space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-blue-400 flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors.unavailable }} />
              Places Indisponibles
            </label>
            <span className="text-[10px] px-1.5 py-0.5 bg-blue-950/80 text-blue-300 border border-blue-800 rounded font-mono">
              Neutralisées
            </span>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="color"
              value={colors.unavailable}
              onChange={(e) => handleColorChange('unavailable', e.target.value)}
              className="w-10 h-10 rounded-lg cursor-pointer border-0 bg-transparent p-0"
              title="Choisir la couleur des places indisponibles"
            />
            <input
              type="text"
              value={colors.unavailable}
              onChange={(e) => handleColorChange('unavailable', e.target.value)}
              className="flex-1 px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-600 bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 uppercase"
              maxLength={7}
            />
          </div>

          <div className="flex items-center gap-1.5 pt-1">
            <span className="text-[10px] text-slate-400">Nuances:</span>
            {presetUnavailable.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => handleColorChange('unavailable', c)}
                className="w-4 h-4 rounded-full border border-slate-600 hover:scale-125 transition-transform"
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
          <p className="text-[11px] text-slate-400">
            Cadre en pointillés des zones bloquées (par défaut : <strong>Bleu</strong>).
          </p>
        </div>

      </div>

      {/* Live Preview Bar */}
      <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
          Aperçu instantané des cadres de places :
        </span>

        <div className="grid grid-cols-3 gap-3">
          {/* Sample Available */}
          <div
            className="h-16 rounded-xl p-2 flex flex-col justify-between transition-all select-none"
            style={{
              borderColor: colors.available,
              borderWidth: '2.5px',
              borderStyle: 'solid',
              boxShadow: `0 0 0 1px ${colors.available}33`,
              backgroundColor: `${colors.available}12`,
            }}
          >
            <div className="flex items-center justify-between text-[10px] font-bold text-slate-400">
              <span>#1</span>
              <span className="font-bold" style={{ color: colors.available }}>Libre</span>
            </div>
            <div className="text-center text-[11px] font-semibold text-slate-300">
              (Disponible)
            </div>
          </div>

          {/* Sample Occupied */}
          <div
            className="h-16 rounded-xl p-2 flex flex-col justify-between transition-all select-none"
            style={{
              borderColor: colors.occupied,
              borderWidth: '2.5px',
              borderStyle: 'solid',
              boxShadow: `0 0 0 1px ${colors.occupied}33`,
              backgroundColor: `${colors.occupied}12`,
            }}
          >
            <div className="flex items-center justify-between text-[10px] font-bold text-slate-400">
              <span>#2</span>
              <span className="text-[9px] font-bold" style={{ color: colors.occupied }}>Occupé</span>
            </div>
            <div className="text-center text-[11px] font-bold text-white truncate">
              Jean Dupont
            </div>
          </div>

          {/* Sample Unavailable */}
          <div
            className="h-16 rounded-xl p-2 flex flex-col justify-between transition-all select-none"
            style={{
              borderColor: colors.unavailable,
              borderWidth: '2px',
              borderStyle: 'dashed',
              boxShadow: `0 0 0 1px ${colors.unavailable}33`,
              backgroundColor: `${colors.unavailable}12`,
            }}
          >
            <div className="flex items-center justify-between text-[10px] font-bold text-slate-400">
              <span>#3</span>
              <span className="font-bold text-[9px]" style={{ color: colors.unavailable }}>Bloqué</span>
            </div>
            <div className="text-center text-[11px] font-semibold text-slate-400">
              Indisponible
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
