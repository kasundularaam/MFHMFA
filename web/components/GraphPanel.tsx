import { useRef, type ReactNode } from 'react';
import { useDragResize } from '../hooks/useDragResize';

interface GraphPanelProps {
  width: number;
  minWidth: number;
  onResizeStart?: () => void;
  onResizeWidth: (desiredWidth: number) => void;
  children: ReactNode;
}

export function GraphPanel({
  width,
  minWidth,
  onResizeStart,
  onResizeWidth,
  children,
}: GraphPanelProps) {
  const dragOriginWidthRef = useRef(width);

  const startResizeDrag = useDragResize((dx) => {
    onResizeWidth(dragOriginWidthRef.current - dx);
  });

  return (
    <aside
      className="graph-panel"
      data-testid="graph-panel"
      style={{ width: `${width}px`, minWidth: `${minWidth}px` }}
      aria-label="Graph panel"
    >
      <div
        className="graph-panel-resizer"
        onMouseDown={(e) => {
          dragOriginWidthRef.current = width;
          onResizeStart?.();
          startResizeDrag(e);
        }}
      />

      <div className="sidebar-section-header graph-top-header">
        <span className="sidebar-section-title">GRAPH</span>
      </div>

      {children}
    </aside>
  );
}
