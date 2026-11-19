import { ChevronRight, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { resolveNodeRefs } from '../../src/shared/comprehension';
import type { DiagramNodeDetail } from '../../src/shared/types';

interface NodePopoverProps {
  selectedNodeId: string;
  detail: DiagramNodeDetail;
  displayLabel: string;
  onClose: () => void;
  onDrillToPath: (targetPath: string) => void;
  onCopyRef: (refText: string) => void;
}

export function NodePopover({
  selectedNodeId,
  detail,
  displayLabel,
  onClose,
  onDrillToPath,
  onCopyRef,
}: NodePopoverProps) {
  const [refsOpen, setRefsOpen] = useState(false);
  const refsListRef = useRef<HTMLDivElement | null>(null);

  // Always collapse References by default whenever switching to a different node
  useEffect(() => {
    setRefsOpen(false);
  }, [selectedNodeId]);

  useEffect(() => {
    if (refsOpen) {
      refsListRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [refsOpen]);

  const refs = resolveNodeRefs(detail);
  const refsLabel = detail.refs?.length ? 'References' : 'Files';

  return (
    <aside
      className="node-inspector-pane"
      data-testid="node-inspector-card"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="node-inspector-header">
        <h3 className="node-inspector-title">{displayLabel}</h3>

        <div className="node-inspector-header-actions">
          {detail.childPath && (
            <button
              type="button"
              className="node-drilldown-link node-drilldown-btn"
              onClick={() => onDrillToPath(detail.childPath!)}
            >
              Dive deeper →
            </button>
          )}

          <button
            type="button"
            className="icon-btn node-popover-close"
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="node-inspector-body">
        {detail.term && (
          <div className="node-inspector-term" data-testid="node-inspector-term">
            {detail.term}
          </div>
        )}

        <p className="node-inspector-summary">{detail.summary}</p>

        {detail.example && (
          <div className="node-inspector-section">
            <div className="node-inspector-label">Example</div>
            <div className="node-inspector-example">{detail.example}</div>
          </div>
        )}

        {detail.whatIf && (
          <div className="node-inspector-section">
            <div className="node-inspector-label hint">What breaks if…</div>
            <div className="node-inspector-whatif">{detail.whatIf}</div>
          </div>
        )}

        {refs.length > 0 && (
          <div className={`node-refs-disclosure ${refsOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="node-refs-trigger"
              data-testid="node-refs-toggle"
              aria-expanded={refsOpen}
              onClick={() => setRefsOpen((prev) => !prev)}
            >
              <ChevronRight size={13} className="node-refs-caret" />
              <span>
                {refsLabel} ({refs.length})
              </span>
            </button>

            {refsOpen && (
              <div
                ref={refsListRef}
                className="node-inspector-files"
                data-testid="node-refs-list"
              >
                {refs.map((refItem) => (
                  <button
                    key={refItem}
                    type="button"
                    className="node-ref-item"
                    onClick={() => onCopyRef(refItem)}
                    title="Copy reference"
                  >
                    {refItem}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
