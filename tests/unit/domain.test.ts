import { describe, expect, it } from 'vitest';
import {
  analyzeStaticWarnings,
  buildCodeSnippet,
  computeLayoutDiagnostics,
  inferSuggestion,
  parseMermaidError,
} from '../../src/domain/diagnostics.js';
import {
  extractSvgDimensions,
  normalizeSvgIntrinsicDimensions,
  slugify,
} from '../../src/shared/svg.js';

describe('Domain Diagnostics & Pure Helpers', () => {
  it('builds 1-indexed code snippets with line pointer', () => {
    const src = ['flowchart TD', '  A --> B[foo(1)]', '  B --> C'].join('\n');
    const snippet = buildCodeSnippet(src, 2);
    expect(snippet).toContain('    1 | flowchart TD');
    expect(snippet).toContain('>   2 |   A --> B[foo(1)]');
    expect(snippet).toContain('    3 |   B --> C');
  });

  it('infers targeted AI fix hints for common Mermaid syntax pitfalls', () => {
    expect(inferSuggestion('```mermaid\nflowchart TD\n```', 'err', 1)).toContain(
      'Markdown code fences'
    );
    expect(
      inferSuggestion('flowchart TD\n  A[call(x)] --> B', 'Parse error', 2)
    ).toContain('double quotes');
    expect(
      inferSuggestion('flowchart TD\n  start --> end', "got 'end'", 2)
    ).toContain('reserved Mermaid keyword');
    expect(
      inferSuggestion('flowchart TD\n  A -> B', 'Parse error', 2)
    ).toContain('Replace `->` with `-->`');
    expect(
      inferSuggestion('flowchart TD\n  subgraph G1\n    A --> B', 'Parse error', 3)
    ).toContain('closing `end`');
  });

  it('parses Jison loc line/column metadata cleanly', () => {
    const code = 'flowchart TD\n  A[bad(x)] --> B';
    const detail = parseMermaidError(code, {
      message: 'Parse error on line 2',
      hash: { loc: { first_line: 2, first_column: 8 }, expected: ['SQE'] },
    });
    expect(detail.line).toBe(2);
    expect(detail.column).toBe(9);
    expect(detail.expected).toEqual(['SQE']);
  });

  it('detects static lint warnings and wide layout aspect ratios', () => {
    const longLabel = 'A["' + 'x'.repeat(85) + '"]';
    const warnings = analyzeStaticWarnings(`flowchart TD\n  ${longLabel}`);
    expect(warnings.some((w) => w.code === 'LONG_NODE_LABEL')).toBe(true);

    const layout = computeLayoutDiagnostics(
      { width: 1600, height: 220, aspectRatio: 7.27, scale: 2 },
      { nodeCount: 10, edgeCount: 9, subgraphCount: 0, textLabelCount: 10, sampleLabels: [] },
      'default',
      '#ffffff'
    );
    expect(layout[0]).toContain('Wide horizontal ribbon');
  });

  it('normalizes SVG viewBox intrinsic pixel dimensions and slugs', () => {
    const rawSvg = '<svg viewBox="0 0 640.4 319.1" width="100%" style="max-width: 640.4px;"><g/></svg>';
    expect(extractSvgDimensions(rawSvg)).toEqual({ width: 641, height: 320 });

    const normalized = normalizeSvgIntrinsicDimensions(rawSvg);
    expect(normalized).toContain('width="641"');
    expect(normalized).toContain('height="320"');
    expect(normalized).not.toContain('width="100%"');

    expect(slugify('  My Cool Chart! (v2)  ')).toBe('my-cool-chart-v2');
  });
});
