import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { resolveDataDir } from '../../config/env.js';
import type {
  ChartListFilter,
  ChartRepositoryPort,
  ChartVersionDetail,
  VersionArtifacts,
} from '../../domain/ports.js';
import type {
  AgentEventRecord,
  CallerSource,
  ChartRecord,
  ChartVersionSummary,
  DiagramMetrics,
  LintWarning,
  MermaidLook,
  MermaidTheme,
  ParseErrorDetail,
} from '../../shared/types.js';

const SCHEMA_SQL = `
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS charts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    code TEXT NOT NULL,
    diagram_type TEXT,
    theme TEXT NOT NULL DEFAULT 'default',
    look TEXT NOT NULL DEFAULT 'classic',
    background TEXT NOT NULL DEFAULT '#ffffff',
    tags_json TEXT NOT NULL DEFAULT '[]',
    valid INTEGER NOT NULL DEFAULT 1,
    error_json TEXT,
    warnings_json TEXT NOT NULL DEFAULT '[]',
    metrics_json TEXT,
    layout_diagnostics_json TEXT NOT NULL DEFAULT '[]',
    width INTEGER,
    height INTEGER,
    svg_path TEXT,
    png_path TEXT,
    author TEXT NOT NULL DEFAULT 'web',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chart_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chart_id TEXT NOT NULL REFERENCES charts(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    code TEXT NOT NULL,
    theme TEXT NOT NULL,
    look TEXT NOT NULL,
    background TEXT NOT NULL,
    valid INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    svg_path TEXT,
    png_path TEXT,
    author TEXT NOT NULL,
    change_note TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(chart_id, version)
  );

  CREATE TABLE IF NOT EXISTS agent_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_name TEXT NOT NULL,
    source TEXT NOT NULL,
    chart_id TEXT,
    status TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`;

export class SqliteChartRepository implements ChartRepositoryPort {
  public readonly dataDir: string;
  public readonly rendersDir: string;
  public readonly previewsDir: string;
  private readonly db: DatabaseSync;

  constructor(dataDir?: string) {
    this.dataDir = resolveDataDir(dataDir);
    this.rendersDir = path.join(this.dataDir, 'renders');
    this.previewsDir = path.join(this.rendersDir, 'previews');

    const dbPath = path.join(this.dataDir, 'studio.db');
    this.db = new DatabaseSync(dbPath);
    this.db.exec(SCHEMA_SQL);
  }

  private resolveRenderFile(rawPath: unknown): string | null {
    if (typeof rawPath !== 'string' || !rawPath) return null;
    if (fs.existsSync(rawPath)) return rawPath;
    return path.join(this.rendersDir, path.basename(rawPath));
  }

