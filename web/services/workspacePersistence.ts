import { createStore, get, set } from 'idb-keyval';
import { parseWorkspaceToken } from '../../src/shared/protocolSchemas';
import { randomToken } from '../../src/shared/strings';
import {
  createFreshWorkspaceState,
  hydrateWorkspaceFromPersistedV4,
  migrateLegacyV2Workspace,
  migrateLegacyV3Workspace,
  toPersistedWorkspaceV4,
  type PersistedWorkspaceV4,
  type WorkspaceState,
} from '../../src/shared/vfs';

export const IDB_DB_NAME = 'mfhmfa-db';
export const IDB_STORE_NAME = 'workspace';
export const WORKSPACE_V4_KEY = 'mfhmfa-workspace-v4';
export const WORKSPACE_ID_KEY = 'mfhmfa-workspace-id';

const LEGACY_V3_STORAGE_KEY = 'mfhmfa-workspace-v3';
const LEGACY_V2_STORAGE_KEY = 'mfhmfa-studio-tabs-v2';
const LEGACY_DRAFT_KEY = 'mfhmfa-stateless-draft';

const SAVE_DEBOUNCE_MS = 120;

const workspaceIdbStore = createStore(IDB_DB_NAME, IDB_STORE_NAME);

let pendingSaveTimer: ReturnType<typeof setTimeout> | null = null;
let latestPendingState: WorkspaceState | null = null;

export function getOrCreateWorkspaceId(): string {
  const urlParams = new URLSearchParams(window.location.search);
  const fromQuery = parseWorkspaceToken(urlParams.get('workspace') ?? urlParams.get('ws'));
  if (fromQuery) {
    try {
      localStorage.setItem(WORKSPACE_ID_KEY, fromQuery);
    } catch {
      // ignore storage restriction on workspaceId cache
    }
    return fromQuery;
  }

  try {
    const saved = parseWorkspaceToken(localStorage.getItem(WORKSPACE_ID_KEY));
    if (saved) return saved;
  } catch {
    // ignore
  }

  const fresh = `ws_${randomToken(12)}`;
  try {
    localStorage.setItem(WORKSPACE_ID_KEY, fresh);
  } catch {
    // ignore
  }
  return fresh;
}

export function persistWorkspaceId(workspaceId: string): void {
  try {
    localStorage.setItem(WORKSPACE_ID_KEY, workspaceId);
  } catch {
    // ignore
  }
}

function tryMigrateFromLocalStorage(workspaceId: string): WorkspaceState | null {
  try {
    const rawV4 = localStorage.getItem(WORKSPACE_V4_KEY);
    if (rawV4) {
      const hydrated = hydrateWorkspaceFromPersistedV4(JSON.parse(rawV4), workspaceId);
      if (hydrated) return hydrated;
    }

    const rawV3 = localStorage.getItem(LEGACY_V3_STORAGE_KEY);
    if (rawV3) {
      const migrated = migrateLegacyV3Workspace(JSON.parse(rawV3), workspaceId);
      if (migrated) return migrated;
    }

    const rawV2 = localStorage.getItem(LEGACY_V2_STORAGE_KEY);
    if (rawV2) {
      const migrated = migrateLegacyV2Workspace(JSON.parse(rawV2), workspaceId);
      if (migrated) return migrated;
    }

    const legacyDraft = localStorage.getItem(LEGACY_DRAFT_KEY);
    if (legacyDraft) {
      return createFreshWorkspaceState(workspaceId, Date.now(), legacyDraft);
    }
  } catch {
    // Ignore malformed legacy localStorage data
  }
  return null;
}

function clearLegacyLocalStorageBlobs(): void {
  try {
    localStorage.removeItem(WORKSPACE_V4_KEY);
    localStorage.removeItem(LEGACY_V3_STORAGE_KEY);
    localStorage.removeItem(LEGACY_V2_STORAGE_KEY);
    localStorage.removeItem(LEGACY_DRAFT_KEY);
  } catch {
    // ignore
  }
}

export async function saveWorkspaceImmediate(
  state: WorkspaceState,
  onError?: (err: unknown) => void
): Promise<boolean> {
  if (pendingSaveTimer) {
    clearTimeout(pendingSaveTimer);
    pendingSaveTimer = null;
  }
  latestPendingState = null;

  try {
    const payload: PersistedWorkspaceV4 = toPersistedWorkspaceV4(state);
    await set(WORKSPACE_V4_KEY, payload, workspaceIdbStore);
    return true;
  } catch (err: unknown) {
    onError?.(err);
    return false;
  }
}

export function scheduleWorkspaceSave(
  state: WorkspaceState,
  onError?: (err: unknown) => void
): void {
  latestPendingState = state;
  if (pendingSaveTimer) {
    clearTimeout(pendingSaveTimer);
  }
  pendingSaveTimer = setTimeout(() => {
    pendingSaveTimer = null;
    const toWrite = latestPendingState;
    latestPendingState = null;
    if (toWrite) {
      void saveWorkspaceImmediate(toWrite, onError);
    }
  }, SAVE_DEBOUNCE_MS);
}

export function flushPendingWorkspaceSave(onError?: (err: unknown) => void): void {
  if (!latestPendingState) return;
  const toWrite = latestPendingState;
  void saveWorkspaceImmediate(toWrite, onError);
}

/**
 * Hydrates the browser VFS from IndexedDB, seamlessly migrating any prior
 * `localStorage` workspace once and cleaning up legacy `localStorage` keys.
 */
export async function loadWorkspaceFromIndexedDb(
  onError?: (err: unknown) => void
): Promise<WorkspaceState> {
  const workspaceId = getOrCreateWorkspaceId();

  try {
    const stored = await get<PersistedWorkspaceV4>(WORKSPACE_V4_KEY, workspaceIdbStore);
    if (stored) {
      const hydrated = hydrateWorkspaceFromPersistedV4(stored, workspaceId);
      if (hydrated) {
        if (stored.workspaceId !== workspaceId) {
          await saveWorkspaceImmediate(hydrated, onError);
        }
        return hydrated;
      }
    }
  } catch (err: unknown) {
    onError?.(err);
  }

  const migrated = tryMigrateFromLocalStorage(workspaceId);
  if (migrated) {
    const wrote = await saveWorkspaceImmediate(migrated, onError);
    if (wrote) {
      clearLegacyLocalStorageBlobs();
    }
    return migrated;
  }

  const fresh = createFreshWorkspaceState(workspaceId);
  await saveWorkspaceImmediate(fresh, onError);
  return fresh;
}
