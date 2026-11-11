import type {
  DiagramDimensions,
  DiagramMetrics,
  LintWarning,
  MermaidTheme,
  ParseErrorDetail,
} from '../shared/types.js';

const KNOWN_HEADERS = [
  'flowchart',
  'graph',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'journey',
  'gantt',
  'pie',
  'quadrantChart',
  'requirementDiagram',
  'gitGraph',
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Dynamic',
  'C4Deployment',
  'mindmap',
  'timeline',
  'zenuml',
  'sankey-beta',
  'xychart-beta',
  'block-beta',
  'packet-beta',
  'kanban',
  'architecture-beta',
  'radar-beta',
] as const;

interface RawMermaidErrorShape {
  message?: unknown;
  str?: unknown;
  hash?: {
    line?: unknown;
    expected?: unknown;
    loc?: {
      first_line?: unknown;
      first_column?: unknown;
    };
  };
}

export function buildCodeSnippet(code: string, line: number | null): string | null {
  if (!line || line < 1) return null;
  const lines = code.split(/\r?\n/);
  if (line > lines.length + 1) return null;

  const start = Math.max(1, line - 2);
  const end = Math.min(lines.length, line + 2);
  const out: string[] = [];
  for (let i = start; i <= end; i++) {
    const marker = i === line ? '>' : ' ';
    const num = String(i).padStart(3, ' ');
    out.push(`${marker} ${num} | ${lines[i - 1] ?? ''}`);
  }
  return out.join('\n');
}

export function inferSuggestion(
  code: string,
  rawMessage: string,
  line: number | null
): string | null {
  const lines = code.split(/\r?\n/);
  const trimmedCode = code.trim();

  if (!trimmedCode) {
    return 'Provide Mermaid diagram code starting with a header such as `flowchart TD`, `sequenceDiagram`, `erDiagram`, or `stateDiagram-v2`.';
  }

  if (trimmedCode.startsWith('```')) {
    return 'Remove Markdown code fences (```mermaid ... ```) and pass only raw Mermaid diagram source.';
  }

  const firstMeaningfulLine = lines
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('%%') && !l.startsWith('---'));

  if (
    firstMeaningfulLine &&
    !KNOWN_HEADERS.some((h) => firstMeaningfulLine.startsWith(h))
  ) {
    return `Unknown or missing diagram header "${firstMeaningfulLine.split(/\s+/)[0]}". Start with a valid Mermaid header like \`flowchart TD\`, \`sequenceDiagram\`, \`classDiagram\`, \`stateDiagram-v2\`, \`erDiagram\`, \`mindmap\`, \`gantt\`, or \`architecture-beta\`.`;
  }

  const targetLine = line && lines[line - 1] ? lines[line - 1] : '';

  if (targetLine && /\w+\[[^"\]]*[(){}[\]][^"\]]*\]/.test(targetLine)) {
    return `Special characters like (), {}, or [] inside a node label on line ${line} break parsing. Wrap the label text in double quotes, e.g. \`NodeId["Label (detail)"]\`.`;
  }

  if (targetLine && /\w+\{[^"\}]*[()[\]][^"\}]*\}/.test(targetLine)) {
    return `Special characters inside a diamond decision node \`{...}\` on line ${line} must be wrapped in double quotes, e.g. \`Check{"Is x > f(y)?"}\`.`;
  }

  if (
    (targetLine && /\bend\b/.test(targetLine) && /-->|---|-\.-|==>/.test(targetLine)) ||
    /got 'end'/i.test(rawMessage)
  ) {
    return '`end` in lowercase is a reserved Mermaid keyword (used to close `subgraph`/`loop`/`alt`). Capitalize the node ID (`End`) or give it a safe ID with quoted label: `endNode["end"]`.';
  }

  if (
    /^(flowchart|graph)\b/m.test(trimmedCode) &&
    targetLine &&
    /(?<!-)->(?!>)/.test(targetLine)
  ) {
    return `Flowcharts use \`-->\` (solid arrow) or \`---\` (solid line), not single \`->\`. Replace \`->\` with \`-->\` on line ${line}.`;
  }

  const subgraphCount = (trimmedCode.match(/^\s*subgraph\b/gm) || []).length;
  const endCount = (trimmedCode.match(/^\s*end\s*$/gm) || []).length;
  if (subgraphCount > endCount) {
    return `Found ${subgraphCount} \`subgraph\` block(s) but only ${endCount} closing \`end\` statement(s). Every \`subgraph\` must end with \`end\` on its own line.`;
  }

  if (/UnknownDiagramError/i.test(rawMessage)) {
    return 'Mermaid could not recognize the diagram type. Ensure the first line starts with a valid diagram keyword (e.g., `flowchart TD`, `sequenceDiagram`, `erDiagram`).';
  }

  if (/Lexical error/i.test(rawMessage)) {
    return `Unrecognized character or unquoted punctuation${line ? ` on line ${line}` : ''}. Wrap labels containing punctuation, colons, slashes, or quotes inside double quotes \`["..."]\` and escape inner quotes using \`#quot;\`.`;
  }

  return 'Wrap node/edge labels containing punctuation (`()`, `[]`, `{}`, `:`, `/`, `@`) in double quotes `["..."]`, avoid lowercase `end` as a node ID, and check arrow syntax for this diagram type.';
}

