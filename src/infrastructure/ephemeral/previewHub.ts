import crypto from 'node:crypto';
import type {
  LiveSnapshotListener,
  PreviewHubPort,
  SaveSnapshotInput,
} from '../../domain/ports.js';
import { slugify } from '../../shared/svg.js';
import type { PreviewHubStats, PreviewSnapshot } from '../../shared/types.js';

const DEFAULT_MAX_SNAPSHOTS = 600;
const DEFAULT_SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const DEFAULT_MAX_CHANNELS = 400;
const DEFAULT_CHANNEL_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const MAX_TABS_PER_CHANNEL = 24;
const MAX_SUBSCRIBERS_PER_CHANNEL = 24;
const MAX_TOTAL_SUBSCRIBERS = 500;

interface StoredSnapshot {
  snapshot: PreviewSnapshot;
  expiresAt: number;
}

interface StoredChannel {
  tabs: Map<string, PreviewSnapshot>;
  latest: PreviewSnapshot;
  expiresAt: number;
}

interface ActiveSubscription {
  listener: LiveSnapshotListener;
  onClose?: () => void;
}

export function generateLiveToken(): string {
  return crypto.randomBytes(9).toString('base64url');
}

export function sanitizeLiveChannel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(trimmed)) return null;
  return trimmed;
}

export class InMemoryPreviewHub implements PreviewHubPort {
  private readonly snapshots = new Map<string, StoredSnapshot>();
  private readonly channels = new Map<string, StoredChannel>();
  private readonly subscribers = new Map<string, Set<ActiveSubscription>>();
  private readonly bootSecret = crypto.randomBytes(32);
  private readonly maxSnapshots: number;
  private readonly snapshotTtlMs: number;
  private readonly maxChannels: number;
  private readonly channelTtlMs: number;
  private totalSubscribers = 0;
  private readonly sweepTimer: ReturnType<typeof setInterval>;

  constructor(opts?: {
    maxSnapshots?: number;
    snapshotTtlMs?: number;
    maxChannels?: number;
    channelTtlMs?: number;
  }) {
    this.maxSnapshots = opts?.maxSnapshots ?? DEFAULT_MAX_SNAPSHOTS;
    this.snapshotTtlMs = opts?.snapshotTtlMs ?? DEFAULT_SNAPSHOT_TTL_MS;
    this.maxChannels = opts?.maxChannels ?? DEFAULT_MAX_CHANNELS;
    this.channelTtlMs = opts?.channelTtlMs ?? DEFAULT_CHANNEL_TTL_MS;

    this.sweepTimer = setInterval(() => this.sweepExpired(), 5 * 60 * 1000);
    this.sweepTimer.unref?.();
  }

  private computeCapabilityId(input: SaveSnapshotInput, tabKey: string): string {
    const hmac = crypto.createHmac('sha256', this.bootSecret);
    hmac.update(
      `${input.code}\0${input.title}\0${tabKey}\0${input.theme}\0${input.look}\0${input.liveToken ?? ''}\0${input.workspaceToken ?? ''}`
    );
    return hmac.digest('base64url').slice(0, 11);
  }

  private publishToChannel(token: string, snapshot: PreviewSnapshot, now: number): void {
    const existing = this.channels.get(token);
    const tabs = existing ? existing.tabs : new Map<string, PreviewSnapshot>();

    // Updating an existing tabKey updates in-place (preserving tab strip order!);
    // new tabKeys append to the right like VS Code editor tabs.
    tabs.set(snapshot.tabKey, snapshot);
    while (tabs.size > MAX_TABS_PER_CHANNEL) {
      const oldestTabKey = tabs.keys().next().value;
      if (oldestTabKey === undefined) break;
      tabs.delete(oldestTabKey);
    }

    // Refresh channel LRU order
    this.channels.delete(token);
    this.channels.set(token, {
      tabs,
      latest: snapshot,
      expiresAt: now + this.channelTtlMs,
    });
    while (this.channels.size > this.maxChannels) {
      const oldestChannel = this.channels.keys().next().value;
      if (oldestChannel === undefined) break;
      this.channels.delete(oldestChannel);
    }

    const subs = this.subscribers.get(token);
    if (subs) {
      for (const sub of subs) {
        try {
          sub.listener(snapshot);
        } catch {
          // Ignore listener errors so one broken stream never blocks others
        }
      }
    }
  }

