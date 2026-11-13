import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  RootsListChangedNotificationSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { StudioService } from '../../application/studioService.js';
import { APP_NAME, APP_VERSION } from '../../config/env.js';
import { extractProjectFromRoots } from '../../shared/agentIdentity.js';
import { withTimeout } from '../../shared/strings.js';
import type { CallerSource } from '../../shared/types.js';
import { AGENT_TOOLS, type ToolCallContext } from '../tools/toolRegistry.js';

export interface McpServerLifecycleHooks {
  onClientInitialized?: (client: { name: string | null; version: string | null }) => void;
  onRootsResolved?: (project: string) => void;
}

export function createMermaidMcpServer(
  service: StudioService,
  sourceOrCtx: CallerSource | ToolCallContext = 'mcp-stdio',
  hooks?: McpServerLifecycleHooks
): McpServer {
  const ctx: ToolCallContext =
    typeof sourceOrCtx === 'string' ? { source: sourceOrCtx } : sourceOrCtx;

  const server = new McpServer(
    {
      name: APP_NAME,
      version: APP_VERSION,
    },
    {
      instructions: [
        'Interactive visual learning tool: use MFHMFA whenever helping the user understand, explain, learn, or debug a concept, research paper, codebase, bug, or design tradeoff. Call `get_playbook` first to load the mode guide.',
        '1. Call `get_playbook` with `mode` ("concept" | "paper" | "codebase" | "bug" | "tradeoff") to load the tailored cognitive-science teaching blueprint, workspace views, and the user\'s live Studio selection.',
        '2. Build clean 4–7 box views via `render_view` with an interactive `guide` (`gist`, `steps` or contrasting `flows`, `nodes`, optional `childPath`), visually inspect the returned 2x PNG + `layoutDiagnostics`, and iterate at the same `path` until clean.',
        '3. Never output raw ```mermaid``` code blocks or URLs in chat unless explicitly asked. Once `syncedToBrowser` is true, summarize concisely and let the user step through the interactive view in MFHMFA Studio.',
      ].join(' '),
    }
  );

  let loadedPlaybook = false;
  let resolvedRootsProject: string | null = null;
  let inflightRootsProbe: Promise<string | null> | null = null;

  const probeClientRoots = (): Promise<string | null> => {
    if (resolvedRootsProject) return Promise.resolve(resolvedRootsProject);
    const caps = server.server.getClientCapabilities();
    if (!caps?.roots) return Promise.resolve(null);

    if (!inflightRootsProbe) {
      inflightRootsProbe = (async () => {
        try {
          const result = await withTimeout(server.server.listRoots(), 1200, 'MCP roots/list');
          const project = extractProjectFromRoots(result?.roots);
          if (project) {
            resolvedRootsProject = project;
            hooks?.onRootsResolved?.(project);
            return project;
          }
        } catch {
          // Client does not have an active reverse request channel or rejected roots/list
        } finally {
          inflightRootsProbe = null;
        }
        return null;
      })();
    }
    return inflightRootsProbe;
  };

  const enrichedCtx: ToolCallContext = {
    ...ctx,
    hasLoadedPlaybook: () => (ctx.hasLoadedPlaybook ? ctx.hasLoadedPlaybook() : loadedPlaybook),
    markPlaybookLoaded: (mode) => {
      loadedPlaybook = true;
      ctx.markPlaybookLoaded?.(mode);
    },
    ensureCallerProject: async () => {
      if (ctx.ensureCallerProject) {
        const fromParent = await ctx.ensureCallerProject();
        if (fromParent) return fromParent;
      }
      return probeClientRoots();
    },
  };

  server.server.oninitialized = () => {
    const cv = server.server.getClientVersion();
    hooks?.onClientInitialized?.({
      name: cv?.name ?? null,
      version: cv?.version ?? null,
    });

    const caps = server.server.getClientCapabilities();
    if (caps?.roots) {
      const t1 = setTimeout(async () => {
        const found = await probeClientRoots();
        if (!found) {
          const t2 = setTimeout(() => {
            probeClientRoots().catch(() => {});
          }, 260);
          t2.unref?.();
        }
      }, 45);
      t1.unref?.();

      if (caps.roots.listChanged) {
        server.server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
          resolvedRootsProject = null;
          await probeClientRoots();
        });
      }
    }
  };

  for (const tool of AGENT_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.zodShape,
        annotations: tool.annotations,
      },
      async (args: Record<string, unknown>): Promise<CallToolResult> => {
        try {
          const out = await tool.parseAndExecute(args, service, enrichedCtx);

          const content: CallToolResult['content'] = [
            {
              type: 'text',
              text: out.textOverride ?? JSON.stringify(out.payload, null, 2),
            },
          ];

          if (out.pngBase64) {
            content.push({
              type: 'image',
              data: out.pngBase64,
              mimeType: 'image/png',
            });
          }

          return {
            isError: !out.ok,
            content,
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
          };
        }
      }
    );
  }

  server.registerResource(
    'syntax-pitfalls-guide',
    'mermaid://guides/pitfalls',
    {
      title: 'Mermaid Syntax & Layout Pitfalls Guide',
      description: 'Essential escaping rules and visual quality guidelines for AI agents.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: service.syntaxGuide('all'),
        },
      ],
    })
  );

  server.registerResource(
    'templates-catalog',
    'mermaid://templates',
    {
      title: 'Starter Mermaid Templates Catalog',
      description: 'JSON catalog of curated starter Mermaid templates across diagram types.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(service.listTemplates(), null, 2),
        },
      ],
    })
  );

  server.registerResource(
    'template-source',
    new ResourceTemplate('mermaid://templates/{id}', {
      list: async () => ({
        resources: service.listTemplates().map((tpl) => ({
          uri: `mermaid://templates/${tpl.id}`,
          name: tpl.name,
          description: `${tpl.category} (${tpl.diagramType})`,
          mimeType: 'text/plain',
        })),
      }),
    }),
    {
      title: 'Starter Mermaid Template Source (.mmd)',
      description: 'Raw Mermaid source code for a starter template ID.',
      mimeType: 'text/plain',
    },
    async (uri, variables) => {
      const id = String(variables.id);
      const tpl = service.getTemplate(id);
      if (!tpl) {
        throw new Error(`Template not found: ${id}`);
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/plain',
            text: tpl.code,
          },
        ],
      };
    }
  );

  server.registerPrompt(
    'design-and-verify-diagram',
    {
      title: 'Design, Validate & Visually Verify a Mermaid Diagram',
      description:
        'Structured stateless workflow for crafting a clean Mermaid chart, rendering it, inspecting the PNG visually, and refining layout.',
      argsSchema: {
        goal: z.string().describe('What system, workflow, or concept to diagram.'),
        diagramType: z.string().optional().describe('Preferred diagram type.'),
      },
    },
    async ({ goal, diagramType }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Create a clear, publication-grade Mermaid diagram${diagramType ? ` (${diagramType})` : ''} for:`,
              goal,
              '',
              'Follow this interactive comprehension workflow:',
              '1. Call `get_playbook` with the appropriate `mode` ("concept" | "paper" | "codebase" | "bug" | "tradeoff") to load the teaching blueprint and inspect existing workspace views.',
              '2. Keep each view to ~4–7 concise boxes (2–5 plain words per box) and pass `guide: { gist, steps (or flows), nodes }` on `render_view` so the user can step through flows, see concrete traces, click boxes for details, and zoom into `childPath` sub-views.',
              '3. Visually inspect the returned 2x Retina PNG image and `layoutDiagnostics`, re-running `render_view` at the same `path` until layout and legibility are clean.',
              '4. Do NOT output raw ```mermaid``` code blocks or any URLs in chat. Once `syncedToBrowser` is true, concisely inform the user their views are ready on MFHMFA.',
            ].join('\n'),
          },
        },
      ],
    })
  );

  return server;
}
