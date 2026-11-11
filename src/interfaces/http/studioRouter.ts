import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import type { StudioService } from '../../application/studioService.js';
import {
  APP_NAME,
  APP_VERSION,
  GITHUB_REPO_URL,
  LOCAL_WORKSPACE_CHANNEL,
  isLocalRequestHost,
  resolveRequestBaseUrl,
  resolveVisibleProjectRoot,
} from '../../config/env.js';
import { sanitizeLiveChannel } from '../../infrastructure/ephemeral/previewHub.js';
import { dispatchNamedTool, getOpenAiToolSchemas } from '../tools/toolRegistry.js';


export function createStudioRouter(
  service: StudioService,
  getMcpSessionCount: () => number
): Router {
  const router = Router();

  router.get('/status', (_req: Request, res: Response) => {
    const visibleRoot = resolveVisibleProjectRoot();
    const stdioScript = path.join(visibleRoot, 'src/mcp-stdio.ts');

    res.json({
      ok: true,
      stateless: true,
      name: APP_NAME,
      version: APP_VERSION,
      repoUrl: GITHUB_REPO_URL,
      baseUrl: service.baseUrl,
      mcpHttpSessions: getMcpSessionCount(),
      engine: service.getEngineStats(),
      previews: service.getPreviewStats(),
      connections: {

        mcpStreamableHttp: `${service.baseUrl}/mcp`,
        mcpLegacySse: `${service.baseUrl}/mcp/sse`,
        mcpStdioCommand: 'npx',
        mcpStdioArgs: ['tsx', stdioScript],
        projectRoot: visibleRoot,
        toolSchemasUrl: `${service.baseUrl}/api/tools/schemas`,
        toolCallUrl: `${service.baseUrl}/api/tools/call`,
      },
    });
  });

  router.get('/templates', (_req: Request, res: Response) => {
    res.json({ templates: service.listTemplates() });
  });

  router.get('/guides', (req: Request, res: Response) => {
    const topic = req.query.topic ? String(req.query.topic) : undefined;
    res.json({ topic: topic || 'all', guide: service.syntaxGuide(topic) });
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
      const reqBaseUrl = resolveRequestBaseUrl(req.headers, req.protocol, service.baseUrl);
      const headerWs = req.headers['x-mfhmfa-workspace'];
      const explicitWs =
        sanitizeLiveChannel(req.query.workspace) ??
        sanitizeLiveChannel(Array.isArray(headerWs) ? headerWs[0] : headerWs);
      const workspaceToken =
        explicitWs ??
        (isLocalRequestHost(req.headers) ? LOCAL_WORKSPACE_CHANNEL : null);

      const out = await dispatchNamedTool(name, args, service, {
        source: 'rest-tool',
        getBaseUrl: () => reqBaseUrl,
        getWorkspaceToken: () => workspaceToken,
      });



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
