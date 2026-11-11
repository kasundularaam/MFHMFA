import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StudioService } from './application/studioService.js';
import { getSharedRenderEngine } from './infrastructure/renderer/chromiumEngine.js';
import { createMermaidMcpServer } from './interfaces/mcp/createMcpServer.js';

export async function runStdioMcpServer(): Promise<void> {
  // Guard stdout strictly for MCP JSON-RPC frames
  console.log = (...args: unknown[]) => {
    console.error(...args);
  };

  const engine = getSharedRenderEngine();
  const service = new StudioService({ engine });
  const mcpServer = createMermaidMcpServer(service, 'mcp-stdio');
  const transport = new StdioServerTransport();

  const cleanup = async () => {
    await mcpServer.close().catch(() => {});
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
