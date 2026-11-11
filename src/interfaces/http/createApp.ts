import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express, { type Express } from 'express';
import type { StudioService } from '../../application/studioService.js';
import { PROJECT_ROOT } from '../../config/env.js';
import { mountMcpHttpEndpoints, type MountedMcpEndpoints } from '../mcp/mountMcpHttp.js';
import { createChartRouter } from './chartRouter.js';
import { createStudioRouter } from './studioRouter.js';

export function createStudioExpressApp(service: StudioService): {
  app: Express;
  mcp: MountedMcpEndpoints;
} {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '8mb' }));

  const mcp = mountMcpHttpEndpoints(app, service);

  app.use('/api', createStudioRouter(service, mcp.getSessionCount));
  app.use('/api', createChartRouter(service));

  const webDistDir = path.join(PROJECT_ROOT, 'dist/web');
  if (fs.existsSync(webDistDir)) {
    app.use(express.static(webDistDir));
    app.get('*', (req, res, next) => {
      if (
        req.path.startsWith('/api') ||
        req.path.startsWith('/mcp') ||
        req.path.startsWith('/ws')
      ) {
        next();
        return;
      }
      const indexFile = path.join(webDistDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        next();
      }
    });
  } else {
    app.get('/', (_req, res) => {
      res
        .status(200)
        .send(
          'Mermaid Agent Studio API & MCP Server is running. Run `npm run build:web` to build the Web UI.'
        );
    });
  }

  return { app, mcp };
}
