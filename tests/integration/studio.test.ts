import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import puppeteer from 'puppeteer-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
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

describe('MFHMFA Stateless Engine — Integration & Parallel Stress Suite', () => {
  let tempDir: string;
  let engine: ChromiumRenderEngine;
  let started: StartedStudioServer;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mfhmfa-stateless-test-'));
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

  it('reports stateless server status and pool telemetry with zero database', async () => {
    const resp = await fetch(`${started.baseUrl}/api/status`);
    expect(resp.ok).toBe(true);
    const status = (await resp.json()) as {
      ok: boolean;
      stateless: boolean;
      engine: { maxConcurrency: number };
    };
    expect(status.ok).toBe(true);
    expect(status.stateless).toBe(true);
    expect(status.engine.maxConcurrency).toBe(4);
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

  it('exposes stateless Streamable HTTP MCP tools, resources, and PNG vision', async () => {
    const mcpClient = new Client({ name: 'test-http-agent', version: '2.0.0' });
    const httpTransport = new StreamableHTTPClientTransport(
      new URL(`${started.baseUrl}/mcp`)
    );
    await mcpClient.connect(httpTransport);

    const toolsList = await mcpClient.listTools();
    const toolNames = toolsList.tools.map((t) => t.name).sort();
    expect(toolNames).toEqual([
      'mermaid_export',
      'mermaid_list_templates',
      'mermaid_render',
      'mermaid_syntax_guide',
      'mermaid_validate',
    ]);

    const renderRes = await mcpClient.callTool({
      name: 'mermaid_render',
      arguments: {
        title: 'Stateless Payment Flow',
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
    expect(contentArr[0].type).toBe('text');
    expect(contentArr[1].type).toBe('image');
    expect(contentArr[1].mimeType).toBe('image/png');

    const pngBuf = Buffer.from(contentArr[1].data!, 'base64');
    expect(pngBuf.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);

    const meta = JSON.parse(contentArr[0].text!) as {
      renderId: string;
      valid: boolean;
      studioUrl: string;
      liveUrl: string;
      svg: string;
      dimensions: { width: number };
    };
    expect(meta.valid).toBe(true);
    expect(meta.studioUrl).toMatch(/\/p\/[A-Za-z0-9_-]+$/);
    expect(meta.liveUrl).toMatch(/\/live\/[A-Za-z0-9_-]+$/);
    expect(meta.svg).toContain('<svg');
    expect(meta.dimensions.width).toBeGreaterThan(200);

    // Verify browser snapshot endpoint serves the exact rendered diagram
    const previewId = meta.studioUrl.split('/p/')[1]!;
    const snapResp = await fetch(`${started.baseUrl}/api/preview/${previewId}`);
    expect(snapResp.ok).toBe(true);
    const snapJson = (await snapResp.json()) as {
      title: string;
      code: string;
      liveUrl: string;
    };
    expect(snapJson.title).toBe('Stateless Payment Flow');
    expect(snapJson.code).toContain('Payments API');
    expect(snapJson.liveUrl).toBe(meta.liveUrl);

    // Verify real-time SSE live stream pushes iterative agent renders to browser
    const liveToken = meta.liveUrl.split('/live/')[1]!;
    const sseAbort = new AbortController();
    const sseResp = await fetch(`${started.baseUrl}/api/live/${liveToken}/events`, {
      signal: sseAbort.signal,
    });
    expect(sseResp.ok).toBe(true);
    const reader = sseResp.body!.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';

    const readUntilTitle = async (expectedTitle: string): Promise<void> => {
      while (true) {
        if (sseBuffer.includes(expectedTitle)) return;
        const { done, value } = await reader.read();
        if (done) throw new Error('SSE stream ended prematurely');
        sseBuffer += decoder.decode(value, { stream: true });
      }
    };

    try {
      // Initial snapshot sent immediately upon connecting
      await readUntilTitle('Stateless Payment Flow');

      // Agent refines the diagram in the same MCP session -> streams live over SSE!
      await mcpClient.callTool({
        name: 'mermaid_render',
        arguments: {
          title: 'Refined Payment Flow v2',
          code: 'flowchart TB\n  Client(["Checkout UI"]) --> API["Payments API v2"]',
        },
      });

      await readUntilTitle('Refined Payment Flow v2');
    } finally {
      sseAbort.abort();
      await reader.cancel().catch(() => {});
    }

    // Stateless template resource read

    const tplRes = await mcpClient.readResource({
      uri: 'mermaid://templates/sequence-oauth',
    });
    const tplText = (tplRes.contents[0] as { text: string }).text;
    expect(tplText).toContain('sequenceDiagram');

    await mcpClient.close();
  }, 30_000);

  it('handles heavy parallel MCP bursts across mixed diagram types, themes, handDrawn & errors without stalling', async () => {
    // Connect 4 independent MCP HTTP clients firing 6 parallel calls each = 24 simultaneous calls!
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
          title: 'HandDrawn Mindmap',
          code: 'mindmap\n  root(("Core"))\n    BranchA\n      Leaf1\n    BranchB\n      Leaf2',
          theme: 'forest',
          look: 'handDrawn',
        },
      },
      {
        kind: 'valid',
        args: {
          title: 'Dark Sequence',
          code: 'sequenceDiagram\n  autonumber\n  A->>B: Request\n  B-->>A: 200 OK',
          theme: 'dark',
          look: 'classic',
        },
      },
      {
        kind: 'valid',
        args: {
          title: 'ER Schema',
          code: 'erDiagram\n  USER ||--o{ SESSION : opens\n  USER {\n    uuid id PK\n  }',
          theme: 'neutral',
          look: 'classic',
        },
      },
      {
        kind: 'valid',
        args: {
          title: 'HandDrawn Flowchart',
          code: 'flowchart TB\n  subgraph Cluster["Service Mesh"]\n    GW["Gateway"] --> S1["Auth"] & S2["Billing"]\n  end',
          theme: 'default',
          look: 'handDrawn',
        },
      },
      {
        kind: 'invalid',
        args: {
          title: 'Broken Syntax',
          code: 'flowchart TD\n  bad[unquoted (parens)] --> end[reserved]',
        },
      },
      {
        kind: 'valid',
        args: {
          title: 'State Machine',
          code: 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running : start\n  Running --> [*]',
          theme: 'base',
          look: 'classic',
        },
      },
    ] as const;

    try {
      // Wave 1: 24 simultaneous MCP calls across 4 clients (exceeding pool size 4 by 6x!)
      const wave1Promises = clients.flatMap((client, cIdx) =>
        workloads.map(async (w, wIdx) => {
          const res = await client.callTool({
            name: 'mermaid_render',
            arguments: {
              ...w.args,
              title: `${w.args.title} [c${cIdx}-w${wIdx}]`,
            },
          });
          return { expectedKind: w.kind, res };
        })
      );

      const wave1Results = await Promise.all(wave1Promises);
      expect(wave1Results.length).toBe(24);

      for (const item of wave1Results) {
        const parts = item.res.content as Array<{
          type: string;
          text?: string;
          data?: string;
        }>;
        const payload = JSON.parse(parts[0].text!) as { valid: boolean; error: unknown };
        if (item.expectedKind === 'valid') {
          expect(item.res.isError).toBeFalsy();
          expect(payload.valid).toBe(true);
          expect(parts[1]?.type).toBe('image');
          expect(Buffer.from(parts[1]!.data!, 'base64').subarray(0, 8).equals(PNG_MAGIC)).toBe(
            true
          );
        } else {
          expect(item.res.isError).toBe(true);
          expect(payload.valid).toBe(false);
          expect(payload.error).toBeTruthy();
        }
      }

      // Wave 2: Immediately run another 12 parallel renders to ensure zero slot poisoning after handDrawn!
      const wave2Results = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          clients[i % clients.length].callTool({
            name: 'mermaid_render',
            arguments: {
              code: `flowchart LR\n  N${i}["Node ${i}"] --> M${i}["Target ${i}"]`,
              theme: i % 2 === 0 ? 'dark' : 'default',
            },
          })
        )
      );

      for (const res of wave2Results) {
        expect(res.isError).toBeFalsy();
      }

      // Verify pool bounds held strictly (never exceeded maxConcurrency = 4)
      const stats = engine.getStats();
      expect(stats.activeSlots).toBeLessThanOrEqual(4);
      expect(stats.busySlots).toBe(0);
      expect(stats.queuedRequests).toBe(0);
    } finally {
      await Promise.all(clients.map((c) => c.close()));
    }
  }, 60_000);

  it('connects cleanly over Stdio MCP transport with zero stdout pollution', async () => {
    const projectRoot = path.resolve(__dirname, '../..');
    const stdioTransport = new StdioClientTransport({
      command: path.join(projectRoot, 'node_modules/.bin/tsx'),
      args: [path.join(projectRoot, 'src/mcp-stdio.ts')],
      env: {
        ...process.env,
        MERMAID_STUDIO_URL: started.baseUrl,
      } as Record<string, string>,
    });

    const stdioClient = new Client({ name: 'test-stdio-agent', version: '2.0.0' });
    await stdioClient.connect(stdioTransport);

    const previewRes = await stdioClient.callTool({
      name: 'mermaid_render',
      arguments: {
        code: 'erDiagram\n  AGENT ||--o{ DIAGRAM : renders',
        theme: 'dark',
      },
    });

    expect(previewRes.isError).toBeFalsy();
    const parts = previewRes.content as Array<{ type: string; text?: string; data?: string }>;
    const bridgedMeta = JSON.parse(parts[0].text!) as {
      studioUrl: string;
      liveUrl: string;
    };
    expect(bridgedMeta.studioUrl).toContain(`${started.baseUrl}/p/`);
    expect(bridgedMeta.liveUrl).toContain(`${started.baseUrl}/live/`);
    expect(parts[1].type).toBe('image');
    expect(Buffer.from(parts[1].data!, 'base64').subarray(0, 8).equals(PNG_MAGIC)).toBe(true);

    await stdioClient.close();

    // Also verify offline/standalone stdio fallback emits #z= stateless permalink
    const offlineTransport = new StdioClientTransport({
      command: path.join(projectRoot, 'node_modules/.bin/tsx'),
      args: [path.join(projectRoot, 'src/mcp-stdio.ts')],
      env: {
        ...process.env,
        MERMAID_STUDIO_URL: 'http://127.0.0.1:1',
      } as Record<string, string>,
    });
    const offlineClient = new Client({ name: 'test-offline-stdio', version: '2.0.0' });
    await offlineClient.connect(offlineTransport);

    const offlineRes = await offlineClient.callTool({
      name: 'mermaid_render',
      arguments: {
        title: 'Offline Permalink Test',
        code: 'flowchart LR\n  A["Stdio"] --> B["Permalink"]',
      },
    });
    const offlineParts = offlineRes.content as Array<{ type: string; text?: string }>;
    const offlineMeta = JSON.parse(offlineParts[0].text!) as {
      studioUrl: string;
      liveUrl: string | null;
    };
    expect(offlineMeta.studioUrl).toContain('#z=');
    expect(offlineMeta.liveUrl).toBeNull();
    const decoded = await decodePermalinkPayload(extractHashToken(offlineMeta.studioUrl)!);
    expect(decoded.title).toBe('Offline Permalink Test');
    expect(decoded.code).toContain('Permalink');

    await offlineClient.close();
  }, 45_000);


  it('supports OpenAI/Anthropic REST tool schemas and stateless mermaid_export', async () => {
    const schemaResp = await fetch(`${started.baseUrl}/api/tools/schemas`);
    const schemaJson = (await schemaResp.json()) as { tools: unknown[] };
    expect(Array.isArray(schemaJson.tools)).toBe(true);
    expect(schemaJson.tools.length).toBe(5);

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
    expect(fs.readFileSync(outSvg, 'utf8')).toContain('<svg');
  }, 20_000);

  it('renders /p/:id snapshots, /live/:token real-time SSE updates, and /#z= permalinks in the Browser UI', async () => {
    const projectRoot = path.resolve(__dirname, '../..');
    if (!fs.existsSync(path.join(projectRoot, 'dist/web/index.html'))) {
      return;
    }

    const mcpClient = new Client({ name: 'test-browser-bridge-agent', version: '2.0.0' });
    await mcpClient.connect(new StreamableHTTPClientTransport(new URL(`${started.baseUrl}/mcp`)));

    const browser = await puppeteer.launch({
      executablePath: resolveChromePath(),
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    try {
      const r1 = await mcpClient.callTool({
        name: 'mermaid_render',
        arguments: {
          title: 'Browser Bridge V1',
          code: 'flowchart LR\n  A["AlphaGateway"] --> B["BetaWorker"]',
        },
      });
      const meta1 = JSON.parse(
        ((r1.content as Array<{ text?: string }>)[0]?.text ?? '{}')
      ) as { studioUrl: string; liveUrl: string };

      const page = await browser.newPage();

      // 1. Open /p/:id snapshot in browser
      await page.goto(meta1.studioUrl, { waitUntil: 'networkidle2' });
      await page.waitForFunction(
        () => document.querySelector('.canvas-stage svg')?.textContent?.includes('AlphaGateway'),
        { timeout: 10_000 }
      );

      // 2. Open /live/:token in browser and verify live SSE update when agent renders V2
      await page.goto(meta1.liveUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        () => document.querySelector('.live-pill')?.textContent?.includes('Live'),
        { timeout: 10_000 }
      );

      await mcpClient.callTool({
        name: 'mermaid_render',
        arguments: {
          title: 'Browser Bridge V2',
          code: 'flowchart LR\n  X["OmegaLiveNode"] --> Y["DeltaStream"]',
        },
      });

      await page.waitForFunction(
        () => document.querySelector('.canvas-stage svg')?.textContent?.includes('OmegaLiveNode'),
        { timeout: 10_000 }
      );

      // 3. Open stateless multi-tab /#z= permalink in browser
      const permUrl = await buildPermalinkUrl(started.baseUrl, {
        title: 'Stateless Hash Chart',
        code: 'flowchart TD\n  P1["SigmaPermalink"] --> P2["ForeverLink"]',
        activeIndex: 0,
        tabs: [
          {
            title: 'Stateless Hash Chart',
            code: 'flowchart TD\n  P1["SigmaPermalink"] --> P2["ForeverLink"]',
          },
          {
            title: 'Second Bundled Tab',
            code: 'flowchart LR\n  Q1["SecondTabNode"] --> Q2["EndNode"]',
          },
        ],
      });
      await page.goto(permUrl, { waitUntil: 'networkidle2' });
      await page.waitForFunction(
        () =>
          document.querySelector('.canvas-stage svg')?.textContent?.includes('SigmaPermalink') &&
          document.querySelectorAll('.editor-tab').length === 2,
        { timeout: 10_000 }
      );

      // 4. Zero-Link Workspace Sync (?workspace=...): open Studio with NO /p/ or /live/ link,
      // connect paired MCP agent, generate multiple graphs + retry, and verify VS Code tabs!
      const wsPage = await browser.newPage();
      await wsPage.goto(`${started.baseUrl}/?workspace=ws_pair_e2e_test`, {
        waitUntil: 'domcontentloaded',
      });
      await wsPage.waitForFunction(
        () => document.querySelector('.live-pill')?.textContent?.includes('Live'),
        { timeout: 10_000 }
      );

      const pairedMcp = new Client({ name: 'paired-ws-agent', version: '2.0.0' });
      await pairedMcp.connect(
        new StreamableHTTPClientTransport(
          new URL(`${started.baseUrl}/mcp?workspace=ws_pair_e2e_test`)
        )
      );

      try {
        // Graph 1 (attempt 1)
        await pairedMcp.callTool({
          name: 'mermaid_render',
          arguments: {
            title: 'Checkout Overview',
            code: 'flowchart LR\n  C1["DraftOverviewV1"] --> C2["Cart"]',
          },
        });
        // Graph 1 (attempt 2 — same title updates tab 1 in-place!)
        await pairedMcp.callTool({
          name: 'mermaid_render',
          arguments: {
            title: 'Checkout Overview',
            code: 'flowchart TB\n  C1["RefinedOverviewV2"] --> C2["Cart"]',
          },
        });
        // Graph 2 (distinct title opens a 2nd VS Code tab!)
        await pairedMcp.callTool({
          name: 'mermaid_render',
          arguments: {
            title: 'Stripe Sequence',
            code: 'sequenceDiagram\n  Cart->>Stripe: ChargeCardToken',
          },
        });

        await wsPage.waitForFunction(
          () => {
            const labels = Array.from(document.querySelectorAll('.editor-tab .tab-label')).map(
              (el) => el.textContent?.trim()
            );
            return (
              labels.length === 2 &&
              labels[0] === 'Checkout Overview' &&
              labels[1] === 'Stripe Sequence' &&
              document
                .querySelector('.canvas-stage svg')
                ?.textContent?.includes('ChargeCardToken')
            );
          },
          { timeout: 10_000 }
        );

        // Click first VS Code tab ("Checkout Overview") and verify refined V2 graph is rendered!
        await wsPage.evaluate(() => {
          const firstTab = document.querySelector('.editor-tab') as HTMLElement | null;
          firstTab?.click();
        });

        await wsPage.waitForFunction(
          () =>
            document
              .querySelector('.canvas-stage svg')
              ?.textContent?.includes('RefinedOverviewV2'),
          { timeout: 10_000 }
        );
      } finally {
        await pairedMcp.close().catch(() => {});
        await wsPage.close().catch(() => {});
      }
    } finally {

      await browser.close().catch(() => {});
      await mcpClient.close().catch(() => {});
    }
  }, 45_000);
});

