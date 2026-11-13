import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  Maximize2,
  Minus,
  PanelLeftOpen,
  Plus,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { resolveGuideFlows } from '../../src/shared/comprehension';
import type { DiagramComprehensionGuide, ParseErrorDetail } from '../../src/shared/types';
import type { GraphBreadcrumbHop, VfsProjectRoot } from '../../src/shared/vfs';
import { graphTitleFromPath, normalizeRelativeGraphPath } from '../../src/shared/vfsPath';
import { useCanvasViewport } from '../hooks/useCanvasViewport';
import { useUiStore, type AnchorPoint, type CanvasTransitionKind } from '../store/uiStore';
import { applySvgComprehensionState } from '../utils/svgComprehension';
import { NodePopover } from './NodePopover';

interface PreviewCanvasProps {
  viewportRef: RefObject<HTMLDivElement | null>;
  chartKey: string;
  renderedSvg: string;
  hasActiveFile: boolean;
  activeProject: VfsProjectRoot | null;
  parseError: ParseErrorDetail | null;
  guide?: DiagramComprehensionGuide;
  activeFlowId: string | null;
  activeStepIndex: number | null;
  selectedNodeId: string | null;
  nodeAnchorPoint: AnchorPoint | null;
  onSelectNode: (nodeId: string | null, anchorPoint?: AnchorPoint | null) => void;
  breadcrumbHops: GraphBreadcrumbHop[];
  showInlineBreadcrumb: boolean;
  canReopenStory: boolean;
  onReopenStory: () => void;
  transitionKind: CanvasTransitionKind;
  onJumpToAncestor: (fileId: string) => void;
  onDrillToPath: (targetPath: string) => void;
  onFitCanvas: () => void;
  onCopyRef: (refText: string) => void;
}

interface FrozenLayer {
  svg: string;
  zoom: number;
  pan: { x: number; y: number };
  mode: CanvasTransitionKind;
}

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 6;

