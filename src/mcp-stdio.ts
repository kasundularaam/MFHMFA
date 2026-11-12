import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StudioService } from './application/studioService.js';
import { LOCAL_WORKSPACE_CHANNEL } from './config/env.js';
import { sanitizeWorkspaceToken } from './infrastructure/ephemeral/workspaceRelay.js';
import { getSharedRenderEngine } from './infrastructure/renderer/chromiumEngine.js';
import { createMermaidMcpServer } from './interfaces/mcp/createMcpServer.js';
import { normalizeAgentIdentity, normalizeProjectName } from './shared/agentIdentity.js';
import type {
  AgentSessionInfo,
  AgentStatusKind,
  VfsRpcQuery,
  VfsRpcResultMap,
  WorkspaceRelayEvent,
} from './shared/types.js';

function inferCwdProjectName(): string | null {
  try {
    const cwd = process.cwd();
    const home = os.homedir();
    if (!cwd || cwd === '/' || cwd === home) {
      return null;
    }
    return normalizeProjectName(path.basename(cwd));
  } catch {
    return null;
  }
}

export async function runStdioMcpServer(): Promise<void> {
  const engine = getSharedRenderEngine();
  const service = new StudioService({ engine });
  const stdioWorkspaceToken =
    sanitizeWorkspaceToken(process.env.MFHMFA_WORKSPACE) ?? LOCAL_WORKSPACE_CHANNEL;
  const sessionId = `stdio-${crypto.randomUUID().slice(0, 10)}`;
  const connectedAt = Date.now();

  let rawAgentName: string | null = process.env.MFHMFA_AGENT ?? null;
  let clientVersion: string | null = null;
  let currentProject: string | null =
    normalizeProjectName(process.env.MFHMFA_PROJECT) ?? inferCwdProjectName();

  const buildSessionInfo = (status: AgentStatusKind): AgentSessionInfo => {
    const normalized = normalizeAgentIdentity(rawAgentName, 'mcp-stdio');
    return {
      sessionId,
      agentSlug: normalized.slug,
      agentLabel: normalized.label,
      agentShortLabel: normalized.shortLabel,
      clientVersion,
      project: currentProject,
      source: 'mcp-stdio',
      status,
      connectedAt,
      lastActiveAt: Date.now(),
    };
  };

  const relayEventToLocalServer = async (
    event: WorkspaceRelayEvent,
    timeoutMs = 450
  ): Promise<{ reachable: boolean; delivered: number }> => {
    try {
      const resp = await fetch(`${service.baseUrl}/api/workspace/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceToken: stdioWorkspaceToken,
          event,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (resp.ok) {
        const json = (await resp.json()) as { deliveredSubscribers?: number };
        return { reachable: true, delivered: json.deliveredSubscribers ?? 0 };
      }
    } catch {
      // Local Studio HTTP server not running; PNG vision still works standalone
    }
    return { reachable: false, delivered: 0 };
  };

  const mcpServer = createMermaidMcpServer(
    service,
    {
      source: 'mcp-stdio',
      allowLocalDiskWrite: true,
      getWorkspaceToken: () => stdioWorkspaceToken,
      getCallerMeta: () => ({
        sessionId,
        agentName: rawAgentName,
        project: currentProject,
      }),
      onProjectDiscovered: (proj) => {
        const normalized = normalizeProjectName(proj);
        if (normalized && normalized !== currentProject) {
          currentProject = normalized;
          relayEventToLocalServer({
            type: 'agent_status',
            agent: buildSessionInfo('active'),
          }).catch(() => {});
        }
      },
      relayBridge: async (diagram) => {
        const out = await relayEventToLocalServer({
          type: 'diagram',
          diagram,
        });
        return out.delivered;
      },
      vfsBridge: async <Q extends VfsRpcQuery>(query: Q): Promise<VfsRpcResultMap[Q['op']]> => {
        let resp: Response;
        try {
          resp = await fetch(`${service.baseUrl}/api/workspace/vfs-query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              workspaceToken: stdioWorkspaceToken,
              query,
            }),
            signal: AbortSignal.timeout(3000),
          });
        } catch {
          throw new Error(
            'Local MFHMFA Studio server is not running. Start `npm start` or open Studio in your browser to use VFS tools over Stdio.'
          );
        }

        const json = (await resp.json()) as {
          ok?: boolean;
          result?: VfsRpcResultMap[Q['op']];
          error?: string;
        };
        if (!resp.ok || !json.ok || !json.result) {
          throw new Error(json.error || `VFS ${query.op} failed`);
        }
        return json.result;
      },
    },
    {
      onClientInitialized: ({ name, version }) => {
        if (name) rawAgentName = name;
        if (version) clientVersion = version;
        relayEventToLocalServer({
          type: 'agent_status',
          agent: buildSessionInfo('connected'),
        }).catch(() => {});
      },
      onRootsResolved: (project) => {
        if (project && !process.env.MFHMFA_PROJECT) {
          currentProject = project;
          relayEventToLocalServer({
            type: 'agent_status',
            agent: buildSessionInfo('connected'),
          }).catch(() => {});
        }
      },
    }
  );

  const transport = new StdioServerTransport();

  let cleanedUp = false;
  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    await relayEventToLocalServer(
      { type: 'agent_status', agent: buildSessionInfo('disconnected') },
      220
    ).catch(() => {});
    await mcpServer.close().catch(() => {});
    service.relay.dispose();
    await engine.dispose().catch(() => {});
  };

  process.on('SIGINT', async () => {
    await cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await cleanup();
    process.exit(0);
  });

  process.stdin.on('close', async () => {
    await cleanup();
    process.exit(0);
  });

  await mcpServer.connect(transport);
}

const isMain =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  runStdioMcpServer().catch((err: unknown) => {
    console.error('Mermaid MCP Stdio fatal error:', err);
    process.exit(1);
  });
}
