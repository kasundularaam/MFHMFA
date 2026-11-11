import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StudioService } from './application/studioService.js';
import {
  APP_TITLE,
  DEFAULT_HOST,
  DEFAULT_PORT,
  resolveConfiguredPort,
} from './config/env.js';
import type { RenderEnginePort } from './domain/ports.js';
import { getSharedRenderEngine } from './infrastructure/renderer/chromiumEngine.js';
import { createStudioExpressApp } from './interfaces/http/createApp.js';

export interface StartedStudioServer {
  httpServer: http.Server;
  port: number;
  baseUrl: string;
  service: StudioService;
  close: () => Promise<void>;
}

export async function startStudioServer(opts?: {
  port?: number;
  host?: string;
  engine?: RenderEnginePort;
}): Promise<StartedStudioServer> {
  const host = opts?.host ?? process.env.HOST ?? DEFAULT_HOST;
  const requestedPort = resolveConfiguredPort(opts?.port);

  const engine = opts?.engine ?? getSharedRenderEngine();

  const service = new StudioService({
    engine,
    baseUrl: `http://localhost:${requestedPort || DEFAULT_PORT}`,
  });

  const { app, mcp } = createStudioExpressApp(service);
  const httpServer = http.createServer(app);

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(requestedPort, host, () => resolve());
  });

  const addr = httpServer.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : requestedPort;
  service.baseUrl = `http://localhost:${actualPort}`;

  return {
    httpServer,
    port: actualPort,
    baseUrl: service.baseUrl,
    service,
    close: async () => {
      await mcp.closeAll();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      if (!opts?.engine) {
        await engine.dispose();
      }
    },
  };
}

const isMain =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  startStudioServer()
    .then((started) => {
      console.log(`\n${APP_TITLE} [Stateless Mode]`);
      console.log(`  Web Studio UI      : ${started.baseUrl}`);
      console.log(`  MCP Streamable HTTP: ${started.baseUrl}/mcp`);
      console.log(`  MCP Legacy SSE     : ${started.baseUrl}/mcp/sse`);
      console.log(`  Tool JSON Schemas  : ${started.baseUrl}/api/tools/schemas\n`);

      const shutdown = async () => {
        await started.close();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    })
    .catch((err: unknown) => {
      console.error('Fatal server startup error:', err);
      process.exit(1);
    });
}
