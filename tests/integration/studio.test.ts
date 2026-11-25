import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import puppeteer from 'puppeteer-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { resolveChromePath } from '../../src/infrastructure/renderer/browserDiscovery.js';
import { ChromiumRenderEngine } from '../../src/infrastructure/renderer/chromiumEngine.js';
import { startStudioServer, type StartedStudioServer } from '../../src/server.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('MFHMFA Zero-Storage VFS Engine & VS Code Explorer Suite', () => {
  let tempDir: string;
  let engine: ChromiumRenderEngine;
  let started: StartedStudioServer;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mfhmfa-vfs-test-'));
    engine = new ChromiumRenderEngine(4);
    started = await startStudioServer({
      port: 0,
      host: '127.0.0.1',
      engine,
    });
  }, 30_000);

  afterAll(async () => {
    await started?.close();
    await engine?.dispose();
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 20_000);

  it('reports zero-storage server status and pool telemetry with zero stored diagrams', async () => {
    const resp = await fetch(`${started.baseUrl}/api/status`);
    expect(resp.ok).toBe(true);
    const status = (await resp.json()) as {
      ok: boolean;
      stateless: boolean;
      serverStorage: string;
      engine: { maxConcurrency: number };
      relay: { storedDiagrams: number };
    };
    expect(status.ok).toBe(true);
    expect(status.stateless).toBe(true);
    expect(status.serverStorage).toBe('none');
    expect(status.engine.maxConcurrency).toBe(4);
    expect(status.relay.storedDiagrams).toBe(0);
  });

  it('validates Mermaid code statelessly and returns line/col snippets on errors', async () => {
    const ok = await started.service.validate('sequenceDiagram\n  Alice->>Bob: Hello!', 'web');
    expect(ok.valid).toBe(true);
    expect(ok.diagramType).toBe('sequence');
    expect(ok.error).toBeNull();

    const broken = await started.service.validate('flowchart TD\n  A[call(x)] --> B', 'web');
    expect(broken.valid).toBe(false);
    expect(broken.error?.line).toBe(2);
    expect(broken.error?.snippet).toContain('>   2 |   A[call(x)] --> B');
  });

  it('exposes VFS MCP tools (ls, read, render, mv; NO rm) and streams path-based graphs with zero server storage', async () => {
    const wsToken = 'ws_sse_relay_vfs';
    const sseAbort = new AbortController();
    const sseResp = await fetch(`${started.baseUrl}/api/workspace/${wsToken}/events`, {
      signal: sseAbort.signal,
    });
    expect(sseResp.ok).toBe(true);
    const reader = sseResp.body!.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';

    const readUntil = async (needle: string): Promise<void> => {
      while (true) {
        if (sseBuffer.includes(needle)) return;
        const { done, value } = await reader.read();
        if (done) throw new Error('SSE stream ended prematurely');
        sseBuffer += decoder.decode(value, { stream: true });
      }
    };

    const mcpClient = new Client(
      { name: 'claude-code', version: '1.2.0' },
      { capabilities: { roots: { listChanged: true } } }
    );
    mcpClient.setRequestHandler(ListRootsRequestSchema, async () => ({
      roots: [{ uri: 'file:///home/dev/Billing-Platform', name: 'Billing Platform' }],
    }));

    try {
      await mcpClient.connect(
        new StreamableHTTPClientTransport(
          new URL(`${started.baseUrl}/mcp?workspace=${wsToken}`)
        )
      );

      await readUntil('Claude Code');
      await readUntil('Billing Platform');

      const toolsList = await mcpClient.listTools();
      const toolNames = toolsList.tools.map((t) => t.name).sort();
      expect(toolNames).toEqual([
        'export_view',
        'get_playbook',
        'list_views',
        'move_view',
        'read_view',
        'render_view',
      ]);
      expect(toolNames).not.toContain('mermaid_rm');
      expect(toolNames).not.toContain('delete_view');

      // Soft guidance: rendering BEFORE calling get_playbook and without a guide succeeds cleanly with coachingTips
      const renderRes = await mcpClient.callTool({
        name: 'render_view',
        arguments: {
          path: 'payments/checkout-flow',
          code: 'flowchart LR\n  Client(["Checkout UI"]) --> API["Payments API"]\n  API --> Ledger[("Ledger")]',
          theme: 'dark',
          look: 'classic',
          includeSvg: true,
        },
      });

      expect(renderRes.isError).toBeFalsy();
      const contentArr = renderRes.content as Array<{
        type: string;
        text?: string;
        data?: string;
        mimeType?: string;
      }>;
      expect(contentArr.length).toBe(2);
      expect(contentArr[1].mimeType).toBe('image/png');
      expect(Buffer.from(contentArr[1].data!, 'base64').subarray(0, 8).equals(PNG_MAGIC)).toBe(
        true
      );

      const meta = JSON.parse(contentArr[0].text!) as {
        valid: boolean;
        project: string;
        path: string;
        agent: string;
        studioUrl?: string;
        syncedToBrowser: boolean;
        syncStatus: string;
        presentationRule: string;
        coachingTips?: string[];
      };
      expect(meta.valid).toBe(true);
      expect(meta.agent).toBe('Claude Code');
      expect(meta.project).toBe('Billing Platform');
      expect(meta.path).toBe('payments/checkout-flow.mmd');
      expect(meta.syncedToBrowser).toBe(true);
      expect(meta.syncStatus).toBe('synced_live');
      expect(meta.studioUrl).toBeUndefined();
      expect(meta.presentationRule).toContain(
        'without outputting raw Mermaid source code or any URLs'
      );
      expect(meta.coachingTips?.length).toBe(2);
      expect(meta.coachingTips?.[0]).toContain('get_playbook');

      // Calling get_playbook loads mode-specific pedagogy and clears coachingTips when a guide is attached
      const pbRes = await mcpClient.callTool({
        name: 'get_playbook',
        arguments: { mode: 'paper', syntax: 'flowchart' },
      });
      expect(pbRes.isError).toBeFalsy();
      const pbText = (pbRes.content as Array<{ text?: string }>)[0]?.text ?? '';
      expect(pbText).toContain('Learning Playbook: `paper`');

      const guidedRes = await mcpClient.callTool({
        name: 'render_view',
        arguments: {
          path: 'payments/checkout-flow',
          code: 'flowchart LR\n  Client(["Checkout UI"]) --> API["Payments API"]',
          guide: {
            gist: 'Checkout UI submits payment intents to the Payments API.',
          },
          returnImage: false,
        },
      });
      const guidedMeta = JSON.parse(
        (guidedRes.content as Array<{ text?: string }>)[0]?.text ?? '{}'
      ) as { coachingTips?: string[] };
      expect(guidedMeta.coachingTips).toBeUndefined();

      await readUntil('payments/checkout-flow.mmd');
      expect(started.service.getRelayStats().storedDiagrams).toBe(0);
    } finally {
      sseAbort.abort();
      await reader.cancel().catch(() => {});
      await mcpClient.close().catch(() => {});
    }
  }, 30_000);

  it('handles heavy parallel MCP bursts across mixed diagram types, themes, handDrawn & errors without stalling', async () => {
    const clients = await Promise.all(
      Array.from({ length: 4 }, async (_, idx) => {
        const c = new Client({ name: `parallel-agent-${idx}`, version: '2.0.0' });
        const t = new StreamableHTTPClientTransport(new URL(`${started.baseUrl}/mcp`));
        await c.connect(t);
        return c;
      })
    );

    const workloads = [
      {
        kind: 'valid',
        args: {
          project: 'Stress Suite',
          path: 'maps/mindmap',
          code: 'mindmap\n  root(("Core"))\n    BranchA\n      Leaf1\n    BranchB\n      Leaf2',
          theme: 'forest',
          look: 'handDrawn',
        },
      },
      {
        kind: 'valid',
        args: {
          project: 'Stress Suite',
          path: 'auth/sequence',
          code: 'sequenceDiagram\n  autonumber\n  A->>B: Request\n  B-->>A: 200 OK',
          theme: 'dark',
          look: 'classic',
        },
      },
      {
        kind: 'valid',
        args: {
          project: 'Stress Suite',
          path: 'db/schema',
          code: 'erDiagram\n  USER ||--o{ SESSION : opens\n  USER {\n    uuid id PK\n  }',
          theme: 'neutral',
          look: 'classic',
        },
      },
      {
        kind: 'valid',
        args: {
          project: 'Stress Suite',
          path: 'mesh/flow',
          code: 'flowchart TB\n  subgraph Cluster["Service Mesh"]\n    GW["Gateway"] --> S1["Auth"] & S2["Billing"]\n  end',
          theme: 'default',
          look: 'handDrawn',
        },
      },
      {
        kind: 'invalid',
        args: {
          project: 'Stress Suite',
          path: 'broken/err',
          code: 'flowchart TD\n  bad[unquoted (parens)] --> end[reserved]',
        },
      },
      {
        kind: 'valid',
        args: {
          project: 'Stress Suite',
          path: 'lifecycle/state',
          code: 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running : start\n  Running --> [*]',
          theme: 'base',
          look: 'classic',
        },
      },
    ] as const;

    try {
      const wave1Results = await Promise.all(
        clients.flatMap((client, cIdx) =>
          workloads.map(async (w, wIdx) => {
            const res = await client.callTool({
              name: 'render_view',
              arguments: {
                ...w.args,
                path: `${w.args.path}-c${cIdx}-w${wIdx}.mmd`,
              },
            });
            return { expectedKind: w.kind, res };
          })
        )
      );

      expect(wave1Results.length).toBe(24);
      for (const item of wave1Results) {
        const parts = item.res.content as Array<{
          type: string;
          text?: string;
          data?: string;
        }>;
        const payload = JSON.parse(parts[0].text!) as { valid: boolean };
        if (item.expectedKind === 'valid') {
          expect(item.res.isError).toBeFalsy();
          expect(payload.valid).toBe(true);
          expect(parts[1]?.type).toBe('image');
        } else {
          expect(item.res.isError).toBe(true);
          expect(payload.valid).toBe(false);
        }
      }

      const stats = engine.getStats();
      expect(stats.activeSlots).toBeLessThanOrEqual(4);
      expect(stats.busySlots).toBe(0);
      expect(stats.queuedRequests).toBe(0);
      expect(started.service.getRelayStats().storedDiagrams).toBe(0);
    } finally {
      await Promise.all(clients.map((c) => c.close()));
    }
  }, 60_000);

  it('connects cleanly over Stdio MCP transport with zero stdout pollution and no #z= URL spam', async () => {
    const projectRoot = path.resolve(__dirname, '../..');
    const stdioTransport = new StdioClientTransport({
      command: path.join(projectRoot, 'node_modules/.bin/tsx'),
      args: [path.join(projectRoot, 'src/mcp-stdio.ts')],
      env: {
        ...process.env,
        MERMAID_STUDIO_URL: started.baseUrl,
      } as Record<string, string>,
    });

    const stdioClient = new Client({ name: 'pi-coding-agent', version: '1.5.2' });
    await stdioClient.connect(stdioTransport);

    const previewRes = await stdioClient.callTool({
      name: 'render_view',
      arguments: {
        path: 'schema/agent-er.mmd',
        code: 'erDiagram\n  AGENT ||--o{ DIAGRAM : renders',
        theme: 'dark',
      },
    });

    expect(previewRes.isError).toBeFalsy();
    const parts = previewRes.content as Array<{ type: string; text?: string; data?: string }>;
    const bridgedMeta = JSON.parse(parts[0].text!) as {
      studioUrl?: string;
      syncStatus: string;
      syncedToBrowser: boolean;
      agent: string;
      project: string;
      path: string;
    };
    expect(bridgedMeta.agent).toBe('Pi');
    expect(bridgedMeta.project).toBe('MFHMFA');
    expect(bridgedMeta.path).toBe('schema/agent-er.mmd');
    expect(bridgedMeta.studioUrl).toBeUndefined();
    expect(bridgedMeta.syncedToBrowser).toBe(false);
    expect(bridgedMeta.syncStatus).toBe('browser_tab_closed');

    await stdioClient.close();
  }, 35_000);

  it('supports OpenAI/Anthropic REST tool schemas and stateless mermaid_export', async () => {
    const schemaResp = await fetch(`${started.baseUrl}/api/tools/schemas`);
    const schemaJson = (await schemaResp.json()) as {
      tools: Array<{ function: { name: string } }>;
    };
    expect(Array.isArray(schemaJson.tools)).toBe(true);
    expect(schemaJson.tools.length).toBe(6);
    expect(schemaJson.tools.map((t) => t.function.name)).toContain('get_playbook');

    const outSvg = path.join(tempDir, 'exported-arch.svg');
    const callResp = await fetch(`${started.baseUrl}/api/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'export_view',
        arguments: {
          code: 'mindmap\n  root((Stateless))\n    MCP\n    REST\n    Web',
          outputPath: outSvg,
        },
      }),
    });
    const callJson = (await callResp.json()) as { ok: boolean };
    expect(callJson.ok).toBe(true);
    expect(fs.existsSync(outSvg)).toBe(true);

    // Remote/hosted requests (non-localhost X-Forwarded-Host) MUST be blocked from writing server disk files
    const remoteExportResp = await fetch(`${started.baseUrl}/api/tools/call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Host': 'mfhmfa.kasun.si',
      },
      body: JSON.stringify({
        name: 'mermaid_export',
        arguments: {
          code: 'flowchart LR\n  A --> B',
          outputPath: path.join(tempDir, 'remote-blocked.svg'),
        },
      }),
    });
    expect(remoteExportResp.status).toBe(403);
    expect(fs.existsSync(path.join(tempDir, 'remote-blocked.svg'))).toBe(false);
  }, 20_000);

  it('supports end-to-end jailed multi-agent VFS (ls, read, render, mv), immutable 5-version history, and VS Code Explorer UI', async () => {
    const projectRoot = path.resolve(__dirname, '../..');
    if (!fs.existsSync(path.join(projectRoot, 'dist/web/index.html'))) {
      return;
    }

    const browser = await puppeteer.launch({
      executablePath: resolveChromePath(),
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    try {
      const wsPage = await browser.newPage();
      await wsPage.goto(`${started.baseUrl}/?workspace=ws_vscode_vfs_e2e`, {
        waitUntil: 'networkidle2',
      });

      // 1. Verify IndexedDB v4 workspace initialized immediately on browser visit (and 0 localStorage blob)
      await wsPage.waitForFunction(
        async () => {
          const dbs = await indexedDB.databases();
          if (!dbs.some((d) => d.name === 'mfhmfa-db')) return false;
          return new Promise<boolean>((resolve) => {
            const req = indexedDB.open('mfhmfa-db');
            req.onsuccess = () => {
              const db = req.result;
              if (!db.objectStoreNames.contains('workspace')) {
                db.close();
                resolve(false);
                return;
              }
              const tx = db.transaction('workspace', 'readonly');
              const getReq = tx.objectStore('workspace').get('mfhmfa-workspace-v4');
              getReq.onsuccess = () => {
                const val = getReq.result as { version?: number } | undefined;
                db.close();
                resolve(val?.version === 4);
              };
              getReq.onerror = () => {
                db.close();
                resolve(false);
              };
            };
            req.onerror = () => resolve(false);
          });
        },
        { timeout: 5_000 }
      );
      const legacyBlob = await wsPage.evaluate(() =>
        localStorage.getItem('mfhmfa-workspace-v4')
      );
      expect(legacyBlob).toBeNull();

      // 1b. Verify automatic one-time migration from legacy localStorage v4 -> IndexedDB + cleanup
      const migContext = await browser.createBrowserContext();
      const isolatedMigPage = await migContext.newPage();
      await isolatedMigPage.evaluateOnNewDocument(() => {
        localStorage.setItem(
          'mfhmfa-workspace-v4',
          JSON.stringify({
            version: 4,
            workspaceId: 'ws_migrated_legacy',
            sidebarOpen: true,
            sidebarWidth: 260,
            openTabIds: ['file-leg-1'],
            activeFileId: 'file-leg-1',
            projects: [
              {
                projectKey: 'legacy-proj',
                projectLabel: 'Legacy Proj',
                expanded: true,
                folders: [],
                files: [
                  {
                    id: 'file-leg-1',
                    path: 'migrated-flow.mmd',
                    title: 'migrated-flow',
                    diagramType: 'flowchart-v2',
                    currentVersion: 1,
                    versions: [
                      {
                        version: 1,
                        code: 'flowchart LR\n  Legacy["Legacy"] --> IDB["IndexedDB"]',
                        authorSlug: 'user',
                        authorLabel: 'You',
                        authorBadge: 'you',
                        createdAt: 1700000000000,
                      },
                    ],
                  },
                ],
              },
            ],
          })
        );
      });
      await isolatedMigPage.goto(`${started.baseUrl}/?workspace=ws_migrated_legacy`, {
        waitUntil: 'networkidle2',
      });
      await isolatedMigPage.waitForSelector(
        '[data-explorer-path="legacy-proj/migrated-flow.mmd"]',
        { timeout: 5_000 }
      );
      const lsAfterMig = await isolatedMigPage.evaluate(() =>
        localStorage.getItem('mfhmfa-workspace-v4')
      );
      expect(lsAfterMig).toBeNull();
      await migContext.close();

      // 2. Connect Claude Code (Project A), Pi (Project A), and Cursor (Project B)
      const claude = new Client(
        { name: 'claude-code', version: '1.0.0' },
        { capabilities: { roots: { listChanged: true } } }
      );
      claude.setRequestHandler(ListRootsRequestSchema, async () => ({
        roots: [{ uri: 'file:///workspace/Project-A', name: 'Project A' }],
      }));

      const pi = new Client(
        { name: '@earendil-works/pi-coding-agent', version: '1.5.2' },
        { capabilities: { roots: { listChanged: true } } }
      );
      pi.setRequestHandler(ListRootsRequestSchema, async () => ({
        roots: [{ uri: 'file:///workspace/Project-A', name: 'Project A' }],
      }));

      const cursor = new Client(
        { name: 'cursor-vscode', version: '0.48.0' },
        { capabilities: { roots: { listChanged: true } } }
      );
      cursor.setRequestHandler(ListRootsRequestSchema, async () => ({
        roots: [{ uri: 'file:///workspace/Project-B', name: 'Project B' }],
      }));

      try {
        await Promise.all([
          claude.connect(
            new StreamableHTTPClientTransport(
              new URL(`${started.baseUrl}/mcp?workspace=ws_vscode_vfs_e2e`)
            )
          ),
          pi.connect(
            new StreamableHTTPClientTransport(
              new URL(`${started.baseUrl}/mcp?workspace=ws_vscode_vfs_e2e`)
            )
          ),
          cursor.connect(
            new StreamableHTTPClientTransport(
              new URL(`${started.baseUrl}/mcp?workspace=ws_vscode_vfs_e2e`)
            )
          ),
        ]);

        // Verify Connected Agents bottom sidebar pane is collapsed by default and shows 3 when expanded!
        await wsPage.waitForFunction(
          () => {
            const count = document.querySelector('.agents-count-pill')?.textContent?.trim();
            const body = document.querySelector('.sidebar-agents-body');
            return count === '3' && body === null;
          },
          { timeout: 10_000 }
        );

        await wsPage.click('.sidebar-agents-pane .sidebar-section-header');
        await wsPage.waitForFunction(
          () => {
            const names = Array.from(document.querySelectorAll('.sidebar-agent-name')).map(
              (el) => el.textContent?.trim()
            );
            return (
              names.includes('Claude Code') && names.includes('Pi') && names.includes('Cursor')
            );
          },
          { timeout: 5_000 }
        );

        // 3. Cursor writes a secret graph in Project B; Claude writes two graphs in Project A
        await cursor.callTool({
          name: 'render_view',
          arguments: {
            path: 'internal/secret-b.mmd',
            code: 'flowchart LR\n  B1["ProjectBSecretNode"] --> B2["Vault"]',
          },
        });

        await claude.callTool({
          name: 'render_view',
          arguments: {
            path: 'architecture/system-overview.mmd',
            code: 'flowchart LR\n  Web["Frontend"] --> GW["API Gateway"]',
          },
        });

        await claude.callTool({
          name: 'render_view',
          arguments: {
            path: 'auth/oauth-flow.mmd',
            code: 'sequenceDiagram\n  User->>GW: ClaudeOAuthV1',
          },
        });

        // 4. Pi calls `list_views` -> sees Claude's folders & graphs in Project A,
        //    and CANNOT see Project B even if passing `project: "Project B"` or `path: "../Project B"`!
        const piLsRes = await pi.callTool({
          name: 'list_views',
          arguments: { project: 'Project B' }, // Should be ignored because Pi is jailed to Project A!
        });
        expect(piLsRes.isError).toBeFalsy();
        const piLsJson = JSON.parse(
          (piLsRes.content as Array<{ text?: string }>)[0]?.text ?? '{}'
        ) as { project: string; treeText: string };
        expect(piLsJson.project).toBe('Project A');
        expect(piLsJson.treeText).toContain('architecture/');
        expect(piLsJson.treeText).toContain('oauth-flow.mmd');
        expect(piLsJson.treeText).not.toContain('secret-b.mmd');

        const escapeAttempt = await pi.callTool({
          name: 'list_views',
          arguments: { path: '../../Project-B' },
        });
        expect(escapeAttempt.isError).toBe(true);

        // 5. Pi reads Claude's `auth/oauth-flow.mmd`, updates it to v2, and creates `auth/session-er.mmd`!
        const piReadV1 = await pi.callTool({
          name: 'read_view',
          arguments: { path: 'auth/oauth-flow' },
        });
        const readV1Payload = JSON.parse(
          (piReadV1.content as Array<{ text?: string }>)[0]?.text ?? '{}'
        ) as { code: string; currentVersion: number; author: string };
        expect(readV1Payload.code).toContain('ClaudeOAuthV1');
        expect(readV1Payload.currentVersion).toBe(1);
        expect(readV1Payload.author).toBe('claude');

        await pi.callTool({
          name: 'render_view',
          arguments: {
            path: 'auth/oauth-flow.mmd',
            code: 'sequenceDiagram\n  User->>GW: PiRefinedOAuthV2',
          },
        });

        await pi.callTool({
          name: 'render_view',
          arguments: {
            path: 'auth/draft-er.mmd',
            code: 'erDiagram\n  USER ||--o{ SESSION : PiSessionRel',
          },
        });

        // 6. Pi moves `auth/draft-er.mmd` -> `database/session-er.mmd` via `move_view`!
        const mvRes = await pi.callTool({
          name: 'move_view',
          arguments: {
            from: 'auth/draft-er.mmd',
            to: 'database/session-er.mmd',
          },
        });
        expect(mvRes.isError).toBeFalsy();

        // Verify immutable history: Claude can still read v1 while head is v2 (by pi)!
        const claudeReadHistorical = await claude.callTool({
          name: 'read_view',
          arguments: { path: 'auth/oauth-flow.mmd', version: 1 },
        });
        const histPayload = JSON.parse(
          (claudeReadHistorical.content as Array<{ text?: string }>)[0]?.text ?? '{}'
        ) as { code: string; currentVersion: number; requestedVersion: number };
        expect(histPayload.requestedVersion).toBe(1);
        expect(histPayload.currentVersion).toBe(2);
        expect(histPayload.code).toContain('ClaudeOAuthV1');

        // 7. Verify clean Topic Library UI:
        //    - No TabBar, no Code Editor, no Version History UI, no New File button
        //    - Folder-only creation/rename; whole-graph delete only (no graph rename)
        //    - Copy MCP URL remains accessible even when 3 agents are connected
        await wsPage.waitForFunction(
          () =>
            Boolean(
              document.querySelector('[data-explorer-path="project-a/database/session-er.mmd"]')
            ) &&
            Boolean(
              document.querySelector('[data-explorer-path="project-a/auth/oauth-flow.mmd"]')
            ),
          { timeout: 10_000 }
        );

        const uiAudit = await wsPage.evaluate(() => {
          const projRow = document.querySelector(
            '[data-project-key="project-a"] .tree-project-row'
          );
          const projChildren = projRow ? Array.from(projRow.children) : [];
          const dotIdx = projChildren.findIndex((el) =>
            el.classList.contains('project-live-dot')
          );
          const labelIdx = projChildren.findIndex((el) =>
            el.classList.contains('tree-project-label')
          );
          return {
            editorTabs: document.querySelectorAll('.editor-tab').length,
            tabBar: document.querySelectorAll('.tabbar').length,
            versionPills: document.querySelectorAll('.version-pill').length,
            codeViewToggle: document.querySelectorAll('.tabbar-view-toggle').length,
            codeMirrorWrap: document.querySelectorAll('.codemirror-wrap').length,
            newFileButtons: document.querySelectorAll('button[aria-label="New file"]').length,
            newFolderButtons: document.querySelectorAll('button[aria-label="New folder"]')
              .length,
            copyLinkButtons: document.querySelectorAll('button[aria-label="Copy link"]').length,
            copyMcpInAgentsPane: document.querySelectorAll(
              '.sidebar-agents-body .sidebar-copy-mcp-btn'
            ).length,
            dotBeforeProjectLabel: dotIdx >= 0 && labelIdx > dotIdx,
            agentsHeaderButtons: document.querySelectorAll(
              '.sidebar-agents-pane .sidebar-header-actions button'
            ).length,
          };
        });
        expect(uiAudit.editorTabs).toBe(0);
        expect(uiAudit.tabBar).toBe(0);
        expect(uiAudit.versionPills).toBe(0);
        expect(uiAudit.codeViewToggle).toBe(0);
        expect(uiAudit.codeMirrorWrap).toBe(0);
        expect(uiAudit.newFileButtons).toBe(0);
        expect(uiAudit.newFolderButtons).toBe(1);
        expect(uiAudit.copyLinkButtons).toBe(0);
        expect(uiAudit.copyMcpInAgentsPane).toBe(1);
        expect(uiAudit.dotBeforeProjectLabel).toBe(true);
        expect(uiAudit.agentsHeaderButtons).toBe(0);

        // Open graph context menu -> verify "Export JSON" and "Delete graph" are available (no Rename on graphs!)
        await wsPage.evaluate(() => {
          const trigger = document.querySelector(
            '[data-explorer-path="project-a/database/session-er.mmd"] .tree-menu-trigger'
          ) as HTMLElement | null;
          trigger?.click();
        });
        await wsPage.waitForSelector('.explorer-context-menu');
        const graphMenuItems = await wsPage.evaluate(() =>
          Array.from(document.querySelectorAll('.explorer-context-menu .dropdown-item')).map(
            (el) => el.textContent?.trim()
          )
        );
        expect(graphMenuItems).toEqual(['Export MFHMFA', 'Delete graph']);

        // Delete graph -> verify VS Code bottom-right notification with sharp corners & Source label, then Undo!
        await wsPage.evaluate(() => {
          const delItem = document.querySelector(
            '.explorer-context-menu .dropdown-item.danger'
          ) as HTMLElement | null;
          delItem?.click();
        });
        await wsPage.waitForFunction(
          () =>
            document.querySelector(
              '[data-explorer-path="project-a/database/session-er.mmd"]'
            ) === null && Boolean(document.querySelector('.toast-action-btn')),
          { timeout: 5_000 }
        );
        const notifAudit = await wsPage.evaluate(() => {
          const stack = document.querySelector('[data-testid="vscode-notifications"]');
          const card = stack?.querySelector('.vscode-notification') as HTMLElement | null;
          if (!card) return null;
          const style = getComputedStyle(card);
          const rect = card.getBoundingClientRect();
          return {
            borderRadius: style.borderRadius,
            inBottomRight:
              rect.right > window.innerWidth * 0.6 && rect.bottom > window.innerHeight * 0.6,
            hasSource: (card.textContent || '').includes('Source: Explorer'),
          };
        });
        expect(notifAudit).toEqual({
          borderRadius: '0px',
          inBottomRight: true,
          hasSource: true,
        });
        await wsPage.click('.toast-action-btn');
        await wsPage.waitForSelector(
          '[data-explorer-path="project-a/database/session-er.mmd"]',
          {
            timeout: 5_000,
          }
        );

        // Verify sharp 0px corners & transparent hover backgrounds (text/icon highlight only)
        await wsPage.hover('.activity-bar-btn');
        const sharpHoverAudit = await wsPage.evaluate(() => {
          const actBtn = document.querySelector('.activity-bar-btn')!;
          const iconBtn = document.querySelector('.topbar-right .icon-btn')!;
          const copyBtn = document.querySelector('.sidebar-copy-mcp-btn')!;
          return {
            actRadius: getComputedStyle(actBtn).borderRadius,
            iconRadius: getComputedStyle(iconBtn).borderRadius,
            copyRadius: getComputedStyle(copyBtn).borderRadius,
            actHoverBg: getComputedStyle(actBtn).backgroundColor,
          };
        });
        expect(sharpHoverAudit).toEqual({
          actRadius: '0px',
          iconRadius: '0px',
          copyRadius: '0px',
          actHoverBg: 'rgba(0, 0, 0, 0)',
        });

        // Toggle Light theme and navigate to Documentation, verifying no separate back button
        await wsPage.click('button[aria-label="Light theme"]');
        await wsPage.waitForFunction(() => document.documentElement.dataset.mode === 'light', {
          timeout: 3_000,
        });

        await wsPage.click('button[aria-label="Documentation"]');
        await wsPage.waitForSelector('.docs-page');
        const topbarLeftButtonsOnDocs = await wsPage.evaluate(
          () => document.querySelectorAll('.topbar-left button').length
        );
        expect(topbarLeftButtonsOnDocs).toBe(1); // Only the brand logo button

        await wsPage.click('.brand-lockup');
        await wsPage.waitForSelector('.explorer-sidebar');

        // 8. Verify 5-zone VS Code / IntelliJ IDE layout, 1/8th screen min-width clamping & hidden scrollbars
        const ideAudit = await wsPage.evaluate(() => {
          const vw = window.innerWidth;
          const minEighth = Math.floor(vw / 8);
          const leftBar = document
            .querySelector('[data-testid="left-activity-bar"]')!
            .getBoundingClientRect();
          const explorer = document.querySelector('.explorer-sidebar')!.getBoundingClientRect();
          const story = document.querySelector('.story-panel')!.getBoundingClientRect();
          const graph = document
            .querySelector('[data-testid="graph-panel"]')!
            .getBoundingClientRect();
          const rightBar = document
            .querySelector('[data-testid="right-activity-bar"]')!
            .getBoundingClientRect();
          const treeScrollbar = getComputedStyle(
            document.querySelector('.explorer-tree')!
          ).scrollbarWidth;
          const storyScrollbar = getComputedStyle(
            document.querySelector('.story-scroll-container')!
          ).scrollbarWidth;

          return {
            topbarLeftButtonsOnStudio: document.querySelectorAll('.topbar-left button').length,
            storyCollapseButtons: document.querySelectorAll('.story-collapse-btn').length,
            leftBarFixed: Math.round(leftBar.width) === 42,
            rightBarFixed: Math.round(rightBar.width) === 42,
            orderedLeftToRight:
              leftBar.right <= explorer.left + 1 &&
              explorer.right <= story.left + 1 &&
              story.right <= graph.left + 1 &&
              graph.right <= rightBar.left + 1,
            allPanelsMeetMinEighth:
              Math.round(explorer.width) >= minEighth &&
              Math.round(story.width) >= minEighth &&
              Math.round(graph.width) >= minEighth,
            scrollbarsHidden: treeScrollbar === 'none' && storyScrollbar === 'none',
          };
        });
        expect(ideAudit).toEqual({
          topbarLeftButtonsOnStudio: 1,
          storyCollapseButtons: 0,
          leftBarFixed: true,
          rightBarFixed: true,
          orderedLeftToRight: true,
          allPanelsMeetMinEighth: true,
          scrollbarsHidden: true,
        });

        // Collapse & reopen Left Explorer and Right Graph panels while Center Story stays open
        await wsPage.click('button[aria-label="Toggle Explorer"]');
        await wsPage.waitForFunction(
          () => document.querySelector('.explorer-sidebar') === null,
          {
            timeout: 3_000,
          }
        );
        expect(await wsPage.$('.story-panel')).not.toBeNull();

        await wsPage.click('button[aria-label="Toggle Graph"]');
        await wsPage.waitForFunction(
          () => document.querySelector('[data-testid="graph-panel"]') === null,
          { timeout: 3_000 }
        );
        expect(await wsPage.$('.story-panel')).not.toBeNull();

        await wsPage.click('button[aria-label="Toggle Explorer"]');
        await wsPage.click('button[aria-label="Toggle Graph"]');
        await wsPage.waitForSelector('.explorer-sidebar');
        await wsPage.waitForSelector('[data-testid="graph-panel"]');

        // Drag Left resizer toward 0px and Right resizer across screen -> verify 1/8th min-width clamp!
        const clampAudit = await wsPage.evaluate(async () => {
          const minEighth = Math.floor(window.innerWidth / 8);

          const leftSash = document.querySelector('.sidebar-resizer')!;
          const leftRect = leftSash.getBoundingClientRect();
          leftSash.dispatchEvent(
            new MouseEvent('mousedown', { clientX: leftRect.left, bubbles: true })
          );
          window.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, bubbles: true }));
          window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 40));

          const explorerMinW = Math.round(
            document.querySelector('.explorer-sidebar')!.getBoundingClientRect().width
          );

          const rightSash = document.querySelector('.graph-panel-resizer')!;
          const rightRect = rightSash.getBoundingClientRect();
          rightSash.dispatchEvent(
            new MouseEvent('mousedown', { clientX: rightRect.left, bubbles: true })
          );
          window.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, bubbles: true }));
          window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 40));

          const centerMinW = Math.round(
            document.querySelector('.story-panel')!.getBoundingClientRect().width
          );

          return {
            explorerClampedAtEighth: explorerMinW === minEighth,
            centerProtectedAtEighth: centerMinW === minEighth,
          };
        });
        expect(clampAudit).toEqual({
          explorerClampedAtEighth: true,
          centerProtectedAtEighth: true,
        });

        expect(started.service.getRelayStats().storedDiagrams).toBe(0);
      } finally {
        await Promise.all([
          claude.close().catch(() => {}),
          pi.close().catch(() => {}),
          cursor.close().catch(() => {}),
        ]);
        await wsPage.close().catch(() => {});
      }
    } finally {
      await browser.close().catch(() => {});
    }
  }, 50_000);

  it('streams interactive Comprehension Guides (Story Stepper, Node Inspector & Sub-Graph Zoom) to Browser VFS', async () => {
    const projectRoot = path.resolve(__dirname, '../..');
    if (!fs.existsSync(path.join(projectRoot, 'dist/web/index.html'))) {
      return;
    }

    const browser = await puppeteer.launch({
      executablePath: resolveChromePath(),
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    try {
      const wsPage = await browser.newPage();
      await wsPage.setViewport({ width: 1280, height: 840 });
      await wsPage.goto(`${started.baseUrl}/?workspace=ws_comprehension_e2e`, {
        waitUntil: 'networkidle2',
      });

      const pi = new Client(
        { name: '@earendil-works/pi-coding-agent', version: '1.5.2' },
        { capabilities: { roots: { listChanged: true } } }
      );
      pi.setRequestHandler(ListRootsRequestSchema, async () => ({
        roots: [{ uri: 'file:///workspace/MFHMFA', name: 'MFHMFA' }],
      }));

      try {
        await pi.connect(
          new StreamableHTTPClientTransport(
            new URL(`${started.baseUrl}/mcp?workspace=ws_comprehension_e2e`)
          )
        );

        // 1. Render parent overview FIRST (`memory/overview.mmd`)
        const overviewRes = await pi.callTool({
          name: 'render_view',
          arguments: {
            path: 'memory/overview.mmd',
            title: 'System Memory Overview',
            code: 'flowchart TB\n  AI(["AI Agent"]) --> Relay["Live Pass-Through"] --> Browser[("Browser Storage")]\n  AI --> Preview["Preview Worker"]',
            guide: {
              gist: 'Server holds zero diagrams; your open browser tab holds every file.',
              steps: [
                {
                  title: '1. Temporary preview check',
                  caption:
                    'AI renders a temporary PNG to check layout, then the PNG is discarded.',
                  focusNodes: ['AI', 'Preview'],
                },
                {
                  title: '2. Live stream to browser',
                  caption:
                    'Valid Mermaid text passes through the server straight into your open tab.',
                  focusNodes: ['AI', 'Relay', 'Browser'],
                },
              ],
              nodes: {
                Browser: {
                  label: 'Browser Local Storage',
                  summary:
                    'Stores all project folders, diagrams, and 5-version history on your computer.',
                  example: 'mfhmfa-workspace-v4 (~14 KB JSON)',
                  whatIf: 'Close all Studio tabs -> AI ls/read calls time out after 2.5s.',
                  files: ['web/services/workspaceStorage.ts'],
                  childPath: 'memory/browser-storage.mmd',
                },
              },
            },
          },
        });
        expect(overviewRes.isError).toBeFalsy();

        // 2. Render child sub-graph SECOND (`memory/browser-storage.mmd`, alphabetically before `overview`!):
        //    Verify child does NOT steal focus or spam a tab, and nests under `overview` in Explorer!
        const childRes = await pi.callTool({
          name: 'render_view',
          arguments: {
            path: 'memory/browser-storage.mmd',
            title: 'Browser Storage Internals',
            code: 'flowchart TB\n  Coalesce["90s Retry Merger"] --> Ring["5-Version Ring"] --> Store[("localStorage Key")]',
            guide: {
              gist: 'Combines quick retries and caps history at 5 versions per graph.',
              parentPath: 'memory/overview.mmd',
              nodes: {
                Ring: {
                  summary: 'Keeps only the latest 5 revisions using slice(-5).',
                  example: 'v1..v6 -> v1 is dropped automatically',
                  whatIf: 'Restoring an older version appends a new head revision.',
                },
              },
            },
          },
        });
        expect(childRes.isError).toBeFalsy();

        // Verify:
        // - Overview is STILL active (child did not steal focus!)
        // - Sub-graph `browser-storage.mmd` is HIDDEN from Explorer sidebar (`childRow === null`)
        // - All walkthrough steps are immediately visible side-by-side in `.story-panel`
        await wsPage.waitForFunction(
          () => {
            const parentRow = document.querySelector(
              '[data-explorer-path="mfhmfa/memory/overview.mmd"]'
            );
            const childRow = document.querySelector(
              '[data-explorer-path="mfhmfa/memory/browser-storage.mmd"]'
            );
            const stepCards = document.querySelectorAll('.story-step-card');
            return (
              parentRow?.getAttribute('data-explorer-role') === 'parent' &&
              childRow === null &&
              stepCards.length === 2 &&
              Boolean(
                document
                  .querySelector('[data-testid="comprehension-dock"]')
                  ?.textContent?.includes('Server holds zero diagrams')
              )
            );
          },
          { timeout: 10_000 }
        );

        // 3. Click Step 1 card -> verify SVG spotlighting, dimming, and removed step-count / explore-deeper chrome!
        await wsPage.click('.story-step-card');
        const storyChromeAudit = await wsPage.evaluate(() => ({
          sectionBars: document.querySelectorAll('.story-section-bar').length,
          startBtns: document.querySelectorAll('[data-testid="story-start-btn"]').length,
          deeperSections: document.querySelectorAll('.story-deeper-section').length,
          hasTitleBar: Boolean(document.querySelector('[data-testid="story-title-bar"]')),
        }));
        expect(storyChromeAudit).toEqual({
          sectionBars: 0,
          startBtns: 0,
          deeperSections: 0,
          hasTitleBar: true,
        });
        await wsPage.waitForFunction(
          () => {
            const svg = document.querySelector('.canvas-stage svg');
            const previewFocused = svg
              ?.querySelector('[data-mfhmfa-node="Preview"]')
              ?.classList.contains('mfhmfa-focus');
            const browserDimmed = svg
              ?.querySelector('[data-mfhmfa-node="Browser"]')
              ?.classList.contains('mfhmfa-dim');
            const activeCardText =
              document.querySelector('.story-step-card.active')?.textContent || '';
            return (
              Boolean(svg?.classList.contains('mfhmfa-story-active')) &&
              Boolean(previewFocused) &&
              Boolean(browserDimmed) &&
              activeCardText.includes('Temporary preview check')
            );
          },
          { timeout: 5_000 }
        );

        // Press ArrowRight -> advances to Step 2!
        await wsPage.keyboard.press('ArrowRight');
        await wsPage.waitForFunction(
          () =>
            Boolean(
              document
                .querySelector('.story-step-card.active')
                ?.textContent?.includes('Live stream to browser')
            ) &&
            Boolean(
              document
                .querySelector('.canvas-stage svg [data-mfhmfa-node="Browser"]')
                ?.classList.contains('mfhmfa-focus')
            ),
          { timeout: 5_000 }
        );

        // 4. Click `Browser` SVG node -> opens top-docked Node Detail pane (scrollable, non-prevented wheel) with Dive deeper link!
        await wsPage.click('.canvas-stage svg [data-mfhmfa-node="Browser"]');

        await wsPage.waitForFunction(
          () => {
            const card = document.querySelector('[data-testid="node-inspector-card"]');
            const vp = document.querySelector('.canvas-viewport');
            if (!card || !vp) return false;
            const cRect = card.getBoundingClientRect();
            const vRect = vp.getBoundingClientRect();
            const wheelEv = new WheelEvent('wheel', {
              deltaY: 40,
              bubbles: true,
              cancelable: true,
            });
            card.dispatchEvent(wheelEv);
            const txt = card.textContent || '';
            return (
              Boolean(card.closest('.canvas-viewport')) &&
              !wheelEv.defaultPrevented &&
              Math.abs(cRect.top - vRect.top) <= 1 &&
              Math.abs(cRect.left - vRect.left) <= 1 &&
              Math.abs(cRect.right - vRect.right) <= 1 &&
              txt.includes('Browser Local Storage') &&
              txt.includes('mfhmfa-workspace-v4') &&
              txt.includes('2.5s') &&
              txt.includes('Dive deeper')
            );
          },
          { timeout: 5_000 }
        );

        // 5. Click Explore in the anchored popover -> dives into `browser-storage.mmd`,
        //    keeps root `overview.mmd` highlighted in Explorer, and shows breadcrumb in Story Sheet!
        await wsPage.click('.node-drilldown-btn');
        await wsPage.waitForFunction(
          () => {
            const crumbEl = document.querySelector('[data-testid="canvas-breadcrumb"]');
            const crumbText = crumbEl?.textContent || '';
            const rootActive = document
              .querySelector('[data-explorer-path="mfhmfa/memory/overview.mmd"]')
              ?.classList.contains('active');
            return (
              Boolean(rootActive) &&
              crumbEl?.querySelector('.crumb-back-btn') === null &&
              crumbEl?.querySelector('.crumb-current-menu-btn') === null &&
              crumbText.includes('System Memory Overview') &&
              crumbText.includes('Browser Storage Internals') &&
              Boolean(
                document
                  .querySelector('[data-testid="comprehension-dock"]')
                  ?.textContent?.includes('caps history at 5 versions')
              )
            );
          },
          { timeout: 5_000 }
        );

        // Click `overview` in the breadcrumb -> returns cleanly to `overview.mmd`!
        await wsPage.click('[data-testid="canvas-breadcrumb"] .crumb-link');
        await wsPage.waitForFunction(
          () =>
            Boolean(
              document
                .querySelector('[data-testid="comprehension-dock"]')
                ?.textContent?.includes('Server holds zero diagrams')
            ),
          { timeout: 5_000 }
        );

        // 6. Verify `read_view` returns full `guide` from browser IndexedDB & server still stores 0!
        const readBack = await pi.callTool({
          name: 'read_view',
          arguments: { path: 'memory/overview.mmd' },
        });
        const readJson = JSON.parse(
          (readBack.content as Array<{ text?: string }>)[0]?.text ?? '{}'
        ) as { guide?: { steps?: unknown[]; nodes?: Record<string, unknown> } };
        expect(readJson.guide?.steps?.length).toBe(2);
        expect(Boolean(readJson.guide?.nodes?.Browser)).toBe(true);

        // 7. Render multi-scenario learning view with contrasting `flows`, `trace`, `check`, `term`, `refs`
        //    and verify two-way live `viewerFocus` over `get_playbook` / `list_views`!
        const conceptRes = await pi.callTool({
          name: 'render_view',
          arguments: {
            path: 'concepts/wal-durability.mmd',
            title: 'Write-Ahead Log Durability',
            code: 'flowchart LR\n  Client(["Client"]) --> Log["Fast Append Log"] --> Table[("B-Tree Pages")]',
            guide: {
              gist: 'Random page writes corrupt on crash unless an append-only log records intent first.',
              flows: [
                {
                  id: 'normal-write',
                  label: 'Normal Write',
                  steps: [
                    {
                      title: '1. Append sequentially',
                      caption:
                        'Sequential log append flushes to disk before touching B-Tree pages.',
                      focusNodes: ['Client', 'Log'],
                      trace: 'LSN=42 | fsync(wal, 128B) -> ACK in 0.4ms',
                      check: {
                        question: 'If power fails right after ACK, is data safe?',
                        answer: 'Yes. Recovery replays LSN=42 from the sequential log on boot.',
                      },
                    },
                  ],
                },
                {
                  id: 'crash-recovery',
                  label: 'Crash Recovery',
                  steps: [
                    {
                      title: '1. Replay committed log entries',
                      caption:
                        'On restart, unapplied WAL records redo page updates idempotently.',
                      focusNodes: ['Log', 'Table'],
                      trace: 'PageLSN(41) < LogLSN(42) -> Redo apply LSN=42',
                    },
                  ],
                },
              ],
              nodes: {
                Log: {
                  label: 'Fast Append Log',
                  term: 'Write-Ahead Log (WAL / ARIES Redo Log)',
                  summary:
                    'Sequential append-only file flushed to disk before acknowledging commits.',
                  example: '128 B record -> 1 sequential fsync',
                  whatIf:
                    'Without checkpoints, log grows unbounded and boot replay takes minutes.',
                  refs: ['ARIES Paper §3', 'storage/wal.rs'],
                },
              },
            },
          },
        });
        expect(conceptRes.isError).toBeFalsy();

        await wsPage.waitForFunction(
          () =>
            Boolean(
              document
                .querySelector('[data-testid="comprehension-dock"]')
                ?.textContent?.includes('Random page writes corrupt on crash')
            ),
          { timeout: 5_000 }
        );

        // Click Step 1 card -> verify sticky title bar -> overview gist -> VS Code flow tabs -> step cards order!
        await wsPage.click('.story-step-card');
        const flowOrderAudit = await wsPage.evaluate(() => {
          const titleBar = document
            .querySelector('[data-testid="story-title-bar"]')!
            .getBoundingClientRect();
          const scrollArea = document
            .querySelector('.story-scroll-container')!
            .getBoundingClientRect();
          const gist = document.querySelector('.story-gist')!.getBoundingClientRect();
          const flowTabsEl = document.querySelector(
            '[data-testid="flow-selector"]'
          ) as HTMLElement;
          const flowTabs = flowTabsEl.getBoundingClientRect();
          const stepsList = document
            .querySelector('.story-steps-list')!
            .getBoundingClientRect();
          return {
            titlePinnedAboveScroll: titleBar.bottom <= scrollArea.top + 1,
            gistAboveFlowTabs: gist.bottom <= flowTabs.top + 1,
            flowTabsAboveSteps: flowTabs.bottom <= stepsList.top + 1,
            flowTabCount: document.querySelectorAll('.story-flow-tab').length,
            tabsFitWithoutOverflow: flowTabsEl.scrollWidth <= flowTabsEl.clientWidth,
          };
        });
        expect(flowOrderAudit).toEqual({
          titlePinnedAboveScroll: true,
          gistAboveFlowTabs: true,
          flowTabsAboveSteps: true,
          flowTabCount: 2,
          tabsFitWithoutOverflow: true,
        });
        await wsPage.waitForFunction(
          () =>
            document.querySelectorAll('[data-testid="flow-selector"] button').length === 2 &&
            Boolean(
              document
                .querySelector('[data-testid="story-step-trace"]')
                ?.textContent?.includes('LSN=42')
            ) &&
            document.querySelector('[data-testid="story-check-answer"]') === null,
          { timeout: 5_000 }
        );

        await wsPage.click('[data-testid="story-check-toggle"]');
        await wsPage.waitForFunction(
          () =>
            Boolean(
              document
                .querySelector('[data-testid="story-check-answer"]')
                ?.textContent?.includes('replays LSN=42')
            ),
          { timeout: 5_000 }
        );

        // Switch to second contrasting flow ("Crash Recovery") and click `Log` box!
        await wsPage.click('[data-flow-id="crash-recovery"]');
        await wsPage.waitForFunction(
          () =>
            Boolean(
              document
                .querySelector('[data-testid="story-step-trace"]')
                ?.textContent?.includes('PageLSN(41) < LogLSN(42)')
            ),
          { timeout: 5_000 }
        );

        await wsPage.evaluate(() => {
          const el = document.querySelector(
            '.canvas-stage svg [data-mfhmfa-node="Log"]'
          ) as HTMLElement | null;
          el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        // References section is last and collapsed by default until clicked!
        await wsPage.waitForFunction(
          () => {
            const termTxt =
              document.querySelector('[data-testid="node-inspector-term"]')?.textContent || '';
            const card = document.querySelector('[data-testid="node-inspector-card"]');
            const cardTxt = card?.textContent || '';
            const bodyChildren = Array.from(
              document.querySelector('.node-inspector-body')?.children || []
            );
            const lastChildIsRefs =
              bodyChildren[bodyChildren.length - 1]?.classList.contains(
                'node-refs-disclosure'
              ) ?? false;
            return (
              termTxt.includes('Write-Ahead Log (WAL') &&
              cardTxt.includes('References') &&
              !cardTxt.includes('ARIES Paper §3') &&
              lastChildIsRefs &&
              document.querySelector('[data-testid="node-refs-list"]') === null
            );
          },
          { timeout: 5_000 }
        );

        await wsPage.click('[data-testid="node-refs-toggle"]');
        await wsPage.waitForFunction(
          () =>
            Boolean(
              document
                .querySelector('[data-testid="node-refs-list"]')
                ?.textContent?.includes('ARIES Paper §3')
            ),
          { timeout: 5_000 }
        );

        // Verify `get_playbook` and `list_views` report the human's live Studio selection (`viewerFocus`)!
        const liveLs = await pi.callTool({
          name: 'list_views',
          arguments: {},
        });
        const liveLsJson = JSON.parse(
          (liveLs.content as Array<{ text?: string }>)[0]?.text ?? '{}'
        ) as {
          viewerFocus?: {
            activePath: string;
            activeFlowId?: string | null;
            activeFlowLabel?: string | null;
            activeStepIndex?: number | null;
            selectedNodeId?: string | null;
          };
        };
        expect(liveLsJson.viewerFocus).toMatchObject({
          activePath: 'concepts/wal-durability.mmd',
          activeFlowId: 'crash-recovery',
          activeFlowLabel: 'Crash Recovery',
          activeStepIndex: 0,
          selectedNodeId: 'Log',
        });

        const livePlaybook = await pi.callTool({
          name: 'get_playbook',
          arguments: { mode: 'concept' },
        });
        const livePlaybookText =
          (livePlaybook.content as Array<{ text?: string }>)[0]?.text ?? '';
        expect(livePlaybookText).toContain('concepts/wal-durability.mmd');
        expect(livePlaybookText).toContain('flow "Crash Recovery"');
        expect(livePlaybookText).toContain('selected box `Log`');

        expect(started.service.getRelayStats().storedDiagrams).toBe(0);
      } finally {
        await pi.close().catch(() => {});
        await wsPage.close().catch(() => {});
      }

      // Verify mobile viewports (<= 720px) show the plain explanation page with zero SSE connections
      const mobilePage = await browser.newPage();
      try {
        await mobilePage.setViewport({ width: 390, height: 844, isMobile: true });
        await mobilePage.goto(`${started.baseUrl}/?workspace=ws_mobile_only`, {
          waitUntil: 'networkidle2',
        });

        await mobilePage.waitForSelector('[data-testid="mobile-info-page"]');
        const mobileAudit = await mobilePage.evaluate(() => ({
          hasSidebar: Boolean(document.querySelector('.explorer-sidebar')),
          hasCanvas: Boolean(document.querySelector('.canvas-viewport')),
          hasCopyMcp: (document.body.textContent || '').includes('ws_mobile_only'),
          heading: document.querySelector('.mobile-info-body h1')?.textContent?.trim(),
        }));
        expect(mobileAudit.hasSidebar).toBe(false);
        expect(mobileAudit.hasCanvas).toBe(false);
        expect(mobileAudit.hasCopyMcp).toBe(false);
        expect(mobileAudit.heading).toBe('MFHMFA');
        expect(started.service.getWorkspaceSubscriberCount('ws_mobile_only')).toBe(0);

        await mobilePage.click('button[aria-label="Light theme"]');
        await mobilePage.waitForFunction(
          () => document.documentElement.dataset.mode === 'light',
          { timeout: 3_000 }
        );
      } finally {
        await mobilePage.close().catch(() => {});
      }

      // Verify saved Light theme loads with zero dark flash AND initial Welcome graph fits inside available canvas
      const lightCtx = await browser.createBrowserContext();
      const lightPage = await lightCtx.newPage();
      try {
        await lightPage.setViewport({ width: 1180, height: 740 });
        let dclMode: string | undefined;
        let dclBg: string | undefined;
        await lightPage.evaluateOnNewDocument(() => {
          localStorage.setItem('mermaid-studio-mode', 'light');
        });
        lightPage.once('domcontentloaded', async () => {
          const snap = await lightPage
            .evaluate(() => ({
              mode: document.documentElement.dataset.mode,
              bg: getComputedStyle(document.documentElement).backgroundColor,
            }))
            .catch(() => ({ mode: undefined, bg: undefined }));
          dclMode = snap.mode;
          dclBg = snap.bg;
        });

        await lightPage.goto(`${started.baseUrl}/?workspace=ws_fit_light_check`, {
          waitUntil: 'networkidle2',
        });

        expect(dclMode).toBe('light');
        expect(dclBg).toBe('rgb(245, 241, 233)');
        expect(await lightPage.title()).toBe('MFHMFA');

        await lightPage.waitForSelector('.canvas-stage svg');
        await lightPage.waitForSelector('.story-panel');
        const fitBounds = await lightPage.evaluate(() => {
          const vp = document.querySelector('.canvas-viewport')!.getBoundingClientRect();
          const svg = document.querySelector('.canvas-stage svg')!.getBoundingClientRect();
          const story = document.querySelector('.story-panel')!.getBoundingClientRect();
          return {
            fitsTop: svg.top >= vp.top - 1,
            fitsBottom: svg.bottom <= vp.bottom + 1,
            fitsLeft: svg.left >= vp.left - 1,
            fitsRight: svg.right <= vp.right + 1,
            besideStory: svg.left >= story.right - 1,
          };
        });
        expect(fitBounds).toEqual({
          fitsTop: true,
          fitsBottom: true,
          fitsLeft: true,
          fitsRight: true,
          besideStory: true,
        });
      } finally {
        await lightCtx.close().catch(() => {});
      }

      // Verify graph-level JSON import (from Project menu) -> sub-diagram drilldown -> JSON export (from Graph menu)
      const shareCtx = await browser.createBrowserContext();
      const sharePage = await shareCtx.newPage();
      try {
        await sharePage.setViewport({ width: 1280, height: 800 });
        await sharePage.goto(`${started.baseUrl}/?workspace=ws_json_share_e2e`, {
          waitUntil: 'networkidle2',
        });
        await sharePage.waitForSelector('.canvas-stage svg');

        // Confirm no TopBar import/export/PNG/SVG icons and no Explorer header import icon
        const chromeAudit = await sharePage.evaluate(() => ({
          topbarExportBtns: document.querySelectorAll('.topbar button[aria-label="Export"]')
            .length,
          topbarImportBtns: document.querySelectorAll('.topbar button[aria-label*="Import"]')
            .length,
          explorerHeaderButtons: document.querySelectorAll(
            '.explorer-top-header .sidebar-header-actions button'
          ).length,
        }));
        expect(chromeAudit).toEqual({
          topbarExportBtns: 0,
          topbarImportBtns: 0,
          explorerHeaderButtons: 1,
        });

        const bundlePath = path.join(tempDir, 'shared-checkout.mfhmfa.json');
        const sampleBundle = {
          format: 'mfhmfa-graph',
          version: 1,
          exportedAt: new Date().toISOString(),
          title: 'Shared Checkout',
          rootPath: 'overview.mmd',
          files: [
            {
              path: 'overview.mmd',
              title: 'Shared Checkout',
              diagramType: 'flowchart-v2',
              code: 'flowchart LR\n  Cart["Cart"] --> Pay["Charge Card"] --> Fulfill["Ship"]',
              guide: {
                gist: 'Imported full graph with linked child view.',
                steps: [
                  {
                    title: '1. Charge customer',
                    caption: 'Cart sends totals to Charge Card.',
                    focusNodes: ['Cart', 'Pay'],
                    trace: 'order=ord_99 | $42.00',
                  },
                ],
                nodes: {
                  Pay: {
                    label: 'Charge Card',
                    term: 'PaymentGateway.charge()',
                    summary: 'Authorizes the card before shipping.',
                    childPath: 'card-retry.mmd',
                  },
                },
              },
            },
            {
              path: 'card-retry.mmd',
              title: 'Card Retry Logic',
              diagramType: 'flowchart-v2',
              code: 'flowchart TD\n  Try1["Attempt 1"] --> Try2["Backoff Retry"]',
              guide: {
                gist: 'Retries transient gateway errors safely.',
                parentPath: 'overview.mmd',
              },
            },
          ],
        };
        fs.writeFileSync(bundlePath, JSON.stringify(sampleBundle, null, 2), 'utf8');

        // Reject plain `.json` files that do not end with `.mfhmfa.json`
        const plainJsonPath = path.join(tempDir, 'plain.json');
        fs.writeFileSync(plainJsonPath, JSON.stringify(sampleBundle, null, 2), 'utf8');

        const acceptAttr = await sharePage.evaluate(
          () =>
            document
              .querySelector('input[data-testid="graph-json-file-input"]')
              ?.getAttribute('accept') ?? ''
        );
        expect(acceptAttr).toBe('.mfhmfa.json');

        await sharePage.evaluate(() => {
          const trigger = document.querySelector(
            '[data-project-key="scratchpad"] .tree-project-row .tree-menu-trigger'
          ) as HTMLElement | null;
          trigger?.click();
        });
        await sharePage.waitForSelector('.explorer-context-menu .dropdown-item');
        const [rejectChooser] = await Promise.all([
          sharePage.waitForFileChooser(),
          sharePage.evaluate(() => {
            const items = Array.from(
              document.querySelectorAll('.explorer-context-menu .dropdown-item')
            );
            const impItem = items.find((el) => el.textContent?.trim() === 'Import MFHMFA');
            (impItem as HTMLElement | undefined)?.click();
          }),
        ]);
        await rejectChooser.accept([plainJsonPath]);
        await sharePage.waitForFunction(
          () =>
            (
              document.querySelector('[data-testid="vscode-notifications"]')?.textContent || ''
            ).includes('Only .mfhmfa.json files can be imported.'),
          { timeout: 5_000 }
        );

        // Open Project `...` menu -> click "Import MFHMFA" -> supply valid .mfhmfa.json via FileChooser
        await sharePage.evaluate(() => {
          const trigger = document.querySelector(
            '[data-project-key="scratchpad"] .tree-project-row .tree-menu-trigger'
          ) as HTMLElement | null;
          trigger?.click();
        });
        await sharePage.waitForSelector('.explorer-context-menu .dropdown-item');
        const [fileChooser] = await Promise.all([
          sharePage.waitForFileChooser(),
          sharePage.evaluate(() => {
            const items = Array.from(
              document.querySelectorAll('.explorer-context-menu .dropdown-item')
            );
            const impItem = items.find((el) => el.textContent?.trim() === 'Import MFHMFA');
            (impItem as HTMLElement | undefined)?.click();
          }),
        ]);
        await fileChooser.accept([bundlePath]);

        // Wait for imported root title & success notification
        await sharePage.waitForFunction(
          () =>
            document.querySelector('.story-doc-title')?.textContent?.trim() ===
            'Shared Checkout',
          { timeout: 6_000 }
        );
        const importToast = await sharePage.evaluate(
          () =>
            document.querySelector('[data-testid="vscode-notifications"]')?.textContent || ''
        );
        expect(importToast).toContain('Imported "Shared Checkout" (2 views)');

        // Click the drillable box and dive into the bundled child sub-diagram
        await sharePage.waitForSelector('[data-mfhmfa-node="Pay"].mfhmfa-node-drillable');
        await sharePage.click('[data-mfhmfa-node="Pay"]');
        await sharePage.waitForSelector('[data-testid="node-inspector-card"]');
        await sharePage.click('.node-drilldown-btn');

        await sharePage.waitForFunction(
          () =>
            document.querySelector('.story-doc-title')?.textContent?.trim() ===
            'Card Retry Logic',
          { timeout: 6_000 }
        );

        // Intercept Blob JSON export via Graph `...` menu -> must export graph-level 2-view JSON (no project/folders!)
        await sharePage.evaluate(() => {
          const w = window as unknown as {
            __capturedExport?: { filename: string; text: string };
          };
          const origCreateObjUrl = URL.createObjectURL.bind(URL);
          const blobs = new Map<string, Blob>();
          URL.createObjectURL = (obj: Blob | MediaSource) => {
            const url = origCreateObjUrl(obj);
            if (obj instanceof Blob) blobs.set(url, obj);
            return url;
          };
          const origClick = HTMLAnchorElement.prototype.click;
          HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
            const blob = blobs.get(this.href);
            if (blob && this.download.endsWith('.mfhmfa.json')) {
              const dl = this.download;
              void blob.text().then((text) => {
                w.__capturedExport = { filename: dl, text };
              });
              return;
            }
            origClick.call(this);
          };
        });

        await sharePage.evaluate(() => {
          const trigger = document.querySelector(
            '[data-explorer-path="scratchpad/overview.mmd"] .tree-menu-trigger'
          ) as HTMLElement | null;
          trigger?.click();
        });
        await sharePage.waitForSelector('.explorer-context-menu .dropdown-item');
        await sharePage.evaluate(() => {
          const items = Array.from(
            document.querySelectorAll('.explorer-context-menu .dropdown-item')
          );
          const jsonItem = items.find((el) => el.textContent?.trim() === 'Export MFHMFA');
          (jsonItem as HTMLElement | undefined)?.click();
        });

        await sharePage.waitForFunction(
          () =>
            Boolean(
              (window as unknown as { __capturedExport?: { filename: string; text: string } })
                .__capturedExport
            ),
          { timeout: 5_000 }
        );

        const captured = await sharePage.evaluate(
          () =>
            (window as unknown as { __capturedExport: { filename: string; text: string } })
              .__capturedExport
        );
        expect(captured.filename).toBe('shared-checkout.mfhmfa.json');
        const reExported = JSON.parse(captured.text) as Record<string, unknown> & {
          format: string;
          version: number;
          rootPath: string;
          files: Array<{ path: string }>;
        };
        expect(reExported.format).toBe('mfhmfa-graph');
        expect(reExported.version).toBe(1);
        expect('project' in reExported).toBe(false);
        expect(reExported.rootPath).toBe('overview.mmd');
        expect(reExported.files.map((f) => f.path)).toEqual(['overview.mmd', 'card-retry.mmd']);
      } finally {
        await shareCtx.close().catch(() => {});
      }
    } finally {
      await browser.close().catch(() => {});
    }
  }, 45_000);
});
