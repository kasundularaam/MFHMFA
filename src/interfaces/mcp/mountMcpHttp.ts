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
import {
  generateLiveToken,
  sanitizeLiveChannel,
} from '../../infrastructure/ephemeral/previewHub.js';
import { createMermaidMcpServer } from './createMcpServer.js';

const SESSION_IDLE_TTL_MS = 30 * 60 * 1000;

interface ActiveHttpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  liveToken: string;
  workspaceToken: string | null;
  baseUrl: string;
  lastActiveAt: number;
}

interface ActiveSseSession {
  server: McpServer;
  transport: SSEServerTransport;
  liveToken: string;
  workspaceToken: string | null;
  baseUrl: string;
}

export interface MountedMcpEndpoints {
  getSessionCount: () => number;
  closeAll: () => Promise<void>;
}

function resolveWorkspaceToken(req: Request): string | null {
  const headerVal = req.headers['x-mfhmfa-workspace'];
  const rawHeader = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  const explicit =
    sanitizeLiveChannel(req.query.workspace) ??
    sanitizeLiveChannel(req.query.ws) ??
    sanitizeLiveChannel(rawHeader);
  if (explicit) {
    return explicit;
  }
  return isLocalRequestHost(req.headers) ? LOCAL_WORKSPACE_CHANNEL : null;
}

export function mountMcpHttpEndpoints(
  app: Express,
  service: StudioService
): MountedMcpEndpoints {
  const httpSessions = new Map<string, ActiveHttpSession>();
  const sseSessions = new Map<string, ActiveSseSession>();

  const sweepTimer = setInterval(() => {
    const cutoff = Date.now() - SESSION_IDLE_TTL_MS;
    for (const [sid, session] of httpSessions.entries()) {
      if (session.lastActiveAt < cutoff) {
        httpSessions.delete(sid);
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
      const headerVal = req.headers['mcp-session-id'];
      const sessionId = Array.isArray(headerVal) ? headerVal[0] : headerVal;

      if (sessionId) {
        const active = httpSessions.get(sessionId);
        if (!active) {
          // Per MCP Streamable HTTP spec, unknown/expired session IDs MUST return 404
          // so clients automatically re-initialize a fresh session.
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
        active.lastActiveAt = Date.now();
        active.baseUrl = reqBaseUrl;
        if (reqWorkspace) {
          active.workspaceToken = reqWorkspace;
        }
        await active.transport.handleRequest(req, res, req.body);
        return;
      }

      if (req.method === 'POST' && isInitializeRequest(req.body)) {
        const liveToken = sanitizeLiveChannel(req.query.channel) ?? generateLiveToken();
        let currentBaseUrl = reqBaseUrl;
        let currentWorkspace = reqWorkspace;

        const mcpServer = createMermaidMcpServer(service, {
          source: 'mcp-http',
          getBaseUrl: () => currentBaseUrl,
          liveToken,
          getWorkspaceToken: () => currentWorkspace,
        });

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (sid) => {
            const sessionRecord: ActiveHttpSession = {
              server: mcpServer,
              transport,
              liveToken,
              get workspaceToken() {
                return currentWorkspace;
              },
              set workspaceToken(next: string | null) {
                currentWorkspace = next;
              },
              get baseUrl() {
                return currentBaseUrl;
              },
              set baseUrl(next: string) {
                currentBaseUrl = next;
              },
              lastActiveAt: Date.now(),
            };
            httpSessions.set(sid, sessionRecord);
          },
          onsessionclosed: (sid) => {
            httpSessions.delete(sid);
          },
        });

        transport.onclose = () => {
          if (transport.sessionId) {
            httpSessions.delete(transport.sessionId);
          }
        };

        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      if (req.method === 'POST') {
        const statelessChannel = sanitizeLiveChannel(req.query.channel);
        const statelessServer = createMermaidMcpServer(service, {
          source: 'mcp-http',
          getBaseUrl: () => reqBaseUrl,
          liveToken: statelessChannel,
          getWorkspaceToken: () => reqWorkspace,
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
    const liveToken = sanitizeLiveChannel(req.query.channel) ?? generateLiveToken();
    let currentBaseUrl = resolveRequestBaseUrl(req.headers, req.protocol, service.baseUrl);
    let currentWorkspace = resolveWorkspaceToken(req);

    const mcpServer = createMermaidMcpServer(service, {
      source: 'mcp-http',
      getBaseUrl: () => currentBaseUrl,
      liveToken,
      getWorkspaceToken: () => currentWorkspace,
    });
    const transport = new SSEServerTransport('/mcp/messages', res);
    sseSessions.set(transport.sessionId, {
      server: mcpServer,
      transport,
      liveToken,
      get workspaceToken() {
        return currentWorkspace;
      },
      set workspaceToken(next: string | null) {
        currentWorkspace = next;
      },
      get baseUrl() {
        return currentBaseUrl;
      },
      set baseUrl(next: string) {
        currentBaseUrl = next;
      },
    });

    res.on('close', () => {
      sseSessions.delete(transport.sessionId);
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
    session.baseUrl = resolveRequestBaseUrl(req.headers, req.protocol, service.baseUrl);
    const ws = resolveWorkspaceToken(req);
    if (ws) session.workspaceToken = ws;
    await session.transport.handlePostMessage(req, res, req.body);
  });

  return {
    getSessionCount: () => httpSessions.size + sseSessions.size,
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
