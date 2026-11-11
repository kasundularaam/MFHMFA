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

export interface RenderEngineStats {
  maxConcurrency: number;
  activeSlots: number;
  busySlots: number;
  creatingSlots: number;
  queuedRequests: number;
  totalRenders: number;
  totalValidations: number;
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

export interface PreviewSnapshot {
  id: string;
  tabKey: string;
  title: string;
  code: string;
  diagramType: string | null;
  theme: MermaidTheme;
  look: MermaidLook;
  liveToken: string | null;
  workspaceToken: string | null;
  createdAt: number;
}


export interface PreviewHubStats {
  snapshots: number;
  maxSnapshots: number;
  liveChannels: number;
  liveSubscribers: number;
}

