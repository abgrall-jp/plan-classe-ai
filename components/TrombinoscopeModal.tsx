import React, { useState, useRef, useEffect } from 'react';
import { Student } from '../types';
import {
  renderPdfPageToCanvas,
  renderImageFileToCanvas,
  extractTrombiWithGemini,
  calculateNameMatchScore,
  processMultiplePhotoFiles,
  saveTrombiExtractionToCache,
  getCachedTrombiExtractions,
  deleteCachedTrombiExtraction,
  CachedTrombiExtraction,
  SAMPLE_203_STUDENTS,
  ExtractedTrombiStudent,
} from '../services/trombiService';
import { registerPhotosBatch } from '../services/photoLibraryService';
import { StudentPhotoModal, PhotoModalData } from './StudentPhotoModal';

interface StudentMatchItem {
  extracted: ExtractedTrombiStudent;
  matchedStudentId?: number;
  matchedStudentName?: string;
  confidence: number; // 0 to 1
  selectedForUpdate: boolean;
}

interface TrombinoscopeModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentStudents: Student[];
  currentClassName: string;
  availableClasses?: string[];
  onApplyPhotos: (updatedStudents: Student[]) => void;
}

export const TrombinoscopeModal: React.FC<TrombinoscopeModalProps> = ({
  isOpen,
  onClose,
  currentStudents,
  currentClassName,
  onApplyPhotos,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [detectedClassName, setDetectedClassName] = useState<string>('');
  const [matchItems, setMatchItems] = useState<StudentMatchItem[]>([]);
  const [photoPreview, setPhotoPreview] = useState<PhotoModalData | null>(null);
  const [cachedExtractions, setCachedExtractions] = useState<CachedTrombiExtraction[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const batchFilesInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setCachedExtractions(getCachedTrombiExtractions());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Run matching between extracted trombi students and target class students
  const matchWithCurrentStudents = (
    extractedList: ExtractedTrombiStudent[],
    targetList: Student[]
  ): StudentMatchItem[] => {
    const usedStudentIds = new Set<number>();

    return extractedList.map((ext) => {
      let bestMatch: Student | undefined = undefined;
      let highestScore = 0;

      for (const st of targetList) {
        if (usedStudentIds.has(st.id)) continue;
        const score = calculateNameMatchScore(ext.name, st.name);
        if (score > highestScore) {
          highestScore = score;
          bestMatch = st;
        }
      }

      if (bestMatch && highestScore >= 0.4) {
        usedStudentIds.add(bestMatch.id);
        return {
          extracted: ext,
          matchedStudentId: bestMatch.id,
          matchedStudentName: bestMatch.name,
          confidence: highestScore,
          selectedForUpdate: !!ext.photoUrl && !ext.isPlaceholder,
        };
      }

      return {
        extracted: ext,
        matchedStudentId: undefined,
        matchedStudentName: undefined,
        confidence: 0,
        selectedForUpdate: false,
      };
    });
  };

  // Re-apply a previously cached trombinoscope extraction
  const handleLoadCachedTrombi = (cached: CachedTrombiExtraction) => {
    setDetectedClassName(cached.className || cached.fileName);
    const matches = matchWithCurrentStudents(cached.students, currentStudents);
    setMatchItems(matches);
    setErrorMessage('');
  };

  // Delete a cached trombi extraction
  const handleDeleteCachedTrombi = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteCachedTrombiExtraction(id);
    setCachedExtractions(getCachedTrombiExtractions());
  };

  // Quick re-associate demo trombinoscope (203 / Seconde 3)
  const handleLoadDemo203Trombi = () => {
    const extractedList: ExtractedTrombiStudent[] = SAMPLE_203_STUDENTS.map(st => ({
      name: st.name,
      isPlaceholder: (st as any).isPlaceholder || false,
      photoUrl: (st as any).photoUrl || undefined,
    }));
    setDetectedClassName('Seconde 3 (203)');
    const matches = matchWithCurrentStudents(extractedList, currentStudents);
    setMatchItems(matches);
    setErrorMessage('');
  };

  // Handle file upload (PDF or Single Trombinoscope Image)
  const handleFileUpload = async (file: File) => {
    setIsProcessing(true);
    setErrorMessage('');
    setStatusMessage(`Lecture du fichier ${file.name}...`);

    try {
      let canvas: HTMLCanvasElement;
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        setStatusMessage("Rendu haute définition de la page PDF...");
        canvas = await renderPdfPageToCanvas(file, 1);
      } else if (file.type.startsWith('image/')) {
        setStatusMessage("Chargement de l'image du trombinoscope...");
        canvas = await renderImageFileToCanvas(file);
      } else {
        throw new Error('Format de fichier non supporté. Veuillez importer un fichier PDF ou une image (PNG, JPG).');
      }

      setStatusMessage("Analyse IA par Gemini : détection des visages réels, noms et cadrage des vignettes...");
      const result = await extractTrombiWithGemini(canvas);

      if (!result.students || result.students.length === 0) {
        throw new Error("Aucun élève n'a pu être détecté sur cette page. Assurez-vous que les visages et les noms sont bien visibles.");
      }

      // Auto-save to persistent cache so user never loses associations
      saveTrombiExtractionToCache(file.name, result);
      setCachedExtractions(getCachedTrombiExtractions());

      setDetectedClassName(result.className || 'Classe détectée');
      const matches = matchWithCurrentStudents(result.students, currentStudents);
      setMatchItems(matches);
      setStatusMessage('');
    } catch (err: any) {
      console.error('Trombi parsing error:', err);
      setErrorMessage(err.message || 'Erreur lors du traitement du trombinoscope.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle batch upload of individual student photo files
  const handleBatchFilesUpload = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    setIsProcessing(true);
    setErrorMessage('');
    setStatusMessage(`Traitement et compression de ${fileArray.length} photos réelles d'élèves...`);

    try {
      const extracted = await processMultiplePhotoFiles(fileArray);
      if (extracted.length === 0) {
        throw new Error("Aucune image valide n'a été trouvée dans la sélection.");
      }

      const fileName = `Lot ${fileArray.length} photos (${currentClassName || 'Classe'})`;
      saveTrombiExtractionToCache(fileName, {
        className: currentClassName,
        students: extracted,
      });
      setCachedExtractions(getCachedTrombiExtractions());

      const matches = matchWithCurrentStudents(extracted, currentStudents);
      setMatchItems(matches);
      setDetectedClassName(`Import de ${extracted.length} photos`);
      setStatusMessage('');
    } catch (err: any) {
      console.error('Batch photos error:', err);
      setErrorMessage(err.message || "Erreur lors du traitement des fichiers photos.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApply = async () => {
    // Map matched photos back to currentStudents
    const photoMap = new Map<number, string>();
    const batchToRegister: Array<{ name: string; photoUrl: string; className?: string }> = [];

    matchItems.forEach((item) => {
      if (item.selectedForUpdate && item.matchedStudentId && item.extracted.photoUrl) {
        photoMap.set(item.matchedStudentId, item.extracted.photoUrl);
        if (item.matchedStudentName) {
          batchToRegister.push({
            name: item.matchedStudentName,
            photoUrl: item.extracted.photoUrl,
            className: currentClassName,
          });
        }
      }
    });

    // Register all selected photos into central photo library
    if (batchToRegister.length > 0) {
      await registerPhotosBatch(batchToRegister);
    }

    const updated = currentStudents.map((st) => {
      if (photoMap.has(st.id)) {
        return { ...st, photoUrl: photoMap.get(st.id) };
      }
      return st;
    });

    onApplyPhotos(updated);
    onClose();
  };

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        onClick={onClose}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="relative bg-slate-900 border border-slate-700/80 rounded-3xl max-w-3xl w-full max-h-[90vh] overflow-hidden shadow-2xl text-slate-100 flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📸</span>
              <div>
                <h2 className="text-lg font-bold text-white leading-tight">
                  Trombinoscope & Photos d'Élèves
                </h2>
                <p className="text-xs text-slate-400">
                  Rattachement automatique des photos aux noms de la classe ({currentClassName || 'Classe active'})
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-all cursor-pointer font-bold text-sm"
            >
              ✕
            </button>
          </div>

          {/* Body */}
          <div className="p-6 overflow-y-auto space-y-5 flex-1">
            {/* Section 1: Previous Scans & Quick Re-associations (if any exist) */}
            {cachedExtractions.length > 0 && (
              <div className="bg-indigo-950/40 border border-indigo-700/60 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base">📂</span>
                    <h3 className="text-xs font-bold text-indigo-200 uppercase tracking-wider">
                      Trombinoscopes récemment scannés & Associations mémorisées
                    </h3>
                  </div>
                  <span className="text-[11px] text-indigo-300 font-mono">
                    {cachedExtractions.length} fichier(s) en mémoire
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {cachedExtractions.map((cached) => (
                    <div
                      key={cached.id}
                      onClick={() => handleLoadCachedTrombi(cached)}
                      className="group p-2.5 bg-slate-800/80 hover:bg-indigo-900/60 border border-slate-700 hover:border-indigo-500 rounded-xl flex items-center justify-between gap-2 cursor-pointer transition-all shadow-xs"
                      title="Cliquer pour réassocier immédiatement ces photos à la classe"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-white truncate group-hover:text-indigo-200">
                          📄 {cached.fileName}
                        </p>
                        <p className="text-[10px] text-slate-400 truncate mt-0.5">
                          {cached.students.length} photos extraites • {new Date(cached.timestamp).toLocaleDateString('fr-FR')}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="px-2 py-1 bg-indigo-600 group-hover:bg-indigo-500 text-white font-bold text-[10px] rounded-lg shadow-xs">
                          ⚡ Réassocier
                        </span>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteCachedTrombi(cached.id, e)}
                          className="w-5 h-5 rounded-md hover:bg-red-500/20 text-slate-500 hover:text-red-400 flex items-center justify-center text-xs"
                          title="Supprimer cette sauvegarde"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Options bar: 2 ways to import real photos */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Option 1: PDF / Trombinoscope page */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-4 flex flex-col justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">📄</span>
                    <h3 className="text-sm font-bold text-slate-200">
                      Trombinoscope PDF ou Image
                    </h3>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    L'IA détecte tous les visages, lit les noms et extrait chaque photo en vignette optimisée.
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isProcessing}
                  className="w-full px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-md cursor-pointer transition-all"
                >
                  <span>📄 Importer un PDF ou Image</span>
                </button>
              </div>

              {/* Option 2: Batch individual photo files */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-4 flex flex-col justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">📁</span>
                    <h3 className="text-sm font-bold text-slate-200">
                      Lot de Photos Individuelles
                    </h3>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Sélectionnez plusieurs photos JPG/PNG d'un coup. Elles sont réduites en vignettes et associées par nom.
                  </p>
                </div>
                <input
                  ref={batchFilesInputRef}
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp,image/avif"
                  className="hidden"
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files && files.length > 0) handleBatchFilesUpload(files);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => batchFilesInputRef.current?.click()}
                  disabled={isProcessing}
                  className="w-full px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-md cursor-pointer transition-all"
                >
                  <span>📁 Importer plusieurs photos (JPG/PNG)</span>
                </button>
              </div>
            </div>

            {/* Status / Loading spinner */}
            {isProcessing && (
              <div className="p-6 bg-indigo-950/40 border border-indigo-700/50 rounded-2xl flex flex-col items-center justify-center text-center gap-3">
                <div className="w-8 h-8 border-3 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                <p className="text-sm font-bold text-indigo-200">{statusMessage}</p>
                <p className="text-xs text-indigo-300/80">
                  Détection optique des visages et reconnaissance des noms en cours...
                </p>
              </div>
            )}

            {/* Error banner */}
            {errorMessage && (
              <div className="p-4 bg-red-950/60 border border-red-700/60 rounded-2xl flex items-start gap-3 text-red-200 text-xs">
                <span className="text-lg">⚠️</span>
                <div className="flex-1">
                  <p className="font-bold">Erreur lors de l'analyse</p>
                  <p className="mt-0.5">{errorMessage}</p>
                </div>
              </div>
            )}

            {/* Results Table */}
            {matchItems.length > 0 && !isProcessing && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-full bg-emerald-950 border border-emerald-600 text-emerald-300 text-xs font-bold">
                      {matchItems.length} photos détectées
                    </span>
                    {detectedClassName && (
                      <span className="text-xs text-slate-400">
                        Classe détectée : <strong className="text-white">{detectedClassName}</strong>
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setMatchItems((prev) => prev.map((m) => ({ ...m, selectedForUpdate: true })))}
                      className="text-indigo-400 hover:underline cursor-pointer font-medium"
                    >
                      Tout cocher
                    </button>
                    <span className="text-slate-600">|</span>
                    <button
                      type="button"
                      onClick={() => setMatchItems((prev) => prev.map((m) => ({ ...m, selectedForUpdate: false })))}
                      className="text-slate-400 hover:underline cursor-pointer"
                    >
                      Tout décocher
                    </button>
                  </div>
                </div>

                <div className="border border-slate-700/80 rounded-2xl overflow-hidden bg-slate-950/60 max-h-72 overflow-y-auto divide-y divide-slate-800">
                  {matchItems.map((item, idx) => {
                    const isMatched = item.matchedStudentId !== undefined;
                    return (
                      <div
                        key={`match-item-${idx}`}
                        className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-800/40 text-xs transition-colors"
                      >
                        {/* Checkbox & Photo */}
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={item.selectedForUpdate}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setMatchItems((prev) =>
                                prev.map((m, i) => (i === idx ? { ...m, selectedForUpdate: checked } : m))
                              );
                            }}
                            className="w-4 h-4 rounded text-indigo-600 bg-slate-800 border-slate-700 cursor-pointer"
                          />

                          {/* Thumbnail (Click to enlarge) */}
                          <div
                            onClick={() => {
                              if (item.extracted.photoUrl) {
                                setPhotoPreview({
                                  name: item.extracted.name,
                                  photoUrl: item.extracted.photoUrl,
                                  className: detectedClassName,
                                });
                              }
                            }}
                            className="relative w-9 h-11 rounded-lg overflow-hidden border border-slate-600 bg-slate-800 shrink-0 cursor-pointer hover:ring-2 hover:ring-indigo-400 transition-all shadow-sm"
                            title="Cliquer pour voir la photo en grand"
                          >
                            {item.extracted.photoUrl ? (
                              <img
                                src={item.extracted.photoUrl}
                                alt={item.extracted.name}
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-slate-500 font-bold">
                                ?
                              </div>
                            )}
                          </div>

                          {/* Extracted Name */}
                          <div>
                            <span className="font-bold text-white block">
                              {item.extracted.name}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              Nom sous la photo dans le PDF
                            </span>
                          </div>
                        </div>

                        {/* Matching with current class */}
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">➜</span>
                          {isMatched ? (
                            <div className="flex items-center gap-2 bg-slate-800/80 px-2.5 py-1 rounded-xl border border-slate-700">
                              <span className="font-semibold text-emerald-300">
                                {item.matchedStudentName}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.2 bg-emerald-950 text-emerald-400 rounded-full font-mono font-bold">
                                {Math.round(item.confidence * 100)}%
                              </span>
                            </div>
                          ) : (
                            <select
                              value={item.matchedStudentId || ''}
                              onChange={(e) => {
                                const stId = Number(e.target.value);
                                const found = currentStudents.find((s) => s.id === stId);
                                setMatchItems((prev) =>
                                  prev.map((m, i) =>
                                    i === idx
                                      ? {
                                          ...m,
                                          matchedStudentId: found ? found.id : undefined,
                                          matchedStudentName: found ? found.name : undefined,
                                          confidence: found ? 1.0 : 0,
                                          selectedForUpdate: !!found && !!m.extracted.photoUrl,
                                        }
                                      : m
                                  )
                                );
                              }}
                              className="px-2 py-1 bg-slate-800 border border-slate-700 rounded-xl text-xs text-slate-200 focus:outline-none"
                            >
                              <option value="">-- Rattacher manuellement --</option>
                              {currentStudents.map((st) => (
                                <option key={st.id} value={st.id}>
                                  #{st.rollNumber || st.id} {st.name}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Footer actions */}
          <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold cursor-pointer"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={matchItems.filter((m) => m.selectedForUpdate).length === 0}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold rounded-xl text-xs transition-all shadow-md cursor-pointer flex items-center gap-2"
            >
              <span>✅</span>
              <span>
                Rattacher les photos sélectionnées (
                {matchItems.filter((m) => m.selectedForUpdate).length})
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Enlarged Photo Lightbox */}
      <StudentPhotoModal data={photoPreview} onClose={() => setPhotoPreview(null)} />
    </>
  );
};
