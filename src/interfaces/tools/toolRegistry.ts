import { z } from 'zod';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { StudioService } from '../../application/studioService.js';
import type { CallerSource } from '../../shared/types.js';

const THEME_ENUM = z.enum(['default', 'neutral', 'dark', 'forest', 'base']);
const LOOK_ENUM = z.enum(['classic', 'handDrawn']);

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
    source: CallerSource
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
      'Statelessly validate and render Mermaid code into a high-DPI 2x Retina PNG image and optional SVG. Returns layout diagnostics, dimensions, node/edge metrics, and the rendered PNG image so you can visually inspect your chart.',
    zodShape: {
      code: z.string().describe('Raw Mermaid diagram source code (without ```mermaid fences).'),
      title: z.string().optional().describe('Optional human-readable title.'),
      theme: THEME_ENUM.optional().describe('Visual theme (default, neutral, dark, forest, base).'),
      look: LOOK_ENUM.optional().describe('Render style: classic or handDrawn.'),
      background: z.string().optional().describe('CSS color or "transparent".'),
      scale: z.number().min(1).max(4).optional().describe('Pixel scale factor (1-4, default 2).'),
      outputPath: z.string().optional().describe('Optional file path (.png or .svg) to write output.'),
      returnImage: z.boolean().optional().describe('Attach rendered PNG image (default true).'),
      includeSvg: z.boolean().optional().describe('Include raw SVG XML string (default false).'),
    },
    jsonParameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Raw Mermaid diagram source code.' },
        title: { type: 'string' },
        theme: { type: 'string', enum: ['default', 'neutral', 'dark', 'forest', 'base'] },
        look: { type: 'string', enum: ['classic', 'handDrawn'] },
        background: { type: 'string' },
        scale: { type: 'number', minimum: 1, maximum: 4 },
        outputPath: { type: 'string' },
        returnImage: { type: 'boolean', default: true },
        includeSvg: { type: 'boolean', default: false },
      },
      required: ['code'],
    },
    annotations: { idempotentHint: true },
    execute: async (args, service, source) => {
      const res = await service.render(args.code, {
        title: args.title,
        theme: args.theme,
        look: args.look,
        background: args.background,
        scale: args.scale,
        outputPath: args.outputPath,
        source,
      });

      return {
        ok: res.valid,
        payload: {
          renderId: res.renderId,
          title: res.title,
          valid: res.valid,
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
    execute: async ({ code }, service, source) => {
      const res = await service.validate(code, source);
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
    execute: async (args, service, source) => {
      const out = await service.exportDiagram({ ...args, source });
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
    execute: async ({ topic }, service, source) => {
      const guide = service.syntaxGuide(topic, source);
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
  source: CallerSource
): Promise<ToolExecutionOutput> {
  const tool = AGENT_TOOLS.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`Unknown tool "${name}". Fetch GET /api/tools/schemas for available tools.`);
  }
  const parsedArgs = z.object(tool.zodShape).parse(rawArgs ?? {});
  return tool.execute(parsedArgs, service, source);
}
