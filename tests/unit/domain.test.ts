import { describe, expect, it } from 'vitest';
import {
  isLocalRequestHost,
  resolveRequestBaseUrl,
} from '../../src/config/env.js';

import {
  analyzeStaticWarnings,
  buildCodeSnippet,
  computeLayoutDiagnostics,
  inferSuggestion,
  parseMermaidError,
} from '../../src/domain/diagnostics.js';
import { InMemoryPreviewHub } from '../../src/infrastructure/ephemeral/previewHub.js';
import {
  buildPermalinkUrl,
  decodePermalinkPayload,
  encodePermalinkPayload,
  extractHashToken,
} from '../../src/shared/permalink.js';
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

  it('round-trips stateless #z= deflate-raw permalinks and rejects oversized/corrupt payloads', async () => {
    const original = {
      title: 'Agent ↔ Browser Bridge 🚀',
      code: 'flowchart LR\n  Agent["MCP Agent"] -->|"studioUrl"| Browser["Web UI"]',
    };
    const url = await buildPermalinkUrl('https://mfhmfa.kasun.si/', original);
    expect(url.startsWith('https://mfhmfa.kasun.si/#z=')).toBe(true);

    const zToken = extractHashToken(url);
    expect(zToken).toBeTruthy();

    const decoded = await decodePermalinkPayload(zToken!);
    expect(decoded).toEqual(original);

    // Multi-tab workspace permalink round-trip
    const multiUrl = await buildPermalinkUrl('https://mfhmfa.kasun.si/', {
      title: 'Auth Sequence',
      code: 'sequenceDiagram\n  A->>B: Hi',
      activeIndex: 1,
      tabs: [
        { title: 'System Overview', code: 'flowchart LR\n  X --> Y' },
        { title: 'Auth Sequence', code: 'sequenceDiagram\n  A->>B: Hi' },
      ],
    });
    const multiDecoded = await decodePermalinkPayload(extractHashToken(multiUrl)!);
    expect(multiDecoded.tabs?.length).toBe(2);
    expect(multiDecoded.activeIndex).toBe(1);
    expect(multiDecoded.tabs?.[0]?.title).toBe('System Overview');

    await expect(decodePermalinkPayload('!invalid-base64!')).rejects.toThrow();


    const bigCode = 'flowchart TD\n' + '  A --> B\n'.repeat(400);
    const bigToken = await encodePermalinkPayload({ code: bigCode });
    await expect(decodePermalinkPayload(bigToken, 128)).rejects.toThrow(/safety limit/);
  });

  it('enforces bounded LRU eviction, TTL expiry, and live pub/sub in InMemoryPreviewHub', async () => {
    const hub = new InMemoryPreviewHub({ maxSnapshots: 2, snapshotTtlMs: 80 });
    try {
      const received: string[] = [];
      const unsub = hub.subscribeLive('session_abc123', (snap) => {
        received.push(snap.title);
      });
      expect(unsub).not.toBeNull();
      expect(hub.getSubscriberCount('session_abc123')).toBe(1);

      const s1 = hub.saveSnapshot({
        title: 'First',
        code: 'flowchart LR\n  A --> B',
        diagramType: 'flowchart-v2',
        theme: 'default',
        look: 'classic',
        liveToken: 'session_abc123',
      });
      const s2 = hub.saveSnapshot({
        title: 'Second',
        code: 'flowchart LR\n  B --> C',
        diagramType: 'flowchart-v2',
        theme: 'dark',
        look: 'classic',
        liveToken: 'session_abc123',
      });
      // Touch s1 so s2 becomes the LRU victim when s3 arrives
      expect(hub.getSnapshot(s1.id)?.title).toBe('First');

      const s3 = hub.saveSnapshot({
        title: 'Third',
        code: 'flowchart LR\n  C --> D',
        diagramType: 'flowchart-v2',
        theme: 'default',
        look: 'classic',
      });

      expect(hub.getSnapshot(s1.id)?.title).toBe('First');
      expect(hub.getSnapshot(s2.id)).toBeNull();
      expect(hub.getSnapshot(s3.id)?.title).toBe('Third');
      expect(received).toEqual(['First', 'Second']);
      expect(hub.getLiveLatest('session_abc123')?.title).toBe('Second');

      unsub?.();
      expect(hub.getSubscriberCount('session_abc123')).toBe(0);

      await new Promise((r) => setTimeout(r, 95));
      expect(hub.getSnapshot(s1.id)).toBeNull();
    } finally {
      hub.dispose();
    }
  });

  it('resolves public origin safely from reverse-proxy headers and rejects host injection', () => {
    expect(
      resolveRequestBaseUrl(
        {
          'x-forwarded-proto': 'https, http',
          'x-forwarded-host': 'mfhmfa.kasun.si',
        },
        'http',
        'http://localhost:48333'
      )
    ).toBe('https://mfhmfa.kasun.si');

    expect(
      resolveRequestBaseUrl(
        { host: 'evil.com/injected-path' },
        'http',
        'http://localhost:48333'
      )
    ).toBe('http://localhost:48333');

    expect(isLocalRequestHost({ host: 'localhost:48333' })).toBe(true);
    expect(isLocalRequestHost({ host: '127.0.0.1:48333' })).toBe(true);
    expect(
      isLocalRequestHost({
        host: '127.0.0.1:48333',
        'x-forwarded-host': 'mfhmfa.kasun.si',
      })
    ).toBe(false);
  });

  it('deduplicates same-title agent retries in-place while preserving multi-tab order', () => {
    const hub = new InMemoryPreviewHub();
    try {
      hub.saveSnapshot({
        title: 'System Overview',
        code: 'flowchart LR\n  A --> B',
        diagramType: 'flowchart-v2',
        theme: 'default',
        look: 'classic',
        workspaceToken: 'ws_unit_test_1',
      });
      hub.saveSnapshot({
        title: 'Auth Sequence',
        code: 'sequenceDiagram\n  U->>S: V1',
        diagramType: 'sequence',
        theme: 'default',
        look: 'classic',
        workspaceToken: 'ws_unit_test_1',
      });
      // Retry of "System Overview" updates Tab 1 in-place without changing order [Overview, Auth]
      hub.saveSnapshot({
        title: 'System Overview',
        code: 'flowchart TB\n  A --> B --> C',
        diagramType: 'flowchart-v2',
        theme: 'default',
        look: 'classic',
        workspaceToken: 'ws_unit_test_1',
      });

      const tabs = hub.getChannelTabs('ws_unit_test_1');
      expect(tabs.map((t) => t.title)).toEqual(['System Overview', 'Auth Sequence']);
      expect(tabs[0]?.code).toContain('A --> B --> C');
    } finally {
      hub.dispose();
    }
  });
});


