import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ChromiumRenderEngine } from '../../src/infrastructure/renderer/chromiumEngine.js';
import { startStudioServer, type StartedStudioServer } from '../../src/server.js';

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
      svg: string;
      dimensions: { width: number };
    };
    expect(meta.valid).toBe(true);
    expect(meta.svg).toContain('<svg');
    expect(meta.dimensions.width).toBeGreaterThan(200);

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
    const parts = previewRes.content as Array<{ type: string; data?: string }>;
    expect(parts[1].type).toBe('image');
    expect(Buffer.from(parts[1].data!, 'base64').subarray(0, 8).equals(PNG_MAGIC)).toBe(true);

    await stdioClient.close();
  }, 30_000);

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
});
