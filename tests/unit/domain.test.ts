import { describe, expect, it } from 'vitest';
import { StudioService } from '../../src/application/studioService.js';
import { isLocalRequestHost, resolveRequestBaseUrl } from '../../src/config/env.js';
import {
  analyzeStaticWarnings,
  buildCodeSnippet,
  computeLayoutDiagnostics,
  inferSuggestion,
  parseMermaidError,
} from '../../src/domain/diagnostics.js';
import { buildLearningPlaybookDocument, LEARNING_MODES } from '../../src/domain/playbooks.js';
import type { RenderEnginePort } from '../../src/domain/ports.js';
import { StatelessWorkspaceRelay } from '../../src/infrastructure/ephemeral/workspaceRelay.js';
import { getOpenAiToolSchemas } from '../../src/interfaces/tools/toolRegistry.js';
import {
  extractProjectFromRoots,
  normalizeAgentIdentity,
  normalizeProjectName,
} from '../../src/shared/agentIdentity.js';
import {
  resolveGuideFlows,
  resolveNodeRefs,
  sanitizeComprehensionGuide,
  serializeGuideCanonical,
  summarizeComprehensionGuide,
} from '../../src/shared/comprehension.js';
import { BoundedIdSet, slugify } from '../../src/shared/strings.js';
import { extractSvgDimensions, normalizeSvgIntrinsicDimensions } from '../../src/shared/svg.js';
import {
  buildExplorerSubtree,
  evaluateVfsLs,
  evaluateVfsRead,
  findFileWithProject,
  movePathInProject,
  resolveProjectGraphHierarchy,
  restoreGraphVersion,
  upsertGraphInVfs,
  type WorkspaceState,
} from '../../src/shared/vfs/index.js';
import {
  normalizeRelativeDirPath,
  normalizeRelativeGraphPath,
} from '../../src/shared/vfsPath.js';

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
    expect(inferSuggestion('flowchart TD\n  A[call(x)] --> B', 'Parse error', 2)).toContain(
      'double quotes'
    );
    expect(inferSuggestion('flowchart TD\n  start --> end', "got 'end'", 2)).toContain(
      'reserved Mermaid keyword'
    );
    expect(inferSuggestion('flowchart TD\n  A -> B', 'Parse error', 2)).toContain(
      'Replace `->` with `-->`'
    );
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
    const longLabel = `A["${'x'.repeat(85)}"]`;
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
    const rawSvg =
      '<svg viewBox="0 0 640.4 319.1" width="100%" style="max-width: 640.4px;"><g/></svg>';
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
    expect(extractProjectFromRoots([{ uri: 'file:///Users/dev/repos/Project-Alpha' }])).toBe(
      'Project-Alpha'
    );
  });

  it('evicts oldest entries in BoundedIdSet and generates OpenAI schemas from Zod single-source', () => {
    const set = new BoundedIdSet(16);
    for (let i = 0; i < 20; i++) {
      set.add(`id-${i}`);
    }
    expect(set.has('id-0')).toBe(false);
    expect(set.has('id-3')).toBe(false);
    expect(set.has('id-4')).toBe(true);
    expect(set.has('id-19')).toBe(true);

    const schemas = getOpenAiToolSchemas();
    expect(schemas.map((s) => s.function.name)).toEqual([
      'get_playbook',
      'render_view',
      'list_views',
      'read_view',
      'move_view',
      'export_view',
    ]);
    const renderSchema = schemas.find((s) => s.function.name === 'render_view');
    expect(renderSchema).toBeDefined();
    expect(renderSchema!.function.parameters).toHaveProperty('properties');
    expect((renderSchema!.function.parameters as { required?: string[] }).required).toContain(
      'code'
    );
  });

  it('blocks server-side disk writes when allowLocalDiskWrite is false', async () => {
    const fakeEngine: RenderEnginePort = {
      validate: async () => ({
        valid: true,
        diagramType: 'flowchart-v2',
        error: null,
        warnings: [],
        durationMs: 1,
      }),
      render: async () => ({
        valid: true,
        diagramType: 'flowchart-v2',
        error: null,
        warnings: [],
        durationMs: 1,
        svg: '<svg viewBox="0 0 100 100"/>',
        pngBytes: new Uint8Array([1, 2, 3]),
        dimensions: { width: 100, height: 100, aspectRatio: 1, scale: 2 },
        metrics: {
          nodeCount: 1,
          edgeCount: 0,
          subgraphCount: 0,
          textLabelCount: 1,
          sampleLabels: ['A'],
        },
        layoutDiagnostics: [],
        theme: 'default',
        look: 'classic',
        background: '#ffffff',
      }),
      dispose: async () => {},
    };

    const svc = new StudioService({ engine: fakeEngine });
    await expect(
      svc.render('flowchart LR\n  A --> B', {
        outputPath: '/tmp/forbidden.png',
        allowLocalDiskWrite: false,
      })
    ).rejects.toThrow(/disabled on remote/i);

    await expect(
      svc.exportDiagram({
        code: 'flowchart LR\n  A --> B',
        outputPath: '/tmp/forbidden.svg',
        allowLocalDiskWrite: false,
      })
    ).rejects.toThrow(/disabled on remote/i);
  });

  it('supports strongly typed bidirectional VFS RPC over StatelessWorkspaceRelay with zero stored diagrams', async () => {
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
      expect(lsRes.treeText).toContain('auth/');
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

    const lsRoot = evaluateVfsLs(state, 'Project A', '/');
    expect(lsRoot.entries.map((e) => `${e.kind}:${e.name}`)).toEqual(['dir:auth']);
    expect(lsRoot.treeText).toContain('oauth-flow.mmd');
    expect(lsRoot.treeText).toContain('v7, by claude');

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

    const moved = movePathInProject(state, 'Project A', 'auth', 'security/auth');
    state = moved.nextState;
    expect(moved.result.movedFiles).toBe(2);

    const movedRead = evaluateVfsRead(state, 'Project A', 'security/auth/oauth-flow.mmd');
    expect(movedRead.currentVersion).toBe(7);

    const fileId = state.projects[0]!.files.find((f) => f.path.endsWith('oauth-flow.mmd'))!.id;
    const restored = restoreGraphVersion(state, fileId, 5);
    state = restored.nextState;
    const afterRestore = evaluateVfsRead(state, 'Project A', 'security/auth/oauth-flow.mmd');
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

    const finalRead = evaluateVfsRead(state, 'MFHMFA', 'architecture/memory-architecture.mmd');
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

  it('enforces cognitive load diagnostics, sanitizes comprehension guides canonically, and rewrites childPath on mv', () => {
    const denseWarnings = analyzeStaticWarnings(
      'flowchart TB\n  Overloaded["This single box crams way too many technical explanation words inside one visual shape"] --> B["Clean Box"]'
    );
    expect(denseWarnings.some((w) => w.code === 'DENSE_NODE_LABEL')).toBe(true);

    const cognitiveNotes = computeLayoutDiagnostics(
      { width: 1100, height: 950, aspectRatio: 1.16, scale: 2 },
      { nodeCount: 11, edgeCount: 12, subgraphCount: 2, textLabelCount: 20, sampleLabels: [] },
      'default',
      '#ffffff'
    );
    expect(cognitiveNotes.some((n) => n.includes('Cognitive load notice'))).toBe(true);

    const cleanGuide = sanitizeComprehensionGuide({
      gist: '  Server stores 0 diagrams; browser stores everything. ',
      parentPath: 'architecture/overview',
      steps: [
        {
          title: ' 1. Render preview ',
          caption: ' Agent validates syntax and inspects PNG. ',
          focusNodes: ['AI', 'Preview', 'AI'],
        },
      ],
      nodes: {
        Preview: {
          summary: ' Draws 2x PNG then deletes buffer. ',
          example: ' 1 KB code -> 160 KB PNG ',
          whatIf: ' Worker recycles after 150 renders. ',
          files: ['src/infrastructure/renderer/chromiumEngine.ts'],
          childPath: 'architecture/renderer-pool',
        },
      },
    });
    expect(cleanGuide?.parentPath).toBe('architecture/overview.mmd');
    expect(cleanGuide?.nodes?.Preview?.childPath).toBe('architecture/renderer-pool.mmd');
    expect(cleanGuide?.steps?.[0]?.focusNodes).toEqual(['AI', 'Preview']);
    expect(summarizeComprehensionGuide(cleanGuide)).toEqual({
      hasGuide: true,
      hasGist: true,
      stepCount: 1,
      documentedNodeCount: 1,
      drilldownPaths: ['architecture/renderer-pool.mmd'],
      parentPath: 'architecture/overview.mmd',
    });

    // Canonical serialization is key-order independent
    const g1 = sanitizeComprehensionGuide({
      gist: 'Same',
      nodes: { B: { summary: 'two' }, A: { summary: 'one' } },
    });
    const g2 = sanitizeComprehensionGuide({
      nodes: { A: { summary: 'one' }, B: { summary: 'two' } },
      gist: 'Same',
    });
    expect(serializeGuideCanonical(g1)).toBe(serializeGuideCanonical(g2));

    expect(() =>
      sanitizeComprehensionGuide({
        nodes: { Bad: { summary: 'bad', childPath: '../../etc/passwd' } },
      })
    ).toThrow(/cannot traverse/i);

    let state: WorkspaceState = {
      version: 4,
      workspaceId: 'ws_guide_unit',
      sidebarOpen: true,
      sidebarWidth: 256,
      openTabIds: [],
      activeFileId: null,
      projects: [],
    };

    const t0 = 1_710_000_000_000;
    state = upsertGraphInVfs(state, {
      projectName: 'MFHMFA',
      path: 'architecture/overview.mmd',
      code: 'flowchart LR\n  A["Server"] --> B["Browser"]',
      guide: {
        gist: 'Zero server storage.',
        nodes: {
          A: {
            summary: 'Stateless pool',
            childPath: 'architecture/renderer-pool.mmd',
          },
        },
      },
      agentSlug: 'pi',
      agentLabel: 'Pi',
      agentSessionId: 'sess-1',
      autoOpenTab: true,
      autoFocus: true,
      now: t0,
    }).nextState;

    state = upsertGraphInVfs(state, {
      projectName: 'MFHMFA',
      path: 'architecture/overview.mmd',
      code: 'flowchart TB\n  A["Server"] --> B["Browser"]',
      agentSlug: 'pi',
      agentLabel: 'Pi',
      agentSessionId: 'sess-1',
      autoOpenTab: true,
      autoFocus: true,
      now: t0 + 10_000,
    }).nextState;

    state = upsertGraphInVfs(state, {
      projectName: 'MFHMFA',
      path: 'architecture/renderer-pool.mmd',
      code: 'flowchart TB\n  Slot["Slot 1..4"]',
      guide: { parentPath: 'architecture/overview.mmd' },
      agentSlug: 'pi',
      agentLabel: 'Pi',
      agentSessionId: 'sess-1',
      autoOpenTab: false,
      autoFocus: false,
      now: t0 + 12_000,
    }).nextState;

    state = movePathInProject(
      state,
      'MFHMFA',
      'architecture/renderer-pool.mmd',
      'internals/chromium-pool.mmd'
    ).nextState;

    const overviewAfterMv = evaluateVfsRead(state, 'MFHMFA', 'architecture/overview.mmd');
    expect(overviewAfterMv.currentVersion).toBe(1);
    expect(overviewAfterMv.guide?.nodes?.A?.childPath).toBe('internals/chromium-pool.mmd');
  });

  it('nests sub-graphs under their parent in Explorer and keeps parent focused regardless of agent render order', () => {
    const items = {
      parent: {
        path: 'memory/how-memory-works.mmd',
        title: 'How Memory Works',
        code: 'flowchart TB\n  Server["Server"] --> Browser["Browser"]',
        guide: {
          gist: 'Main overview.',
          nodes: {
            Server: { summary: 'Stateless workers', childPath: 'memory/server-workers.mmd' },
            Browser: { summary: 'IndexedDB storage', childPath: 'memory/browser-storage.mmd' },
          },
        },
      },
      childA: {
        path: 'memory/browser-storage.mmd',
        title: 'Browser Storage',
        code: 'flowchart TB\n  Ring["5-Version Ring"]',
        guide: { parentPath: 'memory/how-memory-works.mmd' },
      },
      childB: {
        path: 'memory/server-workers.mmd',
        title: 'Server Workers',
        code: 'flowchart TB\n  Slot["Chromium Slot"]',
        guide: { parentPath: 'memory/how-memory-works.mmd' },
      },
    } as const;

    const permutations = [
      ['parent', 'childA', 'childB'],
      ['parent', 'childB', 'childA'],
      ['childA', 'parent', 'childB'],
      ['childB', 'parent', 'childA'],
      ['childA', 'childB', 'parent'],
      ['childB', 'childA', 'parent'],
    ] as const;

    for (const order of permutations) {
      let ws: WorkspaceState = {
        version: 4,
        workspaceId: 'ws_order_test',
        sidebarOpen: true,
        sidebarWidth: 256,
        openTabIds: [],
        activeFileId: null,
        projects: [],
      };

      order.forEach((key, i) => {
        const spec = items[key];
        ws = upsertGraphInVfs(ws, {
          projectName: 'MFHMFA',
          path: spec.path,
          title: spec.title,
          code: spec.code,
          guide: spec.guide,
          agentSlug: 'pi',
          agentLabel: 'Pi',
          agentSessionId: 'sess-order',
          autoOpenTab: true,
          autoFocus: true,
          now: 1_720_000_000_000 + i * 1_000,
        }).nextState;
      });

      const active = findFileWithProject(ws, ws.activeFileId);
      expect(active?.file.path).toBe('memory/how-memory-works.mmd');
      expect(ws.openTabIds.length).toBe(1);
      expect(ws.openTabIds[0]).toBe(active?.file.id);

      const proj = ws.projects[0]!;
      const memFolder = buildExplorerSubtree(proj, '').folders.find(
        (f) => f.name === 'memory'
      )!;
      expect(memFolder.fileTree.map((n) => n.file.path)).toEqual([
        'memory/how-memory-works.mmd',
      ]);
      expect(memFolder.fileTree[0]!.children.map((c) => c.file.path)).toEqual([
        'memory/server-workers.mmd',
        'memory/browser-storage.mmd',
      ]);

      const hierarchy = resolveProjectGraphHierarchy(proj);
      const childFileA = proj.files.find((f) => f.path === 'memory/browser-storage.mmd')!;
      const hops = hierarchy.getBreadcrumbHops(childFileA.id);
      expect(hops.length).toBe(1);
      expect(hops[0]!.parentFile.title).toBe('How Memory Works');
      expect(hops[0]!.viaComponentLabel).toBe('Browser');
      expect(hops[0]!.siblingBranches.map((b) => b.componentLabel)).toEqual([
        'Server',
        'Browser',
      ]);
    }
  });

  it('builds mode-specific learning playbooks and sanitizes flows, traces, checks, terms & refs', () => {
    for (const mode of LEARNING_MODES) {
      const doc = buildLearningPlaybookDocument({
        mode,
        syntaxTopic: 'sequence',
        lsResult: {
          project: 'FlashAttention Study',
          cwd: '/',
          entries: [],
          treeText:
            'FlashAttention Study/\n  overview.mmd  (flowchart-v2, v1, by pi, 2 flows / 4 steps)',
          viewerFocus: {
            activePath: 'overview.mmd',
            viewingVersion: 1,
            activeFlowId: 'paper-method',
            activeFlowLabel: "Paper's Method",
            activeStepIndex: 1,
            activeStepTitle: '2. Tile into SRAM',
            selectedNodeId: 'SRAM',
          },
        },
      });
      expect(doc).toContain(`Learning Playbook: \`${mode}\``);
      expect(doc).toContain('Universal Comprehension Rules');
      expect(doc).toContain('Mermaid Syntax Essentials');
      expect(doc).toContain('Sequence Diagram');
      expect(doc).toContain('selected box `SRAM`');
    }

    const richGuide = sanitizeComprehensionGuide({
      gist: 'Avoid slow HBM round-trips by tiling Q/K/V inside fast on-chip SRAM.',
      flows: [
        {
          label: 'Baseline Bottleneck',
          steps: [
            {
              title: '1. Materialize full N x N matrix',
              caption: 'Writes full attention matrix back to slow HBM.',
              focusNodes: ['QKV', 'HBM'],
              trace: '[4096 x 64] -> [4096 x 4096] written to HBM',
            },
          ],
        },
        {
          label: 'Baseline Bottleneck',
          steps: [
            {
              title: '1. Online softmax tiling',
              caption: 'Computes blockwise rescaled softmax inside SRAM.',
              focusNodes: ['QKV', 'SRAM'],
              trace: '[128 x 64] tile -> 0 intermediate HBM writes',
              check: {
                question: 'How does online softmax combine two blocks without full N?',
                answer: 'By tracking running max m(x) and rescaling factor exp(m_old - m_new).',
              },
            },
          ],
        },
      ],
      nodes: {
        SRAM: {
          label: 'Fast On-Chip Tile',
          term: 'Eq. 4: Blockwise Online Softmax (SRAM)',
          summary: 'Fuses matmul, mask, softmax, and value accumulation in one CUDA kernel.',
          example: '20 MB SRAM @ 19 TB/s vs 40 GB HBM @ 1.5 TB/s',
          whatIf:
            'If head_dim exceeds shared memory capacity, register spilling slows kernels.',
          refs: ['§3.1', 'Algorithm 1'],
          files: ['csrc/flash_attn/flash_fwd_kernel.h'],
        },
      },
    });

    expect(richGuide?.flows?.map((f) => f.id)).toEqual([
      'baseline-bottleneck',
      'baseline-bottleneck-2',
    ]);
    expect(resolveGuideFlows(richGuide).length).toBe(2);
    expect(richGuide?.flows?.[1]?.steps[0]?.trace).toContain('0 intermediate HBM writes');
    expect(richGuide?.flows?.[1]?.steps[0]?.check?.answer).toContain('running max');
    expect(richGuide?.nodes?.SRAM?.term).toBe('Eq. 4: Blockwise Online Softmax (SRAM)');
    expect(resolveNodeRefs(richGuide?.nodes?.SRAM)).toEqual([
      '§3.1',
      'Algorithm 1',
      'csrc/flash_attn/flash_fwd_kernel.h',
    ]);
    expect(summarizeComprehensionGuide(richGuide)).toMatchObject({
      hasGuide: true,
      hasGist: true,
      flowCount: 2,
      stepCount: 2,
      documentedNodeCount: 1,
    });
  });
});
