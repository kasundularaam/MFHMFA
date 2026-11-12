import type {
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
  WorkspaceRelayEvent,
} from '../shared/types.js';

export interface RenderEnginePort {
  validate(code: string): Promise<ValidationResult>;
  render(code: string, options?: RenderOptions): Promise<RenderedDiagram>;
  getStats?(): RenderEngineStats;
  dispose(): Promise<void>;
}

export type WorkspaceEventListener = (event: WorkspaceRelayEvent) => void;

export interface WorkspaceRelayPort {
  publish(workspaceToken: string, event: WorkspaceRelayEvent): number;
  requestVfs(
    workspaceToken: string,
    query: VfsRpcQuery,
    timeoutMs?: number
  ): Promise<VfsLsResult | VfsReadResult | VfsMoveResult>;
  resolveVfsReply(workspaceToken: string, reply: VfsRpcReply): boolean;
  subscribe(
    workspaceToken: string,
    listener: WorkspaceEventListener,
    onClose?: () => void
  ): (() => void) | null;
  getSubscriberCount(workspaceToken: string): number;
  getStats(): RelayStats;
  dispose(): void;
}
