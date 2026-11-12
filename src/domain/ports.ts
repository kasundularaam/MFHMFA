import type {
  RelayStats,
  RenderEngineStats,
  RenderOptions,
  RenderedDiagram,
  ValidationResult,
  VfsRpcQuery,
  VfsRpcReply,
  VfsRpcResultMap,
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
  requestVfs<Q extends VfsRpcQuery>(
    workspaceToken: string,
    query: Q,
    timeoutMs?: number
  ): Promise<VfsRpcResultMap[Q['op']]>;
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
