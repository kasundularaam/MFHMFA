import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type {
  StatelessRenderInput,
  StudioService,
  VfsRpcBridgeFn,
} from '../../application/studioService.js';
import {
  ComprehensionGuideToolSchema,
  summarizeComprehensionGuide,
} from '../../shared/comprehension.js';
import { MermaidLookSchema, MermaidThemeSchema } from '../../shared/protocolSchemas.js';
import type { CallerSource, DiagramComprehensionGuide } from '../../shared/types.js';

export interface ActiveCallerMetadata {
  sessionId: string | null;
  agentName: string | null;
  project: string | null;
}

export interface ToolCallContext {
  source: CallerSource;
  allowLocalDiskWrite?: boolean | (() => boolean);
  getWorkspaceToken?: () => string | null;
  getCallerMeta?: () => ActiveCallerMetadata;
  ensureCallerProject?: () => Promise<string | null>;
  onProjectDiscovered?: (project: string) => void;
  relayBridge?: StatelessRenderInput['relayBridge'];
  vfsBridge?: VfsRpcBridgeFn;
}

export interface ToolExecutionOutput {
  ok: boolean;
  payload: unknown;
  textOverride?: string;
  pngBase64?: string | null;
}

export interface RegisteredAgentTool {
  name: string;
  title: string;
  description: string;
  zodShape: z.ZodRawShape;
  jsonParameters: Record<string, unknown>;
  annotations?: ToolAnnotations;
  parseAndExecute: (
    rawArgs: unknown,
    service: StudioService,
    ctx: ToolCallContext
  ) => Promise<ToolExecutionOutput>;
}

interface ToolDefinitionSpec<Shape extends z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  zodShape: Shape;
  annotations?: ToolAnnotations;
  execute: (
    args: z.infer<z.ZodObject<Shape>>,
    service: StudioService,
    ctx: ToolCallContext
  ) => Promise<ToolExecutionOutput>;
}

function defineTool<Shape extends z.ZodRawShape>(
  spec: ToolDefinitionSpec<Shape>
): RegisteredAgentTool {
  const schema = z.object(spec.zodShape);
  const rawJsonSchema = zodToJsonSchema(schema, {
    target: 'openApi3',
    $refStrategy: 'none',
  }) as Record<string, unknown>;

  return {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    zodShape: spec.zodShape,
    jsonParameters: rawJsonSchema,
    annotations: spec.annotations,
    parseAndExecute: async (rawArgs, service, ctx) => {
      const parsed = schema.parse(rawArgs ?? {});
      return spec.execute(parsed, service, ctx);
    },
  };
}

function bytesToBase64(bytes: Uint8Array | null | undefined): string | null {
  if (!bytes) return null;
  return Buffer.from(bytes).toString('base64');
}

function resolveDiskWriteAllowed(ctx: ToolCallContext): boolean {
  if (ctx.source === 'mcp-stdio') return true;
  if (typeof ctx.allowLocalDiskWrite === 'function') {
    return ctx.allowLocalDiskWrite();
  }
  return Boolean(ctx.allowLocalDiskWrite);
}

/**
 * Enforces strict working-directory sandboxing:
 * Once a session's working project is bound (via MCP `roots`, `?project=`, Stdio CWD, or first tool call),
 * the agent is strictly locked to that working directory and cannot access other projects.
 */
async function resolveJailedProject(
  argsProject: string | undefined,
  ctx: ToolCallContext
): Promise<string> {
  let meta = ctx.getCallerMeta?.();
  if (meta?.project) {
    return meta.project;
  }

  if (ctx.ensureCallerProject) {
    const probed = await ctx.ensureCallerProject();
    if (probed) return probed;
    meta = ctx.getCallerMeta?.();
    if (meta?.project) return meta.project;
  }

  const candidate = argsProject?.trim();
  if (candidate) {
    ctx.onProjectDiscovered?.(candidate);
    return candidate;
  }

  return 'General';
}

