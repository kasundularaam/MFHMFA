import type {
  AgentEventRecord,
  ChartRecord,
  ChartVersionSummary,
  LiveEventType,
  RenderOptions,
  RenderedDiagram,
  ValidationResult,
} from '../shared/types.js';

export interface RenderEnginePort {
  validate(code: string): Promise<ValidationResult>;
  render(code: string, options?: RenderOptions): Promise<RenderedDiagram>;
  dispose(): Promise<void>;
}

export interface ChartListFilter {
  search?: string;
  tag?: string;
  diagramType?: string;
  limit?: number;
}

export interface VersionArtifacts {
  svg: string | null;
  pngBytes: Uint8Array | null;
}

export interface ChartVersionDetail extends ChartVersionSummary {
  svgPath: string | null;
  pngPath: string | null;
}

export interface ChartRepositoryPort {
  readonly dataDir: string;
  readonly rendersDir: string;
  readonly previewsDir: string;

  countCharts(): number;
  listCharts(filter?: ChartListFilter): ChartRecord[];
  getChart(id: string): ChartRecord | null;
  upsertChartWithVersion(
    record: ChartRecord,
    artifacts: VersionArtifacts,
    changeNote?: string | null
  ): ChartRecord;
  getChartVersions(chartId: string): ChartVersionSummary[];
  getChartVersionDetail(chartId: string, version: number): ChartVersionDetail | null;
  deleteChart(id: string): boolean;

  savePreviewArtifacts(
    previewId: string,
    svg: string | null,
    pngBytes: Uint8Array | null
  ): { svgPath: string | null; pngPath: string | null };

  recordAgentEvent(event: Omit<AgentEventRecord, 'id' | 'createdAt'>): AgentEventRecord;
  listAgentEvents(limit?: number): AgentEventRecord[];

  close(): void;
}

export interface RealtimeHubPort {
  broadcast(type: LiveEventType, data: unknown, focusInUi?: boolean): void;
  clientCount(): number;
  close(): void;
}
