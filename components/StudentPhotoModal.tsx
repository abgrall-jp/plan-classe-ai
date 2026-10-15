import React, { useEffect, useRef } from 'react';
import { compressImageToWebP } from '../services/photoLibraryService';

export interface PhotoModalData {
  name: string;
  photoUrl?: string;
  rollNumber?: string;
  className?: string;
  seatInfo?: string;
}

interface StudentPhotoModalProps {
  data: PhotoModalData | null;
  onClose: () => void;
  onDeletePhoto?: (name: string) => void;
  onReplacePhoto?: (name: string, newPhotoUrl: string) => void;
}

export const StudentPhotoModal: React.FC<StudentPhotoModalProps> = ({
  data,
  onClose,
  onDeletePhoto,
  onReplacePhoto,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    if (data) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [data, onClose]);

  if (!data) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onReplacePhoto) {
      try {
        const compressed = await compressImageToWebP(file, 260, 320, 0.88);
        onReplacePhoto(data.name, compressed);
      } catch (err) {
        console.error('Error compressing image:', err);
      }
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative bg-slate-900 border border-slate-700/80 rounded-3xl max-w-sm w-full overflow-hidden shadow-2xl text-slate-100 flex flex-col items-center p-6 text-center"
      >
        {/* Hidden file input for replacement */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="image/webp,image/jpeg,image/png,image/*"
          className="hidden"
        />

        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-all cursor-pointer text-lg font-bold"
          title="Fermer (Échap)"
        >
          ✕
        </button>

        {/* Badge header */}
        <div className="flex items-center gap-2 mb-4">
          {data.rollNumber && (
            <span className="px-2.5 py-0.5 rounded-full bg-indigo-900/80 border border-indigo-600/80 text-indigo-200 text-xs font-mono font-bold">
              N° {data.rollNumber}
            </span>
          )}
          {data.className && (
            <span className="px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold">
              {data.className}
            </span>
          )}
          {data.seatInfo && (
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-600/80 text-emerald-300 text-xs font-semibold">
              {data.seatInfo}
            </span>
          )}
        </div>

        {/* Photo Container */}
        <div className="relative w-48 h-56 sm:w-56 sm:h-64 rounded-2xl overflow-hidden bg-slate-800 border-2 border-indigo-500/50 shadow-lg flex items-center justify-center mb-4 group">
          {data.photoUrl ? (
            <img
              src={data.photoUrl}
              alt={data.name}
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex flex-col items-center justify-center text-slate-500 p-4">
              <span className="text-5xl mb-2">👤</span>
              <span className="text-xs text-slate-400 italic">Aucune photo enregistrée</span>
            </div>
          )}
        </div>

        {/* Student Name */}
        <h3 className="text-xl font-black tracking-tight text-white mb-1">
          {data.name}
        </h3>
        <p className="text-xs text-slate-400 mb-3">
          Fiche individuelle de l'élève (WebP/JPG)
        </p>

        {/* Action Buttons for Managing Photo */}
        <div className="w-full flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            {onReplacePhoto && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="py-2 px-3 bg-indigo-600/90 hover:bg-indigo-600 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-sm"
              >
                <span>🔄 Remplacer</span>
              </button>
            )}
            {data.photoUrl && onDeletePhoto && (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Effacer la photo de ${data.name} ?`)) {
                    onDeletePhoto(data.name);
                    onClose();
                  }
                }}
                className="py-2 px-3 bg-red-600/80 hover:bg-red-600 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-sm"
              >
                <span>🗑️ Effacer</span>
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-xl transition-all cursor-pointer text-xs"
          >
            Fermer la vue
          </button>
        </div>
      </div>
    </div>
  );
};
