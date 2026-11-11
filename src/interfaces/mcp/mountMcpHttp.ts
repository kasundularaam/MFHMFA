import crypto from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { StudioService } from '../../application/studioService.js';
import { APP_NAME } from '../../config/env.js';
import { createMermaidMcpServer } from './createMcpServer.js';

interface ActiveHttpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

interface ActiveSseSession {
  server: McpServer;
  transport: SSEServerTransport;
}

export interface MountedMcpEndpoints {
  getSessionCount: () => number;
  closeAll: () => Promise<void>;
}

export function mountMcpHttpEndpoints(
  app: Express,
  service: StudioService
): MountedMcpEndpoints {
  const httpSessions = new Map<string, ActiveHttpSession>();
  const sseSessions = new Map<string, ActiveSseSession>();

  app.all('/mcp', async (req: Request, res: Response) => {
    try {
      const headerVal = req.headers['mcp-session-id'];
      const sessionId = Array.isArray(headerVal) ? headerVal[0] : headerVal;

      if (sessionId && httpSessions.has(sessionId)) {
        await httpSessions.get(sessionId)!.transport.handleRequest(req, res, req.body);
        return;
      }

      if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
        const mcpServer = createMermaidMcpServer(service, 'mcp-http');
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (sid) => {
            httpSessions.set(sid, { server: mcpServer, transport });
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

      if (!sessionId && req.method === 'POST') {
        const statelessServer = createMermaidMcpServer(service, 'mcp-http');
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
        !sessionId &&
        !(req.headers.accept || '').includes('text/event-stream')
      ) {
        res.status(200).json({
          name: APP_NAME,
          protocol: 'Model Context Protocol (Streamable HTTP & SSE)',
          endpoints: {
            streamableHttp: `${service.baseUrl}/mcp`,
            legacySse: `${service.baseUrl}/mcp/sse`,
            legacyMessages: `${service.baseUrl}/mcp/messages`,
            restToolSchemas: `${service.baseUrl}/api/tools/schemas`,
            restToolCall: `${service.baseUrl}/api/tools/call`,
          },
        });
        return;
      }

      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: Missing or unknown mcp-session-id header.',
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

  app.get('/mcp/sse', async (_req: Request, res: Response) => {
    const mcpServer = createMermaidMcpServer(service, 'mcp-http');
    const transport = new SSEServerTransport('/mcp/messages', res);
    sseSessions.set(transport.sessionId, { server: mcpServer, transport });

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
    await session.transport.handlePostMessage(req, res, req.body);
  });

  return {
    getSessionCount: () => httpSessions.size + sseSessions.size,
    closeAll: async () => {
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
