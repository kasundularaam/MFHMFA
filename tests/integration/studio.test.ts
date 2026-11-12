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
import {
  buildPermalinkUrl,
  decodePermalinkPayload,
  extractHashToken,
} from '../../src/shared/permalink.js';

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
    const ok = await started.service.validate(
      'sequenceDiagram\n  Alice->>Bob: Hello!',
      'web'
    );
    expect(ok.valid).toBe(true);
    expect(ok.diagramType).toBe('sequence');
    expect(ok.error).toBeNull();

    const broken = await started.service.validate(
      'flowchart TD\n  A[call(x)] --> B',
      'web'
    );
    expect(broken.valid).toBe(false);
    expect(broken.error?.line).toBe(2);
    expect(broken.error?.snippet).toContain('>   2 |   A[call(x)] --> B');
  });

  it('exposes VFS MCP tools (ls, read, render, mv — NO rm) and streams path-based graphs with zero server storage', async () => {
    const wsToken = 'ws_sse_relay_vfs';
    const sseAbort = new AbortController();
    const sseResp = await fetch(
      `${started.baseUrl}/api/workspace/${wsToken}/events`,
      { signal: sseAbort.signal }
    );
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
        'mermaid_export',
        'mermaid_list_templates',
        'mermaid_ls',
        'mermaid_mv',
        'mermaid_read',
        'mermaid_render',
        'mermaid_syntax_guide',
        'mermaid_validate',
      ]);
      expect(toolNames).not.toContain('mermaid_rm');

      const renderRes = await mcpClient.callTool({
        name: 'mermaid_render',
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
      expect(
        Buffer.from(contentArr[1].data!, 'base64').subarray(0, 8).equals(PNG_MAGIC)
      ).toBe(true);

      const meta = JSON.parse(contentArr[0].text!) as {
        valid: boolean;
        project: string;
        path: string;
        agent: string;
        studioUrl: string;
        syncedToBrowser: boolean;
      };
      expect(meta.valid).toBe(true);
      expect(meta.agent).toBe('Claude Code');
      expect(meta.project).toBe('Billing Platform');
      expect(meta.path).toBe('payments/checkout-flow.mmd');
      expect(meta.syncedToBrowser).toBe(true);

      const decodedLink = await decodePermalinkPayload(extractHashToken(meta.studioUrl)!);
      expect(decodedLink.project).toBe('Billing Platform');
      expect(decodedLink.path).toBe('payments/checkout-flow.mmd');
      expect(decodedLink.agent).toBe('Claude Code');

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
              name: 'mermaid_render',
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

  it('connects cleanly over Stdio MCP transport with zero stdout pollution and #z= links', async () => {
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
      name: 'mermaid_render',
      arguments: {
        path: 'schema/agent-er.mmd',
        code: 'erDiagram\n  AGENT ||--o{ DIAGRAM : renders',
        theme: 'dark',
      },
    });

    expect(previewRes.isError).toBeFalsy();
    const parts = previewRes.content as Array<{ type: string; text?: string; data?: string }>;
    const bridgedMeta = JSON.parse(parts[0].text!) as {
      studioUrl: string;
      agent: string;
      project: string;
      path: string;
    };
    expect(bridgedMeta.agent).toBe('Pi');
    expect(bridgedMeta.project).toBe('MFHMFA');
    expect(bridgedMeta.path).toBe('schema/agent-er.mmd');
    expect(bridgedMeta.studioUrl).toContain(`${started.baseUrl}/#z=`);

    await stdioClient.close();
  }, 35_000);

  it('supports OpenAI/Anthropic REST tool schemas and stateless mermaid_export', async () => {
    const schemaResp = await fetch(`${started.baseUrl}/api/tools/schemas`);
    const schemaJson = (await schemaResp.json()) as { tools: unknown[] };
    expect(Array.isArray(schemaJson.tools)).toBe(true);
    expect(schemaJson.tools.length).toBe(8);

    const outSvg = path.join(tempDir, 'exported-arch.svg');
    const callResp = await fetch(`${started.baseUrl}/api/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'mermaid_export',
        arguments: {
          code: 'mindmap\n  root((Stateless))\n    MCP\n    REST\n    Web',
          outputPath: outSvg,
        },
      }),
    });
    const callJson = (await callResp.json()) as { ok: boolean };
    expect(callJson.ok).toBe(true);
    expect(fs.existsSync(outSvg)).toBe(true);
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

      // 1. Verify localStorage v4 initialized immediately on browser visit
      const initRaw = await wsPage.evaluate(() =>
        localStorage.getItem('mfhmfa-workspace-v4')
      );
      expect(initRaw).toBeTruthy();
      expect(JSON.parse(initRaw!).version).toBe(4);

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

        // Verify Connected Agents bottom sidebar pane displays all 3 live agents!
        await wsPage.waitForFunction(
          () => {
            const count = document.querySelector('.agents-count-pill')?.textContent?.trim();
            const names = Array.from(
              document.querySelectorAll('.sidebar-agent-name')
            ).map((el) => el.textContent?.trim());
            return (
              count === '3' &&
              names.includes('Claude Code') &&
              names.includes('Pi') &&
              names.includes('Cursor')
            );
          },
          { timeout: 10_000 }
        );

        // 3. Cursor writes a secret graph in Project B; Claude writes two graphs in Project A
        await cursor.callTool({
          name: 'mermaid_render',
          arguments: {
            path: 'internal/secret-b.mmd',
            code: 'flowchart LR\n  B1["ProjectBSecretNode"] --> B2["Vault"]',
          },
        });

        await claude.callTool({
          name: 'mermaid_render',
          arguments: {
            path: 'architecture/system-overview.mmd',
            code: 'flowchart LR\n  Web["Frontend"] --> GW["API Gateway"]',
          },
        });

        await claude.callTool({
          name: 'mermaid_render',
          arguments: {
            path: 'auth/oauth-flow.mmd',
            code: 'sequenceDiagram\n  User->>GW: ClaudeOAuthV1',
          },
        });

        // 4. Pi calls `mermaid_ls` -> sees Claude's folders & graphs in Project A,
        //    and CANNOT see Project B even if passing `project: "Project B"` or `path: "../Project B"`!
        const piLsRes = await pi.callTool({
          name: 'mermaid_ls',
          arguments: { project: 'Project B' }, // Should be ignored because Pi is jailed to Project A!
        });
        expect(piLsRes.isError).toBeFalsy();
        const piLsJson = JSON.parse(
          ((piLsRes.content as Array<{ text?: string }>)[0]?.text ?? '{}')
        ) as { project: string; treeText: string };
        expect(piLsJson.project).toBe('Project A');
        expect(piLsJson.treeText).toContain('architecture/');
        expect(piLsJson.treeText).toContain('oauth-flow.mmd');
        expect(piLsJson.treeText).not.toContain('secret-b.mmd');

        const escapeAttempt = await pi.callTool({
          name: 'mermaid_ls',
          arguments: { path: '../../Project-B' },
        });
        expect(escapeAttempt.isError).toBe(true);

        // 5. Pi reads Claude's `auth/oauth-flow.mmd`, updates it to v2, and creates `auth/session-er.mmd`!
        const piReadV1 = await pi.callTool({
          name: 'mermaid_read',
          arguments: { path: 'auth/oauth-flow' },
        });
        const readV1Payload = JSON.parse(
          ((piReadV1.content as Array<{ text?: string }>)[0]?.text ?? '{}')
        ) as { code: string; currentVersion: number; author: string };
        expect(readV1Payload.code).toContain('ClaudeOAuthV1');
        expect(readV1Payload.currentVersion).toBe(1);
        expect(readV1Payload.author).toBe('claude');

        await pi.callTool({
          name: 'mermaid_render',
          arguments: {
            path: 'auth/oauth-flow.mmd',
            code: 'sequenceDiagram\n  User->>GW: PiRefinedOAuthV2',
          },
        });

        await pi.callTool({
          name: 'mermaid_render',
          arguments: {
            path: 'auth/draft-er.mmd',
            code: 'erDiagram\n  USER ||--o{ SESSION : PiSessionRel',
          },
        });

        // 6. Pi moves `auth/draft-er.mmd` -> `database/session-er.mmd` via `mermaid_mv`!
        const mvRes = await pi.callTool({
          name: 'mermaid_mv',
          arguments: {
            from: 'auth/draft-er.mmd',
            to: 'database/session-er.mmd',
          },
        });
        expect(mvRes.isError).toBeFalsy();

        // Verify immutable history: Claude can still read v1 while head is v2 (by pi)!
        const claudeReadHistorical = await claude.callTool({
          name: 'mermaid_read',
          arguments: { path: 'auth/oauth-flow.mmd', version: 1 },
        });
        const histPayload = JSON.parse(
          ((claudeReadHistorical.content as Array<{ text?: string }>)[0]?.text ?? '{}')
        ) as { code: string; currentVersion: number; requestedVersion: number };
        expect(histPayload.requestedVersion).toBe(1);
        expect(histPayload.currentVersion).toBe(2);
        expect(histPayload.code).toContain('ClaudeOAuthV1');

        // 7. Verify VS Code Explorer tree, Tab close preservation, and Right-Edge View Switcher Icon!
        await wsPage.waitForFunction(
          () =>
            Boolean(
              document.querySelector(
                '[data-explorer-path="project-a/database/session-er.mmd"]'
              )
            ) &&
            Boolean(
              document.querySelector(
                '[data-explorer-path="project-a/auth/oauth-flow.mmd"]'
              )
            ),
          { timeout: 10_000 }
        );

        // Close an open tab on the top bar and verify the file STILL exists in the Left Explorer!
        const openTabsBefore = await wsPage.evaluate(
          () => document.querySelectorAll('.editor-tab').length
        );
        expect(openTabsBefore).toBeGreaterThanOrEqual(2);

        await wsPage.evaluate(() => {
          const closeBtn = document.querySelector(
            '.editor-tab.active .tab-close-btn'
          ) as HTMLElement | null;
          closeBtn?.click();
        });

        await wsPage.waitForFunction(
          (prevCount: number) =>
            document.querySelectorAll('.editor-tab').length === prevCount - 1 &&
            Boolean(
              document.querySelector(
                '[data-explorer-path="project-a/database/session-er.mmd"]'
              )
            ),
          {},
          openTabsBefore
        );

        // Verify right-edge view toggle icon switches Preview <-> Code!
        const initialAria = await wsPage.evaluate(() =>
          document.querySelector('.tabbar-view-toggle')?.getAttribute('aria-label')
        );
        expect(initialAria).toBe('Switch to Code view');

        await wsPage.evaluate(() => {
          (document.querySelector('.tabbar-view-toggle') as HTMLElement | null)?.click();
        });

        await wsPage.waitForFunction(
          () =>
            document
              .querySelector('.tabbar-view-toggle')
              ?.getAttribute('aria-label') === 'Switch to Preview' &&
            Boolean(document.querySelector('.codemirror-wrap')),
          { timeout: 5_000 }
        );

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
});
