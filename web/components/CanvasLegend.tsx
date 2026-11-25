import { ChevronDown, ChevronUp, Map as MapIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DiagramComprehensionGuide, DiagramLegendSymbol } from '../../src/shared/types';
import { deriveDiagramLegend } from '../../src/shared/diagramLegend';

interface CanvasLegendProps {
  code: string;
  guide?: DiagramComprehensionGuide;
}

function LegendGlyph({ symbol }: { symbol: DiagramLegendSymbol }) {
  switch (symbol) {
    case 'actor':
      return (
        <svg className="legend-glyph" viewBox="0 0 24 14" width="22" height="13" aria-hidden="true">
          <rect
            x="1.5"
            y="1.5"
            width="21"
            height="11"
            rx="5.5"
            ry="5.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          />
        </svg>
      );
    case 'service':
    case 'concept':
      return (
        <svg className="legend-glyph" viewBox="0 0 24 14" width="22" height="13" aria-hidden="true">
          <rect
            x="1.5"
            y="1.5"
            width="21"
            height="11"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          />
        </svg>
      );
    case 'store':
      return (
        <svg className="legend-glyph" viewBox="0 0 22 16" width="20" height="14" aria-hidden="true">
          <ellipse
            cx="11"
            cy="3.5"
            rx="8.5"
            ry="2.3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.35"
          />
          <path
            d="M2.5 3.5v8.5c0 1.27 3.8 2.3 8.5 2.3s8.5-1.03 8.5-2.3V3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.35"
          />
        </svg>
      );
    case 'queue':
      return (
        <svg className="legend-glyph" viewBox="0 0 24 14" width="22" height="13" aria-hidden="true">
          <polygon
            points="5,1.5 22.5,1.5 19,12.5 1.5,12.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'job':
      return (
        <svg className="legend-glyph" viewBox="0 0 24 14" width="22" height="13" aria-hidden="true">
          <polygon
            points="5.5,1.5 18.5,1.5 22.5,7 18.5,12.5 5.5,12.5 1.5,7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'decision':
      return (
        <svg className="legend-glyph" viewBox="0 0 22 16" width="20" height="14" aria-hidden="true">
          <polygon
            points="11,1.3 20.2,8 11,14.7 1.8,8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.35"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'subsystem':
      return (
        <svg className="legend-glyph" viewBox="0 0 24 14" width="22" height="13" aria-hidden="true">
          <rect
            x="1.5"
            y="1.5"
            width="21"
            height="11"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.35"
          />
          <line x1="5" y1="1.5" x2="5" y2="12.5" stroke="currentColor" strokeWidth="1.2" />
          <line x1="19" y1="1.5" x2="19" y2="12.5" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
    case 'drillable':
      return (
        <svg
          className="legend-glyph legend-glyph-drill"
          viewBox="0 0 24 14"
          width="22"
          height="13"
          aria-hidden="true"
        >
          <rect
            x="1.5"
            y="1.5"
            width="21"
            height="11"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.45"
            strokeDasharray="3.5 2"
          />
        </svg>
      );
    case 'sync-edge':
      return (
        <svg className="legend-glyph" viewBox="0 0 24 12" width="22" height="12" aria-hidden="true">
          <line x1="1.5" y1="6" x2="19.5" y2="6" stroke="currentColor" strokeWidth="1.45" />
          <polyline
            points="15.5,2.5 20.5,6 15.5,9.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.45"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'async-edge':
      return (
        <svg className="legend-glyph" viewBox="0 0 24 12" width="22" height="12" aria-hidden="true">
          <line
            x1="1.5"
            y1="6"
            x2="19.5"
            y2="6"
            stroke="currentColor"
            strokeWidth="1.45"
            strokeDasharray="3.5 2.5"
          />
          <polyline
            points="15.5,2.5 20.5,6 15.5,9.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.45"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
  }
}

export function CanvasLegend({ code, guide }: CanvasLegendProps) {
  const [open, setOpen] = useState(true);
  const items = useMemo(() => deriveDiagramLegend(code, guide), [code, guide]);

  if (items.length === 0) return null;

  return (
    <section
      className={`canvas-legend-bar ${open ? 'open' : 'collapsed'}`}
      data-testid="canvas-legend"
      aria-label="Diagram legend"
    >
      <button
        type="button"
        className="canvas-legend-toggle"
        data-testid="canvas-legend-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={open ? 'Hide legend' : 'Show legend'}
      >
        <MapIcon size={12} className="canvas-legend-icon" />
        <span className="canvas-legend-title">LEGEND</span>
        {open ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
      </button>

      {open && (
        <ul className="canvas-legend-list">
          {items.map((item) => (
            <li
              key={item.symbol}
              className={`canvas-legend-item ${item.symbol === 'drillable' ? 'is-drill' : ''}`}
              data-legend-symbol={item.symbol}
            >
              <LegendGlyph symbol={item.symbol} />
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