export function parseMermaidError(code: string, rawErr: unknown): ParseErrorDetail {
  const errObj: RawMermaidErrorShape =
    rawErr && typeof rawErr === 'object' ? (rawErr as RawMermaidErrorShape) : {};
  const rawMessage = String(errObj.message || errObj.str || rawErr || 'Unknown Mermaid parse error');

  let line: number | null = null;
  let column: number | null = null;
  let expected: string[] | null = null;

  if (errObj.hash && typeof errObj.hash === 'object') {
    const firstLine = errObj.hash.loc?.first_line;
    const hashLine = errObj.hash.line;
    if (typeof firstLine === 'number') {
      line = firstLine;
    } else if (typeof hashLine === 'number') {
      line = hashLine + 1;
    }

    const firstCol = errObj.hash.loc?.first_column;
    if (typeof firstCol === 'number') {
      column = firstCol + 1;
    }

    if (Array.isArray(errObj.hash.expected)) {
      expected = errObj.hash.expected.map(String);
    }
  }

  if (line === null) {
    const lineMatch =
      rawMessage.match(/Parse error on line (\d+)/i) ||
      rawMessage.match(/Lexical error on line (\d+)/i) ||
      rawMessage.match(/line (\d+):(\d+)/i) ||
      rawMessage.match(/at line (\d+)/i);
    if (lineMatch) {
      line = Number.parseInt(lineMatch[1], 10);
      if (lineMatch[2]) {
        column = Number.parseInt(lineMatch[2], 10);
      }
    }
  }

  const conciseMessage = rawMessage
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' — ');

  return {
    message: conciseMessage || 'Syntax validation failed',
    rawMessage,
    line,
    column,
    snippet: buildCodeSnippet(code, line),
    expected,
    suggestion: inferSuggestion(code, rawMessage, line),
  };
}

export function analyzeStaticWarnings(code: string): LintWarning[] {
  const warnings: LintWarning[] = [];
  const lines = code.split(/\r?\n/);

  lines.forEach((rawLine, idx) => {
    const lineNum = idx + 1;
    const line = rawLine.trim();
    if (!line || line.startsWith('%%')) return;

    const labelMatch = line.match(/\["([^"]{75,})"\]|\[([^\]"]{75,})\]/);
    if (labelMatch && !line.includes('<br')) {
      warnings.push({
        line: lineNum,
        code: 'LONG_NODE_LABEL',
        message: 'Node label exceeds 75 characters on a single line, which can stretch diagram width.',
        suggestion: 'Insert `<br/>` or shorten label text for cleaner box proportions.',
      });
    }

    if (/<script|<iframe|<img/i.test(line)) {
      warnings.push({
        line: lineNum,
        code: 'UNSAFE_HTML_TAG',
        message: 'Disallowed HTML tag detected in diagram source; strict/antiscript security may strip it.',
      });
    }
  });

  if (lines.length > 140) {
    warnings.push({
      line: null,
      code: 'LARGE_DIAGRAM',
      message: `Diagram has ${lines.length} lines. Very dense diagrams can become difficult to read at standard zoom.`,
      suggestion: 'Consider grouping related nodes with `subgraph` or splitting into high-level overview + detailed sub-charts.',
    });
  }

  return warnings;
}

export function computeLayoutDiagnostics(
  dimensions: DiagramDimensions | null,
  metrics: DiagramMetrics | null,
  theme: MermaidTheme,
  background: string
): string[] {
  const notes: string[] = [];
  if (!dimensions) return notes;

  const { width, height, aspectRatio } = dimensions;

  if (aspectRatio > 4.2 && width > 900) {
    notes.push(
      `Wide horizontal ribbon detected (${width}×${height}px, aspect ratio ${aspectRatio}:1). Consider switching \`LR\` to \`TD\`, or grouping linear steps into parallel \`subgraph\` columns.`
    );
  } else if (aspectRatio < 0.24 && height > 900) {
    notes.push(
      `Very tall vertical diagram detected (${width}×${height}px, aspect ratio ${aspectRatio}:1). Consider switching \`TD\` to \`LR\` or splitting stages into side-by-side subgraphs.`
    );
  }

  if (width > 2600 || height > 2600) {
    notes.push(
      `Large canvas footprint (${width}×${height}px). Text may appear small when fitted onto a single slide or README width.`
    );
  }

  if (metrics && metrics.nodeCount === 0 && metrics.textLabelCount === 0) {
    notes.push('Rendered SVG contains no visible nodes or text labels — verify diagram statements.');
  }

  const bgLower = background.trim().toLowerCase();
  const isDarkBg =
    bgLower === '#191918' ||
    bgLower === '#0f172a' ||
    bgLower === '#1e1e2e' ||
    bgLower === '#111827' ||
    bgLower === '#000000' ||
    bgLower === 'black';

  if (isDarkBg && theme !== 'dark' && theme !== 'base') {
    notes.push(
      `Dark background (${background}) paired with light theme "${theme}" can make edge lines and sequence actor labels low-contrast. Consider \`theme: "dark"\`.`
    );
  }

  if (!isDarkBg && bgLower !== 'transparent' && theme === 'dark') {
    notes.push(
      `Theme "dark" rendered on a light background (${background}) can reduce label contrast. Consider \`background: "#191918"\` or switching theme to "default" / "neutral".`
    );
  }

  if (notes.length === 0) {
    notes.push(
      `Balanced layout (${width}×${height}px, ${aspectRatio}:1 aspect ratio) with clean theme/background pairing.`
    );
  }

  return notes;
}
