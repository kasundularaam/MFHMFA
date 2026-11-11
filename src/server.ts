import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StudioService } from './application/studioService.js';
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  resolveConfiguredPort,
} from './config/env.js';
import type { RenderEnginePort } from './domain/ports.js';
import { SqliteChartRepository } from './infrastructure/persistence/sqliteRepository.js';
import { WsLiveHub } from './infrastructure/realtime/wsLiveHub.js';
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
  dataDir?: string;
  seedDefaults?: boolean;
  engine?: RenderEnginePort;
}): Promise<StartedStudioServer> {
  const host = opts?.host ?? process.env.HOST ?? DEFAULT_HOST;
  const requestedPort = resolveConfiguredPort(opts?.port);

  const repo = new SqliteChartRepository(opts?.dataDir);
  const engine = opts?.engine ?? getSharedRenderEngine();
  const liveHub = new WsLiveHub();

  const service = new StudioService({
    repo,
    engine,
    liveHub,
    baseUrl: `http://localhost:${requestedPort || DEFAULT_PORT}`,
  });

  const { app, mcp } = createStudioExpressApp(service);
  const httpServer = http.createServer(app);
  liveHub.attach(httpServer);

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(requestedPort, host, () => resolve());
  });

  const addr = httpServer.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : requestedPort;
  service.baseUrl = `http://localhost:${actualPort}`;

  if (opts?.seedDefaults !== false) {
    await service.seedStarterChartsIfEmpty();
  }

  return {
    httpServer,
    port: actualPort,
    baseUrl: service.baseUrl,
    service,
    close: async () => {
      await mcp.closeAll();
      liveHub.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      repo.close();
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
      console.log(`\nMermaid Agent Studio running`);
      console.log(`  Web Studio UI      : ${started.baseUrl}`);
      console.log(`  MCP Streamable HTTP: ${started.baseUrl}/mcp`);
      console.log(`  MCP Legacy SSE     : ${started.baseUrl}/mcp/sse`);
      console.log(`  Tool JSON Schemas  : ${started.baseUrl}/api/tools/schemas`);
      console.log(`  Live WebSocket     : ws://localhost:${started.port}/ws\n`);

      const shutdown = async () => {
        await started.close();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    })
    .catch((err: unknown) => {
      console.error('Failed to start Mermaid Agent Studio:', err);
      process.exit(1);
    });
}
