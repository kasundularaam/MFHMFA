import type {
  DiagramComprehensionGuide,
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

  if (firstMeaningfulLine && !KNOWN_HEADERS.some((h) => firstMeaningfulLine.startsWith(h))) {
    return `Unknown or missing diagram header "${firstMeaningfulLine.split(/\s+/)[0]}". Start with a valid Mermaid header like \`flowchart TD\`, \`sequenceDiagram\`, \`classDiagram\`, \`stateDiagram-v2\`, \`erDiagram\`, \`mindmap\`, \`gantt\`, or \`architecture-beta\`.`;
  }

  const targetLine = line && lines[line - 1] ? lines[line - 1] : '';

  if (targetLine && /\w+\[[^"\]]*[(){}[\]][^"\]]*\]/.test(targetLine)) {
    return `Special characters like (), {}, or [] inside a node label on line ${line} break parsing. Wrap the label text in double quotes, e.g. \`NodeId["Label (detail)"]\`.`;
  }

  if (targetLine && /\w+\{[^"}\]]*[()[\]][^"}]*\}/.test(targetLine)) {
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
  const rawMessage = String(
    errObj.message || errObj.str || rawErr || 'Unknown Mermaid parse error'
  );

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
    .join(' | ');

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

function stripQuotedStrings(line: string): string {
  return line.replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

function isFlowchartCode(code: string): boolean {
  const firstMeaningful = code
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('%%') && !l.startsWith('---'));
  return Boolean(firstMeaningful && /^(?:flowchart|graph)\b/.test(firstMeaningful));
}

export function analyzeStaticWarnings(code: string): LintWarning[] {
  const warnings: LintWarning[] = [];
  const lines = code.split(/\r?\n/);
  const isFlowchart = isFlowchartCode(code);
  const bidirectionalLines: number[] = [];
  const unlabeledEdgeLines: number[] = [];

  lines.forEach((rawLine, idx) => {
    const lineNum = idx + 1;
    const line = rawLine.trim();
    if (!line || line.startsWith('%%')) return;

    const labelMatch = line.match(/\["([^"]{75,})"\]|\[([^\]"]{75,})\]/);
    if (labelMatch && !line.includes('<br')) {
      warnings.push({
        line: lineNum,
        code: 'LONG_NODE_LABEL',
        message:
          'Node label exceeds 75 characters on a single line, which can stretch diagram width.',
        suggestion: 'Insert `<br/>` or shorten label text for cleaner box proportions.',
      });
    }

    if (!line.startsWith('subgraph ')) {
      const quotedBoxes = line.matchAll(
        /[A-Za-z0-9_-]+\s*(?:\[\["|\(\["|\[\("|(?:\{\{")|\["|\(")([^"]+)"/g
      );
      for (const m of quotedBoxes) {
        const plain = (m[1] ?? '')
          .replace(/<br\s*\/?>/gi, ' ')
          .replace(/#quot;/g, '"')
          .trim();
        const words = plain.split(/\s+/).filter(Boolean);
        if (words.length > 11) {
          warnings.push({
            line: lineNum,
            code: 'DENSE_NODE_LABEL',
            message: `Node label crams ${words.length} words into one box, overloading visual scanning (Dual Coding Principle).`,
            suggestion:
              'Keep box labels to 2–6 plain words and attach detailed mechanics, examples, and "what-if" failure cases via `guide.nodes` in `render_view`.',
          });
          break;
        }
      }
    }

    if (
      isFlowchart &&
      !line.startsWith('flowchart ') &&
      !line.startsWith('graph ') &&
      !line.startsWith('subgraph ') &&
      !line.startsWith('classDef ') &&
      !line.startsWith('style ') &&
      !line.startsWith('linkStyle ')
    ) {
      const bare = stripQuotedStrings(line);
      if (/<-->|<-+->|<-+\.+-+>|<=+=>/.test(bare)) {
        bidirectionalLines.push(lineNum);
      }

      // Check every arrow token on this line; flag if any arrow has neither `|label|` nor inline `-- label -->` text
      const edgeMatches = bare.matchAll(
        /(?:<-->|<-+\.+-+>|<=+=>|-->|-\.->|==>)(?:\s*\|[^|]+\|)?/g
      );
      for (const em of edgeMatches) {
        const token = em[0];
        if (token.includes('|')) continue;
        const startIdx = em.index ?? 0;
        const before = bare.slice(0, startIdx);
        const hasInlineLabel =
          /(?:--|-\.|==)\s+[^-\s][^=>\n]*\s*$/.test(before) &&
          /(?:-->|-\.->|==>)$/.test(token);
        if (!hasInlineLabel) {
          unlabeledEdgeLines.push(lineNum);
          break;
        }
      }
    }

    if (/<script|<iframe|<img/i.test(line)) {
      warnings.push({
        line: lineNum,
        code: 'UNSAFE_HTML_TAG',
        message:
          'Disallowed HTML tag detected in diagram source; strict/antiscript security may strip it.',
      });
    }
  });

  if (bidirectionalLines.length > 0) {
    warnings.push({
      line: bidirectionalLines[0] ?? null,
      code: 'BIDIRECTIONAL_EDGE',
      message: `Bidirectional arrow on line${bidirectionalLines.length > 1 ? 's' : ''} ${bidirectionalLines.join(', ')}. Two-way arrows hide which action flows in which direction and whether both use the same mechanism.`,
      suggestion:
        'Split `<-->` into two separate one-way labeled arrows (e.g. `A -->|logs event| B` and `B -.->|pushes weights| A`).',
    });
  }

  if (unlabeledEdgeLines.length > 0) {
    warnings.push({
      line: unlabeledEdgeLines[0] ?? null,
      code: 'UNLABELED_EDGE',
      message: `${unlabeledEdgeLines.length} arrow${unlabeledEdgeLines.length > 1 ? 's' : ''} without a verb label (line${unlabeledEdgeLines.length > 1 ? 's' : ''} ${unlabeledEdgeLines.join(', ')}). Readers cannot tell what passes across unlabeled connections.`,
      suggestion:
        'Add a short verb + noun label on every arrow (e.g. `-->|reads profile|` for sync/direct, `-.->|publishes click|` for async/scheduled).',
    });
  }

  if (lines.length > 140) {
    warnings.push({
      line: null,
      code: 'LARGE_DIAGRAM',
      message: `Diagram has ${lines.length} lines. Very dense diagrams can become difficult to read at standard zoom.`,
      suggestion:
        'Consider grouping related nodes with `subgraph` or splitting into high-level overview + detailed sub-charts.',
    });
  }

  return warnings;
}

const NON_SERVICE_TERM_HINT_RE =
  /\b(table|tables|mysql|postgres|sqlite|redis|cache|bucket|s3|ledger|store|storage|kafka|topic|queue|stream|cron|job|worker|consumer|browser|client|user|shopper|visitor|webhook)\b/i;

const DISTINCT_SHAPE_SYNTAX_RE =
  /[A-Za-z0-9_-]+\s*(?:\(\[|\[\(|\{\{|\[\[|\[\/|\{"|\{\s*[^}\s])/;

/**
 * Checks the comprehension `guide` paired with `code` for human readability traps:
 * - Missing `kind` on nodes (reader cannot tell tables vs services vs jobs vs actors)
 * - Every box drawn as a plain rectangle even when mixed entity kinds exist
 * - Cryptic arrow/column shorthand inside `node.example` instead of plain English
 */
export function analyzeGuideWarnings(
  code: string,
  guide: DiagramComprehensionGuide | undefined
): LintWarning[] {
  if (!guide?.nodes) return [];

  const warnings: LintWarning[] = [];
  const entries = Object.entries(guide.nodes);
  if (entries.length === 0) return warnings;

  const isFlowchart = isFlowchartCode(code);

  const missingKindIds = entries.filter(([, d]) => !d.kind).map(([id]) => id);
  if (isFlowchart && entries.length >= 2 && missingKindIds.length > 0) {
    warnings.push({
      line: null,
      code: 'MISSING_NODE_KIND',
      message: `${missingKindIds.length} box${missingKindIds.length > 1 ? 'es' : ''} in \`guide.nodes\` (${missingKindIds.slice(0, 4).join(', ')}${missingKindIds.length > 4 ? ', …' : ''}) have no \`kind\`. Without \`kind\`, readers cannot tell whether a box is a table, service, job, actor, or subsystem.`,
      suggestion:
        'Set `kind` ("actor" | "service" | "store" | "queue" | "job" | "decision" | "subsystem" | "concept") on each node and match its Mermaid shape so Studio’s legend and node badges stay clear.',
    });
  }

  if (isFlowchart && entries.length >= 4 && !DISTINCT_SHAPE_SYNTAX_RE.test(code)) {
    const hasMixedKinds = entries.some(([, d]) => {
      if (d.kind && d.kind !== 'service' && d.kind !== 'concept') return true;
      if (d.childPath) return true;
      const text = `${d.label || ''} ${d.term || ''} ${d.summary || ''}`;
      return NON_SERVICE_TERM_HINT_RE.test(text);
    });
    if (hasMixedKinds) {
      warnings.push({
        line: null,
        code: 'UNIFORM_NODE_SHAPES',
        message:
          'Every box uses a plain rectangle `["..."]` even though the diagram mixes different kinds of things (stores/tables, jobs, actors, queues, or subsystems).',
        suggestion:
          'Use matching Mermaid shapes (`[("Table")]` cylinder for stores, `(["User"])` stadium for actors, `{{"Job"}}` hexagon for workers, `[/"Queue"/]` for streams, `[["Area"]]` for drillable subsystems) so readers recognize types at a glance.',
      });
    }
  }

  const crypticExampleIds: string[] = [];
  for (const [id, detail] of entries) {
    const ex = detail.example?.trim();
    if (!ex) continue;
    const looksLikeArrowDump =
      ex.includes('->') && !/[.!?]$/.test(ex) && (/[=();]/.test(ex) || ex.startsWith('/'));
    if (looksLikeArrowDump) {
      crypticExampleIds.push(id);
    }
  }

  if (crypticExampleIds.length > 0) {
    warnings.push({
      line: null,
      code: 'CRYPTIC_NODE_EXAMPLE',
      message: `\`example\` on ${crypticExampleIds.slice(0, 4).join(', ')} reads like terse arrow/code shorthand instead of a plain human example.`,
      suggestion:
        'Set `guide.scenario` to one concrete real-world example and rewrite `node.example` as 1–2 plain English sentences showing what happens to that example here.',
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
    notes.push(
      'Rendered SVG contains no visible nodes or text labels. Verify diagram statements.'
    );
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

  if (metrics && metrics.nodeCount > 8) {
    notes.push(
      `Cognitive load notice: ${metrics.nodeCount} nodes exceeds the ~4–7 chunk human working-memory sweet spot. Prefer 4–7 concise boxes per view and link deeper parts via \`guide.nodes[nodeId].childPath\`.`
    );
  }

  return notes;
}