  private mapChartRow(row: Record<string, unknown>): ChartRecord {
    return {
      id: String(row.id),
      title: String(row.title),
      description: String(row.description ?? ''),
      code: String(row.code),
      diagramType: row.diagram_type ? String(row.diagram_type) : null,
      theme: (row.theme as MermaidTheme) || 'default',
      look: (row.look as MermaidLook) || 'classic',
      background: String(row.background || '#ffffff'),
      tags: safeParseJson<string[]>(row.tags_json, []),
      valid: Boolean(row.valid),
      error: safeParseJson<ParseErrorDetail | null>(row.error_json, null),
      warnings: safeParseJson<LintWarning[]>(row.warnings_json, []),
      metrics: safeParseJson<DiagramMetrics | null>(row.metrics_json, null),
      layoutDiagnostics: safeParseJson<string[]>(row.layout_diagnostics_json, []),
      width: typeof row.width === 'number' ? row.width : null,
      height: typeof row.height === 'number' ? row.height : null,
      svgPath: this.resolveRenderFile(row.svg_path),
      pngPath: this.resolveRenderFile(row.png_path),
      author: String(row.author || 'web'),
      version: Number(row.version || 1),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  countCharts(): number {
    const row = this.db.prepare('SELECT COUNT(*) as c FROM charts').get() as
      | { c: number }
      | undefined;
    return Number(row?.c ?? 0);
  }

  listCharts(filter?: ChartListFilter): ChartRecord[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (filter?.search) {
      clauses.push('(title LIKE ? OR description LIKE ? OR code LIKE ? OR id LIKE ?)');
      const q = `%${filter.search}%`;
      params.push(q, q, q, q);
    }
    if (filter?.diagramType) {
      clauses.push('diagram_type = ?');
      params.push(filter.diagramType);
    }
    if (filter?.tag) {
      clauses.push('tags_json LIKE ?');
      params.push(`%"${filter.tag}"%`);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.min(200, Math.max(1, filter?.limit ?? 100));
    params.push(limit);

    const rows = this.db
      .prepare(`SELECT * FROM charts ${where} ORDER BY updated_at DESC LIMIT ?`)
      .all(...params) as Array<Record<string, unknown>>;

    return rows.map((r) => this.mapChartRow(r));
  }

  getChart(id: string): ChartRecord | null {
    const row = this.db.prepare('SELECT * FROM charts WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapChartRow(row) : null;
  }

  upsertChartWithVersion(
    record: ChartRecord,
    artifacts: VersionArtifacts,
    changeNote?: string | null
  ): ChartRecord {
    let svgPath: string | null = record.svgPath;
    let pngPath: string | null = record.pngPath;
    let verSvgPath: string | null = null;
    let verPngPath: string | null = null;

    if (artifacts.svg) {
      svgPath = path.join(this.rendersDir, `${record.id}.svg`);
      verSvgPath = path.join(this.rendersDir, `${record.id}.v${record.version}.svg`);
      fs.writeFileSync(svgPath, artifacts.svg, 'utf8');
      fs.writeFileSync(verSvgPath, artifacts.svg, 'utf8');
    }

    if (artifacts.pngBytes) {
      pngPath = path.join(this.rendersDir, `${record.id}.png`);
      verPngPath = path.join(this.rendersDir, `${record.id}.v${record.version}.png`);
      fs.writeFileSync(pngPath, artifacts.pngBytes);
      fs.writeFileSync(verPngPath, artifacts.pngBytes);
    }

    const updatedRecord: ChartRecord = {
      ...record,
      svgPath,
      pngPath,
    };

    this.db
      .prepare(`
        INSERT INTO charts (
          id, title, description, code, diagram_type, theme, look, background,
          tags_json, valid, error_json, warnings_json, metrics_json, layout_diagnostics_json,
          width, height, svg_path, png_path, author, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          description = excluded.description,
          code = excluded.code,
          diagram_type = excluded.diagram_type,
          theme = excluded.theme,
          look = excluded.look,
          background = excluded.background,
          tags_json = excluded.tags_json,
          valid = excluded.valid,
          error_json = excluded.error_json,
          warnings_json = excluded.warnings_json,
          metrics_json = excluded.metrics_json,
          layout_diagnostics_json = excluded.layout_diagnostics_json,
          width = excluded.width,
          height = excluded.height,
          svg_path = excluded.svg_path,
          png_path = excluded.png_path,
          author = excluded.author,
          version = excluded.version,
          updated_at = excluded.updated_at
      `)
      .run(
        updatedRecord.id,
        updatedRecord.title,
        updatedRecord.description,
        updatedRecord.code,
        updatedRecord.diagramType,
        updatedRecord.theme,
        updatedRecord.look,
        updatedRecord.background,
        JSON.stringify(updatedRecord.tags),
        updatedRecord.valid ? 1 : 0,
        updatedRecord.error ? JSON.stringify(updatedRecord.error) : null,
        JSON.stringify(updatedRecord.warnings),
        updatedRecord.metrics ? JSON.stringify(updatedRecord.metrics) : null,
        JSON.stringify(updatedRecord.layoutDiagnostics),
        updatedRecord.width,
        updatedRecord.height,
        updatedRecord.svgPath,
        updatedRecord.pngPath,
        updatedRecord.author,
        updatedRecord.version,
        updatedRecord.createdAt,
        updatedRecord.updatedAt
      );

    this.db
      .prepare(`
        INSERT OR REPLACE INTO chart_versions (
          chart_id, version, code, theme, look, background,
          valid, width, height, svg_path, png_path, author, change_note, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        updatedRecord.id,
        updatedRecord.version,
        updatedRecord.code,
        updatedRecord.theme,
        updatedRecord.look,
        updatedRecord.background,
        updatedRecord.valid ? 1 : 0,
        updatedRecord.width,
        updatedRecord.height,
        verSvgPath,
        verPngPath,
        updatedRecord.author,
        changeNote ?? null,
        updatedRecord.updatedAt
      );

    return updatedRecord;
  }

  getChartVersions(chartId: string): ChartVersionSummary[] {
    const rows = this.db
      .prepare('SELECT * FROM chart_versions WHERE chart_id = ? ORDER BY version DESC')
      .all(chartId) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      version: Number(r.version),
      code: String(r.code),
      theme: (r.theme as MermaidTheme) || 'default',
      look: (r.look as MermaidLook) || 'classic',
      background: String(r.background || '#ffffff'),
      valid: Boolean(r.valid),
      width: typeof r.width === 'number' ? r.width : null,
      height: typeof r.height === 'number' ? r.height : null,
      author: String(r.author || 'web'),
      changeNote: r.change_note ? String(r.change_note) : null,
      createdAt: String(r.created_at),
    }));
  }

  getChartVersionDetail(chartId: string, version: number): ChartVersionDetail | null {
    const r = this.db
      .prepare('SELECT * FROM chart_versions WHERE chart_id = ? AND version = ?')
      .get(chartId, version) as Record<string, unknown> | undefined;
    if (!r) return null;

    return {
      version: Number(r.version),
      code: String(r.code),
      theme: (r.theme as MermaidTheme) || 'default',
      look: (r.look as MermaidLook) || 'classic',
      background: String(r.background || '#ffffff'),
      valid: Boolean(r.valid),
      width: typeof r.width === 'number' ? r.width : null,
      height: typeof r.height === 'number' ? r.height : null,
      svgPath: this.resolveRenderFile(r.svg_path),
      pngPath: this.resolveRenderFile(r.png_path),
      author: String(r.author || 'web'),
      changeNote: r.change_note ? String(r.change_note) : null,
      createdAt: String(r.created_at),
    };
  }

  deleteChart(id: string): boolean {
    const existing = this.getChart(id);
    if (!existing) return false;

    this.db.prepare('DELETE FROM charts WHERE id = ?').run(id);

    try {
      const files = fs.readdirSync(this.rendersDir);
      for (const file of files) {
        if (file === `${id}.svg` || file === `${id}.png` || file.startsWith(`${id}.v`)) {
          fs.unlinkSync(path.join(this.rendersDir, file));
        }
      }
    } catch {
      // Ignore file removal race conditions
    }
    return true;
  }

  savePreviewArtifacts(
    previewId: string,
    svg: string | null,
    pngBytes: Uint8Array | null
  ): { svgPath: string | null; pngPath: string | null } {
    let svgPath: string | null = null;
    let pngPath: string | null = null;

    if (svg) {
      svgPath = path.join(this.previewsDir, `${previewId}.svg`);
      fs.writeFileSync(svgPath, svg, 'utf8');
    }
    if (pngBytes) {
      pngPath = path.join(this.previewsDir, `${previewId}.png`);
      fs.writeFileSync(pngPath, pngBytes);
    }

    return { svgPath, pngPath };
  }

  recordAgentEvent(event: Omit<AgentEventRecord, 'id' | 'createdAt'>): AgentEventRecord {
    const createdAt = new Date().toISOString();
    const info = this.db
      .prepare(`
        INSERT INTO agent_events (tool_name, source, chart_id, status, duration_ms, summary, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        event.toolName,
        event.source,
        event.chartId,
        event.status,
        event.durationMs,
        event.summary,
        createdAt
      );

    this.db.exec(`
      DELETE FROM agent_events
      WHERE id NOT IN (SELECT id FROM agent_events ORDER BY id DESC LIMIT 500)
    `);

    return {
      id: Number(info.lastInsertRowid),
      ...event,
      createdAt,
    };
  }

  listAgentEvents(limit = 50): AgentEventRecord[] {
    const safeLimit = Math.min(200, Math.max(1, limit));
    const rows = this.db
      .prepare('SELECT * FROM agent_events ORDER BY id DESC LIMIT ?')
      .all(safeLimit) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: Number(r.id),
      toolName: String(r.tool_name),
      source: r.source as CallerSource,
      chartId: r.chart_id ? String(r.chart_id) : null,
      status: r.status as AgentEventRecord['status'],
      durationMs: Number(r.duration_ms),
      summary: String(r.summary),
      createdAt: String(r.created_at),
    }));
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // Ignore already-closed DB
    }
  }
}

function safeParseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
