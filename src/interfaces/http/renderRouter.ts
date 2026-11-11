import { Router, type Request, type Response } from 'express';
import type { StudioService } from '../../application/studioService.js';
import {
  LOCAL_WORKSPACE_CHANNEL,
  isLocalRequestHost,
  resolveRequestBaseUrl,
} from '../../config/env.js';
import { sanitizeLiveChannel } from '../../infrastructure/ephemeral/previewHub.js';
import type { CallerSource, MermaidLook, MermaidTheme } from '../../shared/types.js';

const MAX_PREVIEW_CODE_CHARS = 256_000;
const SSE_HEARTBEAT_MS = 20_000;

function extractExplicitWorkspace(req: Request): string | null {
  const headerVal = req.headers['x-mfhmfa-workspace'];
  const rawHeader = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  return (
    sanitizeLiveChannel(req.body?.workspaceToken) ??
    sanitizeLiveChannel(req.body?.workspace) ??
    sanitizeLiveChannel(req.query.workspace) ??
    sanitizeLiveChannel(req.query.ws) ??
    sanitizeLiveChannel(rawHeader)
  );
}

export function createRenderRouter(service: StudioService): Router {
  const router = Router();

  router.post('/validate', async (req: Request, res: Response) => {
    try {
      const code = String(req.body?.code ?? '');
      const source = (req.body?.source as CallerSource | undefined) ?? 'web';
      const result = await service.validate(code, source);
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  router.post('/render', async (req: Request, res: Response) => {
    try {
      const {
        code = '',
        title,
        tabId,
        theme,
        look,
        background,
        scale,
        outputPath,
        liveChannel,
        liveToken,
        includePngBase64 = true,
        source = 'web',
      } = req.body ?? {};

      const requestBaseUrl = resolveRequestBaseUrl(
        req.headers,
        req.protocol,
        service.baseUrl
      );

      const explicitWs = extractExplicitWorkspace(req);
      const workspaceToken =
        explicitWs ??
        (source !== 'web' && isLocalRequestHost(req.headers)
          ? LOCAL_WORKSPACE_CHANNEL
          : null);

      const rendered = await service.render(String(code), {
        title,
        tabId,
        theme,
        look,
        background,
        scale,
        outputPath,
        source,
        requestBaseUrl,
        liveToken: liveChannel ?? liveToken ?? null,
        workspaceToken,
      });

      res.json({
        renderId: rendered.renderId,
        previewId: rendered.previewId,
        studioUrl: rendered.studioUrl,
        liveUrl: rendered.liveUrl,
        title: rendered.title,
        valid: rendered.valid,
        diagramType: rendered.diagramType,
        theme: rendered.theme,
        look: rendered.look,
        background: rendered.background,
        dimensions: rendered.dimensions,
        metrics: rendered.metrics,
        layoutDiagnostics: rendered.layoutDiagnostics,
        warnings: rendered.warnings,
        error: rendered.error,
        durationMs: rendered.durationMs,
        svg: rendered.svg,
        outputPath: rendered.outputPath,
        pngDataUrl:
          includePngBase64 && rendered.pngBytes
            ? `data:image/png;base64,${Buffer.from(rendered.pngBytes).toString('base64')}`
            : null,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  router.post('/preview', (req: Request, res: Response) => {
    const code = typeof req.body?.code === 'string' ? req.body.code : '';
    if (!code.trim()) {
      res.status(400).json({ error: 'Non-empty `code` is required.' });
      return;
    }
    if (code.length > MAX_PREVIEW_CODE_CHARS) {
      res.status(413).json({ error: 'Diagram source exceeds maximum preview size.' });
      return;
    }

    const requestBaseUrl = resolveRequestBaseUrl(
      req.headers,
      req.protocol,
      service.baseUrl
    );

    const registered = service.registerPreview({
      code,
      title: typeof req.body?.title === 'string' ? req.body.title : undefined,
      tabId: typeof req.body?.tabId === 'string' ? req.body.tabId : undefined,
      diagramType:
        typeof req.body?.diagramType === 'string' ? req.body.diagramType : null,
      theme: (req.body?.theme as MermaidTheme | undefined) ?? 'default',
      look: (req.body?.look as MermaidLook | undefined) ?? 'classic',
      liveToken: req.body?.liveToken ?? req.body?.liveChannel ?? null,
      workspaceToken: extractExplicitWorkspace(req),
      requestBaseUrl,
    });

    res.json({
      id: registered.snapshot.id,
      studioUrl: registered.studioUrl,
      liveUrl: registered.liveUrl,
      snapshot: registered.snapshot,
    });
  });

  router.get('/preview/:id', (req: Request, res: Response) => {
    const snap = service.getPreview(String(req.params.id || ''));
    if (!snap) {
      res.status(404).json({ error: 'Preview link expired or not found.' });
      return;
    }

    const requestBaseUrl = resolveRequestBaseUrl(
      req.headers,
      req.protocol,
      service.baseUrl
    );
    const sessionTabs = snap.liveToken ? service.getChannelTabs(snap.liveToken) : [];

    res.json({
      ...snap,
      liveUrl: snap.liveToken ? `${requestBaseUrl}/live/${snap.liveToken}` : null,
      sessionTabs: sessionTabs.length > 0 ? sessionTabs : [snap],
    });
  });

  router.get('/live/:token', (req: Request, res: Response) => {
    const cleanToken = sanitizeLiveChannel(req.params.token);
    if (!cleanToken) {
      res.status(400).json({ error: 'Invalid live session token.' });
      return;
    }

    res.json({
      token: cleanToken,
      latest: service.getLiveLatest(cleanToken),
      tabs: service.getChannelTabs(cleanToken),
      subscriberCount: service.getLiveSubscriberCount(cleanToken),
    });
  });

  router.get('/live/:token/events', (req: Request, res: Response) => {
    const cleanToken = sanitizeLiveChannel(req.params.token);
    if (!cleanToken) {
      res.status(400).json({ error: 'Invalid live session token.' });
      return;
    }

    const writeSnapshot = (snap: unknown) => {
      if (!res.writableEnded) {
        res.write(`event: snapshot\ndata: ${JSON.stringify(snap)}\n\n`);
      }
    };

    const unsubscribe = service.subscribeLive(cleanToken, writeSnapshot, () => {
      if (!res.writableEnded) {
        res.end();
      }
    });

    if (!unsubscribe) {
      res.status(503).json({ error: 'Live session subscriber limit reached.' });
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    res.write(': connected\n\n');

    const existingTabs = service.getChannelTabs(cleanToken);
    if (existingTabs.length > 0) {
      res.write(`event: tabs\ndata: ${JSON.stringify({ tabs: existingTabs })}\n\n`);
    }

    const latest = service.getLiveLatest(cleanToken);
    if (latest) {
      writeSnapshot(latest);
    }

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': keepalive\n\n');
      }
    }, SSE_HEARTBEAT_MS);
    heartbeat.unref?.();

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  router.post('/export', async (req: Request, res: Response) => {
    try {
      const {
        code = '',
        outputPath = '',
        title,
        format,
        theme,
        look,
        background,
        scale,
        source = 'web',
      } = req.body ?? {};

      if (!outputPath) {
        res.status(400).json({ error: '`outputPath` is required.' });
        return;
      }

      const exported = await service.exportDiagram({
        code: String(code),
        outputPath: String(outputPath),
        title,
        format,
        theme,
        look,
        background,
        scale,
        source,
      });
      res.json(exported);
    } catch (err: unknown) {
      res.status(422).json({ error: errorMessage(err) });
    }
  });

  return router;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
