import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { resolveBaseUrl } from '../config/env.js';
import { getSyntaxGuide, MERMAID_TEMPLATES } from '../domain/catalog.js';
import type {
  ChartListFilter,
  ChartRepositoryPort,
  RealtimeHubPort,
  RenderEnginePort,
} from '../domain/ports.js';
import { slugify } from '../shared/svg.js';
import type {
  AgentEventRecord,
  CallerSource,
  ChartRecord,
  ChartVersionSummary,
  LiveEventType,
  MermaidLook,
  MermaidTemplate,
  MermaidTheme,
  RenderOptions,
  RenderedDiagram,
  ValidationResult,
} from '../shared/types.js';

export interface CreateChartInput {
  id?: string;
  title: string;
  code: string;
  description?: string;
  theme?: MermaidTheme;
  look?: MermaidLook;
  background?: string;
  tags?: string[];
  author?: string;
  scale?: number;
  focusInUi?: boolean;
  source?: CallerSource;
}

export interface UpdateChartInput {
  title?: string;
  code?: string;
  description?: string;
  theme?: MermaidTheme;
  look?: MermaidLook;
  background?: string;
  tags?: string[];
  author?: string;
  changeNote?: string;
  scale?: number;
  focusInUi?: boolean;
  source?: CallerSource;
}

export interface ChartOperationResult {
  chart: ChartRecord;
  svg: string | null;
  pngBytes: Uint8Array | null;
  studioUrl: string;
  pngUrl: string;
  svgUrl: string;
  durationMs: number;
}

export interface PreviewOperationResult extends RenderedDiagram {
  previewId: string;
  svgPath: string | null;
  pngPath: string | null;
  previewPngUrl: string | null;
  outputPath: string | null;
}

export interface ChartVisualInspection {
  chart: ChartRecord;
  versions: ChartVersionSummary[];
  selectedVersion: number;
  code: string;
  svg: string | null;
  pngBytes: Uint8Array | null;
  studioUrl: string;
  pngUrl: string;
  svgUrl: string;
}

export type ExportFormat = 'png' | 'svg' | 'mmd' | 'md';

export class StudioService {
  public readonly repo: ChartRepositoryPort;
  public readonly engine: RenderEnginePort;
  public readonly liveHub: RealtimeHubPort | null;
  public baseUrl: string;

  constructor(deps: {
    repo: ChartRepositoryPort;
    engine: RenderEnginePort;
    liveHub?: RealtimeHubPort | null;
    baseUrl?: string;
  }) {
    this.repo = deps.repo;
    this.engine = deps.engine;
    this.liveHub = deps.liveHub ?? null;
    this.baseUrl = resolveBaseUrl(deps.baseUrl);
  }

