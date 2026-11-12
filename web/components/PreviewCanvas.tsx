import {
  AlertCircle,
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileCode2,
  Layers,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { DiagramComprehensionGuide, ParseErrorDetail } from '../../src/shared/types';
import type { GraphBreadcrumbHop } from '../../src/shared/vfs';
import { graphTitleFromPath } from '../../src/shared/vfsPath';
import { useCanvasViewport } from '../hooks/useCanvasViewport';
import { useDragResize } from '../hooks/useDragResize';
import { useUiStore, type CanvasTransitionKind } from '../store/uiStore';
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
  breadcrumbHops: GraphBreadcrumbHop[];
  transitionKind: CanvasTransitionKind;
  onJumpToAncestor: (fileId: string) => void;
  onDrillToPath: (targetPath: string) => void;
  onCopyFilePath: (filePath: string) => void;
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
  onDrillToPath,
  onCopyFilePath,
  onFlipToCode,
}: PreviewCanvasProps) {
  const zoom = useUiStore((s) => s.zoom);
  const pan = useUiStore((s) => s.pan);
  const fitTrigger = useUiStore((s) => s.fitTrigger);
  const setZoom = useUiStore((s) => s.setZoom);
  const setPan = useUiStore((s) => s.setPan);

  const [cameraGlide, setCameraGlide] = useState(false);
  const [outgoingLayer, setOutgoingLayer] = useState<FrozenLayer | null>(null);
  const [nodeLabels, setNodeLabels] = useState<Map<string, string>>(() => new Map());
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [panelBodyHeight, setPanelBodyHeight] = useState(240);

  const stageLayoutRef = useRef<HTMLDivElement | null>(null);
  const activeStageRef = useRef<HTMLDivElement | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevFitTriggerRef = useRef(fitTrigger);
  const dragOriginPanelHeightRef = useRef(panelBodyHeight);

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

  const { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, wasDraggedRecently } =
    useCanvasViewport({
      viewportRef,
      zoom,
      pan,
      onChangeZoom: setZoom,
      onChangePan: setPan,
      onUserCameraGesture: () => {
        if (cameraGlide) setCameraGlide(false);
      },
    });

  const startPanelResize = useDragResize((_dx, dy) => {
    const stageHeight =
      stageLayoutRef.current?.getBoundingClientRect().height ?? window.innerHeight;
    const maxBodyHeight = Math.max(240, stageHeight - 44);
    const next = Math.min(maxBodyHeight, Math.max(32, dragOriginPanelHeightRef.current - dy));
    setPanelBodyHeight(Math.round(next));
  });

  const steps = guide?.steps ?? [];
  const activeStep =
    activeStepIndex !== null && steps[activeStepIndex] ? steps[activeStepIndex]! : null;

  const selectedDetail =
    selectedNodeId && guide?.nodes?.[selectedNodeId] ? guide.nodes[selectedNodeId]! : null;

  useEffect(
    () => () => {
      if (fadeTimerRef.current) {
        clearTimeout(fadeTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (fitTrigger !== prevFitTriggerRef.current) {
      prevFitTriggerRef.current = fitTrigger;
      setCameraGlide(true);
    }
  }, [fitTrigger]);

  useEffect(() => {
    if (activeStepIndex !== null) {
      setPanelCollapsed(false);
    }
  }, [activeStepIndex]);

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

  const hasOverview = Boolean(guide?.gist);
  const hasSteps = steps.length > 0;
  const showBottomPanel = hasActiveFile && Boolean(renderedSvg) && (hasOverview || hasSteps);
  const isWalkthroughActive = Boolean(activeStep) || (!hasOverview && hasSteps);

  return (
    <div ref={stageLayoutRef} className="preview-stage-layout">
      {breadcrumbHops.length > 0 && (
        <nav
          className="vscode-breadcrumb"
          data-testid="canvas-breadcrumb"
          aria-label="Diagram breadcrumb"
        >
          {breadcrumbHops.map((hop) => {
            const parentName = graphTitleFromPath(hop.parentFile.path);
            return (
              <span
                key={`${hop.parentFile.id}-${hop.childFile.id}`}
                className="crumb-hop-group"
              >
                <button
                  type="button"
                  className="crumb-link"
                  onClick={() => onJumpToAncestor(hop.parentFile.id)}
                  title={hop.parentFile.path}
                >
                  {parentName}
                </button>
                <ChevronRight size={13} className="crumb-sep" />
              </span>
            );
          })}

          <span className="crumb-current">
            {graphTitleFromPath(breadcrumbHops[breadcrumbHops.length - 1]!.childFile.path)}
          </span>
        </nav>
      )}

      <div
        ref={viewportRef}
        className="canvas-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClick={(e) => {
          if (wasDraggedRecently()) return;
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

        {historicalVersion !== null && (
          <div
            className="floating-history-pill"
            onClick={(e) => {
              e.stopPropagation();
              onExitHistoricalVersion?.();
            }}
            onPointerDown={(e) => e.stopPropagation()}
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
            onPointerDown={(e) => e.stopPropagation()}
          >
            <AlertCircle size={16} />
            <span>
              {parseError.line ? `Syntax error on line ${parseError.line}` : 'Syntax error'} —
              View code
            </span>
          </div>
        )}

        {selectedNodeId && selectedDetail && (
          <aside
            className="node-inspector-card"
            data-testid="node-inspector-card"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
          >
            <div className="node-inspector-header">
              <div className="node-inspector-title-wrap">
                <h3 className="node-inspector-title">{resolveDisplayLabel(selectedNodeId)}</h3>
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
      </div>

      {showBottomPanel && (
        <section
          className={`walkthrough-panel ${panelCollapsed ? 'collapsed' : ''}`}
          data-testid="comprehension-dock"
          aria-label="Walkthrough panel"
        >
          {!panelCollapsed && (
            <div
              className="walkthrough-resizer"
              onMouseDown={(e) => {
                dragOriginPanelHeightRef.current = panelBodyHeight;
                startPanelResize(e);
              }}
            />
          )}

          <div className="walkthrough-header">
            <div className="walkthrough-tabs" role="tablist">
              {hasOverview && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={!isWalkthroughActive}
                  className={`walkthrough-tab ${!isWalkthroughActive ? 'active' : ''}`}
                  onClick={() => {
                    setPanelCollapsed(false);
                    onChangeStepIndex(null);
                  }}
                >
                  Overview
                </button>
              )}

              {hasSteps && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={isWalkthroughActive}
                  data-testid="story-start-btn"
                  className={`walkthrough-tab ${isWalkthroughActive ? 'active' : ''}`}
                  onClick={() => {
                    setPanelCollapsed(false);
                    if (activeStepIndex === null) {
                      onChangeStepIndex(0);
                    }
                  }}
                >
                  <span>Walkthrough</span>
                  <span className="walkthrough-tab-count">{steps.length}</span>
                </button>
              )}
            </div>

            <div className="walkthrough-toolbar">
              {!isWalkthroughActive && hasSteps && (
                <button
                  type="button"
                  className="walkthrough-start-link"
                  onClick={() => {
                    setPanelCollapsed(false);
                    onChangeStepIndex(0);
                  }}
                  title="Start walkthrough (Right arrow)"
                >
                  <span>Start walkthrough</span>
                  <ArrowRight size={14} />
                </button>
              )}

              {isWalkthroughActive && hasSteps && (
                <div className="walkthrough-step-controls">
                  <span className="walkthrough-step-counter">
                    Step {(activeStepIndex ?? 0) + 1} / {steps.length}
                  </span>
                  <button
                    type="button"
                    className="panel-icon-btn"
                    disabled={(activeStepIndex ?? 0) <= 0}
                    onClick={() => {
                      setPanelCollapsed(false);
                      onChangeStepIndex(Math.max(0, (activeStepIndex ?? 0) - 1));
                    }}
                    title="Previous step (Left arrow)"
                    aria-label="Previous step"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    type="button"
                    className="panel-icon-btn"
                    disabled={activeStepIndex !== null && activeStepIndex >= steps.length - 1}
                    onClick={() => {
                      setPanelCollapsed(false);
                      onChangeStepIndex(
                        activeStepIndex === null
                          ? 0
                          : Math.min(steps.length - 1, activeStepIndex + 1)
                      );
                    }}
                    title="Next step (Right arrow)"
                    aria-label="Next step"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}

              <button
                type="button"
                className="panel-icon-btn"
                onClick={() => setPanelCollapsed((v) => !v)}
                title={panelCollapsed ? 'Expand panel' : 'Minimize panel'}
                aria-label={panelCollapsed ? 'Expand panel' : 'Minimize panel'}
              >
                {panelCollapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            </div>
          </div>

          {!panelCollapsed && (
            <div className="walkthrough-body" style={{ height: `${panelBodyHeight}px` }}>
              {activeStep ? (
                <div className="walkthrough-step-content">
                  <div className="story-step-title">{activeStep.title}</div>
                  <p className="story-step-caption">{activeStep.caption}</p>
                </div>
              ) : !hasOverview && steps[0] ? (
                <div className="walkthrough-step-content">
                  <div className="story-step-title">{steps[0].title}</div>
                  <p className="story-step-caption">{steps[0].caption}</p>
                </div>
              ) : (
                <p className="walkthrough-gist">{guide?.gist}</p>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
