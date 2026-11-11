import { z } from 'zod';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { StudioService } from '../../application/studioService.js';
import { toHostVisiblePath } from '../../config/env.js';
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
    name: 'mermaid_validate',
    title: 'Validate Mermaid Syntax',
    description:
      'Fast syntax validation and static linting for Mermaid diagram code. Returns diagram type, exact line/column error snippet, and actionable fix suggestions without saving a chart.',
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
    name: 'mermaid_render_preview',
    title: 'Render & Visually Inspect Mermaid Preview',
    description:
      'Validate and render Mermaid code into a high-DPI PNG image and SVG without creating a workspace entry. Returns layout telemetry plus the rendered PNG image so you can visually see the chart.',
    zodShape: {
      code: z.string().describe('Raw Mermaid diagram source code.'),
      theme: THEME_ENUM.optional().describe('Visual theme (default, neutral, dark, forest, base).'),
      look: LOOK_ENUM.optional().describe('Render style: classic or handDrawn.'),
      background: z.string().optional().describe('CSS color or "transparent".'),
      scale: z.number().min(1).max(4).optional().describe('Pixel scale factor (1-4, default 2).'),
      outputPath: z.string().optional().describe('Optional path (.png or .svg) to write output.'),
      returnImage: z.boolean().optional().describe('Attach rendered PNG image (default true).'),
      includeSvg: z.boolean().optional().describe('Include raw SVG XML string (default false).'),
    },
    jsonParameters: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        theme: { type: 'string', enum: ['default', 'neutral', 'dark', 'forest', 'base'] },
        look: { type: 'string', enum: ['classic', 'handDrawn'] },
        background: { type: 'string' },
        scale: { type: 'number', minimum: 1, maximum: 4 },
        outputPath: { type: 'string' },
        returnImage: { type: 'boolean', default: true },
      },
      required: ['code'],
    },
    execute: async (args, service, source) => {
      const res = await service.renderPreview(args.code, {
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
          pngPath: toHostVisiblePath(res.pngPath),
          svgPath: toHostVisiblePath(res.svgPath),
          outputPath: res.outputPath,
          previewPngUrl: res.previewPngUrl,
          durationMs: res.durationMs,
          ...(args.includeSvg && res.svg ? { svg: res.svg } : {}),
        },
        pngBase64: res.valid && args.returnImage !== false ? bytesToBase64(res.pngBytes) : null,
      };
    },
  }),

  defineTool({
    name: 'mermaid_create_chart',
    title: 'Create & Save Mermaid Chart in Studio',
    description:
      'Create a persistent Mermaid chart in the Studio workspace, broadcast it live to any open Web Studio browser tab, validate & render it, and return both layout metadata and the rendered PNG image.',
    zodShape: {
      title: z.string().describe('Human-readable title for the chart.'),
      code: z.string().describe('Raw Mermaid diagram source code.'),
      description: z.string().optional().describe('Optional summary notes.'),
      theme: THEME_ENUM.optional(),
      look: LOOK_ENUM.optional(),
      background: z.string().optional(),
      tags: z.array(z.string()).optional(),
      author: z.string().optional(),
      focusInUi: z.boolean().optional().describe('Focus chart in connected Web UI (default true).'),
      returnImage: z.boolean().optional().describe('Return PNG image attachment (default true).'),
    },
    jsonParameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        code: { type: 'string' },
        description: { type: 'string' },
        theme: { type: 'string', enum: ['default', 'neutral', 'dark', 'forest', 'base'] },
        look: { type: 'string', enum: ['classic', 'handDrawn'] },
        background: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        focusInUi: { type: 'boolean', default: true },
        returnImage: { type: 'boolean', default: true },
      },
      required: ['title', 'code'],
    },
    execute: async (args, service, source) => {
      const result = await service.createChart({ ...args, source });
      return {
        ok: result.chart.valid,
        payload: formatChartPayload(result),
        pngBase64:
          result.chart.valid && args.returnImage !== false
            ? bytesToBase64(result.pngBytes)
            : null,
      };
    },
  }),

  defineTool({
    name: 'mermaid_update_chart',
    title: 'Update Mermaid Chart (Versioned)',
    description:
      'Update an existing chart in the Studio workspace (automatically saves a version snapshot), re-validate, re-render, sync live to the Web UI, and return the new rendered PNG image.',
    zodShape: {
      id: z.string().describe('Chart ID to update.'),
      code: z.string().optional().describe('Updated Mermaid diagram source code.'),
      title: z.string().optional(),
      description: z.string().optional(),
      theme: THEME_ENUM.optional(),
      look: LOOK_ENUM.optional(),
      background: z.string().optional(),
      tags: z.array(z.string()).optional(),
      changeNote: z.string().optional().describe('Note describing what changed in this version.'),
      focusInUi: z.boolean().optional().describe('Focus updated chart in Web UI (default true).'),
      returnImage: z.boolean().optional().describe('Return PNG image attachment (default true).'),
    },
    jsonParameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        code: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        theme: { type: 'string', enum: ['default', 'neutral', 'dark', 'forest', 'base'] },
        look: { type: 'string', enum: ['classic', 'handDrawn'] },
        background: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        changeNote: { type: 'string' },
        focusInUi: { type: 'boolean', default: true },
        returnImage: { type: 'boolean', default: true },
      },
      required: ['id'],
    },
    execute: async ({ id, returnImage, ...patch }, service, source) => {
      const result = await service.updateChart(id, { ...patch, source });
      return {
        ok: result.chart.valid,
        payload: formatChartPayload(result),
        pngBase64:
          result.chart.valid && returnImage !== false ? bytesToBase64(result.pngBytes) : null,
      };
    },
  }),

  defineTool({
    name: 'mermaid_see_chart',
    title: 'See & Inspect Saved Mermaid Chart',
    description:
      'Retrieve a chart by ID (optionally at a historical version), including its Mermaid code, version history, layout metrics, and rendered PNG image.',
    zodShape: {
      id: z.string().describe('Chart ID to inspect.'),
      version: z.number().int().positive().optional().describe('Optional historical version.'),
      returnImage: z.boolean().optional().describe('Attach rendered PNG image (default true).'),
      includeSvg: z.boolean().optional().describe('Include raw SVG markup (default false).'),
    },
    jsonParameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        version: { type: 'integer', minimum: 1 },
        returnImage: { type: 'boolean', default: true },
      },
      required: ['id'],
    },
    annotations: { readOnlyHint: true },
    execute: async ({ id, version, returnImage, includeSvg }, service, source) => {
      const res = await service.getChartWithVisuals(id, { version, source });
      return {
        ok: true,
        payload: {
          chart: {
            ...res.chart,
            pngPath: toHostVisiblePath(res.chart.pngPath),
            svgPath: toHostVisiblePath(res.chart.svgPath),
          },
          selectedVersion: res.selectedVersion,
          code: res.code,
          versions: res.versions.map((v) => ({
            version: v.version,
            author: v.author,
            valid: v.valid,
            width: v.width,
            height: v.height,
            changeNote: v.changeNote,
            createdAt: v.createdAt,
          })),
          studioUrl: res.studioUrl,
          pngUrl: res.pngUrl,
          svgUrl: res.svgUrl,
          ...(includeSvg && res.svg ? { svg: res.svg } : {}),
        },
        pngBase64: returnImage !== false ? bytesToBase64(res.pngBytes) : null,
      };
    },
  }),

  defineTool({
    name: 'mermaid_list_charts',
    title: 'List Workspace Mermaid Charts',
    description: 'List and search saved Mermaid charts in the Studio workspace.',
    zodShape: {
      search: z.string().optional().describe('Search by title, description, ID, or code.'),
      tag: z.string().optional().describe('Filter by tag.'),
      diagramType: z.string().optional().describe('Filter by Mermaid diagram type.'),
      limit: z.number().int().min(1).max(200).optional().describe('Max charts to return.'),
    },
    jsonParameters: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        tag: { type: 'string' },
        diagramType: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      },
    },
    annotations: { readOnlyHint: true },
    execute: async (filters, service, source) => {
      const charts = service.listCharts({ ...filters, limit: filters.limit ?? 50 }, source);
      const concise = charts.map((c) => ({
        id: c.id,
        title: c.title,
        description: c.description,
        diagramType: c.diagramType,
        theme: c.theme,
        look: c.look,
        valid: c.valid,
        width: c.width,
        height: c.height,
        tags: c.tags,
        version: c.version,
        author: c.author,
        updatedAt: c.updatedAt,
        ...service.buildUrls(c.id),
      }));
      return { ok: true, payload: { count: concise.length, charts: concise } };
    },
  }),

  defineTool({
    name: 'mermaid_delete_chart',
    title: 'Delete Mermaid Chart',
    description: 'Permanently delete a chart and its rendered artifacts by ID.',
    zodShape: {
      id: z.string().describe('Chart ID to delete.'),
    },
    jsonParameters: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    annotations: { destructiveHint: true },
    execute: async ({ id }, service, source) => {
      const deleted = service.deleteChart(id, source);
      return { ok: deleted, payload: { id, deleted } };
    },
  }),

  defineTool({
    name: 'mermaid_export_chart',
    title: 'Export Mermaid Chart to File',
    description:
      'Export an existing workspace chart (by `id`) or raw `code` directly to a target file path (.png, .svg, .mmd, or .md).',
    zodShape: {
      id: z.string().optional().describe('Saved chart ID to export.'),
      code: z.string().optional().describe('Raw Mermaid source code.'),
      outputPath: z.string().describe('Destination file path (.png, .svg, .mmd, or .md).'),
      format: z.enum(['png', 'svg', 'mmd', 'md']).optional(),
      theme: THEME_ENUM.optional(),
      look: LOOK_ENUM.optional(),
      background: z.string().optional(),
      scale: z.number().min(1).max(4).optional(),
    },
    jsonParameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        code: { type: 'string' },
        outputPath: { type: 'string' },
        format: { type: 'string', enum: ['png', 'svg', 'mmd', 'md'] },
        scale: { type: 'number', minimum: 1, maximum: 4 },
      },
      required: ['outputPath'],
    },
    execute: async (args, service, source) => {
      const out = await service.exportChart({ ...args, source });
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
    annotations: { readOnlyHint: true },
    execute: async ({ topic }, service, source) => {
      const guide = service.syntaxGuide(topic, source);
      return { ok: true, payload: { guide }, textOverride: guide };
    },
  }),

  defineTool({
    name: 'mermaid_list_templates',
    title: 'List Starter Mermaid Templates',
    description: 'Return curated starter Mermaid templates across diagram categories.',
    zodShape: {},
    jsonParameters: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    execute: async (_args, service) => ({
      ok: true,
      payload: { templates: service.listTemplates() },
    }),
  }),
];

function formatChartPayload(result: Awaited<ReturnType<StudioService['createChart']>>) {
  return {
    id: result.chart.id,
    title: result.chart.title,
    version: result.chart.version,
    valid: result.chart.valid,
    diagramType: result.chart.diagramType,
    dimensions:
      result.chart.width && result.chart.height
        ? {
            width: result.chart.width,
            height: result.chart.height,
            aspectRatio: Number((result.chart.width / result.chart.height).toFixed(2)),
          }
        : null,
    metrics: result.chart.metrics,
    layoutDiagnostics: result.chart.layoutDiagnostics,
    warnings: result.chart.warnings,
    error: result.chart.error,
    studioUrl: result.studioUrl,
    pngUrl: result.pngUrl,
    svgUrl: result.svgUrl,
    pngPath: toHostVisiblePath(result.chart.pngPath),
    svgPath: toHostVisiblePath(result.chart.svgPath),
    durationMs: result.durationMs,
  };
}

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
