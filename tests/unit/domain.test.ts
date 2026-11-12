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
import { StatelessWorkspaceRelay } from '../../src/infrastructure/ephemeral/workspaceRelay.js';
import {
  extractProjectFromRoots,
  normalizeAgentIdentity,
  normalizeProjectName,
} from '../../src/shared/agentIdentity.js';
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
import {
  normalizeRelativeDirPath,
  normalizeRelativeGraphPath,
} from '../../src/shared/vfsPath.js';
import {
  evaluateVfsLs,
  evaluateVfsRead,
  movePathInProject,
  restoreGraphVersion,
  upsertGraphInVfs,
  type WorkspaceState,
} from '../../web/services/workspaceStorage.js';

describe('Domain Diagnostics, Jailed VFS Paths & Last-5 Immutable Storage', () => {
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

  it('jails relative VFS paths inside the working project and rejects traversal', () => {
    expect(normalizeRelativeDirPath('/')).toBe('');
    expect(normalizeRelativeDirPath('/auth/flows/')).toBe('auth/flows');
    expect(normalizeRelativeGraphPath('auth/oauth-flow')).toBe('auth/oauth-flow.mmd');
    expect(normalizeRelativeGraphPath('/arch/sub/../overview.mmd')).toBe('arch/overview.mmd');

    expect(() => normalizeRelativeDirPath('../other-project')).toThrow(/cannot traverse/i);
    expect(() => normalizeRelativeGraphPath('../../secret/graph.mmd')).toThrow(
      /cannot traverse/i
    );
  });

  it('identifies coding agents and extracts project names from MCP roots & paths', () => {
    expect(normalizeAgentIdentity('claude-code')).toEqual({
      slug: 'claude-code',
      label: 'Claude Code',
      shortLabel: 'Claude',
    });
    expect(normalizeAgentIdentity('@earendil-works/pi-coding-agent')).toEqual({
      slug: 'pi',
      label: 'Pi',
      shortLabel: 'Pi',
    });
    expect(normalizeProjectName('file:///home/ilabs/Projects/Project%20A/')).toBe('Project A');
    expect(
      extractProjectFromRoots([{ uri: 'file:///Users/dev/repos/Project-Alpha' }])
    ).toBe('Project-Alpha');
  });

  it('round-trips stateless #z= permalinks with project, path & agent metadata', async () => {
    const original = {
      title: 'oauth-flow',
      path: 'auth/oauth-flow.mmd',
      project: 'Project A',
      agent: 'Claude Code',
      code: 'flowchart LR\n  Agent["MCP Agent"] --> Browser["Web UI"]',
    };
    const url = await buildPermalinkUrl('https://mfhmfa.kasun.si/', original);
    const decoded = await decodePermalinkPayload(extractHashToken(url)!);
    expect(decoded).toEqual(original);

    const bigCode = 'flowchart TD\n' + '  A --> B\n'.repeat(400);
    const bigToken = await encodePermalinkPayload({ code: bigCode });
    await expect(decodePermalinkPayload(bigToken, 128)).rejects.toThrow(/safety limit/);
  });

  it('supports bidirectional VFS RPC over StatelessWorkspaceRelay with zero stored diagrams', async () => {
    const relay = new StatelessWorkspaceRelay();
    try {
      const unsub = relay.subscribe('ws_rpc_1', (ev) => {
        if (ev.type === 'vfs_request' && ev.request.op === 'ls') {
          relay.resolveVfsReply('ws_rpc_1', {
            requestId: ev.request.requestId,
            ok: true,
            result: {
              project: ev.request.project,
              cwd: '/',
              entries: [{ name: 'auth', path: 'auth', kind: 'dir' }],
              treeText: 'Project A/\n  auth/',
            },
          });
        }
      });

      expect(unsub).not.toBeNull();
      const lsRes = await relay.requestVfs('ws_rpc_1', {
        op: 'ls',
        project: 'Project A',
        dirPath: '',
      });
      expect((lsRes as { treeText: string }).treeText).toContain('auth/');
      expect(relay.getStats().storedDiagrams).toBe(0);

      unsub?.();
      await expect(
        relay.requestVfs('ws_rpc_1', { op: 'ls', project: 'Project A', dirPath: '' })
      ).rejects.toThrow(/not currently open/i);
    } finally {
      relay.dispose();
    }
  });

  it('maintains immutable last-5 versions per graph and supports ls, read & mv', () => {
    let state: WorkspaceState = {
      version: 4,
      workspaceId: 'ws_vfs_unit',
      sidebarOpen: true,
      sidebarWidth: 256,
      openTabIds: [],
      activeFileId: null,
      projects: [],
    };

    // Push 7 versions across Claude Code and Pi to `auth/oauth-flow.mmd`
    for (let i = 1; i <= 7; i++) {
      const isPi = i % 2 === 0;
      state = upsertGraphInVfs(state, {
        projectName: 'Project A',
        path: 'auth/oauth-flow',
        code: `sequenceDiagram\n  U->>S: Step_${i}`,
        diagramType: 'sequence',
        agentSlug: isPi ? 'pi' : 'claude-code',
        agentLabel: isPi ? 'Pi' : 'Claude Code',
        agentShortLabel: isPi ? 'Pi' : 'Claude',
        autoOpenTab: true,
        autoFocus: true,
      }).nextState;
    }

    // Add a sibling file in `auth/`
    state = upsertGraphInVfs(state, {
      projectName: 'Project A',
      path: 'auth/session-er.mmd',
      code: 'erDiagram\n  USER ||--o{ SESSION : owns',
      diagramType: 'er',
      agentSlug: 'pi',
      agentLabel: 'Pi',
      agentShortLabel: 'Pi',
      autoOpenTab: true,
      autoFocus: false,
    }).nextState;

    // Verify ls output
    const lsRoot = evaluateVfsLs(state, 'Project A', '/');
    expect(lsRoot.entries.map((e) => `${e.kind}:${e.name}`)).toEqual(['dir:auth']);
    expect(lsRoot.treeText).toContain('oauth-flow.mmd');
    expect(lsRoot.treeText).toContain('v7, by claude');

    // Verify last-5 immutable versions (v3..v7 kept; v1 & v2 evicted)
    const headRead = evaluateVfsRead(state, 'Project A', 'auth/oauth-flow.mmd');
    expect(headRead.currentVersion).toBe(7);
    expect(headRead.code).toContain('Step_7');
    expect(headRead.versions.map((v) => v.version)).toEqual([3, 4, 5, 6, 7]);

    const v4Read = evaluateVfsRead(state, 'Project A', 'auth/oauth-flow', 4);
    expect(v4Read.code).toContain('Step_4');
    expect(v4Read.author).toBe('pi');
    expect(() => evaluateVfsRead(state, 'Project A', 'auth/oauth-flow', 1)).toThrow(
      /5-version history/
    );

    // Move `auth` folder -> `security/auth` and verify history preserved
    const moved = movePathInProject(state, 'Project A', 'auth', 'security/auth');
    state = moved.nextState;
    expect(moved.result.movedFiles).toBe(2);

    const movedRead = evaluateVfsRead(
      state,
      'Project A',
      'security/auth/oauth-flow.mmd'
    );
    expect(movedRead.currentVersion).toBe(7);

    // Restore v5 immutably -> creates v8!
    const fileId = state.projects[0]!.files.find((f) =>
      f.path.endsWith('oauth-flow.mmd')
    )!.id;
    const restored = restoreGraphVersion(state, fileId, 5);
    state = restored.nextState;
    const afterRestore = evaluateVfsRead(
      state,
      'Project A',
      'security/auth/oauth-flow.mmd'
    );
    expect(afterRestore.currentVersion).toBe(8);
    expect(afterRestore.code).toContain('Step_5');
    expect(afterRestore.author).toBe('you');
    expect(afterRestore.versions.map((v) => v.version)).toEqual([4, 5, 6, 7, 8]);
  });

  it('coalesces rapid iterative renders by the same coding agent into a single clean version', () => {
    let state: WorkspaceState = {
      version: 4,
      workspaceId: 'ws_coalesce_unit',
      sidebarOpen: true,
      sidebarWidth: 256,
      openTabIds: [],
      activeFileId: null,
      projects: [],
    };

    const t0 = 1_700_000_000_000;

    // Pi iterates 4 times within 30s while inspecting 2x Retina PNGs -> stays clean v1!
    for (let attempt = 1; attempt <= 4; attempt++) {
      state = upsertGraphInVfs(state, {
        projectName: 'MFHMFA',
        path: 'architecture/memory-architecture.mmd',
        code: `flowchart TB\n  Draft_${attempt}["Attempt ${attempt}"]`,
        diagramType: 'flowchart-v2',
        agentSlug: 'pi',
        agentLabel: 'Pi',
        agentShortLabel: 'Pi',
        agentSessionId: 'sess-pi-1',
        autoOpenTab: true,
        autoFocus: true,
        now: t0 + attempt * 5_000,
      }).nextState;
    }

    const afterRetries = evaluateVfsRead(
      state,
      'MFHMFA',
      'architecture/memory-architecture.mmd'
    );
    expect(afterRetries.currentVersion).toBe(1);
    expect(afterRetries.versions.length).toBe(1);
    expect(afterRetries.code).toContain('Attempt 4');

    // Another agent (Claude Code) edits 10s later -> appends immutable v2!
    state = upsertGraphInVfs(state, {
      projectName: 'MFHMFA',
      path: 'architecture/memory-architecture.mmd',
      code: 'flowchart TB\n  Claude["Claude Update"]',
      diagramType: 'flowchart-v2',
      agentSlug: 'claude-code',
      agentLabel: 'Claude Code',
      agentShortLabel: 'Claude',
      agentSessionId: 'sess-claude-1',
      autoOpenTab: true,
      autoFocus: true,
      now: t0 + 30_000,
    }).nextState;

    // Claude returns 2 minutes later in a follow-up turn -> appends immutable v3!
    state = upsertGraphInVfs(state, {
      projectName: 'MFHMFA',
      path: 'architecture/memory-architecture.mmd',
      code: 'flowchart TB\n  ClaudeFollowup["Claude Follow-Up"]',
      diagramType: 'flowchart-v2',
      agentSlug: 'claude-code',
      agentLabel: 'Claude Code',
      agentShortLabel: 'Claude',
      agentSessionId: 'sess-claude-1',
      autoOpenTab: true,
      autoFocus: true,
      now: t0 + 180_000,
    }).nextState;

    const finalRead = evaluateVfsRead(
      state,
      'MFHMFA',
      'architecture/memory-architecture.mmd'
    );
    expect(finalRead.currentVersion).toBe(3);
    expect(finalRead.versions.map((v) => `${v.version}:${v.author}`)).toEqual([
      '1:pi',
      '2:claude',
      '3:claude',
    ]);
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

    expect(isLocalRequestHost({ host: 'localhost:48333' })).toBe(true);
    expect(
      isLocalRequestHost({
        host: '127.0.0.1:48333',
        'x-forwarded-host': 'mfhmfa.kasun.si',
      })
    ).toBe(false);
  });
});
