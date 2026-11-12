import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  RootsListChangedNotificationSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { StudioService } from '../../application/studioService.js';
import { APP_NAME, APP_VERSION } from '../../config/env.js';
import { extractProjectFromRoots } from '../../shared/agentIdentity.js';
import type { CallerSource } from '../../shared/types.js';
import { AGENT_TOOLS, type ToolCallContext } from '../tools/toolRegistry.js';

export interface McpServerLifecycleHooks {
  onClientInitialized?: (client: { name: string | null; version: string | null }) => void;
  onRootsResolved?: (project: string) => void;
}

function withRaceTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    timer.unref?.();
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
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
        'MFHMFA (Mermaid For Humans, Mermaid For Agents) is a zero-server-storage Codebase Comprehension Studio & Virtual Diagram Filesystem (VFS) stored 100% in the user\'s browser localStorage plus a headless 2x Retina PNG validation/rendering engine.',
        'Follow these Comprehension & VFS rules:',
        '1. Call `mermaid_ls` to inspect existing folders and `.mmd` graphs in this project (and `mermaid_read` before updating an existing graph).',
        '2. DESIGN FOR HUMAN WORKING MEMORY (4–7 Boxes per View): Keep each `.mmd` graph to ~4–7 core boxes with concise 2–5 word plain-English labels (never cram raw code identifiers, unexplained buzzwords, or forced metaphors inside boxes). For deeper subsystems, render clean child `.mmd` files and link them via `guide.nodes[nodeId].childPath` (setting `guide.parentPath` on child graphs).',
        '3. ATTACH INTERACTIVE COMPREHENSION LAYERS (`guide` on `mermaid_render`): When explaining systems or flows, populate `guide.gist` (1-sentence takeaway), `guide.steps` (3–6 ordered Story Mode frames tracing one concrete request/item step-by-step via `focusNodes`), and `guide.nodes` (clickable inspector cards with plain `summary`, concrete `example` with real sizes/timings, `whatIf` failure/boundary behavior, `files`, and optional `childPath`).',
        '4. Visually inspect the returned 2x Retina PNG (`image/png`) and `layoutDiagnostics`, re-rendering the same `path` until accurate, legible, and overlap-free (rapid retries by the same agent coalesce automatically into a single clean revision).',
        '5. Check `syncedToBrowser` in `mermaid_render`: if `syncStatus` is `"browser_tab_closed"` or `"workspace_not_paired"`, ask the user to open MFHMFA Studio in their browser (or pair `?workspace=ws_...`) so you can push the finalized diagram live.',
        '6. STRICT RESPONSE RULE: Never output raw ```mermaid``` code blocks or any URLs/links in terminal/chat unless the user explicitly asks for raw code. Once visually verified and synced, concisely tell the user their interactive graphs are ready on MFHMFA (mentioning they can step through Story Mode or click boxes to inspect/zoom in).',
        'If validation fails, check `error.line`, `error.snippet`, and `error.suggestion` (wrap labels containing (), [], or {} in double quotes ["..."], and avoid lowercase `end` as a node ID).',
      ].join(' '),
    }
  );

  let resolvedRootsProject: string | null = null;
  let inflightRootsProbe: Promise<string | null> | null = null;

  const probeClientRoots = (): Promise<string | null> => {
    if (resolvedRootsProject) return Promise.resolve(resolvedRootsProject);
    const caps = server.server.getClientCapabilities();
    if (!caps?.roots) return Promise.resolve(null);

    if (!inflightRootsProbe) {
      inflightRootsProbe = (async () => {
        try {
          const result = await withRaceTimeout(server.server.listRoots(), 1200);
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
        server.server.setNotificationHandler(
          RootsListChangedNotificationSchema,
          async () => {
            resolvedRootsProject = null;
            await probeClientRoots();
          }
        );
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
          const out = await tool.execute(args, service, enrichedCtx);

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

  // Stateless Resources
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

  // Guided Prompt
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
              'Follow this project-scoped VFS workflow:',
              '1. Call `mermaid_ls` to see existing folders and `.mmd` graphs in this project (and `mermaid_read` if updating an existing graph).',
              '2. Keep each view to ~4–7 concise boxes (2–5 plain words per box) and pass `guide: { gist, steps, nodes }` on `mermaid_render` so the user can step through Story Mode, click boxes for concrete examples & "what-if" edge cases, and drill down via `childPath` into child `.mmd` files.',
              '3. Visually inspect the returned 2x Retina PNG image and `layoutDiagnostics`, re-running `mermaid_render` at the same `path` until layout and legibility are clean (rapid retries coalesce automatically into one clean revision).',
              '4. Do NOT output raw ```mermaid``` code blocks or any URLs in chat — once `syncedToBrowser` is true, simply inform the user their graphs are ready on MFHMFA.',
            ].join('\n'),
          },
        },
      ],
    })
  );

  return server;
}
