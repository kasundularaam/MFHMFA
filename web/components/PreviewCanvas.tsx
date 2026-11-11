import { useEffect, useRef, useState, type RefObject } from 'react';
import { AlertCircle, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import type { ParseErrorDetail } from '../../src/shared/types';

interface PreviewCanvasProps {
  viewportRef: RefObject<HTMLDivElement | null>;
  chartKey: string;
  renderedSvg: string;
  parseError: ParseErrorDetail | null;
  zoom: number;
  pan: { x: number; y: number };
  onChangeZoom: (updater: (prev: number) => number) => void;
  onResetView: () => void;
  onChangePan: (pan: { x: number; y: number }) => void;
  onFitCanvas: () => void;
  onFlipToCode: () => void;
}

interface FrozenLayer {
  svg: string;
  zoom: number;
  pan: { x: number; y: number };
}

export function PreviewCanvas({
  viewportRef,
  chartKey,
  renderedSvg,
  parseError,
  zoom,
  pan,
  onChangeZoom,
  onResetView,
  onChangePan,
  onFitCanvas,
  onFlipToCode,
}: PreviewCanvasProps) {
  // Smooth camera transition ONLY when clicking zoom/fit buttons (never on mount or chart swap)
  const [cameraGlide, setCameraGlide] = useState(false);
  const [outgoingLayer, setOutgoingLayer] = useState<FrozenLayer | null>(null);

  const prevSnapshotRef = useRef<{
    chartKey: string;
    svg: string;
    zoom: number;
    pan: { x: number; y: number };
  }>({
    chartKey,
    svg: renderedSvg,
    zoom,
    pan,
  });

  const dragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
  });

  // Cross-dissolve outgoing chart into incoming chart with zero blank frames
  useEffect(() => {
    const prev = prevSnapshotRef.current;
    if (prev.chartKey !== chartKey) {
      setCameraGlide(false);
      if (prev.svg && renderedSvg && prev.svg !== renderedSvg) {
        setOutgoingLayer({
          svg: prev.svg,
          zoom: prev.zoom,
          pan: prev.pan,
        });
        const timer = setTimeout(() => {
          setOutgoingLayer(null);
        }, 170);
        prevSnapshotRef.current = { chartKey, svg: renderedSvg, zoom, pan };
        return () => clearTimeout(timer);
      }
    }
    prevSnapshotRef.current = { chartKey, svg: renderedSvg, zoom, pan };
    return undefined;
  }, [chartKey, renderedSvg, zoom, pan]);

  return (
    <div
      ref={viewportRef}
      className="canvas-viewport"
      onWheel={(e) => {
        e.preventDefault();
        if (cameraGlide) setCameraGlide(false);
        const delta = e.deltaY < 0 ? 1.08 : 0.92;
        onChangeZoom((z) => Number(Math.min(6, Math.max(0.15, z * delta)).toFixed(2)));
      }}
      onMouseDown={(e) => {
        if (cameraGlide) setCameraGlide(false);
        dragRef.current = {
          active: true,
          startX: e.clientX,
          startY: e.clientY,
          origX: pan.x,
          origY: pan.y,
        };
      }}
      onMouseMove={(e) => {
        if (!dragRef.current.active) return;
        onChangePan({
          x: dragRef.current.origX + (e.clientX - dragRef.current.startX),
          y: dragRef.current.origY + (e.clientY - dragRef.current.startY),
        });
      }}
      onMouseUp={() => {
        dragRef.current.active = false;
      }}
      onMouseLeave={() => {
        dragRef.current.active = false;
      }}
    >
      {/* Outgoing frozen layer during chart switch (prevents empty-canvas blink) */}
      {outgoingLayer && (
        <div
          className="canvas-stage canvas-layer-out"
          style={{
            transform: `translate(calc(-50% + ${outgoingLayer.pan.x}px), calc(-50% + ${outgoingLayer.pan.y}px)) scale(${outgoingLayer.zoom})`,
          }}
          dangerouslySetInnerHTML={{ __html: outgoingLayer.svg }}
        />
      )}

      {/* Active diagram layer */}
      {renderedSvg ? (
        <div
          className={`canvas-stage ${cameraGlide ? 'smooth-camera' : ''} ${
            outgoingLayer ? 'canvas-layer-in' : ''
          }`}
          onTransitionEnd={() => setCameraGlide(false)}
          style={{
            transform: `translate(calc(-50% + ${Math.round(pan.x)}px), calc(-50% + ${Math.round(pan.y)}px)) scale(${zoom})`,
          }}
          dangerouslySetInnerHTML={{ __html: renderedSvg }}
        />
      ) : (
        <div
          style={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
          }}
        >
          Switch to Code to edit diagram
        </div>
      )}

      {parseError && (
        <div
          className="floating-error-pill"
          onClick={onFlipToCode}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <AlertCircle size={14} />
          <span>
            {parseError.line ? `Syntax error on line ${parseError.line}` : 'Syntax error'} — View in
            Code
          </span>
        </div>
      )}

      <div className="floating-zoom-bar" onMouseDown={(e) => e.stopPropagation()}>
        <button
          className="btn ghost sm"
          onClick={() => {
            setCameraGlide(true);
            onChangeZoom((z) => Number(Math.max(0.15, z - 0.14).toFixed(2)));
          }}
          title="Zoom out"
        >
          <ZoomOut size={13} />
        </button>
        <button
          className="btn ghost sm"
          onClick={() => {
            setCameraGlide(true);
            onResetView();
          }}
          title="100%"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          className="btn ghost sm"
          onClick={() => {
            setCameraGlide(true);
            onChangeZoom((z) => Number(Math.min(6, z + 0.14).toFixed(2)));
          }}
          title="Zoom in"
        >
          <ZoomIn size={13} />
        </button>
        <button
          className="btn ghost sm"
          onClick={() => {
            setCameraGlide(true);
            onFitCanvas();
          }}
          title="Fit"
        >
          <Maximize2 size={13} />
        </button>
      </div>
    </div>
  );
}
