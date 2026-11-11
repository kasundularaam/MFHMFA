import { z } from 'zod';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type {
  StatelessRenderInput,
  StudioService,
} from '../../application/studioService.js';
import type { CallerSource } from '../../shared/types.js';

const THEME_ENUM = z.enum(['default', 'neutral', 'dark', 'forest', 'base']);
const LOOK_ENUM = z.enum(['classic', 'handDrawn']);

export interface ToolCallContext {
  source: CallerSource;
  getBaseUrl?: () => string;
  liveToken?: string | null;
  getWorkspaceToken?: () => string | null;
  previewBridge?: StatelessRenderInput['previewBridge'];
}


export interface ToolExecutionOutput {
  ok: boolean;
  payload: unknown;
  textOverride?: string;
  pngBase64?: string | null;
}

export interface AgentToolDefinition<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  zodShape: Shape;
  jsonParameters: Record<string, unknown>;
  annotations?: ToolAnnotations;
  execute: (
    args: z.infer<z.ZodObject<Shape>>,
    service: StudioService,
    ctx: ToolCallContext
  ) => Promise<ToolExecutionOutput>;
}

function defineTool<Shape extends z.ZodRawShape>(
  def: AgentToolDefinition<Shape>
): AgentToolDefinition<Shape> {
  return def;
}

function bytesToBase64(bytes: Uint8Array | null | undefined): string | null {
  if (!bytes) return null;
  return Buffer.from(bytes).toString('base64');
}

