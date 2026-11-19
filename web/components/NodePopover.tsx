import {
  AlertTriangle,
  ArrowUpRight,
  ChevronRight,
  Code2,
  FileCode2,
  Terminal,
  X,
} from 'lucide-react';
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
              <span>Dive deeper</span>
              <ArrowUpRight size={13} />
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
            <Code2 size={12} className="node-term-icon" />
            <span>{detail.term}</span>
          </div>
        )}

        <p className="node-inspector-summary">{detail.summary}</p>

        {detail.example && (
          <div className="node-inspector-section">
            <div className="node-inspector-label">
              <Terminal size={12} />
              <span>Example</span>
            </div>
            <div className="node-inspector-example">{detail.example}</div>
          </div>
        )}

        {detail.whatIf && (
          <div className="node-inspector-section">
            <div className="node-inspector-label hint">
              <AlertTriangle size={12} />
              <span>What breaks if…</span>
            </div>
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
              <FileCode2 size={13} className="node-refs-icon" />
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
                    <FileCode2 size={12} className="node-ref-item-icon" />
                    <span>{refItem}</span>
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
