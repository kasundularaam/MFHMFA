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
import {
  LearningModeSchema,
  MermaidLookSchema,
  MermaidThemeSchema,
} from '../../shared/protocolSchemas.js';
import type {
  CallerSource,
  DiagramComprehensionGuide,
  LearningMode,
} from '../../shared/types.js';

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
  hasLoadedPlaybook?: () => boolean;
  markPlaybookLoaded?: (mode: LearningMode) => void;
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
    name: 'get_playbook',
    title: 'Load Learning Playbook & Live Workspace Context',
    description:
      'Call this FIRST whenever helping a user understand, learn, explain, or debug a topic. Loads the tailored cognitive-science teaching blueprint for `mode` (`concept`, `paper`, `codebase`, `bug`, or `tradeoff`), Mermaid escaping rules, existing workspace views, and what view/step/box the user currently has selected in Studio.',
    zodShape: {
      mode: LearningModeSchema.describe(
        'Topic category: "concept" (algorithms/tech/mental models), "paper" (research papers/math/ML), "codebase" (repos/execution flows), "bug" (root-cause/incidents), or "tradeoff" (architecture/design options).'
      ),
      syntax: z
        .string()
        .optional()
        .describe(
          'Optional Mermaid diagram syntax reference if needed (flowchart, sequence, state, er, class, mindmap, gantt).'
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
      ctx.markPlaybookLoaded?.(args.mode);
      const out = await service.getPlaybook({
        mode: args.mode,
        syntaxTopic: args.syntax,
        workspaceToken: ctx.getWorkspaceToken?.(),
        project,
        vfsBridge: ctx.vfsBridge,
      });
      return {
        ok: true,
        payload: out,
        textOverride: out.playbook,
      };
    },
  }),

  defineTool({
    name: 'render_view',
    title: 'Render Interactive Visual Learning View',
    description:
      "Write or update an interactive `.mmd` learning view at `path` (4–7 plain-English boxes per view + `guide` with `gist`, `steps` or contrasting `flows`, `nodes` inspector cards, and optional `childPath` sub-views). Validates syntax, returns a 2x Retina PNG + layout/cognitive diagnostics for visual self-verification, and streams live to the user's open Studio tab. Never output raw ```mermaid``` code or URLs in chat unless asked.",
    zodShape: {
      code: z.string().describe('Raw Mermaid diagram source code (without ```mermaid fences).'),
      path: z
        .string()
        .optional()
        .describe(
          'Relative `.mmd` path inside the project workspace (e.g. `"overview.mmd"`, `"raft/leader-election.mmd"`). Rapid retries at the same path coalesce into 1 version.'
        ),
      title: z
        .string()
        .optional()
        .describe('Optional human-readable view title (defaults to file name of `path`).'),
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
          ? "Synced live to the user's MFHMFA Studio browser tab. Visually verify the PNG and layoutDiagnostics, then reply concisely without outputting raw Mermaid source code or any URLs unless explicitly asked."
          : workspaceToken
            ? 'No MFHMFA Studio browser tab is currently open for this workspace (MFHMFA stores 0 diagrams on the server). Ask the user to open MFHMFA Studio in their browser so you can stream the view live. Do NOT output raw Mermaid source code or URLs unless explicitly asked.'
            : 'No ?workspace=ws_... token is configured on this MCP connection. Ask the user to copy their paired MCP URL from MFHMFA Studio ("Copy MCP URL") and reconnect. Do NOT output raw Mermaid source code or URLs unless explicitly asked.';

      const coachingTips: string[] = [];
      if (ctx.hasLoadedPlaybook && !ctx.hasLoadedPlaybook()) {
        coachingTips.push(
          'Soft tip: Call `get_playbook` with `mode` ("concept" | "paper" | "codebase" | "bug" | "tradeoff") to load the tailored teaching blueprint and check the user\'s live Studio focus.'
        );
      }
      if (res.valid && !res.guide) {
        coachingTips.push(
          'Soft tip: Attach `guide: { gist, steps (or flows), nodes }` on `render_view` so the user gets interactive walkthroughs, concrete data traces, and clickable component cards instead of a static chart.'
        );
      }

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
          ...(coachingTips.length > 0 ? { coachingTips } : {}),
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
    name: 'list_views',
    title: 'List Workspace Folders, Views & User Focus',
    description:
      "List folders and `.mmd` learning views inside your project workspace (stored in the user's browser IndexedDB), plus `viewerFocus` showing which view, walkthrough step, or box the user currently has selected in Studio.",
    zodShape: {
      path: z
        .string()
        .optional()
        .describe(
          'Relative directory path inside your project workspace (defaults to `"/"` project root).'
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
    name: 'read_view',
    title: 'Read View Source, Guide & Version History',
    description:
      'Read the `.mmd` Mermaid source, attached comprehension `guide`, and 5-version immutable revision history of an existing view inside your project workspace.',
    zodShape: {
      path: z
        .string()
        .describe(
          'Relative `.mmd` path inside your project workspace (e.g. `"overview.mmd"` or `"auth/oauth-flow"`).'
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
    name: 'move_view',
    title: 'Move or Rename View / Folder',
    description:
      'Move or rename an existing `.mmd` view or subfolder within your project workspace while preserving 5-version history and updating `childPath` / `parentPath` links.',
    zodShape: {
      from: z
        .string()
        .describe('Existing relative file or folder path (e.g. `"draft.mmd"` or `"old-dir"`).'),
      to: z
        .string()
        .describe(
          'Destination relative file or folder path (e.g. `"auth/login-flow.mmd"` or `"core/auth"`).'
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
    name: 'export_view',
    title: 'Export View to Local Disk File',
    description:
      'Render and write raw Mermaid `code` to a local filesystem path (`.png`, `.svg`, `.mmd`, or `.md`) when running locally and the user explicitly asks to save a file to disk.',
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
];

const LEGACY_REST_TOOL_ALIASES: Record<string, string> = {
  mermaid_playbook: 'get_playbook',
  mermaid_render: 'render_view',
  mermaid_ls: 'list_views',
  mermaid_read: 'read_view',
  mermaid_mv: 'move_view',
  mermaid_export: 'export_view',
};

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
  const ctx: ToolCallContext =
    typeof sourceOrCtx === 'string' ? { source: sourceOrCtx } : sourceOrCtx;

  if (name === 'mermaid_syntax_guide') {
    const topic =
      rawArgs &&
      typeof rawArgs === 'object' &&
      typeof (rawArgs as { topic?: unknown }).topic === 'string'
        ? (rawArgs as { topic: string }).topic
        : undefined;
    const guide = service.syntaxGuide(topic, ctx.source);
    return { ok: true, payload: { guide }, textOverride: guide };
  }

  const resolvedName = LEGACY_REST_TOOL_ALIASES[name] ?? name;
  const tool = AGENT_TOOLS.find((t) => t.name === resolvedName);
  if (!tool) {
    throw new Error(
      `Unknown tool "${name}". Fetch GET /api/tools/schemas for available tools.`
    );
  }
  return tool.parseAndExecute(rawArgs, service, ctx);
}
