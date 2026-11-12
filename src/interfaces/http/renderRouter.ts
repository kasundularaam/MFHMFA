import { Router, type Request, type Response } from 'express';
import type { StudioService } from '../../application/studioService.js';
import { sanitizeWorkspaceToken } from '../../infrastructure/ephemeral/workspaceRelay.js';
import { sanitizeComprehensionGuide } from '../../shared/comprehension.js';
import {
  AgentSessionInfoSchema,
  DiagramRelayPayloadSchema,
  ExportHttpBodySchema,
  RenderHttpBodySchema,
  ValidateHttpBodySchema,
  VfsRpcQuerySchema,
  VfsRpcReplySchema,
} from '../../shared/protocolSchemas.js';
import type {
  AgentSessionInfo,
  DiagramComprehensionGuide,
  WorkspaceRelayEvent,
} from '../../shared/types.js';
import { isLocalHttpCaller, resolveExplicitWorkspaceToken } from './requestContext.js';

const SSE_HEARTBEAT_MS = 20_000;

export function createRenderRouter(
  service: StudioService,
  getActiveAgents: (workspaceToken: string) => AgentSessionInfo[]
): Router {
  const router = Router();

  router.post('/validate', async (req: Request, res: Response) => {
    try {
      const parsed = ValidateHttpBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request body.' });
        return;
      }
      const result = await service.validate(parsed.data.code, 'web');
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  router.post('/render', async (req: Request, res: Response) => {
    try {
      const parsed = RenderHttpBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid render payload.',
        });
        return;
      }

      const {
        code,
        path: graphPath,
        title,
        guide: rawGuide,
        project,
        agent,
        theme,
        look,
        background,
        scale,
        outputPath,
        includePngBase64,
      } = parsed.data;

      let safeGuide: DiagramComprehensionGuide | undefined;
      if (rawGuide !== undefined) {
        safeGuide = sanitizeComprehensionGuide(rawGuide);
      }

      const workspaceToken = resolveExplicitWorkspaceToken(req);

      const rendered = await service.render(code, {
        path: graphPath,
        title,
        guide: safeGuide,
        project: project ?? null,
        agentName: agent ?? null,
        theme,
        look,
        background,
        scale,
        outputPath,
        allowLocalDiskWrite: isLocalHttpCaller(req),
        source: 'web',
        workspaceToken,
      });

      res.json({
        renderId: rendered.renderId,
        syncedToBrowser: rendered.syncedSubscribers > 0,
        path: rendered.path,
        title: rendered.title,
        guide: rendered.guide ?? null,
        project: rendered.project,
        agent: rendered.agent,
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
      const message = errorMessage(err);
      const status = message.includes('disabled on remote/hosted endpoints') ? 403 : 500;
      res.status(status).json({ error: message });
    }
  });

  // Zero-storage pass-through bridge used by local `mcp-stdio` processes
  router.post('/workspace/event', (req: Request, res: Response) => {
    const cleanToken = sanitizeWorkspaceToken(req.body?.workspaceToken);
    if (!cleanToken) {
      res.status(400).json({ error: 'Valid `workspaceToken` is required.' });
      return;
    }

    const rawEvent = req.body?.event as
      | { type?: unknown; agent?: unknown; diagram?: unknown }
      | undefined;
    if (!rawEvent || typeof rawEvent.type !== 'string') {
      res.status(400).json({ error: 'Valid `event` payload is required.' });
      return;
    }

    if (rawEvent.type === 'agent_status') {
      const parsedAgent = AgentSessionInfoSchema.safeParse(rawEvent.agent);
      if (!parsedAgent.success) {
        res.status(400).json({ error: 'Invalid `agent` status payload.' });
        return;
      }
      const delivered = service.publishEvent(cleanToken, {
        type: 'agent_status',
        agent: parsedAgent.data,
      });
      res.json({ ok: true, deliveredSubscribers: delivered });
      return;
    }

    if (rawEvent.type === 'diagram') {
      try {
        const parsedDiagram = DiagramRelayPayloadSchema.safeParse(rawEvent.diagram);
        if (!parsedDiagram.success) {
          const tooLarge = parsedDiagram.error.issues.some((i) => i.code === 'too_big');
          res.status(tooLarge ? 413 : 400).json({
            error: parsedDiagram.error.issues[0]?.message || 'Invalid diagram payload.',
          });
          return;
        }
        const delivered = service.publishEvent(cleanToken, {
          type: 'diagram',
          diagram: parsedDiagram.data,
        });
        res.json({ ok: true, deliveredSubscribers: delivered });
        return;
      } catch (err: unknown) {
        res.status(400).json({ error: errorMessage(err) });
        return;
      }
    }

    res.status(400).json({ error: 'Unsupported workspace event type.' });
  });

  // Zero-storage VFS query bridge used by local `mcp-stdio` processes (`ls`, `read`, `mv`)
  router.post('/workspace/vfs-query', async (req: Request, res: Response) => {
    const cleanToken = sanitizeWorkspaceToken(req.body?.workspaceToken);
    if (!cleanToken) {
      res.status(400).json({ error: 'Valid `workspaceToken` is required.' });
      return;
    }

    const parsedQuery = VfsRpcQuerySchema.safeParse(req.body?.query);
    if (!parsedQuery.success) {
      res.status(400).json({ error: 'Valid `query` payload is required.' });
      return;
    }

    try {
      const result = await service.queryVfs(cleanToken, parsedQuery.data);
      res.json({ ok: true, result });
    } catch (err: unknown) {
      res.status(422).json({ ok: false, error: errorMessage(err) });
    }
  });

  // Browser IndexedDB reply endpoint for in-flight VFS RPC queries (`ls`, `read`, `mv`)
  router.post('/workspace/:token/vfs-reply', (req: Request, res: Response) => {
    const cleanToken = sanitizeWorkspaceToken(req.params.token);
    if (!cleanToken) {
      res.status(400).json({ error: 'Invalid workspace token.' });
      return;
    }

    const parsedReply = VfsRpcReplySchema.safeParse(req.body);
    if (!parsedReply.success) {
      res.status(400).json({ error: 'Valid `requestId` and reply payload required.' });
      return;
    }

    const matched = service.resolveVfsReply(cleanToken, parsedReply.data);
    res.json({ ok: true, matched });
  });

  // Pure pass-through SSE stream for browser workspace sync
  router.get('/workspace/:token/events', (req: Request, res: Response) => {
    const cleanToken = sanitizeWorkspaceToken(req.params.token);
    if (!cleanToken) {
      res.status(400).json({ error: 'Invalid workspace token.' });
      return;
    }

    const writeEvent = (ev: WorkspaceRelayEvent) => {
      if (res.writableEnded) return;
      if (ev.type === 'agent_status') {
        res.write(`event: agent_status\ndata: ${JSON.stringify(ev.agent)}\n\n`);
      } else if (ev.type === 'diagram') {
        res.write(`event: diagram\ndata: ${JSON.stringify(ev.diagram)}\n\n`);
      } else if (ev.type === 'vfs_request') {
        res.write(`event: vfs_request\ndata: ${JSON.stringify(ev.request)}\n\n`);
      } else if (ev.type === 'connected_agents') {
        res.write(
          `event: connected_agents\ndata: ${JSON.stringify({ agents: ev.agents })}\n\n`
        );
      }
    };

    const unsubscribe = service.subscribeWorkspace(cleanToken, writeEvent, () => {
      if (!res.writableEnded) {
        res.end();
      }
    });

    if (!unsubscribe) {
      res.status(503).json({ error: 'Workspace subscriber limit reached.' });
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    res.write(': connected\n\n');

    const activeAgents = getActiveAgents(cleanToken);
    res.write(`event: connected_agents\ndata: ${JSON.stringify({ agents: activeAgents })}\n\n`);

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
      const parsed = ExportHttpBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message || '`outputPath` is required.',
        });
        return;
      }

      const exported = await service.exportDiagram({
        ...parsed.data,
        allowLocalDiskWrite: isLocalHttpCaller(req),
        source: 'web',
      });
      res.json(exported);
    } catch (err: unknown) {
      const message = errorMessage(err);
      const status = message.includes('disabled on remote/hosted endpoints') ? 403 : 422;
      res.status(status).json({ error: message });
    }
  });

  return router;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
