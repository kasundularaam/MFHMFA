import crypto from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { StudioService } from '../../application/studioService.js';
import {
  APP_NAME,
  APP_VERSION,
  LOCAL_WORKSPACE_CHANNEL,
  isLocalRequestHost,
  resolveRequestBaseUrl,
} from '../../config/env.js';
import { sanitizeWorkspaceToken } from '../../infrastructure/ephemeral/workspaceRelay.js';
import {
  normalizeAgentIdentity,
  normalizeProjectName,
} from '../../shared/agentIdentity.js';
import type { AgentSessionInfo, AgentStatusKind } from '../../shared/types.js';
import { createMermaidMcpServer } from './createMcpServer.js';

const SESSION_IDLE_TTL_MS = 20 * 60 * 1000;

interface SessionAgentMeta {
  sessionId: string;
  workspaceToken: string | null;
  rawAgentName: string | null;
  clientVersion: string | null;
  pinnedProject: string | null;
  discoveredProject: string | null;
  connectedAt: number;
  lastActiveAt: number;
}

interface ActiveHttpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  baseUrl: string;
  meta: SessionAgentMeta;
}

interface ActiveSseSession {
  server: McpServer;
  transport: SSEServerTransport;
  baseUrl: string;
  meta: SessionAgentMeta;
}

export interface MountedMcpEndpoints {
  getSessionCount: () => number;
  getActiveAgents: (workspaceToken: string) => AgentSessionInfo[];
  closeAll: () => Promise<void>;
}

function firstString(val: unknown): string | null {
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0];
  return null;
}

function resolveWorkspaceToken(req: Request): string | null {
  const explicit =
    sanitizeWorkspaceToken(firstString(req.query.workspace)) ??
    sanitizeWorkspaceToken(firstString(req.query.ws)) ??
    sanitizeWorkspaceToken(firstString(req.headers['x-mfhmfa-workspace']));
  if (explicit) {
    return explicit;
  }
  return isLocalRequestHost(req.headers) ? LOCAL_WORKSPACE_CHANNEL : null;
}

function resolveExplicitProject(req: Request): string | null {
  return (
    normalizeProjectName(firstString(req.query.project)) ??
    normalizeProjectName(firstString(req.headers['x-mfhmfa-project']))
  );
}

function extractInitClientInfo(body: unknown): {
  name: string | null;
  version: string | null;
} {
  if (!body || typeof body !== 'object') {
    return { name: null, version: null };
  }
  const params = (body as { params?: unknown }).params;
  if (!params || typeof params !== 'object') {
    return { name: null, version: null };
  }
  const ci = (params as { clientInfo?: unknown }).clientInfo;
  if (!ci || typeof ci !== 'object') {
    return { name: null, version: null };
  }
  const name = typeof (ci as { name?: unknown }).name === 'string'
    ? (ci as { name: string }).name
    : null;
  const version = typeof (ci as { version?: unknown }).version === 'string'
    ? (ci as { version: string }).version
    : null;
  return { name, version };
}

function buildAgentSessionInfo(
  meta: SessionAgentMeta,
  status: AgentStatusKind
): AgentSessionInfo {
  const normalized = normalizeAgentIdentity(meta.rawAgentName, 'mcp-http');
  return {
    sessionId: meta.sessionId,
    agentSlug: normalized.slug,
    agentLabel: normalized.label,
    agentShortLabel: normalized.shortLabel,
    clientVersion: meta.clientVersion,
    project: meta.pinnedProject ?? meta.discoveredProject,
    source: 'mcp-http',
    status,
    connectedAt: meta.connectedAt,
    lastActiveAt: meta.lastActiveAt,
  };
}