  private emitLive(type: LiveEventType, data: unknown, focusInUi = false): void {
    if (this.liveHub) {
      this.liveHub.broadcast(type, data, focusInUi);
      return;
    }

    fetch(`${this.baseUrl}/api/internal/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, data, focusInUi }),
      signal: AbortSignal.timeout(150),
    }).catch(() => {});
  }

  private logEvent(
    source: CallerSource | undefined,
    toolName: string,
    chartId: string | null,
    status: AgentEventRecord['status'],
    durationMs: number,
    summary: string
  ): void {
    if (!source || source === 'web') return;
    const recorded = this.repo.recordAgentEvent({
      toolName,
      source,
      chartId,
      status,
      durationMs,
      summary,
    });
    this.emitLive('agent:event', recorded, false);
  }

  buildUrls(id: string) {
    return {
      studioUrl: `${this.baseUrl}/?chart=${encodeURIComponent(id)}`,
      pngUrl: `${this.baseUrl}/api/charts/${encodeURIComponent(id)}/png`,
      svgUrl: `${this.baseUrl}/api/charts/${encodeURIComponent(id)}/svg`,
    };
  }

  async validate(code: string, source?: CallerSource): Promise<ValidationResult> {
    const res = await this.engine.validate(code);
    this.logEvent(
      source,
      'mermaid_validate',
      null,
      res.valid ? 'ok' : 'invalid',
      res.durationMs,
      res.valid
        ? `Valid ${res.diagramType ?? 'diagram'} (${res.warnings.length} warnings)`
        : `Syntax error${res.error?.line ? ` on line ${res.error.line}` : ''}: ${res.error?.message ?? 'invalid'}`
    );
    return res;
  }

  async renderPreview(
    code: string,
    options: RenderOptions & { outputPath?: string; source?: CallerSource } = {}
  ): Promise<PreviewOperationResult> {
    const res = await this.engine.render(code, options);
    const hash = crypto
      .createHash('sha1')
      .update(`${code}|${res.theme}|${res.look}|${res.background}`)
      .digest('hex')
      .slice(0, 12);
    const previewId = `preview-${hash}`;

    let svgPath: string | null = null;
    let pngPath: string | null = null;
    let savedOutputPath: string | null = null;

    if (res.valid) {
      const saved = this.repo.savePreviewArtifacts(previewId, res.svg, res.pngBytes);
      svgPath = saved.svgPath;
      pngPath = saved.pngPath;

      if (options.outputPath) {
        const absOut = path.resolve(options.outputPath);
        fs.mkdirSync(path.dirname(absOut), { recursive: true });
        if (absOut.toLowerCase().endsWith('.svg') && res.svg) {
          fs.writeFileSync(absOut, res.svg, 'utf8');
          savedOutputPath = absOut;
        } else if (res.pngBytes) {
          fs.writeFileSync(absOut, res.pngBytes);
          savedOutputPath = absOut;
        }
      }
    }

    const previewPngUrl = res.valid
      ? `${this.baseUrl}/api/previews/${encodeURIComponent(previewId)}.png`
      : null;

    this.logEvent(
      options.source,
      'mermaid_render_preview',
      null,
      res.valid ? 'ok' : 'invalid',
      res.durationMs,
      res.valid
        ? `Rendered ${res.diagramType ?? 'diagram'} (${res.dimensions?.width}×${res.dimensions?.height}px)`
        : `Render failed${res.error?.line ? ` on line ${res.error.line}` : ''}`
    );

    if (res.valid && options.source && options.source !== 'web') {
      this.emitLive(
        'preview:rendered',
        {
          previewId,
          diagramType: res.diagramType,
          dimensions: res.dimensions,
          previewPngUrl,
          source: options.source,
        },
        false
      );
    }

    return {
      ...res,
      previewId,
      svgPath,
      pngPath,
      previewPngUrl,
      outputPath: savedOutputPath,
    };
  }

  async createChart(input: CreateChartInput): Promise<ChartOperationResult> {
    const started = performance.now();
    const id = input.id ? slugify(input.id, 'chart') : generateChartId(input.title);
    const theme: MermaidTheme = input.theme ?? 'default';
    const look: MermaidLook = input.look ?? 'classic';
    const background = input.background ?? (theme === 'dark' ? '#191918' : '#ffffff');

    const rendered = await this.engine.render(input.code, {
      theme,
      look,
      background,
      scale: input.scale ?? 2,
    });

    const now = new Date().toISOString();
    const initialRecord: ChartRecord = {
      id,
      title: input.title.trim() || 'Untitled Diagram',
      description: (input.description ?? '').trim(),
      code: input.code,
      diagramType: rendered.diagramType,
      theme,
      look,
      background,
      tags: normalizeTags(input.tags),
      valid: rendered.valid,
      error: rendered.error,
      warnings: rendered.warnings,
      metrics: rendered.metrics,
      layoutDiagnostics: rendered.layoutDiagnostics,
      width: rendered.dimensions?.width ?? null,
      height: rendered.dimensions?.height ?? null,
      svgPath: null,
      pngPath: null,
      author: input.author ?? (input.source && input.source !== 'web' ? input.source : 'web'),
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const saved = this.repo.upsertChartWithVersion(
      initialRecord,
      { svg: rendered.svg, pngBytes: rendered.pngBytes },
      'Initial chart creation'
    );

    const durationMs = Math.round(performance.now() - started);
    this.logEvent(
      input.source,
      'mermaid_create_chart',
      saved.id,
      saved.valid ? 'ok' : 'invalid',
      durationMs,
      `Created "${saved.title}" (${saved.id}) — ${saved.valid ? `${saved.width}×${saved.height}px` : 'invalid syntax'}`
    );

    this.emitLive('chart:created', saved, input.focusInUi ?? true);

    return {
      chart: saved,
      svg: rendered.svg,
      pngBytes: rendered.pngBytes,
      ...this.buildUrls(saved.id),
      durationMs,
    };
  }

  async updateChart(id: string, patch: UpdateChartInput): Promise<ChartOperationResult> {
    const started = performance.now();
    const existing = this.repo.getChart(id);
    if (!existing) {
      throw new Error(`Chart not found: ${id}`);
    }

    const nextCode = patch.code ?? existing.code;
    const nextTheme: MermaidTheme = patch.theme ?? existing.theme;
    const nextLook: MermaidLook = patch.look ?? existing.look;
    const nextBg =
      patch.background ??
      (patch.theme && patch.theme !== existing.theme
        ? nextTheme === 'dark'
          ? '#191918'
          : '#ffffff'
        : existing.background);

    const needsRender =
      patch.code !== undefined ||
      patch.theme !== undefined ||
      patch.look !== undefined ||
      patch.background !== undefined ||
      !existing.pngPath ||
      !fs.existsSync(existing.pngPath);

    let svg: string | null =
      existing.svgPath && fs.existsSync(existing.svgPath)
        ? fs.readFileSync(existing.svgPath, 'utf8')
        : null;
    let pngBytes: Uint8Array | null =
      existing.pngPath && fs.existsSync(existing.pngPath)
        ? new Uint8Array(fs.readFileSync(existing.pngPath))
        : null;

    let diagramType = existing.diagramType;
    let valid = existing.valid;
    let error = existing.error;
    let warnings = existing.warnings;
    let metrics = existing.metrics;
    let layoutDiagnostics = existing.layoutDiagnostics;
    let width = existing.width;
    let height = existing.height;

    if (needsRender) {
      const rendered = await this.engine.render(nextCode, {
        theme: nextTheme,
        look: nextLook,
        background: nextBg,
        scale: patch.scale ?? 2,
      });
      svg = rendered.svg;
      pngBytes = rendered.pngBytes;
      diagramType = rendered.diagramType;
      valid = rendered.valid;
      error = rendered.error;
      warnings = rendered.warnings;
      metrics = rendered.metrics;
      layoutDiagnostics = rendered.layoutDiagnostics;
      width = rendered.dimensions?.width ?? null;
      height = rendered.dimensions?.height ?? null;
    }

    const codeOrVisualChanged =
      nextCode !== existing.code ||
      nextTheme !== existing.theme ||
      nextLook !== existing.look ||
      nextBg !== existing.background;

    const nextVersion = codeOrVisualChanged ? existing.version + 1 : existing.version;
    const now = new Date().toISOString();

    const updatedRecord: ChartRecord = {
      ...existing,
      title: patch.title !== undefined ? patch.title.trim() || existing.title : existing.title,
      description: patch.description !== undefined ? patch.description.trim() : existing.description,
      code: nextCode,
      diagramType,
      theme: nextTheme,
      look: nextLook,
      background: nextBg,
      tags: patch.tags !== undefined ? normalizeTags(patch.tags) : existing.tags,
      valid,
      error,
      warnings,
      metrics,
      layoutDiagnostics,
      width,
      height,
      author: patch.author ?? (patch.source && patch.source !== 'web' ? patch.source : existing.author),
      version: nextVersion,
      updatedAt: now,
    };

    const saved = this.repo.upsertChartWithVersion(
      updatedRecord,
      { svg, pngBytes },
      patch.changeNote ?? (codeOrVisualChanged ? `Updated to v${nextVersion}` : 'Metadata updated')
    );

    const durationMs = Math.round(performance.now() - started);
    this.logEvent(
      patch.source,
      'mermaid_update_chart',
      saved.id,
      saved.valid ? 'ok' : 'invalid',
      durationMs,
      `Updated "${saved.title}" to v${saved.version}${patch.changeNote ? ` (${patch.changeNote})` : ''}`
    );

    this.emitLive('chart:updated', saved, patch.focusInUi ?? true);

    return {
      chart: saved,
      svg,
      pngBytes,
      ...this.buildUrls(saved.id),
      durationMs,
    };
  }

  async getChartWithVisuals(
    id: string,
    opts?: { version?: number; source?: CallerSource }
  ): Promise<ChartVisualInspection> {
    const started = performance.now();
    const chart = this.repo.getChart(id);
    if (!chart) {
      throw new Error(`Chart not found: ${id}`);
    }

    const versions = this.repo.getChartVersions(id);
    let selectedVersion = chart.version;
    let code = chart.code;
    let svgPath = chart.svgPath;
    let pngPath = chart.pngPath;
    let theme = chart.theme;
    let look = chart.look;
    let background = chart.background;

    if (opts?.version !== undefined && opts.version !== chart.version) {
      const ver = this.repo.getChartVersionDetail(id, opts.version);
      if (!ver) {
        throw new Error(`Version ${opts.version} not found for chart ${id}`);
      }
      selectedVersion = ver.version;
      code = ver.code;
      svgPath = ver.svgPath;
      pngPath = ver.pngPath;
      theme = ver.theme;
      look = ver.look;
      background = ver.background;
    }

    let svg: string | null =
      svgPath && fs.existsSync(svgPath) ? fs.readFileSync(svgPath, 'utf8') : null;
    let pngBytes: Uint8Array | null =
      pngPath && fs.existsSync(pngPath) ? new Uint8Array(fs.readFileSync(pngPath)) : null;

    if ((!pngBytes || !svg) && chart.valid) {
      const rendered = await this.engine.render(code, { theme, look, background, scale: 2 });
      svg = rendered.svg;
      pngBytes = rendered.pngBytes;
    }

    const durationMs = Math.round(performance.now() - started);
    this.logEvent(
      opts?.source,
      'mermaid_see_chart',
      chart.id,
      chart.valid ? 'ok' : 'invalid',
      durationMs,
      `Inspected "${chart.title}" (v${selectedVersion})`
    );

    return {
      chart,
      versions,
      selectedVersion,
      code,
      svg,
      pngBytes,
      ...this.buildUrls(chart.id),
    };
  }

  listCharts(filter?: ChartListFilter, source?: CallerSource): ChartRecord[] {
    const started = performance.now();
    const charts = this.repo.listCharts(filter);
    this.logEvent(
      source,
      'mermaid_list_charts',
      null,
      'ok',
      Math.round(performance.now() - started),
      `Listed ${charts.length} chart(s)`
    );
    return charts;
  }

  deleteChart(id: string, source?: CallerSource): boolean {
    const started = performance.now();
    const existed = this.repo.deleteChart(id);
    if (existed) {
      this.emitLive('chart:deleted', { id }, false);
    }
    this.logEvent(
      source,
      'mermaid_delete_chart',
      id,
      existed ? 'ok' : 'error',
      Math.round(performance.now() - started),
      existed ? `Deleted chart ${id}` : `Chart ${id} not found`
    );
    return existed;
  }

  async exportChart(params: {
    id?: string;
    code?: string;
    outputPath: string;
    format?: ExportFormat;
    theme?: MermaidTheme;
    look?: MermaidLook;
    background?: string;
    scale?: number;
    source?: CallerSource;
  }): Promise<{
    outputPath: string;
    format: ExportFormat;
    bytes: number;
    dimensions: { width: number; height: number } | null;
  }> {
    const started = performance.now();
    const absOut = path.resolve(params.outputPath);
    const ext = path.extname(absOut).toLowerCase().replace('.', '');
    const format: ExportFormat =
      params.format ?? (ext === 'svg' || ext === 'mmd' || ext === 'md' ? ext : 'png');

    let sourceCode = params.code;
    let title = 'Mermaid Chart';
    let theme = params.theme;
    let look = params.look;
    let background = params.background;

    if (params.id) {
      const chart = this.repo.getChart(params.id);
      if (!chart) throw new Error(`Chart not found: ${params.id}`);
      sourceCode = sourceCode ?? chart.code;
      title = chart.title;
      theme = theme ?? chart.theme;
      look = look ?? chart.look;
      background = background ?? chart.background;
    }

    if (!sourceCode) {
      throw new Error('Provide either chart `id` or Mermaid `code` to export.');
    }

    fs.mkdirSync(path.dirname(absOut), { recursive: true });

    if (format === 'mmd') {
      fs.writeFileSync(absOut, sourceCode, 'utf8');
      const bytes = Buffer.byteLength(sourceCode, 'utf8');
      this.logEvent(
        params.source,
        'mermaid_export_chart',
        params.id ?? null,
        'ok',
        Math.round(performance.now() - started),
        `Exported .mmd to ${absOut}`
      );
      return { outputPath: absOut, format, bytes, dimensions: null };
    }

    if (format === 'md') {
      const md = `# ${title}\n\n\`\`\`mermaid\n${sourceCode.trim()}\n\`\`\`\n`;
      fs.writeFileSync(absOut, md, 'utf8');
      const bytes = Buffer.byteLength(md, 'utf8');
      this.logEvent(
        params.source,
        'mermaid_export_chart',
        params.id ?? null,
        'ok',
        Math.round(performance.now() - started),
        `Exported Markdown to ${absOut}`
      );
      return { outputPath: absOut, format, bytes, dimensions: null };
    }

    const rendered = await this.engine.render(sourceCode, {
      theme,
      look,
      background,
      scale: params.scale ?? 2,
    });

    if (!rendered.valid) {
      this.logEvent(
        params.source,
        'mermaid_export_chart',
        params.id ?? null,
        'invalid',
        Math.round(performance.now() - started),
        `Export failed: ${rendered.error?.message}`
      );
      throw new Error(
        `Cannot export invalid Mermaid chart${rendered.error?.line ? ` (line ${rendered.error.line})` : ''}: ${rendered.error?.message}`
      );
    }

    if (format === 'svg') {
      fs.writeFileSync(absOut, rendered.svg!, 'utf8');
      const bytes = Buffer.byteLength(rendered.svg!, 'utf8');
      this.logEvent(
        params.source,
        'mermaid_export_chart',
        params.id ?? null,
        'ok',
        Math.round(performance.now() - started),
        `Exported SVG to ${absOut}`
      );
      return {
        outputPath: absOut,
        format,
        bytes,
        dimensions: rendered.dimensions
          ? { width: rendered.dimensions.width, height: rendered.dimensions.height }
          : null,
      };
    }

    fs.writeFileSync(absOut, rendered.pngBytes!);
    const bytes = rendered.pngBytes!.byteLength;
    this.logEvent(
      params.source,
      'mermaid_export_chart',
      params.id ?? null,
      'ok',
      Math.round(performance.now() - started),
      `Exported PNG to ${absOut}`
    );
    return {
      outputPath: absOut,
      format: 'png',
      bytes,
      dimensions: rendered.dimensions
        ? { width: rendered.dimensions.width, height: rendered.dimensions.height }
        : null,
    };
  }

