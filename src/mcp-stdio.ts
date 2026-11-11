import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StudioService } from './application/studioService.js';
import {
  LOCAL_WORKSPACE_CHANNEL,
  PUBLIC_FALLBACK_STUDIO_URL,
} from './config/env.js';
import {
  generateLiveToken,
  sanitizeLiveChannel,
} from './infrastructure/ephemeral/previewHub.js';
import { getSharedRenderEngine } from './infrastructure/renderer/chromiumEngine.js';
import { createMermaidMcpServer } from './interfaces/mcp/createMcpServer.js';
import { buildPermalinkUrl } from './shared/permalink.js';

export async function runStdioMcpServer(): Promise<void> {
  // Guard stdout strictly for MCP JSON-RPC frames
  console.log = (...args: unknown[]) => {
    console.error(...args);
  };

  const engine = getSharedRenderEngine();
  const service = new StudioService({ engine });
  const stdioLiveToken = generateLiveToken();
  const stdioWorkspaceToken =
    sanitizeLiveChannel(process.env.MFHMFA_WORKSPACE) ?? LOCAL_WORKSPACE_CHANNEL;

  const mcpServer = createMermaidMcpServer(service, {
    source: 'mcp-stdio',
    liveToken: stdioLiveToken,
    getWorkspaceToken: () => stdioWorkspaceToken,
    previewBridge: async (snap) => {
      try {
        const resp = await fetch(`${service.baseUrl}/api/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...snap,
            liveToken: stdioLiveToken,
            workspaceToken: stdioWorkspaceToken,
          }),
          signal: AbortSignal.timeout(450),
        });

        if (resp.ok) {
          const json = (await resp.json()) as {
            id: string;
            studioUrl: string;
            liveUrl: string | null;
          };
          return {
            previewId: json.id,
            studioUrl: json.studioUrl,
            liveUrl: json.liveUrl,
          };
        }
      } catch {
        // Local HTTP studio is not running — fall back to stateless #z= permalink
      }

      const fallbackBase = process.env.MERMAID_STUDIO_URL || PUBLIC_FALLBACK_STUDIO_URL;
      const studioUrl = await buildPermalinkUrl(fallbackBase, {
        code: snap.code,
        title: snap.title,
      });
      return {
        previewId: null,
        studioUrl,
        liveUrl: null,
      };
    },
  });

  const transport = new StdioServerTransport();

  const cleanup = async () => {
    await mcpServer.close().catch(() => {});
    service.previewHub.dispose();
    await engine.dispose().catch(() => {});
  };

  process.on('SIGINT', async () => {
    await cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await cleanup();
    process.exit(0);
  });

  process.stdin.on('close', async () => {
    await cleanup();
    process.exit(0);
  });

  await mcpServer.connect(transport);
}

const isMain =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  runStdioMcpServer().catch((err: unknown) => {
    console.error('Mermaid MCP Stdio fatal error:', err);
    process.exit(1);
  });
}
