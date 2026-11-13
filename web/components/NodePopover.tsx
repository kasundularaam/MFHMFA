import { ArrowUpRight, FileCode2, Layers, TriangleAlert, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { resolveNodeRefs } from '../../src/shared/comprehension';
import type { DiagramNodeDetail } from '../../src/shared/types';
import { graphTitleFromPath } from '../../src/shared/vfsPath';
import type { AnchorPoint } from '../store/uiStore';

interface NodePopoverProps {
  viewportRef: RefObject<HTMLDivElement | null>;
  stageRef: RefObject<HTMLDivElement | null>;
  selectedNodeId: string;
  detail: DiagramNodeDetail;
  displayLabel: string;
  childTitle?: string | null;
  anchorPoint: AnchorPoint | null;
  zoom: number;
  pan: { x: number; y: number };
  onNudgePan?: (delta: { dx: number; dy: number }) => void;
  onClose: () => void;
  onDrillToPath: (targetPath: string) => void;
  onCopyRef: (refText: string) => void;
}

interface PopoverCoords {
  left: number;
  top: number;
  width: number;
  maxBodyHeight: number;
}

const GAP = 14;
const VIEWPORT_MARGIN = 12;

function clamp(val: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, val));
}

function findMatchingNodeElement(
  stageEl: HTMLDivElement | null,
  nodeId: string,
  anchorPoint: AnchorPoint | null
): Element | null {
  if (!stageEl) return null;
  const candidates = Array.from(stageEl.querySelectorAll('[data-mfhmfa-node]')).filter(
    (el) =>
      el.getAttribute('data-mfhmfa-node') === nodeId &&
      el.getAttribute('data-mfhmfa-actor-text') !== 'true'
  );
  if (candidates.length === 0) return null;
  if (candidates.length === 1 || !anchorPoint) return candidates[0]!;

  let best = candidates[0]!;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const el of candidates) {
    const r = el.getBoundingClientRect();
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    const dist = Math.hypot(cx - anchorPoint.clientX, cy - anchorPoint.clientY);
    if (dist < bestDist) {
      bestDist = dist;
      best = el;
    }
  }
  return best;
}

