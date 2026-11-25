import type {
  DiagramComprehensionGuide,
  DiagramLegendItem,
  DiagramLegendSymbol,
  DiagramNodeKind,
} from './types.js';

export const NODE_KIND_LABELS: Record<DiagramNodeKind, string> = {
  actor: 'Actor / Trigger',
  service: 'Service / Code',
  store: 'Table / Store',
  queue: 'Queue / Stream',
  job: 'Job / Worker',
  decision: 'Decision',
  subsystem: 'Subsystem',
  concept: 'Stage / Concept',
};

const DEFAULT_SYMBOL_LABELS: Record<DiagramLegendSymbol, string> = {
  ...NODE_KIND_LABELS,
  'sync-edge': 'Direct / Sync',
  'async-edge': 'Async / Scheduled',
  drillable: 'Dive deeper',
};

const SYMBOL_ORDER: readonly DiagramLegendSymbol[] = [
  'actor',
  'service',
  'store',
  'queue',
  'job',
  'decision',
  'subsystem',
  'concept',
  'drillable',
  'sync-edge',
  'async-edge',
];

function stripQuotedStrings(line: string): string {
  return line.replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

function isFlowchartSource(code: string): boolean {
  const firstMeaningful = code
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('%%') && !l.startsWith('---'));
  return Boolean(firstMeaningful && /^(?:flowchart|graph)\b/.test(firstMeaningful));
}

function detectMermaidSymbolsFromCode(code: string): Set<DiagramLegendSymbol> {
  const found = new Set<DiagramLegendSymbol>();
  if (!isFlowchartSource(code)) {
    return found;
  }

  for (const rawLine of code.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (
      !line ||
      line.startsWith('%%') ||
      line.startsWith('flowchart ') ||
      line.startsWith('graph ') ||
      line.startsWith('subgraph ') ||
      line.startsWith('end') ||
      line.startsWith('classDef ') ||
      line.startsWith('style ') ||
      line.startsWith('linkStyle ')
    ) {
      continue;
    }

    const bare = stripQuotedStrings(line);

    if (/[A-Za-z0-9_-]\s*\(\[/.test(bare)) found.add('actor');
    if (/[A-Za-z0-9_-]\s*\[\(/.test(bare)) found.add('store');
    if (/[A-Za-z0-9_-]\s*\{\{/.test(bare)) found.add('job');
    if (/[A-Za-z0-9_-]\s*\[\[/.test(bare)) found.add('subsystem');
    if (/[A-Za-z0-9_-]\s*\[\/[^\]]*\/\]/.test(bare)) found.add('queue');
    if (/[A-Za-z0-9_-]\s*\{(?!\{)/.test(bare)) found.add('decision');
    // Plain rectangle `Node["..."]` or `Node[...]` (excluding `[(`, `[[`, `[/`)
    if (/[A-Za-z0-9_-]\s*\[(?![([/\\])/.test(bare)) found.add('service');

    if (/(?:<-->|-->|==>|===|---)/.test(bare)) found.add('sync-edge');
    if (/(?:<-+\.+-+>|-\.->|-\.-)/.test(bare)) found.add('async-edge');
  }

  return found;
}

/**
 * Derives a compact, diagram-specific legend showing only the node shapes,
 * interaction cues, and arrow styles actually used in the current view.
 * Custom `guide.legend` entries override default labels for matching symbols.
 */
export function deriveDiagramLegend(
  code: string,
  guide?: DiagramComprehensionGuide
): DiagramLegendItem[] {
  const detected = detectMermaidSymbolsFromCode(code);
  const explicitKinds = new Set<DiagramNodeKind>();
  let hasDrillable = false;

  if (guide?.nodes) {
    for (const detail of Object.values(guide.nodes)) {
      if (detail.kind) {
        explicitKinds.add(detail.kind);
      }
      if (detail.childPath) {
        hasDrillable = true;
      }
    }
  }

  // Prefer explicit `guide.nodes[*].kind` over heuristic rectangle fallback
  const activeSymbols = new Set<DiagramLegendSymbol>();
  if (explicitKinds.size > 0) {
    for (const kind of explicitKinds) {
      activeSymbols.add(kind);
    }
    // Keep non-rectangle Mermaid shapes detected in code in case a node wasn't listed in guide.nodes
    for (const sym of detected) {
      if (sym !== 'service' || explicitKinds.has('service')) {
        activeSymbols.add(sym);
      }
    }
  } else {
    for (const sym of detected) {
      activeSymbols.add(sym);
    }
  }

  if (hasDrillable) {
    activeSymbols.add('drillable');
  }

  const customLabelBySymbol = new Map<DiagramLegendSymbol, string>();
  if (guide?.legend) {
    for (const item of guide.legend) {
      customLabelBySymbol.set(item.symbol, item.label);
      activeSymbols.add(item.symbol);
    }
  }

  // If the diagram only uses plain rectangles with no explicit kinds, label them neutrally as "Component"
  const onlyPlainRectangles =
    explicitKinds.size === 0 &&
    activeSymbols.has('service') &&
    !activeSymbols.has('actor') &&
    !activeSymbols.has('store') &&
    !activeSymbols.has('queue') &&
    !activeSymbols.has('job') &&
    !activeSymbols.has('decision') &&
    !activeSymbols.has('subsystem') &&
    !activeSymbols.has('concept');

  const items: DiagramLegendItem[] = [];
  for (const symbol of SYMBOL_ORDER) {
    if (!activeSymbols.has(symbol)) continue;
    const label =
      customLabelBySymbol.get(symbol) ??
      (symbol === 'service' && onlyPlainRectangles
        ? 'Component'
        : DEFAULT_SYMBOL_LABELS[symbol]);
    items.push({ symbol, label });
  }

  return items;
}
