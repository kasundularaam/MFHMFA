import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import type { StudioService } from '../../application/studioService.js';
import {
  APP_NAME,
  APP_VERSION,
  isLocalOrBridgeAddress,
  resolveVisibleProjectRoot,
} from '../../config/env.js';
import type { LiveEventType } from '../../shared/types.js';
import { dispatchNamedTool, getOpenAiToolSchemas } from '../tools/toolRegistry.js';

export function createStudioRouter(
  service: StudioService,
  getMcpSessionCount: () => number
): Router {
  const router = Router();

  router.get('/status', (_req: Request, res: Response) => {
    const visibleRoot = resolveVisibleProjectRoot();
    const cliBin = path.join(visibleRoot, 'bin/mfhmfa');
    const stdioScript = path.join(visibleRoot, 'src/mcp-stdio.ts');

    res.json({
      ok: true,
      name: APP_NAME,
      version: APP_VERSION,
      baseUrl: service.baseUrl,
      chartCount: service.repo.countCharts(),
      wsClients: service.liveHub?.clientCount() ?? 0,
      mcpHttpSessions: getMcpSessionCount(),
      connections: {
        mcpStreamableHttp: `${service.baseUrl}/mcp`,
        mcpLegacySse: `${service.baseUrl}/mcp/sse`,
        mcpStdioCommand: 'npx',
        mcpStdioArgs: ['tsx', stdioScript],
        cliExecutable: cliBin,
        projectRoot: visibleRoot,
        toolSchemasUrl: `${service.baseUrl}/api/tools/schemas`,
        toolCallUrl: `${service.baseUrl}/api/tools/call`,
      },
    });
  });

  router.post('/internal/broadcast', (req: Request, res: Response) => {
    const rawIp = req.ip || req.socket.remoteAddress || '';
    if (!isLocalOrBridgeAddress(rawIp)) {
      res.status(403).json({ error: 'Local network only' });
      return;
    }

    const { type, data, focusInUi } = (req.body ?? {}) as {
      type?: LiveEventType;
      data?: unknown;
      focusInUi?: boolean;
    };
    if (type && service.liveHub) {
      service.liveHub.broadcast(type, data, Boolean(focusInUi));
    }
    res.json({ ok: true });
  });

  router.get('/templates', (_req: Request, res: Response) => {
    res.json({ templates: service.listTemplates() });
  });

  router.get('/guides', (req: Request, res: Response) => {
    const topic = req.query.topic ? String(req.query.topic) : undefined;
    res.json({ topic: topic || 'all', guide: service.syntaxGuide(topic) });
  });

  router.get('/events', (req: Request, res: Response) => {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    res.json({ events: service.repo.listAgentEvents(limit) });
  });

  router.get('/tools/schemas', (_req: Request, res: Response) => {
    res.json({
      tools: getOpenAiToolSchemas(),
      mcpEndpoint: `${service.baseUrl}/mcp`,
    });
  });

  router.post('/tools/call', async (req: Request, res: Response) => {
    try {
      const name = String(req.body?.name ?? '');
      const args = req.body?.arguments ?? {};
      const out = await dispatchNamedTool(name, args, service, 'rest-tool');

      res.json({
        ok: out.ok,
        result: out.payload,
        image: out.pngBase64
          ? {
              mimeType: 'image/png',
              base64: out.pngBase64,
            }
          : null,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.startsWith('Unknown tool') ? 400 : 500;
      res.status(status).json({ ok: false, error: message });
    }
  });

  return router;
}