  listTemplates(): MermaidTemplate[] {
    return MERMAID_TEMPLATES;
  }

  syntaxGuide(topic?: string, source?: CallerSource): string {
    const guide = getSyntaxGuide(topic);
    this.logEvent(source, 'mermaid_syntax_guide', null, 'ok', 1, `Fetched syntax guide (${topic || 'all'})`);
    return guide;
  }

  async seedStarterChartsIfEmpty(): Promise<void> {
    if (this.repo.countCharts() > 0) return;

    const starters = [...MERMAID_TEMPLATES.slice(0, 3)].reverse();
    for (const tpl of starters) {
      await this.createChart({
        id: tpl.id,
        title: tpl.name,
        description: tpl.description,
        code: tpl.code,
        theme: tpl.theme ?? 'default',
        look: tpl.look ?? 'classic',
        tags: [tpl.category.toLowerCase(), 'starter'],
        author: 'studio-seed',
        focusInUi: false,
      });
    }
  }
}

function generateChartId(title: string): string {
  const base = slugify(title, 'chart').slice(0, 36);
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${base}-${suffix}`;
}

function normalizeTags(tags?: string[]): string[] {
  if (!Array.isArray(tags)) return [];
  const uniq = new Set<string>();
  for (const tag of tags) {
    const clean = String(tag).trim().toLowerCase();
    if (clean) uniq.add(clean);
  }
  return Array.from(uniq).slice(0, 12);
}
