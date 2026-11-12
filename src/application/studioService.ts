import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { resolveBaseUrl } from '../config/env.js';
import { getSyntaxGuide, MERMAID_TEMPLATES } from '../domain/catalog.js';
import type {
  RenderEnginePort,
  WorkspaceEventListener,
  WorkspaceRelayPort,
} from '../domain/ports.js';
import {
  StatelessWorkspaceRelay,
  sanitizeWorkspaceToken,
} from '../infrastructure/ephemeral/workspaceRelay.js';
import { normalizeAgentIdentity, normalizeProjectName } from '../shared/agentIdentity.js';
import { sanitizeComprehensionGuide } from '../shared/comprehension.js';
import type {
  AgentSessionInfo,
  CallerSource,
  DiagramComprehensionGuide,
  DiagramRelayPayload,
  MermaidLook,
  MermaidTemplate,
  MermaidTheme,
  RelayStats,
  RenderEngineStats,
  RenderOptions,
  RenderedDiagram,
  ValidationResult,
  VfsLsResult,
  VfsMoveResult,
  VfsReadResult,
  VfsRpcQuery,
  VfsRpcReply,
  VfsRpcResultMap,
  WorkspaceRelayEvent,
} from '../shared/types.js';
import {
  graphTitleFromPath,
  inferPathFromTitle,
  normalizeRelativeDirPath,
  normalizeRelativeGraphPath,
} from '../shared/vfsPath.js';

export type VfsRpcBridgeFn = <Q extends VfsRpcQuery>(
  query: Q
) => Promise<VfsRpcResultMap[Q['op']]>;

export interface StatelessRenderInput extends RenderOptions {
  path?: string;
  title?: string;
  guide?: DiagramComprehensionGuide;
  project?: string | null;
  agentName?: string | null;
  agentSessionId?: string | null;
  outputPath?: string;
  allowLocalDiskWrite?: boolean;
  source?: CallerSource;
  workspaceToken?: string | null;
  relayBridge?: (diagram: DiagramRelayPayload) => Promise<number>;
}

export interface StatelessRenderResult extends RenderedDiagram {
  renderId: string;
  path: string;
  title: string;
  guide?: DiagramComprehensionGuide;
  project: string;
  agent: string;
  outputPath: string | null;
  syncedSubscribers: number;
}

export type ExportFormat = 'png' | 'svg' | 'mmd' | 'md';

const REMOTE_DISK_WRITE_ERROR =
  'Server-side disk writes are disabled on remote/hosted endpoints (MFHMFA stores 0 files on the server). Run via local mcp-stdio or export PNG/SVG from the MFHMFA Studio browser UI.';

export class StudioService {
  public readonly engine: RenderEnginePort;
  public readonly relay: WorkspaceRelayPort;
  public baseUrl: string;

  constructor(deps: {
    engine: RenderEnginePort;
    relay?: WorkspaceRelayPort;
    baseUrl?: string;
  }) {
    this.engine = deps.engine;
    this.relay = deps.relay ?? new StatelessWorkspaceRelay();
    this.baseUrl = resolveBaseUrl(deps.baseUrl);
  }

  getEngineStats(): RenderEngineStats | null {
    return this.engine.getStats ? this.engine.getStats() : null;
  }

  getRelayStats(): RelayStats {
    return this.relay.getStats();
  }

  publishEvent(workspaceToken: string, event: WorkspaceRelayEvent): number {
    const clean = sanitizeWorkspaceToken(workspaceToken);
    if (!clean) return 0;
    return this.relay.publish(clean, event);
  }

  publishAgentStatus(
    workspaceToken: string | null | undefined,
    agent: AgentSessionInfo
  ): number {
    const clean = sanitizeWorkspaceToken(workspaceToken);
    if (!clean) return 0;
    return this.relay.publish(clean, { type: 'agent_status', agent });
  }

  subscribeWorkspace(
    token: string,
    listener: WorkspaceEventListener,
    onClose?: () => void
  ): (() => void) | null {
    return this.relay.subscribe(token, listener, onClose);
  }

  getWorkspaceSubscriberCount(token: string): number {
    return this.relay.getSubscriberCount(token);
  }

  resolveVfsReply(workspaceToken: string, reply: VfsRpcReply): boolean {
    return this.relay.resolveVfsReply(workspaceToken, reply);
  }

  async queryVfs<Q extends VfsRpcQuery>(
    workspaceToken: string | null | undefined,
    query: Q,
    vfsBridge?: VfsRpcBridgeFn
  ): Promise<VfsRpcResultMap[Q['op']]> {
    if (vfsBridge) {
      return vfsBridge(query);
    }
    return this.relay.requestVfs(workspaceToken ?? '', query);
  }

