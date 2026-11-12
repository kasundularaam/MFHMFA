import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  FileCode2,
  Layers,
  Maximize2,
  Play,
  Sparkles,
  TriangleAlert,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  DiagramComprehensionGuide,
  ParseErrorDetail,
} from '../../src/shared/types';
import { applySvgComprehensionState } from '../utils/svgComprehension';

interface PreviewCanvasProps {
  viewportRef: RefObject<HTMLDivElement | null>;
  chartKey: string;
  renderedSvg: string;
  hasActiveFile: boolean;
  historicalVersion: number | null;
  onExitHistoricalVersion?: () => void;
  parseError: ParseErrorDetail | null;
  guide?: DiagramComprehensionGuide;
  activeStepIndex: number | null;
  onChangeStepIndex: (next: number | null) => void;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  parentGraphTitle: string | null;
  onDrillBack: () => void;
  onDrillToPath: (targetPath: string) => void;
  onCopyFilePath: (filePath: string) => void;
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
  hasActiveFile,
  historicalVersion,
  onExitHistoricalVersion,
  parseError,
  guide,
  activeStepIndex,
  onChangeStepIndex,
  selectedNodeId,
  onSelectNode,
  parentGraphTitle,
  onDrillBack,
  onDrillToPath,
  onCopyFilePath,
  zoom,
  pan,
  onChangeZoom,
  onResetView,
  onChangePan,
  onFitCanvas,
  onFlipToCode,
}: PreviewCanvasProps) {
  const [cameraGlide, setCameraGlide] = useState(false);
  const [outgoingLayer, setOutgoingLayer] = useState<FrozenLayer | null>(null);
  const [nodeLabels, setNodeLabels] = useState<Map<string, string>>(() => new Map());

  const activeStageRef = useRef<HTMLDivElement | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    moved: false,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
  });

  const steps = guide?.steps ?? [];
  const activeStep =
    activeStepIndex !== null && steps[activeStepIndex]
      ? steps[activeStepIndex]!
      : null;

  const documentedNodeIds = useMemo(
    () => (guide?.nodes ? Object.keys(guide.nodes) : []),
    [guide]
  );

  const selectedDetail =
    selectedNodeId && guide?.nodes?.[selectedNodeId]
      ? guide.nodes[selectedNodeId]!
      : null;

  useEffect(
    () => () => {
      if (fadeTimerRef.current) {
        clearTimeout(fadeTimerRef.current);
      }
    },
    []
  );

  // Cross-dissolve outgoing chart into incoming chart with zero blank frames
  useEffect(() => {
    const prev = prevSnapshotRef.current;
    if (prev.chartKey !== chartKey) {
      setCameraGlide(false);
      if (prev.svg && renderedSvg && prev.svg !== renderedSvg) {
        if (fadeTimerRef.current) {
          clearTimeout(fadeTimerRef.current);
        }
        setOutgoingLayer({
          svg: prev.svg,
          zoom: prev.zoom,
          pan: prev.pan,
        });
        fadeTimerRef.current = setTimeout(() => {
          setOutgoingLayer(null);
          fadeTimerRef.current = null;
        }, 170);
      }
    }
    prevSnapshotRef.current = { chartKey, svg: renderedSvg, zoom, pan };
  }, [chartKey, renderedSvg, zoom, pan]);

  // Apply Story Stepper spotlighting & clickable node affordances to active SVG DOM
  useLayoutEffect(() => {
    const { nodeDisplayLabels } = applySvgComprehensionState(activeStageRef.current, {
      guide,
      activeStep,
      selectedNodeId,
    });
    setNodeLabels(nodeDisplayLabels);
  }, [renderedSvg, guide, activeStep, selectedNodeId]);

  const resolveDisplayLabel = (nodeId: string): string => {
    const explicit = guide?.nodes?.[nodeId]?.label;
    if (explicit) return explicit;
    return nodeLabels.get(nodeId) || nodeId;
  };

  const showComprehensionBar =
    hasActiveFile &&
    Boolean(renderedSvg) &&
    (Boolean(guide?.gist) || steps.length > 0 || documentedNodeIds.length > 0);

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
        if (e.button !== 0) return;
        if (cameraGlide) setCameraGlide(false);
        dragRef.current = {
          active: true,
          moved: false,
          startX: e.clientX,
          startY: e.clientY,
          origX: pan.x,
          origY: pan.y,
        };
      }}
      onMouseMove={(e) => {
        if (!dragRef.current.active) return;
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        if (!dragRef.current.moved && Math.hypot(dx, dy) >= 5) {
          dragRef.current.moved = true;
        }
        onChangePan({
          x: dragRef.current.origX + dx,
          y: dragRef.current.origY + dy,
        });
      }}
      onMouseUp={() => {
        dragRef.current.active = false;
      }}
      onMouseLeave={() => {
        dragRef.current.active = false;
      }}
      onClick={(e) => {
        if (dragRef.current.moved) return;
        const target = e.target as Element | null;
        const nodeEl = target?.closest?.('[data-mfhmfa-node]');
        if (nodeEl) {
          const nid = nodeEl.getAttribute('data-mfhmfa-node');
          if (nid && guide?.nodes?.[nid]) {
            onSelectNode(selectedNodeId === nid ? null : nid);
            return;
          }
        }
        if (selectedNodeId !== null) {
          onSelectNode(null);
        }
      }}
      onDoubleClick={(e) => {
        const target = e.target as Element | null;
        const nodeEl = target?.closest?.('[data-mfhmfa-node]');
        if (!nodeEl) return;
        const nid = nodeEl.getAttribute('data-mfhmfa-node');
        const childPath = nid ? guide?.nodes?.[nid]?.childPath : undefined;
        if (childPath) {
          e.stopPropagation();
          onDrillToPath(childPath);
        }
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
          ref={activeStageRef}
          className={`canvas-stage ${cameraGlide ? 'smooth-camera' : ''} ${
            outgoingLayer ? 'canvas-layer-in' : ''
          }`}
          onTransitionEnd={() => setCameraGlide(false)}
          style={{
            transform: `translate(calc(-50% + ${Math.round(pan.x)}px), calc(-50% + ${Math.round(pan.y)}px)) scale(${zoom})`,
          }}
          dangerouslySetInnerHTML={{ __html: renderedSvg }}
        />
      ) : !hasActiveFile ? (
        <div className="empty-agent-stage">
          <div className="empty-stage-watermark">
            Select a graph in the Explorer or click <code>+</code> to create one
          </div>
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
          Switch to Code view to edit diagram
        </div>
      )}

      {/* Top-Left Sub-Graph Zoom-Out Breadcrumb */}
      {parentGraphTitle && (
        <button
          type="button"
          className="floating-drillback-pill"
          onClick={(e) => {
            e.stopPropagation();
            onDrillBack();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          title={`Zoom back out to ${parentGraphTitle}`}
        >
          <ArrowLeft size={13} />
          <span>Back to {parentGraphTitle}</span>
        </button>
      )}

      {historicalVersion !== null && (
        <div
          className="floating-history-pill"
          onClick={(e) => {
            e.stopPropagation();
            onExitHistoricalVersion?.();
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <span>Viewing historical revision v{historicalVersion} — Return to head</span>
        </div>
      )}

      {parseError && (
        <div
          className="floating-error-pill"
          onClick={(e) => {
            e.stopPropagation();
            onFlipToCode();
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <AlertCircle size={14} />
          <span>
            {parseError.line ? `Syntax error on line ${parseError.line}` : 'Syntax error'} — View in
            Code
          </span>
        </div>
      )}

      {/* Right-Side Progressive-Disclosure Node Inspector Card */}
      {selectedNodeId && selectedDetail && (
        <aside
          className="node-inspector-card"
          data-testid="node-inspector-card"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          <div className="node-inspector-header">
            <div className="node-inspector-title-wrap">
              <span className="node-inspector-eyebrow">Component Details</span>
              <h3 className="node-inspector-title">
                {resolveDisplayLabel(selectedNodeId)}
              </h3>
            </div>
            <button
              type="button"
              className="icon-btn"
              onClick={() => onSelectNode(null)}
              title="Close inspector (Esc)"
              aria-label="Close inspector"
            >
              <X size={14} />
            </button>
          </div>

          <div className="node-inspector-body">
            <p className="node-inspector-summary">{selectedDetail.summary}</p>

            {selectedDetail.example && (
              <div className="node-inspector-section">
                <div className="node-inspector-label">Concrete Example</div>
                <div className="node-inspector-example">{selectedDetail.example}</div>
              </div>
            )}

            {selectedDetail.whatIf && (
              <div className="node-inspector-section">
                <div className="node-inspector-label hint">
                  <TriangleAlert size={11} />
                  <span>What Breaks If…</span>
                </div>
                <div className="node-inspector-whatif">{selectedDetail.whatIf}</div>
              </div>
            )}

            {selectedDetail.files && selectedDetail.files.length > 0 && (
              <div className="node-inspector-section">
                <div className="node-inspector-label">Source Files</div>
                <div className="node-inspector-files">
                  {selectedDetail.files.map((fp) => (
                    <button
                      key={fp}
                      type="button"
                      className="node-file-chip"
                      onClick={() => onCopyFilePath(fp)}
                      title="Click to copy file path"
                    >
                      <FileCode2 size={12} />
                      <span>{fp}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selectedDetail.childPath && (
              <button
                type="button"
                className="btn node-drilldown-btn"
                onClick={() => onDrillToPath(selectedDetail.childPath!)}
              >
                <Layers size={13} />
                <span>Zoom into {selectedDetail.childPath}</span>
                <ArrowRight size={13} />
              </button>
            )}
          </div>
        </aside>
      )}

      {/* Bottom-Center Story Mode Stepper & Takeaway Dock */}
      {showComprehensionBar && (
        <div
          className={`comprehension-dock ${activeStep ? 'stepping' : 'overview'}`}
          data-testid="comprehension-dock"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          {!activeStep ? (
            <div className="comprehension-overview-row">
              <div className="comprehension-gist-col">
                {guide?.gist ? (
                  <div className="comprehension-gist">{guide.gist}</div>
                ) : (
                  <div className="comprehension-gist muted">
                    Interactive guide attached — walk through step-by-step or click a box to inspect.
                  </div>
                )}
                {documentedNodeIds.length > 0 && (
                  <div className="comprehension-subhint">
                    <Sparkles size={11} />
                    <span>
                      Click any outlined box ({documentedNodeIds.length}) for concrete examples & edge cases
                    </span>
                  </div>
                )}
              </div>

              {steps.length > 0 && (
                <button
                  type="button"
                  className="btn sm story-start-btn"
                  data-testid="story-start-btn"
                  onClick={() => onChangeStepIndex(0)}
                  title="Step through one concrete flow (Right Arrow)"
                >
                  <Play size={11} />
                  <span>Walk Through ({steps.length})</span>
                </button>
              )}
            </div>
          ) : (
            <div className="story-stepper-panel">
              <div className="story-stepper-top">
                <span className="story-step-badge">
                  Step {activeStepIndex! + 1} / {steps.length}
                </span>
                <span className="story-step-title">{activeStep.title}</span>

                <div className="story-step-dots" role="tablist" aria-label="Story steps">
                  {steps.map((st, idx) => (
                    <button
                      key={`${st.title}-${idx}`}
                      type="button"
                      className={`story-dot ${idx === activeStepIndex ? 'active' : ''}`}
                      onClick={() => onChangeStepIndex(idx)}
                      title={st.title}
                      aria-label={`Step ${idx + 1}: ${st.title}`}
                    />
                  ))}
                </div>

                <button
                  type="button"
                  className="btn ghost sm story-exit-btn"
                  onClick={() => onChangeStepIndex(null)}
                  title="Return to full overview (Esc)"
                >
                  Overview
                </button>
              </div>

              <div className="story-step-caption">{activeStep.caption}</div>

              <div className="story-stepper-footer">
                <div className="story-focus-chips">
                  {activeStep.focusNodes
                    .filter((nid) => Boolean(guide?.nodes?.[nid]))
                    .map((nid) => (
                      <button
                        key={nid}
                        type="button"
                        className={`story-node-chip ${
                          selectedNodeId === nid ? 'active' : ''
                        }`}
                        onClick={() =>
                          onSelectNode(selectedNodeId === nid ? null : nid)
                        }
                        title="Inspect component details"
                      >
                        {resolveDisplayLabel(nid)}
                      </button>
                    ))}
                </div>

                <div className="story-nav-btns">
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() =>
                      onChangeStepIndex(
                        activeStepIndex! <= 0 ? null : activeStepIndex! - 1
                      )
                    }
                    title="Previous step (Left Arrow)"
                  >
                    <ChevronLeft size={13} />
                    <span>{activeStepIndex! <= 0 ? 'Overview' : 'Prev'}</span>
                  </button>
                  <button
                    type="button"
                    className="btn sm story-next-btn"
                    onClick={() =>
                      onChangeStepIndex(
                        activeStepIndex! + 1 < steps.length
                          ? activeStepIndex! + 1
                          : null
                      )
                    }
                    title="Next step (Right Arrow)"
                  >
                    <span>
                      {activeStepIndex! + 1 < steps.length ? 'Next' : 'Finish'}
                    </span>
                    <ChevronRight size={13} />
                  </button>
                </div>
              </div>
            </div>
          )}
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