export function NodePopover({
  viewportRef,
  stageRef,
  selectedNodeId,
  detail,
  displayLabel,
  childTitle,
  anchorPoint,
  zoom,
  pan,
  onNudgePan,
  onClose,
  onDrillToPath,
  onCopyRef,
}: NodePopoverProps) {
  const cardRef = useRef<HTMLElement | null>(null);
  const nudgedForNodeRef = useRef<string | null>(null);
  const [coords, setCoords] = useState<PopoverCoords>({
    left: 16,
    top: 16,
    width: 328,
    maxBodyHeight: 320,
  });

  const refs = resolveNodeRefs(detail);
  const drillLabel =
    childTitle?.trim() || (detail.childPath ? graphTitleFromPath(detail.childPath) : null);

  useLayoutEffect(() => {
    const vpEl = viewportRef.current;
    const cardEl = cardRef.current;
    if (!vpEl || !cardEl) return undefined;

    const computePlacement = (allowCameraNudge: boolean) => {
      const vpRect = vpEl.getBoundingClientRect();
      if (vpRect.width <= 0 || vpRect.height <= 0) return;

      const targetWidth = Math.min(
        336,
        Math.max(248, Math.floor(vpRect.width * 0.54)),
        Math.max(220, Math.floor(vpRect.width - VIEWPORT_MARGIN * 2))
      );
      const popW = targetWidth;
      const popH = cardEl.offsetHeight || 220;
      const maxBodyHeight = Math.max(140, Math.floor(vpRect.height - 132));

      const nodeEl = findMatchingNodeElement(stageRef.current, selectedNodeId, anchorPoint);
      if (!nodeEl) {
        setCoords({
          left: Math.max(VIEWPORT_MARGIN, vpRect.width - popW - 16),
          top: 16,
          width: targetWidth,
          maxBodyHeight,
        });
        return;
      }

      const nRect = nodeEl.getBoundingClientRect();
      const nLeft = nRect.left - vpRect.left;
      const nRight = nRect.right - vpRect.left;
      const nTop = nRect.top - vpRect.top;
      const nBottom = nRect.bottom - vpRect.top;
      const nCenterX = (nLeft + nRight) / 2;
      const nCenterY = (nTop + nBottom) / 2;

      const spaceRight = vpRect.width - nRight - GAP - VIEWPORT_MARGIN;
      const spaceLeft = nLeft - GAP - VIEWPORT_MARGIN;
      const spaceBottom = vpRect.height - nBottom - GAP - VIEWPORT_MARGIN;
      const spaceTop = nTop - GAP - VIEWPORT_MARGIN;

      const nudgeBucketKey = `${selectedNodeId}::${Math.round(vpRect.width / 48)}`;

      // If neither horizontal nor vertical side fits without overlapping the clicked node,
      // gently slide the canvas so the node and its popover sit side-by-side!
      if (
        allowCameraNudge &&
        onNudgePan &&
        nudgedForNodeRef.current !== nudgeBucketKey &&
        spaceRight < popW &&
        spaceLeft < popW &&
        spaceBottom < popH &&
        spaceTop < popH &&
        vpRect.width >= popW + Math.min(160, nRect.width * 0.65) + GAP + VIEWPORT_MARGIN * 2
      ) {
        nudgedForNodeRef.current = nudgeBucketKey;
        const neededShiftLeft = Math.round(popW - spaceRight);
        onNudgePan({ dx: -neededShiftLeft, dy: 0 });
        return;
      }

      let left: number;
      let top: number;

      if (spaceRight >= popW) {
        left = nRight + GAP;
        top = clamp(
          nCenterY - popH / 2,
          VIEWPORT_MARGIN,
          vpRect.height - popH - VIEWPORT_MARGIN
        );
      } else if (spaceLeft >= popW) {
        left = nLeft - GAP - popW;
        top = clamp(
          nCenterY - popH / 2,
          VIEWPORT_MARGIN,
          vpRect.height - popH - VIEWPORT_MARGIN
        );
      } else if (spaceBottom >= popH) {
        left = clamp(
          nCenterX - popW / 2,
          VIEWPORT_MARGIN,
          vpRect.width - popW - VIEWPORT_MARGIN
        );
        top = nBottom + GAP;
      } else if (spaceTop >= popH) {
        left = clamp(
          nCenterX - popW / 2,
          VIEWPORT_MARGIN,
          vpRect.width - popW - VIEWPORT_MARGIN
        );
        top = nTop - GAP - popH;
      } else if (spaceRight >= spaceLeft) {
        left = clamp(nRight + GAP, VIEWPORT_MARGIN, vpRect.width - popW - VIEWPORT_MARGIN);
        top = clamp(
          nCenterY - popH / 2,
          VIEWPORT_MARGIN,
          vpRect.height - popH - VIEWPORT_MARGIN
        );
      } else {
        left = clamp(
          nLeft - GAP - popW,
          VIEWPORT_MARGIN,
          vpRect.width - popW - VIEWPORT_MARGIN
        );
        top = clamp(
          nCenterY - popH / 2,
          VIEWPORT_MARGIN,
          vpRect.height - popH - VIEWPORT_MARGIN
        );
      }

      setCoords({
        left: Math.round(left),
        top: Math.round(top),
        width: targetWidth,
        maxBodyHeight,
      });
    };

    computePlacement(true);

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => computePlacement(true));
      ro.observe(vpEl);
      ro.observe(cardEl);
      return () => ro.disconnect();
    }
    return undefined;
  }, [anchorPoint, onNudgePan, pan.x, pan.y, selectedNodeId, stageRef, viewportRef, zoom]);

  return (
    <aside
      ref={cardRef}
      className="node-popover-card"
      data-testid="node-inspector-card"
      style={{
        left: `${coords.left}px`,
        top: `${coords.top}px`,
        width: `${coords.width}px`,
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="node-inspector-header">
        <div className="node-inspector-title-wrap">
          <h3 className="node-inspector-title">{displayLabel}</h3>
          {detail.term && (
            <div className="node-inspector-term" data-testid="node-inspector-term">
              {detail.term}
            </div>
          )}
        </div>
        <button
          type="button"
          className="icon-btn node-popover-close"
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close"
        >
          <X size={15} />
        </button>
      </div>

      <div className="node-inspector-body" style={{ maxHeight: `${coords.maxBodyHeight}px` }}>
        <p className="node-inspector-summary">{detail.summary}</p>

        {detail.example && (
          <div className="node-inspector-section">
            <div className="node-inspector-label">Example</div>
            <div className="node-inspector-example">{detail.example}</div>
          </div>
        )}

        {detail.whatIf && (
          <div className="node-inspector-section">
            <div className="node-inspector-label hint">
              <TriangleAlert size={13} />
              <span>What breaks if…</span>
            </div>
            <div className="node-inspector-whatif">{detail.whatIf}</div>
          </div>
        )}

        {refs.length > 0 && (
          <div className="node-inspector-section">
            <div className="node-inspector-label">
              {detail.refs?.length ? 'References' : 'Files'}
            </div>
            <div className="node-inspector-files">
              {refs.map((refItem) => (
                <button
                  key={refItem}
                  type="button"
                  className="node-file-chip"
                  onClick={() => onCopyRef(refItem)}
                  title="Copy reference"
                >
                  <FileCode2 size={13} />
                  <span>{refItem}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {detail.childPath && (
        <div className="node-popover-footer">
          <button
            type="button"
            className="btn node-drilldown-btn"
            onClick={() => onDrillToPath(detail.childPath!)}
          >
            <span className="node-drilldown-left">
              <Layers size={14} />
              <span>Explore {drillLabel || detail.childPath}</span>
            </span>
            <ArrowUpRight size={15} />
          </button>
        </div>
      )}
    </aside>
  );
}
