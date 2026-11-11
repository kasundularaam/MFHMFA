import type {
  DiagramDimensions,
  DiagramMetrics,
  LintWarning,
  MermaidLook,
  MermaidTheme,
  ParseErrorDetail,
  PreviewHubStats,
  PreviewSnapshot,
  RenderEngineStats,
  ValidationResult,
} from '../../src/shared/types';

export interface ServerStatus {
  ok: boolean;
  stateless: boolean;
  name: string;
  version: string;
  repoUrl: string;
  baseUrl: string;
  mcpHttpSessions: number;
  engine: RenderEngineStats | null;
  previews: PreviewHubStats;
  connections: {
    mcpStreamableHttp: string;
    mcpLegacySse: string;
    mcpStdioCommand: string;
    mcpStdioArgs: string[];
    projectRoot: string;
    toolSchemasUrl: string;
    toolCallUrl: string;
  };
}

export interface StatelessRenderResponse {
  renderId: string;
  previewId: string | null;
  studioUrl: string | null;
  liveUrl: string | null;
  title: string;
  valid: boolean;
  diagramType: string | null;
  theme: MermaidTheme;
  look: MermaidLook;
  background: string;
  dimensions: DiagramDimensions | null;
  metrics: DiagramMetrics | null;
  layoutDiagnostics: string[];
  warnings: LintWarning[];
  error: ParseErrorDetail | null;
  durationMs: number;
  svg: string | null;
  pngDataUrl: string | null;
}

export interface PreviewSnapshotResponse extends PreviewSnapshot {
  liveUrl: string | null;
  sessionTabs: PreviewSnapshot[];
}

export interface LiveSessionResponse {
  token: string;
  latest: PreviewSnapshot | null;
  tabs: PreviewSnapshot[];
  subscriberCount: number;
}


async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return data;
}

export const studioApi = {
  getStatus: () => requestJson<ServerStatus>('/api/status'),

  validate: (code: string) =>
    requestJson<ValidationResult>('/api/validate', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  renderServer: (payload: {
    code: string;
    title?: string;
    theme: MermaidTheme;
    look: MermaidLook;
    background: string;
    includePngBase64?: boolean;
  }) =>
    requestJson<StatelessRenderResponse>('/api/render', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getPreview: (id: string) =>
    requestJson<PreviewSnapshotResponse>(`/api/preview/${encodeURIComponent(id)}`),

  getLiveSession: (token: string) =>
    requestJson<LiveSessionResponse>(`/api/live/${encodeURIComponent(token)}`),
};
