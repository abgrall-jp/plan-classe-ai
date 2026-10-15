import React, { useState, useRef, useEffect, useCallback } from 'react';

interface PlanZoomPanContainerProps {
  children: React.ReactNode;
  footerContent?: React.ReactNode;
  className?: string;
  initialZoom?: number;
  minZoom?: number;
  maxZoom?: number;
  zoomStep?: number;
  showControls?: boolean;
  theme?: 'dark' | 'light' | 'auto';
  helperText?: string;
  allowFrameExpand?: boolean;
}

export const PlanZoomPanContainer: React.FC<PlanZoomPanContainerProps> = ({
  children,
  footerContent,
  className = '',
  initialZoom = 1,
  minZoom = 0.35,
  maxZoom = 2.0,
  zoomStep = 0.1,
  showControls = true,
  theme = 'auto',
  helperText,
  allowFrameExpand = true,
}) => {
  const [zoom, setZoom] = useState<number>(initialZoom);
  const [isRightDragging, setIsRightDragging] = useState<boolean>(false);
  const [isExpandedFrame, setIsExpandedFrame] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const outerWrapperRef = useRef<HTMLDivElement>(null);

  // Monitor fullscreen change events
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const handleToggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement && outerWrapperRef.current) {
        await outerWrapperRef.current.requestFullscreen();
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.warn("Fullscreen toggle non supporté ou bloqué:", err);
    }
  };

  // Mouse drag tracking refs
  const dragStartRef = useRef<{
    clientX: number;
    clientY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);

  // Handle right-click mouse down
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Only trigger pan on right mouse button (button 2) or middle mouse button (button 1)
    if (e.button === 2 || e.button === 1) {
      e.preventDefault();
      e.stopPropagation();

      if (!containerRef.current) return;

      dragStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        scrollLeft: containerRef.current.scrollLeft,
        scrollTop: containerRef.current.scrollTop,
      };

      setIsRightDragging(true);
    }
  }, []);

  // Global mouse move and mouse up listeners so panning stays smooth even if cursor leaves container
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current || !containerRef.current) return;

      const deltaX = e.clientX - dragStartRef.current.clientX;
      const deltaY = e.clientY - dragStartRef.current.clientY;

      containerRef.current.scrollLeft = dragStartRef.current.scrollLeft - deltaX;
      containerRef.current.scrollTop = dragStartRef.current.scrollTop - deltaY;
    };

    const handleGlobalMouseUp = (e: MouseEvent) => {
      if (e.button === 2 || e.button === 1 || dragStartRef.current) {
        dragStartRef.current = null;
        setIsRightDragging(false);
      }
    };

    if (isRightDragging) {
      window.addEventListener('mousemove', handleGlobalMouseMove, { passive: false });
      window.addEventListener('mouseup', handleGlobalMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isRightDragging]);

  // Suppress context menu on right click inside container to allow smooth right-click panning
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  // Mouse wheel zoom with Ctrl / Cmd key
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? zoomStep : -zoomStep;
      setZoom(prev => {
        const next = Math.round((prev + delta) * 100) / 100;
        return Math.min(maxZoom, Math.max(minZoom, next));
      });
    }
  }, [maxZoom, minZoom, zoomStep]);

  // Zoom actions
  const handleZoomIn = () => {
    setZoom(prev => {
      const next = Math.round((prev + zoomStep) * 100) / 100;
      return Math.min(maxZoom, next);
    });
  };

  const handleZoomOut = () => {
    setZoom(prev => {
      const next = Math.round((prev - zoomStep) * 100) / 100;
      return Math.max(minZoom, next);
    });
  };

  const handleResetZoom = () => {
    setZoom(1.0);
    if (containerRef.current) {
      containerRef.current.scrollLeft = 0;
      containerRef.current.scrollTop = 0;
    }
  };

  // Preset zoom levels for thumbnail sizing
  const setPresetZoom = (presetValue: number) => {
    setZoom(presetValue);
    if (containerRef.current) {
      containerRef.current.scrollLeft = 0;
      containerRef.current.scrollTop = 0;
    }
  };

  // Auto-fit function: adjusts zoom so the whole classroom grid fits in current container width
  const handleFitToScreen = () => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    // Reset scroll first
    container.scrollLeft = 0;
    container.scrollTop = 0;

    // Available viewport dimensions
    const availWidth = container.clientWidth - 32; // subtracting internal padding
    const naturalWidth = content.scrollWidth || content.offsetWidth;

    if (naturalWidth > 0 && availWidth > 0) {
      const scaleFactor = Math.floor((availWidth / naturalWidth) * 100) / 100;
      // Clamp between minZoom and 1.0 (so small classes don't blow up beyond 100% unless user zooms in)
      const targetZoom = Math.min(1.0, Math.max(minZoom, scaleFactor));
      setZoom(targetZoom);
    }
  };

  const percentage = Math.round(zoom * 100);

  return (
    <div
      ref={outerWrapperRef}
      className={`relative flex flex-col transition-all duration-300 ${
        isFullscreen
          ? 'fixed inset-0 z-50 p-4 bg-slate-950 text-white overflow-hidden'
          : isExpandedFrame
          ? 'w-full max-w-none shadow-2xl p-2 bg-slate-900/40 rounded-2xl border-2 border-indigo-500/50 my-2'
          : 'w-full'
      } ${className}`}
    >
      {/* Zoom, Vignettes Sizing & Frame Width Control Bar */}
      {showControls && (
        <div className="flex flex-wrap items-center justify-between gap-2 p-2 px-3 mb-2 rounded-xl bg-slate-100/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 text-xs select-none shadow-sm">
          {/* Left: Navigation Helper & Fullscreen */}
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300 flex-wrap">
            <span className="flex items-center gap-1.5 font-bold">
              <span className={`w-2 h-2 rounded-full ${isRightDragging ? 'bg-amber-400 animate-ping' : 'bg-emerald-400'}`} />
              <span className="hidden sm:inline">Nav :</span>
            </span>
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {isRightDragging ? (
                <strong className="text-amber-500 dark:text-amber-400">↔️ Glissement vue...</strong>
              ) : (
                helperText || '🖱️ Clic droit pour déplacer • Molette pour défiler'
              )}
            </span>

            {/* Fullscreen Toggle Button */}
            <button
              type="button"
              onClick={handleToggleFullscreen}
              className={`px-2.5 py-1 rounded-lg font-extrabold text-[11px] transition-all flex items-center gap-1 cursor-pointer border ${
                isFullscreen
                  ? 'bg-rose-600 text-white border-rose-400 hover:bg-rose-500'
                  : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700 hover:text-white'
              }`}
              title={isFullscreen ? "Quitter le mode plein écran" : "Passer en mode Plein Écran (TNI / Grand écran)"}
            >
              <span>{isFullscreen ? '✕ Quitter Plein Écran' : '📺 Plein Écran'}</span>
            </button>
          </div>

          {/* Right: Frame Width & Zoom Controls */}
          <div className="flex items-center gap-1.5 ml-auto flex-wrap">
            {/* Frame Width Expansion Button */}
            {allowFrameExpand && (
              <button
                type="button"
                onClick={() => setIsExpandedFrame(!isExpandedFrame)}
                className={`px-2.5 py-1 rounded-lg font-black text-[11px] transition-all flex items-center gap-1 cursor-pointer shadow-xs ${
                  isExpandedFrame
                    ? 'bg-amber-500 text-slate-950 hover:bg-amber-400 font-extrabold ring-2 ring-amber-300'
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                }`}
                title={isExpandedFrame ? "Réduire le cadre à la largeur standard" : "Élargir le cadre pour occuper toute la largeur de l'écran"}
              >
                <span>{isExpandedFrame ? '📐 Cadre Standard' : '↔️ Pleine Largeur'}</span>
              </button>
            )}

            {/* Zoom to fit container width */}
            <button
              type="button"
              onClick={handleFitToScreen}
              title="Ajuster automatiquement le zoom du plan à la largeur exacte de votre écran"
              className="h-7 px-2.5 flex items-center gap-1 rounded-lg font-black text-[11px] bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-xs transition-all cursor-pointer"
            >
              <span>🔍</span>
              <span>Zoom Largeur</span>
            </button>

            <div className="h-4 w-px bg-slate-300 dark:bg-slate-700 mx-0.5 hidden sm:block" />

            {/* Quick Vignette Size Presets */}
            <button
              type="button"
              onClick={() => setPresetZoom(0.7)}
              className={`px-2 h-7 rounded-lg text-[10px] font-extrabold transition-all cursor-pointer ${
                percentage === 70
                  ? 'bg-indigo-600 text-white font-black ring-2 ring-indigo-400'
                  : 'bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
              title="Vignettes S (70%)"
            >
              S
            </button>

            <button
              type="button"
              onClick={() => setPresetZoom(1.0)}
              className={`px-2 h-7 rounded-lg text-[10px] font-extrabold transition-all cursor-pointer ${
                percentage === 100
                  ? 'bg-indigo-600 text-white font-black ring-2 ring-indigo-400'
                  : 'bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
              title="Vignettes M (100%)"
            >
              M
            </button>

            <button
              type="button"
              onClick={() => setPresetZoom(1.3)}
              className={`px-2 h-7 rounded-lg text-[10px] font-extrabold transition-all cursor-pointer ${
                percentage === 130
                  ? 'bg-indigo-600 text-white font-black ring-2 ring-indigo-400'
                  : 'bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
              title="Vignettes L (130%)"
            >
              L
            </button>

            <div className="h-4 w-px bg-slate-300 dark:bg-slate-700 mx-0.5 hidden sm:block" />

            {/* Zoom Out Button */}
            <button
              type="button"
              onClick={handleZoomOut}
              disabled={zoom <= minZoom}
              title="Dézoomer (-10%)"
              className="w-7 h-7 flex items-center justify-center rounded-lg font-black text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer shadow-2xs"
            >
              −
            </button>

            {/* Current Zoom Level Badge (Click to reset to 100%) */}
            <button
              type="button"
              onClick={handleResetZoom}
              title="Cliquer pour réinitialiser à 100%"
              className="px-2 h-7 min-w-[50px] flex items-center justify-center rounded-lg font-mono font-black text-[11px] bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 text-indigo-700 dark:text-indigo-300 transition-all cursor-pointer shadow-2xs"
            >
              {percentage}%
            </button>

            {/* Zoom In Button */}
            <button
              type="button"
              onClick={handleZoomIn}
              disabled={zoom >= maxZoom}
              title="Zoomer (+10%)"
              className="w-7 h-7 flex items-center justify-center rounded-lg font-black text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer shadow-2xs"
            >
              +
            </button>
          </div>
        </div>
      )}

      {/* Viewport container with scroll & right-click panning */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
        onWheel={handleWheel}
        className={`w-full overflow-auto rounded-xl relative ${
          isFullscreen
            ? footerContent
              ? 'flex-1 max-h-[calc(100vh-230px)]'
              : 'flex-1 max-h-[calc(100vh-80px)]'
            : ''
        } ${
          isRightDragging ? 'cursor-grabbing select-none' : 'cursor-default'
        }`}
        style={{
          userSelect: isRightDragging ? 'none' : 'auto',
          WebkitUserSelect: isRightDragging ? 'none' : 'auto',
        }}
      >
        {/* Content wrapper with scaling applied */}
        <div
          ref={contentRef}
          style={{
            zoom: zoom,
            transformOrigin: 'top left',
            minWidth: 'min-content',
            transition: isRightDragging ? 'none' : 'zoom 0.1s ease-out',
          }}
          className="w-full"
        >
          {children}
        </div>
      </div>

      {/* Footer Content (e.g. Student Reserve Bank) - ALWAYS visible in Fullscreen Mode */}
      {footerContent && (
        <div
          className={`w-full mt-2.5 transition-all ${
            isFullscreen
              ? 'max-h-52 overflow-y-auto shrink-0 bg-[#0E1524] p-3 rounded-2xl border border-slate-700 shadow-2xl'
              : ''
          }`}
        >
          {footerContent}
        </div>
      )}
    </div>
  );
};

export default PlanZoomPanContainer;
