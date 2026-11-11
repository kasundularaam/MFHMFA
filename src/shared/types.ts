export type MermaidTheme = 'default' | 'neutral' | 'dark' | 'forest' | 'base';
export type MermaidLook = 'classic' | 'handDrawn';
export type CallerSource = 'mcp-stdio' | 'mcp-http' | 'rest-tool' | 'web';

export interface ParseErrorDetail {
  message: string;
  rawMessage: string;
  line: number | null;
  column: number | null;
  snippet: string | null;
  expected: string[] | null;
  suggestion: string | null;
}

export interface LintWarning {
  line: number | null;
  code: string;
  message: string;
  suggestion?: string;
}

export interface DiagramMetrics {
  nodeCount: number;
  edgeCount: number;
  subgraphCount: number;
  textLabelCount: number;
  sampleLabels: string[];
}

export interface DiagramDimensions {
  width: number;
  height: number;
  aspectRatio: number;
  scale: number;
}

export interface ValidationResult {
  valid: boolean;
  diagramType: string | null;
  error: ParseErrorDetail | null;
  warnings: LintWarning[];
  durationMs: number;
}

export interface RenderOptions {
  theme?: MermaidTheme;
  look?: MermaidLook;
  background?: string;
  scale?: number;
  padding?: number;
}

export interface RenderedDiagram extends ValidationResult {
  svg: string | null;
  pngBytes: Uint8Array | null;
  dimensions: DiagramDimensions | null;
  metrics: DiagramMetrics | null;
  layoutDiagnostics: string[];
  theme: MermaidTheme;
  look: MermaidLook;
  background: string;
}

export interface ChartVersionSummary {
  version: number;
  code: string;
  theme: MermaidTheme;
  look: MermaidLook;
  background: string;
  valid: boolean;
  width: number | null;
  height: number | null;
  author: string;
  changeNote: string | null;
  createdAt: string;
}

export interface ChartRecord {
  id: string;
  title: string;
  description: string;
  code: string;
  diagramType: string | null;
  theme: MermaidTheme;
  look: MermaidLook;
  background: string;
  tags: string[];
  valid: boolean;
  error: ParseErrorDetail | null;
  warnings: LintWarning[];
  metrics: DiagramMetrics | null;
  layoutDiagnostics: string[];
  width: number | null;
  height: number | null;
  svgPath: string | null;
  pngPath: string | null;
  author: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentEventRecord {
  id: number;
  toolName: string;
  source: CallerSource;
  chartId: string | null;
  status: 'ok' | 'invalid' | 'error';
  durationMs: number;
  summary: string;
  createdAt: string;
}

export interface MermaidTemplate {
  id: string;
  name: string;
  category: string;
  diagramType: string;
  description: string;
  theme?: MermaidTheme;
  look?: MermaidLook;
  code: string;
}

export type LiveEventType =
  | 'chart:created'
  | 'chart:updated'
  | 'chart:deleted'
  | 'agent:event'
  | 'preview:rendered'
  | 'hello';

export interface LiveEventPayload {
  type: LiveEventType;
  data: unknown;
  focusInUi?: boolean;
  timestamp: string;
}