export const AGENT_TOOLS: readonly AgentToolDefinition<any>[] = [
  defineTool({
    name: 'mermaid_render',
    title: 'Validate, Render & Visually Inspect Mermaid Diagram',
    description:
      'Statelessly validate and render Mermaid code into a high-DPI 2x Retina PNG image, layout diagnostics, and interactive browser links (`studioUrl` for this snapshot and `liveUrl` for real-time session updates). Share `studioUrl` with the user so they can view, pan/zoom, edit, and export in the browser.',
    zodShape: {
      code: z.string().describe('Raw Mermaid diagram source code (without ```mermaid fences).'),
      title: z
        .string()
        .optional()
        .describe(
          'Concise tab title (e.g. "System Overview", "Auth Sequence"). Distinct titles open separate VS Code tabs in the browser; re-rendering the same title updates that tab in place.'
        ),
      tabId: z
        .string()
        .optional()
        .describe('Optional stable tab key to update an existing browser tab even if title changes.'),
      theme: THEME_ENUM.optional().describe('Visual theme (default, neutral, dark, forest, base).'),
      look: LOOK_ENUM.optional().describe('Render style: classic or handDrawn.'),
      background: z.string().optional().describe('CSS color or "transparent".'),
      scale: z.number().min(1).max(4).optional().describe('Pixel scale factor (1-4, default 2).'),
      outputPath: z.string().optional().describe('Optional file path (.png or .svg) to write output.'),
      returnImage: z.boolean().optional().describe('Attach rendered PNG image (default true).'),
      includeSvg: z.boolean().optional().describe('Include raw SVG XML string (default false).'),
      liveChannel: z
        .string()
        .optional()
        .describe('Optional custom live-stream channel token (4-64 alphanumeric/_/- chars).'),
    },
    jsonParameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Raw Mermaid diagram source code.' },
        title: { type: 'string' },
        tabId: { type: 'string' },
        theme: { type: 'string', enum: ['default', 'neutral', 'dark', 'forest', 'base'] },
        look: { type: 'string', enum: ['classic', 'handDrawn'] },
        background: { type: 'string' },
        scale: { type: 'number', minimum: 1, maximum: 4 },
        outputPath: { type: 'string' },
        returnImage: { type: 'boolean', default: true },
        includeSvg: { type: 'boolean', default: false },
        liveChannel: { type: 'string' },
      },
      required: ['code'],
    },
    annotations: { idempotentHint: true },
    execute: async (args, service, ctx) => {
      const res = await service.render(args.code, {
        title: args.title,
        tabId: args.tabId,
        theme: args.theme,
        look: args.look,
        background: args.background,
        scale: args.scale,
        outputPath: args.outputPath,
        source: ctx.source,
        requestBaseUrl: ctx.getBaseUrl?.(),
        liveToken: args.liveChannel ?? ctx.liveToken ?? null,
        workspaceToken: ctx.getWorkspaceToken?.() ?? null,
        previewBridge: ctx.previewBridge,
      });


      return {
        ok: res.valid,
        payload: {
          renderId: res.renderId,
          title: res.title,
          valid: res.valid,
          studioUrl: res.studioUrl,
          liveUrl: res.liveUrl,
          diagramType: res.diagramType,
          theme: res.theme,
          look: res.look,
          background: res.background,
          dimensions: res.dimensions,
          metrics: res.metrics,
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
    name: 'mermaid_validate',
    title: 'Validate Mermaid Syntax',
    description:
      'Fast stateless syntax validation and static linting for Mermaid diagram code. Returns diagram type, exact 1-indexed line/column error snippet, and actionable fix suggestions.',
    zodShape: {
      code: z.string().describe('Raw Mermaid diagram source code (without ```mermaid fences).'),
    },
    jsonParameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Raw Mermaid diagram source code.' },
      },
      required: ['code'],
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    execute: async ({ code }, service, ctx) => {
      const res = await service.validate(code, ctx.source);
      return { ok: res.valid, payload: res };
    },
  }),

  defineTool({
    name: 'mermaid_export',
    title: 'Export Mermaid Diagram to File',
    description:
      'Statelessly validate, render, and export raw Mermaid `code` directly to a destination file path (`.png`, `.svg`, `.mmd`, or `.md`).',
    zodShape: {
      code: z.string().describe('Raw Mermaid diagram source code.'),
      outputPath: z.string().describe('Destination file path (.png, .svg, .mmd, or .md).'),
      title: z.string().optional().describe('Optional heading title when exporting `.md`.'),
      format: z.enum(['png', 'svg', 'mmd', 'md']).optional(),
      theme: THEME_ENUM.optional(),
      look: LOOK_ENUM.optional(),
      background: z.string().optional(),
      scale: z.number().min(1).max(4).optional(),
    },
    jsonParameters: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        outputPath: { type: 'string' },
        title: { type: 'string' },
        format: { type: 'string', enum: ['png', 'svg', 'mmd', 'md'] },
        theme: { type: 'string', enum: ['default', 'neutral', 'dark', 'forest', 'base'] },
        look: { type: 'string', enum: ['classic', 'handDrawn'] },
        background: { type: 'string' },
        scale: { type: 'number', minimum: 1, maximum: 4 },
      },
      required: ['code', 'outputPath'],
    },
    annotations: { idempotentHint: true },
    execute: async (args, service, ctx) => {
      const out = await service.exportDiagram({ ...args, source: ctx.source });
      return { ok: true, payload: out };
    },
  }),

  defineTool({
    name: 'mermaid_syntax_guide',
    title: 'Get Mermaid Syntax & Escaping Guide',
    description:
      'Retrieve concise Mermaid syntax examples and escaping rules (pitfalls, flowchart, sequence, er, state, class, mindmap, gantt, all).',
    zodShape: {
      topic: z.string().optional().describe('Guide topic.'),
    },
    jsonParameters: {
      type: 'object',
      properties: { topic: { type: 'string' } },
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
    jsonParameters: { type: 'object', properties: {} },
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
    throw new Error(`Unknown tool "${name}". Fetch GET /api/tools/schemas for available tools.`);
  }
  const ctx: ToolCallContext =
    typeof sourceOrCtx === 'string' ? { source: sourceOrCtx } : sourceOrCtx;
  const parsedArgs = z.object(tool.zodShape).parse(rawArgs ?? {});
  return tool.execute(parsedArgs, service, ctx);
}