  async vfsLs(params: {
    workspaceToken: string | null | undefined;
    project: string;
    dirPath?: string;
    vfsBridge?: VfsRpcBridgeFn;
  }): Promise<VfsLsResult> {
    const project = normalizeProjectName(params.project) || 'General';
    const dirPath = normalizeRelativeDirPath(params.dirPath);
    return this.queryVfs(
      params.workspaceToken,
      { op: 'ls', project, dirPath },
      params.vfsBridge
    );
  }

  async vfsRead(params: {
    workspaceToken: string | null | undefined;
    project: string;
    filePath: string;
    version?: number;
    vfsBridge?: VfsRpcBridgeFn;
  }): Promise<VfsReadResult> {
    const project = normalizeProjectName(params.project) || 'General';
    const filePath = normalizeRelativeGraphPath(params.filePath);
    return this.queryVfs(
      params.workspaceToken,
      {
        op: 'read',
        project,
        filePath,
        ...(typeof params.version === 'number' ? { version: params.version } : {}),
      },
      params.vfsBridge
    );
  }

  async vfsMove(params: {
    workspaceToken: string | null | undefined;
    project: string;
    fromPath: string;
    toPath: string;
    vfsBridge?: VfsRpcBridgeFn;
  }): Promise<VfsMoveResult> {
    const project = normalizeProjectName(params.project) || 'General';
    const fromHasExt = /\.(mmd|mermaid)$/i.test(params.fromPath.trim());
    const toHasExt = /\.(mmd|mermaid)$/i.test(params.toPath.trim());
    const fromClean = fromHasExt
      ? normalizeRelativeGraphPath(params.fromPath)
      : normalizeRelativeDirPath(params.fromPath);
    const toClean = toHasExt
      ? normalizeRelativeGraphPath(params.toPath)
      : normalizeRelativeDirPath(params.toPath);

    if (!fromClean || !toClean) {
      throw new Error('Both `from` and `to` paths within the working directory are required.');
    }

    return this.queryVfs(
      params.workspaceToken,
      { op: 'mv', project, fromPath: fromClean, toPath: toClean },
      params.vfsBridge
    );
  }

  async validate(code: string, _source?: CallerSource): Promise<ValidationResult> {
    return this.engine.validate(code);
  }

  async render(
    code: string,
    options: StatelessRenderInput = {}
  ): Promise<StatelessRenderResult> {
    if (options.outputPath && !options.allowLocalDiskWrite) {
      throw new Error(REMOTE_DISK_WRITE_ERROR);
    }

    const explicitRelPath = options.path?.trim()
      ? normalizeRelativeGraphPath(options.path)
      : null;
    const cleanGuide = sanitizeComprehensionGuide(options.guide);

    const res = await this.engine.render(code, options);
    const hash = crypto
      .createHash('sha1')
      .update(`${code}|${res.theme}|${res.look}|${res.background}`)
      .digest('hex')
      .slice(0, 10);
    const renderId = `render-${hash}-${crypto.randomBytes(2).toString('hex')}`;

    const inferredTitle = inferDiagramTitle(code, res.diagramType);
    const relPath =
      explicitRelPath ?? inferPathFromTitle(options.title?.trim() || inferredTitle);
    const title = options.title?.trim() || graphTitleFromPath(relPath);
    const agent = normalizeAgentIdentity(options.agentName, options.source);
    const project = normalizeProjectName(options.project) || 'General';

    let savedOutputPath: string | null = null;

    if (res.valid && options.outputPath && options.allowLocalDiskWrite) {
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

    let syncedSubscribers = 0;

    if (res.valid) {
      const diagramPayload: DiagramRelayPayload = {
        renderId,
        path: relPath,
        title,
        code,
        ...(cleanGuide ? { guide: cleanGuide } : {}),
        diagramType: res.diagramType,
        theme: res.theme,
        look: res.look,
        project,
        agentSessionId: options.agentSessionId ?? null,
        agentSlug: agent.slug,
        agentLabel: agent.label,
        agentShortLabel: agent.shortLabel,
        timestamp: Date.now(),
      };

      if (options.relayBridge) {
        syncedSubscribers = await options.relayBridge(diagramPayload);
      } else {
        const cleanWs = sanitizeWorkspaceToken(options.workspaceToken);
        if (cleanWs && options.source !== 'web') {
          syncedSubscribers = this.relay.publish(cleanWs, {
            type: 'diagram',
            diagram: diagramPayload,
          });
        }
      }
    }

    return {
      ...res,
      renderId,
      path: relPath,
      title,
      ...(cleanGuide ? { guide: cleanGuide } : {}),
      project,
      agent: agent.label,
      outputPath: savedOutputPath,
      syncedSubscribers,
    };
  }

  async exportDiagram(params: {
    code: string;
    outputPath: string;
    allowLocalDiskWrite?: boolean;
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
    if (!params.allowLocalDiskWrite) {
      throw new Error(REMOTE_DISK_WRITE_ERROR);
    }

    const sourceCode = params.code;
    if (!sourceCode?.trim()) {
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

export function inferDiagramTitle(code: string, diagramType: string | null): string {
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
