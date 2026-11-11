import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import WebSocket from 'ws';
import { startStudioServer, type StartedStudioServer } from '../../src/server.js';
import type { LiveEventPayload } from '../../src/shared/types.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Mermaid Agent Studio — Integration (Engine, REST, WS & Dual MCP)', () => {
  let tempDir: string;
  let started: StartedStudioServer;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mermaid-studio-test-'));
    started = await startStudioServer({
      port: 0,
      host: '127.0.0.1',
      dataDir: tempDir,
      seedDefaults: false,
    });
  }, 30_000);

  afterAll(async () => {
    await started?.close();
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 20_000);

  it('validates Mermaid code via Chromium engine and returns error snippets', async () => {
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

  it('exposes Streamable HTTP MCP tools that create, update, version, and return PNG ImageContent', async () => {
    const wsEvents: LiveEventPayload[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${started.port}/ws`);
    await new Promise<void>((resolve) => ws.once('open', () => resolve()));
    ws.on('message', (raw) => {
      wsEvents.push(JSON.parse(String(raw)) as LiveEventPayload);
    });

    const mcpClient = new Client({ name: 'test-http-agent', version: '1.0.0' });
    const httpTransport = new StreamableHTTPClientTransport(
      new URL(`${started.baseUrl}/mcp`)
    );
    await mcpClient.connect(httpTransport);

    const toolsList = await mcpClient.listTools();
    const toolNames = toolsList.tools.map((t) => t.name);
    expect(toolNames).toContain('mermaid_validate');
    expect(toolNames).toContain('mermaid_render_preview');
    expect(toolNames).toContain('mermaid_create_chart');
    expect(toolNames).toContain('mermaid_update_chart');
    expect(toolNames).toContain('mermaid_see_chart');
    expect(toolNames).toContain('mermaid_export_chart');
    expect(toolNames).toContain('mermaid_syntax_guide');

    const createRes = await mcpClient.callTool({
      name: 'mermaid_create_chart',
      arguments: {
        title: 'Payment Architecture',
        code: 'flowchart LR\n  Client(["Checkout UI"]) --> API["Payments API"]\n  API --> Ledger[("Ledger DB")]',
        theme: 'default',
        look: 'handDrawn',
        tags: ['payments', 'arch'],
      },
    });

    expect(createRes.isError).toBeFalsy();
    const contentArr = createRes.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    expect(contentArr.length).toBe(2);
    expect(contentArr[0].type).toBe('text');
    expect(contentArr[1].type).toBe('image');
    expect(contentArr[1].mimeType).toBe('image/png');

    const pngBuf = Buffer.from(contentArr[1].data!, 'base64');
    expect(pngBuf.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);

    const meta = JSON.parse(contentArr[0].text!) as {
      id: string;
      valid: boolean;
      version: number;
      dimensions: { width: number };
    };
    expect(meta.valid).toBe(true);
    expect(meta.version).toBe(1);
    expect(meta.dimensions.width).toBeGreaterThan(200);

    const updateRes = await mcpClient.callTool({
      name: 'mermaid_update_chart',
      arguments: {
        id: meta.id,
        code: 'flowchart TB\n  Client(["Checkout UI"]) --> API["Payments API"]\n  API --> Ledger[("Ledger DB")]\n  API --> Webhook["Stripe Webhook"]',
        changeNote: 'Switched LR to TB and added webhook node',
      },
    });
    expect(updateRes.isError).toBeFalsy();
    const updatedMeta = JSON.parse(
      (updateRes.content as Array<{ text: string }>)[0].text
    ) as { version: number };
    expect(updatedMeta.version).toBe(2);

    const seeV1 = await mcpClient.callTool({
      name: 'mermaid_see_chart',
      arguments: { id: meta.id, version: 1 },
    });
    const seeV1Parts = seeV1.content as Array<{ type: string; text?: string }>;
    const seeV1Meta = JSON.parse(seeV1Parts[0].text!) as {
      selectedVersion: number;
      code: string;
    };
    expect(seeV1Meta.selectedVersion).toBe(1);
    expect(seeV1Meta.code).toContain('flowchart LR');
    expect(seeV1Parts[1].type).toBe('image');

    const resRead = await mcpClient.readResource({
      uri: `mermaid://charts/${meta.id}/png`,
    });
    const resBlob = (resRead.contents[0] as { blob: string }).blob;
    expect(Buffer.from(resBlob, 'base64').subarray(0, 8).equals(PNG_MAGIC)).toBe(true);

    await new Promise((r) => setTimeout(r, 80));
    const types = wsEvents.map((e) => e.type);
    expect(types).toContain('chart:created');
    expect(types).toContain('chart:updated');
    expect(types).toContain('agent:event');

    ws.close();
    await mcpClient.close();
  }, 30_000);

  it('connects cleanly over Stdio MCP transport with zero stdout pollution', async () => {
    const projectRoot = path.resolve(__dirname, '../..');
    const stdioTransport = new StdioClientTransport({
      command: path.join(projectRoot, 'node_modules/.bin/tsx'),
      args: [path.join(projectRoot, 'src/mcp-stdio.ts')],
      env: {
        ...process.env,
        MERMAID_STUDIO_DATA_DIR: tempDir,
        MERMAID_STUDIO_URL: started.baseUrl,
      } as Record<string, string>,
    });

    const stdioClient = new Client({ name: 'test-stdio-agent', version: '1.0.0' });
    await stdioClient.connect(stdioTransport);

    const previewRes = await stdioClient.callTool({
      name: 'mermaid_render_preview',
      arguments: {
        code: 'erDiagram\n  AGENT ||--o{ CHART : builds',
        theme: 'dark',
      },
    });

    expect(previewRes.isError).toBeFalsy();
    const parts = previewRes.content as Array<{ type: string; data?: string }>;
    expect(parts[1].type).toBe('image');
    expect(Buffer.from(parts[1].data!, 'base64').subarray(0, 8).equals(PNG_MAGIC)).toBe(true);

    await stdioClient.close();
  }, 30_000);

  it('supports OpenAI/Anthropic REST tool schemas and /api/tools/call', async () => {
    const schemaResp = await fetch(`${started.baseUrl}/api/tools/schemas`);
    const schemaJson = (await schemaResp.json()) as { tools: unknown[] };
    expect(Array.isArray(schemaJson.tools)).toBe(true);
    expect(schemaJson.tools.length).toBe(10);

    const outSvg = path.join(tempDir, 'exported-arch.svg');
    const callResp = await fetch(`${started.baseUrl}/api/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'mermaid_export_chart',
        arguments: {
          code: 'mindmap\n  root((Studio))\n    MCP\n    REST\n    Web',
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
