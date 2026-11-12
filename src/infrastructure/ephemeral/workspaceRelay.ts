import crypto from 'node:crypto';
import type {
  WorkspaceEventListener,
  WorkspaceRelayPort,
} from '../../domain/ports.js';
import type {
  RelayStats,
  VfsLsResult,
  VfsMoveResult,
  VfsReadResult,
  VfsRpcQuery,
  VfsRpcReply,
  WorkspaceRelayEvent,
} from '../../shared/types.js';

const MAX_SUBSCRIBERS_PER_WORKSPACE = 24;
const MAX_TOTAL_SUBSCRIBERS = 500;
const MAX_PENDING_RPC = 200;
const DEFAULT_RPC_TIMEOUT_MS = 2500;

interface ActiveSubscription {
  listener: WorkspaceEventListener;
  onClose?: () => void;
}

interface PendingRpcEntry {
  workspaceToken: string;
  resolve: (val: VfsLsResult | VfsReadResult | VfsMoveResult) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function sanitizeWorkspaceToken(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Pure zero-storage bidirectional SSE relay.
 * Never stores diagrams or workspace trees in server memory — streams diagrams
 * to open browser tabs and proxies ephemeral `ls` / `read` / `mv` RPC calls
 * directly against browser `localStorage`.
 */
export class StatelessWorkspaceRelay implements WorkspaceRelayPort {
  private readonly subscribers = new Map<string, Set<ActiveSubscription>>();
  private readonly pendingRpc = new Map<string, PendingRpcEntry>();
  private totalSubscribers = 0;

  publish(workspaceToken: string, event: WorkspaceRelayEvent): number {
    const clean = sanitizeWorkspaceToken(workspaceToken);
    if (!clean) return 0;

    const subs = this.subscribers.get(clean);
    if (!subs || subs.size === 0) return 0;

    let delivered = 0;
    for (const sub of subs) {
      try {
        sub.listener(event);
        delivered += 1;
      } catch {
        // Ignore individual broken stream errors so sibling tabs keep receiving events
      }
    }
    return delivered;
  }

  requestVfs(
    workspaceToken: string,
    query: VfsRpcQuery,
    timeoutMs = DEFAULT_RPC_TIMEOUT_MS
  ): Promise<VfsLsResult | VfsReadResult | VfsMoveResult> {
    const clean = sanitizeWorkspaceToken(workspaceToken);
    if (!clean) {
      return Promise.reject(
        new Error(
          'No workspace token configured. Ask the user to copy their paired `?workspace=ws_...` MCP URL from MFHMFA Studio ("Copy MCP URL" in sidebar or Docs) so VFS tools (`ls`, `read`, `mv`) can access browser localStorage.'
        )
      );
    }

    const subs = this.subscribers.get(clean);
    if (!subs || subs.size === 0) {
      return Promise.reject(
        new Error(
          'Studio browser window is not currently open for this workspace (MFHMFA stores 0 diagrams on the server). Ask the user to open MFHMFA Studio in their browser so VFS tools (`ls`, `read`, `mv`) and live diagram sync can access browser localStorage.'
        )
      );
    }

    if (this.pendingRpc.size >= MAX_PENDING_RPC) {
      return Promise.reject(new Error('Too many concurrent VFS queries in flight.'));
    }

    const requestId = `vfs_${crypto.randomUUID().slice(0, 12)}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRpc.delete(requestId);
        reject(new Error(`Browser VFS ${query.op} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      timer.unref?.();

      this.pendingRpc.set(requestId, {
        workspaceToken: clean,
        resolve,
        reject,
        timer,
      });

      const delivered = this.publish(clean, {
        type: 'vfs_request',
        request: {
          ...query,
          requestId,
        },
      });

      if (delivered === 0) {
        clearTimeout(timer);
        this.pendingRpc.delete(requestId);
        reject(new Error('No active Studio browser window received the VFS request.'));
      }
    });
  }

  resolveVfsReply(workspaceToken: string, reply: VfsRpcReply): boolean {
    const clean = sanitizeWorkspaceToken(workspaceToken);
    if (!clean || !reply || typeof reply.requestId !== 'string') return false;

    const pending = this.pendingRpc.get(reply.requestId);
    if (!pending || pending.workspaceToken !== clean) {
      return false;
    }

    clearTimeout(pending.timer);
    this.pendingRpc.delete(reply.requestId);

    if (reply.ok && reply.result) {
      pending.resolve(reply.result);
    } else {
      pending.reject(new Error(reply.error || 'Browser VFS operation failed.'));
    }
    return true;
  }

  subscribe(
    workspaceToken: string,
    listener: WorkspaceEventListener,
    onClose?: () => void
  ): (() => void) | null {
    const clean = sanitizeWorkspaceToken(workspaceToken);
    if (!clean) return null;
    if (this.totalSubscribers >= MAX_TOTAL_SUBSCRIBERS) return null;

    let set = this.subscribers.get(clean);
    if (!set) {
      set = new Set();
      this.subscribers.set(clean, set);
    }
    if (set.size >= MAX_SUBSCRIBERS_PER_WORKSPACE) return null;

    const record: ActiveSubscription = { listener, onClose };
    set.add(record);
    this.totalSubscribers += 1;

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = this.subscribers.get(clean);
      if (current?.delete(record)) {
        this.totalSubscribers = Math.max(0, this.totalSubscribers - 1);
        if (current.size === 0) {
          this.subscribers.delete(clean);
        }
      }
    };
  }

  getSubscriberCount(workspaceToken: string): number {
    const clean = sanitizeWorkspaceToken(workspaceToken);
    if (!clean) return 0;
    return this.subscribers.get(clean)?.size ?? 0;
  }

  getStats(): RelayStats {
    return {
      activeWorkspaces: this.subscribers.size,
      browserSubscribers: this.totalSubscribers,
      storedDiagrams: 0,
    };
  }

  dispose(): void {
    for (const pending of this.pendingRpc.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Workspace relay disposed.'));
    }
    this.pendingRpc.clear();

    for (const set of this.subscribers.values()) {
      for (const sub of set) {
        try {
          sub.onClose?.();
        } catch {
          // ignore
        }
      }
      set.clear();
    }
    this.subscribers.clear();
    this.totalSubscribers = 0;
  }
}