export function PreviewCanvas({
  viewportRef,
  chartKey,
  renderedSvg,
  hasActiveFile,
  activeProject,
  parseError,
  guide,
  activeFlowId,
  activeStepIndex,
  selectedNodeId,
  nodeAnchorPoint,
  onSelectNode,
  breadcrumbHops,
  showInlineBreadcrumb,
  canReopenStory,
  onReopenStory,
  transitionKind,
  onJumpToAncestor,
  onDrillToPath,
  onFitCanvas,
  onCopyRef,
}: PreviewCanvasProps) {
  const zoom = useUiStore((s) => s.zoom);
  const pan = useUiStore((s) => s.pan);
  const fitTrigger = useUiStore((s) => s.fitTrigger);
  const setZoom = useUiStore((s) => s.setZoom);
  const setPan = useUiStore((s) => s.setPan);
  const markUserCameraAdjusted = useUiStore((s) => s.markUserCameraAdjusted);

  const [cameraGlide, setCameraGlide] = useState(false);
  const [outgoingLayer, setOutgoingLayer] = useState<FrozenLayer | null>(null);
  const [nodeLabels, setNodeLabels] = useState<Map<string, string>>(() => new Map());

  const activeStageRef = useRef<HTMLDivElement | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevFitTriggerRef = useRef(fitTrigger);

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
        markUserCameraAdjusted();
        if (cameraGlide) setCameraGlide(false);
      },
    });

  const flows = resolveGuideFlows(guide);
  const currentFlow =
    (activeFlowId && flows.find((f) => f.id === activeFlowId)) || flows[0] || null;
  const steps = currentFlow?.steps ?? [];

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

  const resolveChildTitle = (rawChildPath?: string): string | null => {
    if (!rawChildPath || !activeProject) return null;
    try {
      const norm = normalizeRelativeGraphPath(rawChildPath);
      const found = activeProject.files.find((f) => f.path === norm);
      return found?.title?.trim() || graphTitleFromPath(norm);
    } catch {
      return null;
    }
  };

  const handleNudgePan = useCallback(
    (delta: { dx: number; dy: number }) => {
      setCameraGlide(true);
      const curPan = useUiStore.getState().pan;
      setPan({ x: curPan.x + delta.dx, y: curPan.y + delta.dy });
    },
    [setPan]
  );

  const stepZoom = (factor: number) => {
    markUserCameraAdjusted();
    setCameraGlide(true);
    setZoom((cur) => Number(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cur * factor)).toFixed(2)));
  };

  return (
    <div className="preview-stage-layout">
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
              if (selectedNodeId === nid) {
                onSelectNode(null);
              } else {
                onSelectNode(nid, { clientX: e.clientX, clientY: e.clientY });
              }
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
        {(canReopenStory || (showInlineBreadcrumb && breadcrumbHops.length > 0)) && (
          <div
            className="canvas-top-overlay"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {canReopenStory && (
              <button
                type="button"
                className="canvas-overlay-pill"
                onClick={onReopenStory}
                title="Show reading guide"
              >
                <PanelLeftOpen size={14} />
                <span>Guide</span>
              </button>
            )}

            {showInlineBreadcrumb && breadcrumbHops.length > 0 && (
              <nav
                className="canvas-inline-breadcrumb"
                data-testid="canvas-breadcrumb"
                aria-label="Diagram breadcrumb"
              >
                <button
                  type="button"
                  className="crumb-back-btn"
                  onClick={() =>
                    onJumpToAncestor(breadcrumbHops[breadcrumbHops.length - 1]!.parentFile.id)
                  }
                  aria-label="Back to parent view"
                >
                  <ArrowLeft size={13} />
                </button>
                {breadcrumbHops.map((hop) => {
                  const parentName =
                    hop.parentFile.title?.trim() || graphTitleFromPath(hop.parentFile.path);
                  return (
                    <span
                      key={`${hop.parentFile.id}-${hop.childFile.id}`}
                      className="crumb-hop-group"
                    >
                      <button
                        type="button"
                        className="crumb-link"
                        onClick={() => onJumpToAncestor(hop.parentFile.id)}
                      >
                        {parentName}
                      </button>
                      <ChevronRight size={13} className="crumb-sep" />
                    </span>
                  );
                })}
                <span className="crumb-current">
                  {breadcrumbHops[breadcrumbHops.length - 1]!.childFile.title?.trim() ||
                    graphTitleFromPath(
                      breadcrumbHops[breadcrumbHops.length - 1]!.childFile.path
                    )}
                </span>
              </nav>
            )}
          </div>
        )}

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
              Ask your AI agent to explain a concept, paper, codebase, bug, or design tradeoff
            </div>
          </div>
        ) : null}

        {parseError && (
          <div
            className="floating-error-pill"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <AlertCircle size={16} />
            <span>
              {parseError.line
                ? `Diagram render error on line ${parseError.line}: ${parseError.message}`
                : parseError.message}
            </span>
          </div>
        )}

        {selectedNodeId && selectedDetail && (
          <NodePopover
            viewportRef={viewportRef}
            stageRef={activeStageRef}
            selectedNodeId={selectedNodeId}
            detail={selectedDetail}
            displayLabel={resolveDisplayLabel(selectedNodeId)}
            childTitle={resolveChildTitle(selectedDetail.childPath)}
            anchorPoint={nodeAnchorPoint}
            zoom={zoom}
            pan={pan}
            onNudgePan={handleNudgePan}
            onClose={() => onSelectNode(null)}
            onDrillToPath={onDrillToPath}
            onCopyRef={onCopyRef}
          />
        )}

        {renderedSvg && hasActiveFile && (
          <div
            className="canvas-zoom-hud"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="hud-btn"
              onClick={() => stepZoom(0.86)}
              title="Zoom out"
              aria-label="Zoom out"
            >
              <Minus size={14} />
            </button>
            <span className="hud-zoom-label">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              className="hud-btn"
              onClick={() => stepZoom(1.16)}
              title="Zoom in"
              aria-label="Zoom in"
            >
              <Plus size={14} />
            </button>
            <span className="hud-sep" aria-hidden="true" />
            <button
              type="button"
              className="hud-btn"
              onClick={onFitCanvas}
              title="Fit to screen"
              aria-label="Fit to screen"
            >
              <Maximize2 size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
