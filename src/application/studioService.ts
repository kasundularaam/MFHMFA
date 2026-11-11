import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { resolveBaseUrl } from '../config/env.js';
import { getSyntaxGuide, MERMAID_TEMPLATES } from '../domain/catalog.js';
import type { RenderEnginePort } from '../domain/ports.js';
import type {
  CallerSource,
  MermaidLook,
  MermaidTemplate,
  MermaidTheme,
  RenderEngineStats,
  RenderOptions,
  RenderedDiagram,
  ValidationResult,
} from '../shared/types.js';

export interface StatelessRenderInput extends RenderOptions {
  title?: string;
  outputPath?: string;
  source?: CallerSource;
}

export interface StatelessRenderResult extends RenderedDiagram {
  renderId: string;
  title: string;
  outputPath: string | null;
}

export type ExportFormat = 'png' | 'svg' | 'mmd' | 'md';

export class StudioService {
  public readonly engine: RenderEnginePort;
  public baseUrl: string;

  constructor(deps: { engine: RenderEnginePort; baseUrl?: string }) {
    this.engine = deps.engine;
    this.baseUrl = resolveBaseUrl(deps.baseUrl);
  }

  getEngineStats(): RenderEngineStats | null {
    return this.engine.getStats ? this.engine.getStats() : null;
  }

  async validate(code: string, _source?: CallerSource): Promise<ValidationResult> {
    return this.engine.validate(code);
  }

  async render(code: string, options: StatelessRenderInput = {}): Promise<StatelessRenderResult> {
    const res = await this.engine.render(code, options);
    const hash = crypto
      .createHash('sha1')
      .update(`${code}|${res.theme}|${res.look}|${res.background}`)
      .digest('hex')
      .slice(0, 10);
    const renderId = `render-${hash}-${crypto.randomBytes(2).toString('hex')}`;
    const title = options.title?.trim() || inferDiagramTitle(code, res.diagramType);

    let savedOutputPath: string | null = null;

    if (res.valid && options.outputPath) {
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

    return {
      ...res,
      renderId,
      title,
      outputPath: savedOutputPath,
    };
  }

  async exportDiagram(params: {
    code: string;
    outputPath: string;
    title?: string;
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
    const sourceCode = params.code;
    if (!sourceCode || !sourceCode.trim()) {
      throw new Error('Non-empty Mermaid `code` is required to export.');
    }

    const absOut = path.resolve(params.outputPath);
    const ext = path.extname(absOut).toLowerCase().replace('.', '');
    const format: ExportFormat =
      params.format ?? (ext === 'svg' || ext === 'mmd' || ext === 'md' ? ext : 'png');
    const title = params.title?.trim() || inferDiagramTitle(sourceCode, null);

    fs.mkdirSync(path.dirname(absOut), { recursive: true });

    if (format === 'mmd') {
      fs.writeFileSync(absOut, sourceCode, 'utf8');
      const bytes = Buffer.byteLength(sourceCode, 'utf8');
      return { outputPath: absOut, format, bytes, dimensions: null };
    }

    if (format === 'md') {
      const md = `# ${title}\n\n\`\`\`mermaid\n${sourceCode.trim()}\n\`\`\`\n`;
      fs.writeFileSync(absOut, md, 'utf8');
      const bytes = Buffer.byteLength(md, 'utf8');
      return { outputPath: absOut, format, bytes, dimensions: null };
    }

    const rendered = await this.engine.render(sourceCode, {
      theme: params.theme,
      look: params.look,
      background: params.background,
      scale: params.scale ?? 2,
    });

    if (!rendered.valid) {
      throw new Error(
        `Cannot export invalid Mermaid chart${rendered.error?.line ? ` (line ${rendered.error.line})` : ''}: ${rendered.error?.message}`
      );
    }

    if (format === 'svg') {
      fs.writeFileSync(absOut, rendered.svg!, 'utf8');
      const bytes = Buffer.byteLength(rendered.svg!, 'utf8');
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

  getTemplate(id: string): MermaidTemplate | null {
    return MERMAID_TEMPLATES.find((t) => t.id === id) ?? null;
  }

  syntaxGuide(topic?: string, _source?: CallerSource): string {
    return getSyntaxGuide(topic);
  }
}

function inferDiagramTitle(code: string, diagramType: string | null): string {
  const titleMatch = code.match(/^\s*title\s+(.+)$/m);
  if (titleMatch?.[1]) {
    return titleMatch[1].replace(/^["']|["']$/g, '').trim();
  }
  const subMatch = code.match(/subgraph\s+\w+\["([^"]+)"\]/);
  if (subMatch?.[1]) {
    return subMatch[1].trim();
  }
  if (diagramType) {
    return `${diagramType} diagram`;
  }
  const firstLine = code.trim().split('\n')[0]?.trim() || 'Mermaid';
  return `${firstLine.split(/\s+/)[0]} diagram`;
}
