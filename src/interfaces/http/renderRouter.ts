import { Router, type Request, type Response } from 'express';
import type { StudioService } from '../../application/studioService.js';
import {
  LOCAL_WORKSPACE_CHANNEL,
  isLocalRequestHost,
  resolveRequestBaseUrl,
} from '../../config/env.js';
import { sanitizeWorkspaceToken } from '../../infrastructure/ephemeral/workspaceRelay.js';
import type {
  AgentSessionInfo,
  CallerSource,
  DiagramRelayPayload,
  VfsRpcQuery,
  VfsRpcReply,
  WorkspaceRelayEvent,
} from '../../shared/types.js';

const MAX_RELAY_CODE_CHARS = 256_000;
const SSE_HEARTBEAT_MS = 20_000;

function extractExplicitWorkspace(req: Request): string | null {
  const headerVal = req.headers['x-mfhmfa-workspace'];
  const rawHeader = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  return (
    sanitizeWorkspaceToken(req.body?.workspaceToken) ??
    sanitizeWorkspaceToken(req.body?.workspace) ??
    sanitizeWorkspaceToken(req.query.workspace) ??
    sanitizeWorkspaceToken(req.query.ws) ??
    sanitizeWorkspaceToken(rawHeader)
  );
}

export function createRenderRouter(
  service: StudioService,
  getActiveAgents: (workspaceToken: string) => AgentSessionInfo[]
): Router {
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
        path: graphPath,
        title,
        project,
        agent,
        theme,
        look,
        background,
        scale,
        outputPath,
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
        path: typeof graphPath === 'string' ? graphPath : undefined,
        title,
        project: typeof project === 'string' ? project : null,
        agentName: typeof agent === 'string' ? agent : null,
        theme,
        look,
        background,
        scale,
        outputPath,
        source,
        requestBaseUrl,
        workspaceToken,
      });

      res.json({
        renderId: rendered.renderId,
        studioUrl: rendered.studioUrl,
        syncedToBrowser: rendered.syncedSubscribers > 0,
        path: rendered.path,
        title: rendered.title,
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
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // Zero-storage pass-through bridge used by local `mcp-stdio` processes
  router.post('/workspace/event', (req: Request, res: Response) => {
    const cleanToken = sanitizeWorkspaceToken(req.body?.workspaceToken);
    if (!cleanToken) {
      res.status(400).json({ error: 'Valid `workspaceToken` is required.' });
      return;
    }

    const rawEvent = req.body?.event as Partial<WorkspaceRelayEvent> | undefined;
    if (!rawEvent || typeof rawEvent.type !== 'string') {
      res.status(400).json({ error: 'Valid `event` payload is required.' });
      return;
    }

    if (rawEvent.type === 'agent_status' && rawEvent.agent && typeof rawEvent.agent === 'object') {
      const delivered = service.publishEvent(cleanToken, {
        type: 'agent_status',
        agent: rawEvent.agent as AgentSessionInfo,
      });
      res.json({ ok: true, deliveredSubscribers: delivered });
      return;
    }

    if (rawEvent.type === 'diagram' && rawEvent.diagram && typeof rawEvent.diagram === 'object') {
      const diag = rawEvent.diagram as DiagramRelayPayload;
      if (typeof diag.code !== 'string' || diag.code.length > MAX_RELAY_CODE_CHARS) {
        res.status(413).json({ error: 'Diagram code missing or exceeds safety limit.' });
        return;
      }
      const delivered = service.publishEvent(cleanToken, {
        type: 'diagram',
        diagram: diag,
      });
      res.json({ ok: true, deliveredSubscribers: delivered });
      return;
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

    const query = req.body?.query as VfsRpcQuery | undefined;
    if (!query || typeof query !== 'object' || typeof query.op !== 'string') {
      res.status(400).json({ error: 'Valid `query` payload is required.' });
      return;
    }

    try {
      const result = await service.queryVfs(cleanToken, query);
      res.json({ ok: true, result });
    } catch (err: unknown) {
      res.status(422).json({ ok: false, error: errorMessage(err) });
    }
  });

  // Browser `localStorage` reply endpoint for in-flight VFS RPC queries (`ls`, `read`, `mv`)
  router.post('/workspace/:token/vfs-reply', (req: Request, res: Response) => {
    const cleanToken = sanitizeWorkspaceToken(req.params.token);
    if (!cleanToken) {
      res.status(400).json({ error: 'Invalid workspace token.' });
      return;
    }

    const reply = req.body as VfsRpcReply | undefined;
    if (!reply || typeof reply.requestId !== 'string') {
      res.status(400).json({ error: 'Valid `requestId` is required.' });
      return;
    }

    const matched = service.resolveVfsReply(cleanToken, reply);
    res.json({ ok: true, matched });
  });

  // Pure pass-through SSE stream for browser `localStorage` sync
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
    res.write(
      `event: connected_agents\ndata: ${JSON.stringify({ agents: activeAgents })}\n\n`
    );

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
