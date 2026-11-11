import { useRef, useState, type RefObject } from 'react';
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
  const [directInput, setDirectInput] = useState(false);
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
  });

  return (
    <div
      ref={viewportRef}
      className="canvas-viewport"
      onWheel={(e) => {
        e.preventDefault();
        setDirectInput(true);
        if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
        wheelTimerRef.current = setTimeout(() => setDirectInput(false), 120);

        const delta = e.deltaY < 0 ? 1.08 : 0.92;
        onChangeZoom((z) => Number(Math.min(4, Math.max(0.15, z * delta)).toFixed(2)));
      }}
      onMouseDown={(e) => {
        setDirectInput(true);
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
        setDirectInput(false);
      }}
      onMouseLeave={() => {
        dragRef.current.active = false;
        setDirectInput(false);
      }}
    >
      {renderedSvg ? (
        <div
          className={`canvas-stage ${directInput ? '' : 'smooth-camera'}`}
          style={{
            transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`,
          }}
        >
          <div
            key={chartKey}
            className="canvas-diagram-fade"
            dangerouslySetInnerHTML={{ __html: renderedSvg }}
          />
        </div>
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
            setDirectInput(false);
            onChangeZoom((z) => Number(Math.max(0.15, z - 0.14).toFixed(2)));
          }}
          title="Zoom out"
        >
          <ZoomOut size={13} />
        </button>
        <button
          className="btn ghost sm"
          onClick={() => {
            setDirectInput(false);
            onResetView();
          }}
          title="100%"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          className="btn ghost sm"
          onClick={() => {
            setDirectInput(false);
            onChangeZoom((z) => Number(Math.min(4, z + 0.14).toFixed(2)));
          }}
          title="Zoom in"
        >
          <ZoomIn size={13} />
        </button>
        <button
          className="btn ghost sm"
          onClick={() => {
            setDirectInput(false);
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