export const AGENT_TOOLS: readonly RegisteredAgentTool[] = [
  defineTool({
    name: 'mermaid_ls',
    title: 'List Project Diagram Directories & Graphs (ls)',
    description:
      "List subdirectories and `.mmd` Mermaid graph files inside your current project working directory (stored in the user's browser IndexedDB). Shows directory tree, diagram types, version counts, and which coding agent (`pi`, `claude`, `you`) last updated each graph.",
    zodShape: {
      path: z
        .string()
        .optional()
        .describe(
          'Relative directory path inside your project working directory (defaults to `"/"` project root, e.g. `"auth"` or `"architecture/core"`).'
        ),
      project: z
        .string()
        .optional()
        .describe(
          'Working project folder name (used only if your MCP client did not advertise workspace `roots`).'
        ),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    execute: async (args, service, ctx) => {
      const project = await resolveJailedProject(args.project, ctx);
      const out = await service.vfsLs({
        workspaceToken: ctx.getWorkspaceToken?.(),
        project,
        dirPath: args.path,
        vfsBridge: ctx.vfsBridge,
      });
      return {
        ok: true,
        payload: out,
      };
    },
  }),

  defineTool({
    name: 'mermaid_read',
    title: 'Read Diagram Source & Revision History (read)',
    description:
      'Read the `.mmd` Mermaid source code, comprehension `guide`, and 5-version immutable revision history of an existing graph inside your project working directory (including diagrams created by other coding agents or edited by the human).',
    zodShape: {
      path: z
        .string()
        .describe(
          'Relative file path inside your project working directory (e.g. `"auth/oauth-flow.mmd"` or `"auth/oauth-flow"`).'
        ),
      version: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('Optional specific version number to inspect (defaults to latest version).'),
      project: z
        .string()
        .optional()
        .describe(
          'Working project folder name (used only if your MCP client did not advertise workspace `roots`).'
        ),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    execute: async (args, service, ctx) => {
      const project = await resolveJailedProject(args.project, ctx);
      const out = await service.vfsRead({
        workspaceToken: ctx.getWorkspaceToken?.(),
        project,
        filePath: args.path,
        version: args.version,
        vfsBridge: ctx.vfsBridge,
      });
      return {
        ok: true,
        payload: out,
      };
    },
  }),

  defineTool({
    name: 'mermaid_render',
    title: 'Write, Validate, Render & Visually Inspect Mermaid Graph',
    description:
      'Write or update a Mermaid graph at `path` inside your project working directory (auto-creating folders and coalescing rapid iterative refinements by the same agent into a single clean revision), attach an optional interactive `guide` (`gist`, `steps` Story Mode walkthrough, `nodes` clickable inspector cards & `childPath` sub-graph zoom), validate syntax, and receive a 2x Retina PNG (`image/png`) + layout/comprehension diagnostics. Keep each graph to ~4–7 concise plain-English boxes (2–5 words per box) and place detailed mechanics, concrete examples, and "what-if" edge cases in `guide`. IMPORTANT: Never output raw ```mermaid``` code or URLs in chat unless explicitly asked — visually verify the PNG until clean, ensure `syncedToBrowser` is true, and simply tell the user their graphs are ready on MFHMFA.',
    zodShape: {
      code: z.string().describe('Raw Mermaid diagram source code (without ```mermaid fences).'),
      path: z
        .string()
        .optional()
        .describe(
          'Relative `.mmd` path inside your project working directory (e.g. `"architecture/system-overview.mmd"`, `"auth/oauth-flow"`). Auto-creates parent folders; re-rendering the same `path` appends a new immutable version.'
        ),
      title: z
        .string()
        .optional()
        .describe('Optional human-readable graph title (defaults to file name of `path`).'),
      guide: ComprehensionGuideToolSchema.optional(),
      project: z
        .string()
        .optional()
        .describe(
          'Working project folder name (used only if your MCP client did not advertise workspace `roots`).'
        ),
      agent: z
        .string()
        .optional()
        .describe('Optional coding agent name override when calling via stateless HTTP/REST.'),
      theme: MermaidThemeSchema.optional().describe(
        'Visual theme (default, neutral, dark, forest, base).'
      ),
      look: MermaidLookSchema.optional().describe('Render style: classic or handDrawn.'),
      background: z.string().optional().describe('CSS color or "transparent".'),
      scale: z
        .number()
        .min(1)
        .max(4)
        .optional()
        .describe('Pixel scale factor (1-4, default 2).'),
      outputPath: z
        .string()
        .optional()
        .describe('Optional local disk file path (.png or .svg) when running locally.'),
      returnImage: z.boolean().optional().describe('Attach rendered PNG image (default true).'),
      includeSvg: z
        .boolean()
        .optional()
        .describe('Include raw SVG XML string (default false).'),
    },
    annotations: { idempotentHint: true },
    execute: async (args, service, ctx) => {
      const effectiveProject = await resolveJailedProject(args.project, ctx);
      const callerMeta = ctx.getCallerMeta?.();
      const effectiveAgent = args.agent?.trim() || callerMeta?.agentName || null;
      const workspaceToken = ctx.getWorkspaceToken?.() ?? null;

      const res = await service.render(args.code, {
        path: args.path,
        title: args.title,
        guide: args.guide as DiagramComprehensionGuide | undefined,
        project: effectiveProject,
        agentName: effectiveAgent,
        agentSessionId: callerMeta?.sessionId ?? null,
        theme: args.theme,
        look: args.look,
        background: args.background,
        scale: args.scale,
        outputPath: args.outputPath,
        allowLocalDiskWrite: resolveDiskWriteAllowed(ctx),
        source: ctx.source,
        workspaceToken,
        relayBridge: ctx.relayBridge,
      });

      const syncedToBrowser = res.syncedSubscribers > 0;
      const syncStatus = !res.valid
        ? 'invalid'
        : syncedToBrowser
          ? 'synced_live'
          : workspaceToken
            ? 'browser_tab_closed'
            : 'workspace_not_paired';

      const presentationRule = !res.valid
        ? undefined
        : syncedToBrowser
          ? "Synced live to the user's MFHMFA Studio browser tab. Once you have visually verified the PNG and layoutDiagnostics, reply concisely that their diagram is ready on MFHMFA — do NOT output raw Mermaid source code or any URLs unless the user explicitly asks for raw code."
          : workspaceToken
            ? 'No MFHMFA Studio browser tab is currently open for this workspace (MFHMFA stores 0 diagrams on the server — 100% browser IndexedDB). Ask the user to open MFHMFA Studio in their browser and tell you when ready so you can push the finalized diagram live. Do NOT output raw Mermaid source code or URLs unless explicitly asked.'
            : 'No ?workspace=ws_... token is configured on this MCP connection, so MFHMFA cannot route diagrams to the user\'s browser tab. Ask the user to copy their paired MCP URL from MFHMFA Studio ("Copy MCP URL" in the sidebar or Docs) and reconnect. Do NOT output raw Mermaid source code or URLs unless explicitly asked.';

      return {
        ok: res.valid,
        payload: {
          renderId: res.renderId,
          project: res.project,
          path: res.path,
          title: res.title,
          agent: res.agent,
          valid: res.valid,
          syncedToBrowser,
          syncStatus,
          ...(presentationRule ? { presentationRule } : {}),
          diagramType: res.diagramType,
          theme: res.theme,
          look: res.look,
          background: res.background,
          dimensions: res.dimensions,
          metrics: res.metrics,
          comprehension: summarizeComprehensionGuide(res.guide),
          layoutDiagnostics: res.layoutDiagnostics,
          warnings: res.warnings,
          error: res.error,
          outputPath: res.outputPath,
          durationMs: res.durationMs,
          ...(args.includeSvg && res.svg ? { svg: res.svg } : {}),
        },
        pngBase64: res.valid && args.returnImage !== false ? bytesToBase64(res.pngBytes) : null,
      };
    },
  }),

  defineTool({
    name: 'mermaid_mv',
    title: 'Move or Rename Diagram / Subfolder (mv)',
    description:
      'Move or rename an existing `.mmd` graph or subfolder within your project working directory while preserving its immutable 5-version history and updating linked `childPath` / `parentPath` references.',
    zodShape: {
      from: z
        .string()
        .describe('Existing relative file or folder path (e.g. `"draft.mmd"` or `"old-dir"`).'),
      to: z
        .string()
        .describe(
          'Destination relative file or folder path (e.g. `"auth/login-flow.mmd"` or `"architecture/auth"`).'
        ),
      project: z
        .string()
        .optional()
        .describe(
          'Working project folder name (used only if your MCP client did not advertise workspace `roots`).'
        ),
    },
    annotations: { idempotentHint: true },
    execute: async (args, service, ctx) => {
      const project = await resolveJailedProject(args.project, ctx);
      const out = await service.vfsMove({
        workspaceToken: ctx.getWorkspaceToken?.(),
        project,
        fromPath: args.from,
        toPath: args.to,
        vfsBridge: ctx.vfsBridge,
      });
      return {
        ok: true,
        payload: out,
      };
    },
  }),

  defineTool({
    name: 'mermaid_validate',
    title: 'Validate Mermaid Syntax',
    description:
      'Fast stateless syntax validation and static linting for Mermaid diagram code. Returns diagram type, exact 1-indexed line/column error snippet, and actionable fix suggestions.',
    zodShape: {
      code: z.string().describe('Raw Mermaid diagram source code (without ```mermaid fences).'),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    execute: async ({ code }, service, ctx) => {
      const res = await service.validate(code, ctx.source);
      return { ok: res.valid, payload: res };
    },
  }),

  defineTool({
    name: 'mermaid_export',
    title: 'Export Mermaid Diagram to Local Disk File',
    description:
      'Statelessly validate, render, and export raw Mermaid `code` directly to a local filesystem path (`.png`, `.svg`, `.mmd`, or `.md`) when running locally.',
    zodShape: {
      code: z.string().describe('Raw Mermaid diagram source code.'),
      outputPath: z.string().describe('Destination file path (.png, .svg, .mmd, or .md).'),
      title: z.string().optional().describe('Optional heading title when exporting `.md`.'),
      format: z.enum(['png', 'svg', 'mmd', 'md']).optional(),
      theme: MermaidThemeSchema.optional(),
      look: MermaidLookSchema.optional(),
      background: z.string().optional(),
      scale: z.number().min(1).max(4).optional(),
    },
    annotations: { idempotentHint: true },
    execute: async (args, service, ctx) => {
      const out = await service.exportDiagram({
        ...args,
        allowLocalDiskWrite: resolveDiskWriteAllowed(ctx),
        source: ctx.source,
      });
      return { ok: true, payload: out };
    },
  }),

  defineTool({
    name: 'mermaid_syntax_guide',
    title: 'Get Mermaid Syntax & Escaping Guide',
    description:
      'Retrieve concise Mermaid syntax examples, comprehension guidelines, and escaping rules (comprehension, pitfalls, flowchart, sequence, er, state, class, mindmap, gantt, all).',
    zodShape: {
      topic: z.string().optional().describe('Guide topic.'),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    execute: async ({ topic }, service, ctx) => {
      const guide = service.syntaxGuide(topic, ctx.source);
      return { ok: true, payload: { guide }, textOverride: guide };
    },
  }),

  defineTool({
    name: 'mermaid_list_templates',
    title: 'List Starter Mermaid Templates',
    description: 'Return curated starter Mermaid templates across 11 diagram categories.',
    zodShape: {},
    annotations: { readOnlyHint: true, idempotentHint: true },
    execute: async (_args, service) => ({
      ok: true,
      payload: { templates: service.listTemplates() },
    }),
  }),
];

export function getOpenAiToolSchemas() {
  return AGENT_TOOLS.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.jsonParameters,
    },
  }));
}

export async function dispatchNamedTool(
  name: string,
  rawArgs: unknown,
  service: StudioService,
  sourceOrCtx: CallerSource | ToolCallContext
): Promise<ToolExecutionOutput> {
  const tool = AGENT_TOOLS.find((t) => t.name === name);
  if (!tool) {
    throw new Error(
      `Unknown tool "${name}". Fetch GET /api/tools/schemas for available tools.`
    );
  }
  const ctx: ToolCallContext =
    typeof sourceOrCtx === 'string' ? { source: sourceOrCtx } : sourceOrCtx;
  return tool.parseAndExecute(rawArgs, service, ctx);
}
