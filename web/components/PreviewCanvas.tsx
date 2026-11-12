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
  ArrowRight,
  Box,
  Check,
  ChevronDown,
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
import type { CanvasTransitionKind } from '../hooks/useStudioController';
import type { GraphBreadcrumbHop } from '../services/workspaceStorage';
import { applySvgComprehensionState } from '../utils/svgComprehension';

interface PreviewCanvasProps {
  viewportRef: RefObject<HTMLDivElement | null>;
  chartKey: string;
  activeGraphTitle: string | null;
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
  breadcrumbHops: GraphBreadcrumbHop[];
  transitionKind: CanvasTransitionKind;
  onJumpToAncestor: (fileId: string) => void;
  onOpenGraphById: (fileId: string) => void;
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
  mode: CanvasTransitionKind;
}

export function PreviewCanvas({
  viewportRef,
  chartKey,
  activeGraphTitle,
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
  breadcrumbHops,
  transitionKind,
  onJumpToAncestor,
  onOpenGraphById,
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
  const [openBranchHopIdx, setOpenBranchHopIdx] = useState<number | null>(null);

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

  useEffect(() => {
    setOpenBranchHopIdx(null);
  }, [chartKey]);

  useEffect(() => {
    if (openBranchHopIdx === null) return undefined;
    const onDocClick = () => setOpenBranchHopIdx(null);
    window.addEventListener('click', onDocClick);
    return () => window.removeEventListener('click', onDocClick);
  }, [openBranchHopIdx]);

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
          mode: transitionKind,
        });
        fadeTimerRef.current = setTimeout(() => {
          setOutgoingLayer(null);
          fadeTimerRef.current = null;
        }, 220);
      }
    }
    prevSnapshotRef.current = { chartKey, svg: renderedSvg, zoom, pan };
  }, [chartKey, renderedSvg, zoom, pan, transitionKind]);

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
      {outgoingLayer && (
        <div
          className={`canvas-stage canvas-layer-out mode-${outgoingLayer.mode}`}
          style={{
            transform: `translate(calc(-50% + ${outgoingLayer.pan.x}px), calc(-50% + ${outgoingLayer.pan.y}px)) scale(${outgoingLayer.zoom})`,
          }}
          dangerouslySetInnerHTML={{ __html: outgoingLayer.svg }}
        />
      )}

      {renderedSvg ? (
        <div
          ref={activeStageRef}
          className={`canvas-stage ${cameraGlide ? 'smooth-camera' : ''} ${
            outgoingLayer ? `canvas-layer-in mode-${outgoingLayer.mode}` : ''
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
            Select a file in the Explorer or click <code>+</code> to create a diagram
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
          Switch to Code view to edit this diagram
        </div>
      )}

      {/* Hierarchy Breadcrumb */}
      {breadcrumbHops.length > 0 && (
        <nav
          className="canvas-breadcrumb"
          data-testid="canvas-breadcrumb"
          aria-label="Diagram breadcrumb"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {breadcrumbHops.map((hop, idx) => {
            const hasMultipleBranches = hop.siblingBranches.length > 1;
            const isMenuOpen = openBranchHopIdx === idx;

            return (
              <span key={`${hop.parentFile.id}-${hop.childFile.id}`} className="crumb-hop-group">
                <button
                  type="button"
                  className="crumb-link"
                  onClick={() => onJumpToAncestor(hop.parentFile.id)}
                  title={`Open ${hop.parentFile.title}`}
                >
                  {hop.parentFile.title}
                </button>
                <span className="crumb-sep">/</span>

                {hop.viaComponentLabel && (
                  <>
                    <span className="crumb-branch-wrap">
                      {hasMultipleBranches ? (
                        <button
                          type="button"
                          className={`crumb-component switchable ${
                            isMenuOpen ? 'open' : ''
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenBranchHopIdx((prev) => (prev === idx ? null : idx));
                          }}
                          title="Switch component"
                        >
                          <Box size={13} className="crumb-box-icon" />
                          <span>{hop.viaComponentLabel}</span>
                          <ChevronDown size={13} className="crumb-chevron" />
                        </button>
                      ) : (
                        <span className="crumb-component">
                          <Box size={13} className="crumb-box-icon" />
                          <span>{hop.viaComponentLabel}</span>
                        </span>
                      )}

                      {hasMultipleBranches && isMenuOpen && (
                        <div
                          className="crumb-branch-menu"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="crumb-branch-menu-header">Components</div>
                          {hop.siblingBranches.map((branch) => {
                            const isCurrent = branch.childFile.id === hop.childFile.id;
                            return (
                              <button
                                key={`${branch.nodeId}-${branch.childFile.id}`}
                                type="button"
                                className={`crumb-branch-item ${
                                  isCurrent ? 'active' : ''
                                }`}
                                onClick={() => {
                                  setOpenBranchHopIdx(null);
                                  if (!isCurrent) {
                                    onOpenGraphById(branch.childFile.id);
                                  }
                                }}
                              >
                                <Box size={13} className="crumb-box-icon" />
                                <span className="crumb-branch-comp">
                                  {branch.componentLabel}
                                </span>
                                <ArrowRight size={12} className="crumb-branch-arrow" />
                                <span className="crumb-branch-target">
                                  {branch.childFile.title}
                                </span>
                                {isCurrent && <Check size={13} className="crumb-branch-check" />}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </span>
                    <span className="crumb-sep">/</span>
                  </>
                )}
              </span>
            );
          })}

          <span className="crumb-current">{activeGraphTitle || 'Diagram'}</span>
        </nav>
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
          <span>Viewing v{historicalVersion} — Back to latest</span>
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
          <AlertCircle size={16} />
          <span>
            {parseError.line ? `Syntax error on line ${parseError.line}` : 'Syntax error'} — View
            code
          </span>
        </div>
      )}

      {/* Node Inspector Card */}
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
              <h3 className="node-inspector-title">
                {resolveDisplayLabel(selectedNodeId)}
              </h3>
            </div>
            <button
              type="button"
              className="icon-btn"
              onClick={() => onSelectNode(null)}
              title="Close"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          <div className="node-inspector-body">
            <p className="node-inspector-summary">{selectedDetail.summary}</p>

            {selectedDetail.example && (
              <div className="node-inspector-section">
                <div className="node-inspector-label">Example</div>
                <div className="node-inspector-example">{selectedDetail.example}</div>
              </div>
            )}

            {selectedDetail.whatIf && (
              <div className="node-inspector-section">
                <div className="node-inspector-label hint">
                  <TriangleAlert size={13} />
                  <span>What breaks if…</span>
                </div>
                <div className="node-inspector-whatif">{selectedDetail.whatIf}</div>
              </div>
            )}

            {selectedDetail.files && selectedDetail.files.length > 0 && (
              <div className="node-inspector-section">
                <div className="node-inspector-label">Files</div>
                <div className="node-inspector-files">
                  {selectedDetail.files.map((fp) => (
                    <button
                      key={fp}
                      type="button"
                      className="node-file-chip"
                      onClick={() => onCopyFilePath(fp)}
                      title="Copy path"
                    >
                      <FileCode2 size={14} />
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
                <Layers size={15} />
                <span>Zoom into {selectedDetail.childPath}</span>
                <ArrowRight size={15} />
              </button>
            )}
          </div>
        </aside>
      )}

      {/* Walkthrough & Overview Dock */}
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
                    Walk through step by step or click any highlighted box for details.
                  </div>
                )}
                {documentedNodeIds.length > 0 && (
                  <div className="comprehension-subhint">
                    <Sparkles size={13} />
                    <span>Click any highlighted box for details</span>
                  </div>
                )}
              </div>

              {steps.length > 0 && (
                <button
                  type="button"
                  className="btn sm story-start-btn"
                  data-testid="story-start-btn"
                  onClick={() => onChangeStepIndex(0)}
                  title="Start walkthrough"
                >
                  <Play size={13} />
                  <span>Walk through ({steps.length})</span>
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

                <div className="story-step-dots" role="tablist" aria-label="Walkthrough steps">
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
                  title="Exit walkthrough"
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
                        title="View details"
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
                    title="Previous step"
                  >
                    <ChevronLeft size={15} />
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
                    title="Next step"
                  >
                    <span>
                      {activeStepIndex! + 1 < steps.length ? 'Next' : 'Finish'}
                    </span>
                    <ChevronRight size={15} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="floating-zoom-bar" onMouseDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => {
            setCameraGlide(true);
            onChangeZoom((z) => Number(Math.max(0.15, z - 0.14).toFixed(2)));
          }}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <ZoomOut size={15} />
        </button>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => {
            setCameraGlide(true);
            onResetView();
          }}
          title="Reset zoom"
          aria-label="Reset zoom"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => {
            setCameraGlide(true);
            onChangeZoom((z) => Number(Math.min(6, z + 0.14).toFixed(2)));
          }}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <ZoomIn size={15} />
        </button>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => {
            setCameraGlide(true);
            onFitCanvas();
          }}
          title="Fit to screen"
          aria-label="Fit to screen"
        >
          <Maximize2 size={15} />
        </button>
      </div>
    </div>
  );
}
