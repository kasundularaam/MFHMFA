import type {
  AgentEventRecord,
  ChartRecord,
  ChartVersionSummary,
  DiagramDimensions,
  DiagramMetrics,
  LintWarning,
  LiveEventPayload,
  MermaidLook,
  MermaidTemplate,
  MermaidTheme,
  ParseErrorDetail,
  ValidationResult,
} from '../../src/shared/types';

export interface ServerStatus {
  ok: boolean;
  name: string;
  version: string;
  baseUrl: string;
  chartCount: number;
  wsClients: number;
  mcpHttpSessions: number;
  connections: {
    mcpStreamableHttp: string;
    mcpLegacySse: string;
    mcpStdioCommand: string;
    mcpStdioArgs: string[];
    cliExecutable: string;
    projectRoot: string;
    toolSchemasUrl: string;
    toolCallUrl: string;
  };
}

export interface ChartDetailResponse {
  chart: ChartRecord;
  selectedVersion: number;
  code: string;
  svg: string | null;
  versions: ChartVersionSummary[];
  studioUrl: string;
  pngUrl: string;
  svgUrl: string;
}

export interface StatelessRenderResponse {
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

  listCharts: (search?: string) =>
    requestJson<{ charts: ChartRecord[] }>(
      `/api/charts${search ? `?search=${encodeURIComponent(search)}` : ''}`
    ),

  getChart: (id: string, version?: number) =>
    requestJson<ChartDetailResponse>(
      `/api/charts/${encodeURIComponent(id)}${version ? `?version=${version}` : ''}`
    ),

  createChart: (payload: {
    title: string;
    code: string;
    description?: string;
    theme?: MermaidTheme;
    look?: MermaidLook;
    background?: string;
    tags?: string[];
  }) =>
    requestJson<{
      chart: ChartRecord;
      svg: string | null;
      studioUrl: string;
      pngUrl: string;
      svgUrl: string;
    }>('/api/charts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateChart: (
    id: string,
    payload: {
      title?: string;
      code?: string;
      description?: string;
      theme?: MermaidTheme;
      look?: MermaidLook;
      background?: string;
      tags?: string[];
      changeNote?: string;
    }
  ) =>
    requestJson<{
      chart: ChartRecord;
      svg: string | null;
      studioUrl: string;
      pngUrl: string;
      svgUrl: string;
    }>(`/api/charts/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteChart: (id: string) =>
    requestJson<{ deleted: boolean; id: string }>(`/api/charts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  validate: (code: string) =>
    requestJson<ValidationResult>('/api/validate', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  renderServer: (payload: {
    code: string;
    theme: MermaidTheme;
    look: MermaidLook;
    background: string;
    includePngBase64?: boolean;
  }) =>
    requestJson<StatelessRenderResponse>('/api/render', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listTemplates: () => requestJson<{ templates: MermaidTemplate[] }>('/api/templates'),

  getGuide: (topic = 'all') =>
    requestJson<{ topic: string; guide: string }>(
      `/api/guides?topic=${encodeURIComponent(topic)}`
    ),

  listEvents: () => requestJson<{ events: AgentEventRecord[] }>('/api/events?limit=80'),

  callAgentTool: (name: string, args: Record<string, unknown>) =>
    requestJson<{
      ok: boolean;
      result: unknown;
      image?: { mimeType: string; base64: string } | null;
    }>('/api/tools/call', {
      method: 'POST',
      body: JSON.stringify({ name, arguments: args }),
    }),
};

export function connectLiveSocket(
  onMessage: (msg: LiveEventPayload) => void,
  onStateChange: (connected: boolean) => void
): () => void {
  let ws: WebSocket | null = null;
  let closedByApp = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    if (closedByApp) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${window.location.host}/ws`);

    ws.onopen = () => onStateChange(true);
    ws.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(String(ev.data)) as LiveEventPayload;
        onMessage(parsed);
      } catch {
        // Ignore malformed frame
      }
    };
    ws.onclose = () => {
      onStateChange(false);
      if (!closedByApp) {
        retryTimer = setTimeout(open, 1800);
      }
    };
    ws.onerror = () => {
      ws?.close();
    };
  };

  open();

  return () => {
    closedByApp = true;
    if (retryTimer) clearTimeout(retryTimer);
    ws?.close();
  };
}
