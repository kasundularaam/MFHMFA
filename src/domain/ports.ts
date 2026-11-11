import type {
  MermaidLook,
  MermaidTheme,
  PreviewHubStats,
  PreviewSnapshot,
  RenderEngineStats,
  RenderOptions,
  RenderedDiagram,
  ValidationResult,
} from '../shared/types.js';

export interface RenderEnginePort {
  validate(code: string): Promise<ValidationResult>;
  render(code: string, options?: RenderOptions): Promise<RenderedDiagram>;
  getStats?(): RenderEngineStats;
  dispose(): Promise<void>;
}

export interface SaveSnapshotInput {
  title: string;
  tabId?: string | null;
  code: string;
  diagramType: string | null;
  theme: MermaidTheme;
  look: MermaidLook;
  liveToken?: string | null;
  workspaceToken?: string | null;
}

export type LiveSnapshotListener = (snapshot: PreviewSnapshot) => void;

export interface PreviewHubPort {
  saveSnapshot(input: SaveSnapshotInput): PreviewSnapshot;
  getSnapshot(id: string): PreviewSnapshot | null;
  getLiveLatest(token: string): PreviewSnapshot | null;
  getChannelTabs(token: string): PreviewSnapshot[];
  subscribeLive(
    token: string,
    listener: LiveSnapshotListener,
    onClose?: () => void
  ): (() => void) | null;
  getSubscriberCount(token: string): number;
  getStats(): PreviewHubStats;
  dispose(): void;
}