export function mountMcpHttpEndpoints(
  app: Express,
  service: StudioService
): MountedMcpEndpoints {
  const httpSessions = new Map<string, ActiveHttpSession>();
  const sseSessions = new Map<string, ActiveSseSession>();

  const notifyDisconnect = (meta: SessionAgentMeta) => {
    if (meta.workspaceToken) {
      service.publishAgentStatus(
        meta.workspaceToken,
        buildAgentSessionInfo(meta, 'disconnected')
      );
    }
  };

  const sweepTimer = setInterval(() => {
    const cutoff = Date.now() - SESSION_IDLE_TTL_MS;
    for (const [sid, session] of httpSessions.entries()) {
      if (session.meta.lastActiveAt < cutoff) {
        httpSessions.delete(sid);
        notifyDisconnect(session.meta);
        session.transport.close().catch(() => {});
        session.server.close().catch(() => {});
      }
    }
  }, 60_000);
  sweepTimer.unref?.();

  app.all('/mcp', async (req: Request, res: Response) => {
    try {
      const reqBaseUrl = resolveRequestBaseUrl(req.headers, req.protocol, service.baseUrl);
      const reqWorkspace = resolveWorkspaceToken(req);
      const reqProject = resolveExplicitProject(req);
      const sessionId = firstString(req.headers['mcp-session-id']);

      if (sessionId) {
        const active = httpSessions.get(sessionId);
        if (!active) {
          res.status(404).json({
            jsonrpc: '2.0',
            error: {
              code: -32001,
              message: 'Session not found',
            },
            id: null,
          });
          return;
        }
        active.meta.lastActiveAt = Date.now();
        active.baseUrl = reqBaseUrl;
        if (reqWorkspace) {
          active.meta.workspaceToken = reqWorkspace;
        }
        if (reqProject) {
          active.meta.pinnedProject = reqProject;
        }
        await active.transport.handleRequest(req, res, req.body);
        return;
      }

      if (req.method === 'POST' && isInitializeRequest(req.body)) {
        const sid = crypto.randomUUID();
        const initInfo = extractInitClientInfo(req.body);
        const now = Date.now();

        const meta: SessionAgentMeta = {
          sessionId: sid,
          workspaceToken: reqWorkspace,
          rawAgentName: initInfo.name || firstString(req.headers['user-agent']),
          clientVersion: initInfo.version,
          pinnedProject: reqProject,
          discoveredProject: null,
          connectedAt: now,
          lastActiveAt: now,
        };

        let currentBaseUrl = reqBaseUrl;
        let closedNotified = false;

        const emitStatus = (status: AgentStatusKind) => {
          if (meta.workspaceToken) {
            service.publishAgentStatus(
              meta.workspaceToken,
              buildAgentSessionInfo(meta, status)
            );
          }
        };

        const mcpServer = createMermaidMcpServer(
          service,
          {
            source: 'mcp-http',
            getBaseUrl: () => currentBaseUrl,
            getWorkspaceToken: () => meta.workspaceToken,
            getCallerMeta: () => ({
              sessionId: meta.sessionId,
              agentName: meta.rawAgentName,
              project: meta.pinnedProject ?? meta.discoveredProject,
            }),
            onProjectDiscovered: (proj) => {
              const normalized = normalizeProjectName(proj);
              if (normalized && normalized !== meta.discoveredProject) {
                meta.discoveredProject = normalized;
                meta.lastActiveAt = Date.now();
                emitStatus('active');
              }
            },
          },
          {
            onClientInitialized: ({ name, version }) => {
              if (name) meta.rawAgentName = name;
              if (version) meta.clientVersion = version;
              meta.lastActiveAt = Date.now();
              emitStatus('connected');
            },
            onRootsResolved: (project) => {
              if (project && project !== meta.discoveredProject) {
                meta.discoveredProject = project;
                meta.lastActiveAt = Date.now();
                emitStatus('connected');
              }
            },
          }
        );

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => sid,
          enableJsonResponse: true,
          onsessioninitialized: (initializedSid) => {
            const sessionRecord: ActiveHttpSession = {
              server: mcpServer,
              transport,
              get baseUrl() {
                return currentBaseUrl;
              },
              set baseUrl(next: string) {
                currentBaseUrl = next;
              },
              meta,
            };
            httpSessions.set(initializedSid, sessionRecord);
            emitStatus('connected');
          },
          onsessionclosed: (closedSid) => {
            httpSessions.delete(closedSid);
            if (!closedNotified) {
              closedNotified = true;
              notifyDisconnect(meta);
            }
          },
        });

        transport.onclose = () => {
          if (transport.sessionId) {
            httpSessions.delete(transport.sessionId);
          }
          if (!closedNotified) {
            closedNotified = true;
            notifyDisconnect(meta);
          }
        };

        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      if (req.method === 'POST') {
        const ua = firstString(req.headers['user-agent']);
        let statelessProject = reqProject;
        const statelessServer = createMermaidMcpServer(service, {
          source: 'mcp-http',
          getBaseUrl: () => reqBaseUrl,
          getWorkspaceToken: () => reqWorkspace,
          getCallerMeta: () => ({
            sessionId: null,
            agentName: ua,
            project: statelessProject,
          }),
          onProjectDiscovered: (proj) => {
            statelessProject = normalizeProjectName(proj) ?? statelessProject;
          },
        });
        const statelessTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        res.on('close', () => {
          statelessTransport.close().catch(() => {});
          statelessServer.close().catch(() => {});
        });
        await statelessServer.connect(statelessTransport);
        await statelessTransport.handleRequest(req, res, req.body);
        return;
      }

      if (
        req.method === 'GET' &&
        !(req.headers.accept || '').includes('text/event-stream')
      ) {
        res.status(200).json({
          name: APP_NAME,
          version: APP_VERSION,
          stateless: true,
          serverStorage: 'none (browser localStorage + pass-through SSE)',
          protocol: 'Model Context Protocol (Streamable HTTP & SSE)',
          endpoints: {
            streamableHttp: `${reqBaseUrl}/mcp`,
            legacySse: `${reqBaseUrl}/mcp/sse`,
            legacyMessages: `${reqBaseUrl}/mcp/messages`,
            restToolSchemas: `${reqBaseUrl}/api/tools/schemas`,
            restToolCall: `${reqBaseUrl}/api/tools/call`,
          },
        });
        return;
      }

      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: Missing Mcp-Session-Id header.',
        },
        id: null,
      });
    } catch (err: unknown) {
      if (!res.headersSent) {
        const message = err instanceof Error ? err.message : 'Internal MCP server error';
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message },
          id: null,
        });
      }
    }
  });

  app.get('/mcp/sse', async (req: Request, res: Response) => {
    let currentBaseUrl = resolveRequestBaseUrl(req.headers, req.protocol, service.baseUrl);
    const reqWorkspace = resolveWorkspaceToken(req);
    const reqProject = resolveExplicitProject(req);
    const now = Date.now();

    const transport = new SSEServerTransport('/mcp/messages', res);
    const meta: SessionAgentMeta = {
      sessionId: transport.sessionId,
      workspaceToken: reqWorkspace,
      rawAgentName: firstString(req.headers['user-agent']),
      clientVersion: null,
      pinnedProject: reqProject,
      discoveredProject: null,
      connectedAt: now,
      lastActiveAt: now,
    };

    const emitStatus = (status: AgentStatusKind) => {
      if (meta.workspaceToken) {
        service.publishAgentStatus(
          meta.workspaceToken,
          buildAgentSessionInfo(meta, status)
        );
      }
    };

    const mcpServer = createMermaidMcpServer(
      service,
      {
        source: 'mcp-http',
        getBaseUrl: () => currentBaseUrl,
        getWorkspaceToken: () => meta.workspaceToken,
        getCallerMeta: () => ({
          sessionId: meta.sessionId,
          agentName: meta.rawAgentName,
          project: meta.pinnedProject ?? meta.discoveredProject,
        }),
        onProjectDiscovered: (proj) => {
          const normalized = normalizeProjectName(proj);
          if (normalized && normalized !== meta.discoveredProject) {
            meta.discoveredProject = normalized;
            meta.lastActiveAt = Date.now();
            emitStatus('active');
          }
        },
      },
      {
        onClientInitialized: ({ name, version }) => {
          if (name) meta.rawAgentName = name;
          if (version) meta.clientVersion = version;
          meta.lastActiveAt = Date.now();
          emitStatus('connected');
        },
        onRootsResolved: (project) => {
          if (project && project !== meta.discoveredProject) {
            meta.discoveredProject = project;
            meta.lastActiveAt = Date.now();
            emitStatus('connected');
          }
        },
      }
    );

    sseSessions.set(transport.sessionId, {
      server: mcpServer,
      transport,
      get baseUrl() {
        return currentBaseUrl;
      },
      set baseUrl(next: string) {
        currentBaseUrl = next;
      },
      meta,
    });

    res.on('close', () => {
      sseSessions.delete(transport.sessionId);
      notifyDisconnect(meta);
      mcpServer.close().catch(() => {});
    });

    await mcpServer.connect(transport);
  });

  app.post('/mcp/messages', async (req: Request, res: Response) => {
    const sessionId = String(req.query.sessionId || '');
    const session = sseSessions.get(sessionId);
    if (!session) {
      res.status(404).json({ error: `Unknown SSE sessionId: ${sessionId}` });
      return;
    }
    session.meta.lastActiveAt = Date.now();
    session.baseUrl = resolveRequestBaseUrl(req.headers, req.protocol, service.baseUrl);
    const ws = resolveWorkspaceToken(req);
    if (ws) session.meta.workspaceToken = ws;
    const proj = resolveExplicitProject(req);
    if (proj) session.meta.pinnedProject = proj;
    await session.transport.handlePostMessage(req, res, req.body);
  });

  return {
    getSessionCount: () => httpSessions.size + sseSessions.size,
    getActiveAgents: (workspaceToken: string): AgentSessionInfo[] => {
      const clean = sanitizeWorkspaceToken(workspaceToken);
      if (!clean) return [];
      const out: AgentSessionInfo[] = [];
      for (const s of httpSessions.values()) {
        if (s.meta.workspaceToken === clean) {
          out.push(buildAgentSessionInfo(s.meta, 'connected'));
        }
      }
      for (const s of sseSessions.values()) {
        if (s.meta.workspaceToken === clean) {
          out.push(buildAgentSessionInfo(s.meta, 'connected'));
        }
      }
      return out;
    },
    closeAll: async () => {
      clearInterval(sweepTimer);
      for (const s of httpSessions.values()) {
        await s.transport.close().catch(() => {});
        await s.server.close().catch(() => {});
      }
      httpSessions.clear();

      for (const s of sseSessions.values()) {
        await s.transport.close().catch(() => {});
        await s.server.close().catch(() => {});
      }
      sseSessions.clear();
    },
  };
}