  saveSnapshot(input: SaveSnapshotInput): PreviewSnapshot {
    const now = Date.now();
    const tabKey = slugify(input.tabId?.trim() || input.title, 'diagram');
    const id = this.computeCapabilityId(input, tabKey);
    const liveToken = sanitizeLiveChannel(input.liveToken) ?? null;
    const workspaceToken = sanitizeLiveChannel(input.workspaceToken) ?? null;

    const snapshot: PreviewSnapshot = {
      id,
      tabKey,
      title: input.title,
      code: input.code,
      diagramType: input.diagramType,
      theme: input.theme,
      look: input.look,
      liveToken,
      workspaceToken,
      createdAt: now,
    };

    // Refresh LRU order on write
    this.snapshots.delete(id);
    this.snapshots.set(id, {
      snapshot,
      expiresAt: now + this.snapshotTtlMs,
    });
    while (this.snapshots.size > this.maxSnapshots) {
      const oldestKey = this.snapshots.keys().next().value;
      if (oldestKey === undefined) break;
      this.snapshots.delete(oldestKey);
    }

    if (liveToken) {
      this.publishToChannel(liveToken, snapshot, now);
    }
    if (workspaceToken && workspaceToken !== liveToken) {
      this.publishToChannel(workspaceToken, snapshot, now);
    }

    return snapshot;
  }

  getSnapshot(id: string): PreviewSnapshot | null {
    const entry = this.snapshots.get(id);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.snapshots.delete(id);
      return null;
    }
    // Refresh LRU recency
    this.snapshots.delete(id);
    this.snapshots.set(id, entry);
    return entry.snapshot;
  }

  getLiveLatest(token: string): PreviewSnapshot | null {
    const clean = sanitizeLiveChannel(token);
    if (!clean) return null;
    const entry = this.channels.get(clean);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.channels.delete(clean);
      return null;
    }
    return entry.latest;
  }

  getChannelTabs(token: string): PreviewSnapshot[] {
    const clean = sanitizeLiveChannel(token);
    if (!clean) return [];
    const entry = this.channels.get(clean);
    if (!entry) return [];
    if (entry.expiresAt <= Date.now()) {
      this.channels.delete(clean);
      return [];
    }
    return Array.from(entry.tabs.values());
  }

  subscribeLive(
    token: string,
    listener: LiveSnapshotListener,
    onClose?: () => void
  ): (() => void) | null {
    const clean = sanitizeLiveChannel(token);
    if (!clean) return null;
    if (this.totalSubscribers >= MAX_TOTAL_SUBSCRIBERS) return null;

    let set = this.subscribers.get(clean);
    if (!set) {
      set = new Set();
      this.subscribers.set(clean, set);
    }
    if (set.size >= MAX_SUBSCRIBERS_PER_CHANNEL) return null;

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

  getSubscriberCount(token: string): number {
    const clean = sanitizeLiveChannel(token);
    if (!clean) return 0;
    return this.subscribers.get(clean)?.size ?? 0;
  }

  getStats(): PreviewHubStats {
    this.sweepExpired();
    return {
      snapshots: this.snapshots.size,
      maxSnapshots: this.maxSnapshots,
      liveChannels: this.channels.size,
      liveSubscribers: this.totalSubscribers,
    };
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [id, entry] of this.snapshots.entries()) {
      if (entry.expiresAt <= now) {
        this.snapshots.delete(id);
      }
    }
    for (const [tok, entry] of this.channels.entries()) {
      if (entry.expiresAt <= now) {
        this.channels.delete(tok);
      }
    }
  }

  dispose(): void {
    clearInterval(this.sweepTimer);
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
    this.snapshots.clear();
    this.channels.clear();
  }
}
