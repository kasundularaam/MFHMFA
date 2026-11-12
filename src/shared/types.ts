export type MermaidTheme = 'default' | 'neutral' | 'dark' | 'forest' | 'base';
export type MermaidLook = 'classic' | 'handDrawn';
export type CallerSource = 'mcp-stdio' | 'mcp-http' | 'rest-tool' | 'web';
export type LearningMode = 'concept' | 'paper' | 'codebase' | 'bug' | 'tradeoff';

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

/**
 * Progressive-disclosure inspector card attached to a Mermaid node ID
 * (Dual Coding + Counterfactual Reasoning + Sub-Graph Zoom).
 */
export interface DiagramNodeDetail {
  label?: string;
  term?: string;
  summary: string;
  example?: string;
  whatIf?: string;
  refs?: string[];
  files?: string[];
  childPath?: string;
}

/**
 * Active retrieval / micro-prediction prompt inside a walkthrough step.
 */
export interface DiagramStepCheck {
  question: string;
  answer: string;
}

/**
 * User-paced Story Stepper frame (Mayer's Segmenting & Signaling Principles).
 */
export interface DiagramWalkthroughStep {
  title: string;
  caption: string;
  focusNodes: string[];
  trace?: string;
  check?: DiagramStepCheck;
}

/**
 * Named walkthrough scenario for contrasting paths on the same map
 * (e.g. "Happy Path" vs. "Crash & Retry", or "Expected" vs. "Bug Trace").
 */
export interface DiagramWalkthroughFlow {
  id: string;
  label: string;
  steps: DiagramWalkthroughStep[];
}

/**
 * Optional comprehension layer persisted alongside a `.mmd` revision in browser IndexedDB.
 */
export interface DiagramComprehensionGuide {
  gist?: string;
  steps?: DiagramWalkthroughStep[];
  flows?: DiagramWalkthroughFlow[];
  nodes?: Record<string, DiagramNodeDetail>;
  parentPath?: string;
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

export type AgentStatusKind = 'connected' | 'active' | 'disconnected';

export interface AgentSessionInfo {
  sessionId: string;
  agentSlug: string;
  agentLabel: string;
  agentShortLabel: string;
  clientVersion: string | null;
  project: string | null;
  source: CallerSource;
  status: AgentStatusKind;
  connectedAt: number;
  lastActiveAt: number;
}

export interface DiagramRelayPayload {
  renderId: string;
  path: string;
  title: string;
  code: string;
  guide?: DiagramComprehensionGuide;
  diagramType: string | null;
  theme: MermaidTheme;
  look: MermaidLook;
  project: string;
  agentSessionId: string | null;
  agentSlug: string;
  agentLabel: string;
  agentShortLabel: string;
  timestamp: number;
}

export interface ViewerFocusContext {
  activePath: string;
  viewingVersion: number;
  activeFlowId?: string | null;
  activeFlowLabel?: string | null;
  activeStepIndex?: number | null;
  activeStepTitle?: string | null;
  selectedNodeId?: string | null;
}

export interface VfsLsEntry {
  name: string;
  path: string;
  kind: 'dir' | 'file';
  diagramType?: string | null;
  currentVersion?: number;
  author?: string;
  updatedAt?: number;
  flowCount?: number;
  stepCount?: number;
  nodeNoteCount?: number;
}

export interface VfsLsResult {
  project: string;
  cwd: string;
  entries: VfsLsEntry[];
  treeText: string;
  viewerFocus?: ViewerFocusContext | null;
}

export interface VfsRevisionSummary {
  version: number;
  author: string;
  authorLabel: string;
  createdAt: number;
}

export interface VfsReadResult {
  project: string;
  path: string;
  title: string;
  diagramType: string | null;
  requestedVersion: number;
  currentVersion: number;
  code: string;
  guide?: DiagramComprehensionGuide;
  author: string;
  updatedAt: number;
  versions: VfsRevisionSummary[];
}

export interface VfsMoveResult {
  project: string;
  fromPath: string;
  toPath: string;
  movedFiles: number;
}

export type VfsRpcQuery =
  | { op: 'ls'; project: string; dirPath: string }
  | { op: 'read'; project: string; filePath: string; version?: number }
  | { op: 'mv'; project: string; fromPath: string; toPath: string };

export interface VfsRpcResultMap {
  ls: VfsLsResult;
  read: VfsReadResult;
  mv: VfsMoveResult;
}

export type VfsRpcAnyResult = VfsRpcResultMap[keyof VfsRpcResultMap];

export type VfsRpcRequest = VfsRpcQuery & {
  requestId: string;
};

export interface VfsRpcReply {
  requestId: string;
  ok: boolean;
  result?: VfsRpcAnyResult;
  error?: string;
}

export type WorkspaceRelayEvent =
  | { type: 'connected_agents'; agents: AgentSessionInfo[] }
  | { type: 'agent_status'; agent: AgentSessionInfo }
  | { type: 'diagram'; diagram: DiagramRelayPayload }
  | { type: 'vfs_request'; request: VfsRpcRequest };

export interface RelayStats {
  activeWorkspaces: number;
  browserSubscribers: number;
  storedDiagrams: 0;
}
