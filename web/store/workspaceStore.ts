import { produce } from 'immer';
import { create } from 'zustand';
import { randomToken } from '../../src/shared/strings';
import type {
  AgentSessionInfo,
  DiagramRelayPayload,
  VfsRpcAnyResult,
  VfsRpcQuery,
} from '../../src/shared/types';
import {
  allocateProjectSpace,
  createFreshWorkspaceState,
  deleteFolderFromProject,
  deleteGraphFromProject,
  deleteProjectFromWorkspace,
  editGraphByHuman,
  evaluateVfsLs,
  evaluateVfsRead,
  findFileWithProject,
  movePathInProject,
  NEW_TAB_STARTER,
  normalizeWorkspaceConsistency,
  restoreGraphVersion,
  SCRATCHPAD_PROJECT_KEY,
  upsertGraphInVfs,
  type VfsGraphFile,
  type VfsProjectRoot,
  type WorkspaceState,
} from '../../src/shared/vfs';
import { normalizeRelativeDirPath, normalizeRelativeGraphPath } from '../../src/shared/vfsPath';
import {
  getOrCreateWorkspaceId,
  loadWorkspaceFromIndexedDb,
  persistWorkspaceId,
  saveWorkspaceImmediate,
  scheduleWorkspaceSave,
} from '../services/workspacePersistence';
import { useUiStore } from './uiStore';

export interface OpenTabEntry {
  file: VfsGraphFile;
  project: VfsProjectRoot;
}

function reportPersistenceError(): void {
  useUiStore
    .getState()
    .notifyToast('Browser storage is full or unavailable — export important diagrams');
}

function snapshotCameraIntoState(state: WorkspaceState): WorkspaceState {
  if (!state.activeFileId) return state;
  const { zoom, pan } = useUiStore.getState();
  return produce(state, (draft) => {
    for (const p of draft.projects) {
      const f = p.files.find((item) => item.id === state.activeFileId);
      if (f) {
        f.zoom = zoom;
        f.pan = pan;
        return;
      }
    }
  });
}

function syncCameraForActiveFile(
  nextState: WorkspaceState,
  versionOverride: number | null
): void {
  useUiStore.getState().resetComprehensionSelection();
  const found = findFileWithProject(nextState, nextState.activeFileId);
  if (!found) {
    useUiStore.getState().clearRenderStage();
    return;
  }
  if (found.file.zoom !== null && versionOverride === null) {
    useUiStore.getState().applyCamera({
      zoom: found.file.zoom,
      pan: found.file.pan,
    });
  } else {
    useUiStore.getState().applyCamera({ zoom: null, pan: { x: 0, y: 0 } });
  }
}

export interface WorkspaceStoreState {
  hydrated: boolean;
  workspace: WorkspaceState;
  selectedVersion: number | null;
  connectedAgentsMap: Record<string, AgentSessionInfo>;
  sessionProjectMap: Record<string, string>;

  hydrate: () => Promise<void>;

  toggleSidebar: () => void;
  resizeSidebar: (nextWidth: number) => void;
  toggleProjectExpanded: (projectKey: string) => void;

  openFile: (fileId: string) => void;
  closeTab: (fileId: string) => void;
  createGraph: (targetProjectKey?: string, parentDir?: string, rawName?: string) => void;
  createFolder: (projectKey: string, parentDir: string, rawFolderName: string) => void;
  renamePath: (projectKey: string, fromPath: string, toPath: string) => void;

  deleteGraph: (projectKey: string, fileId: string) => void;
  deleteFolder: (projectKey: string, folderPath: string) => void;
  deleteProject: (projectKey: string) => void;

  selectVersion: (version: number | null) => void;
  restoreVersion: (version: number) => void;
  editActiveCode: (nextCode: string) => void;

  rotateWorkspaceId: () => void;

  applyAgentStatus: (
    agent: AgentSessionInfo,
    opts: { silent: boolean; shouldAnnounce: boolean }
  ) => void;
  applyIncomingDiagram: (diag: DiagramRelayPayload) => void;
  executeVfsRpc: (query: VfsRpcQuery) => VfsRpcAnyResult;
}

let hydrationPromise: Promise<void> | null = null;

export const useWorkspaceStore = create<WorkspaceStoreState>((set, get) => ({
  hydrated: false,
  workspace: createFreshWorkspaceState(getOrCreateWorkspaceId()),
  selectedVersion: null,
  connectedAgentsMap: {},
  sessionProjectMap: {},

  hydrate: () => {
    if (hydrationPromise) return hydrationPromise;
    hydrationPromise = (async () => {
      const loaded = await loadWorkspaceFromIndexedDb(reportPersistenceError);
      set({ workspace: loaded, hydrated: true, selectedVersion: null });
      syncCameraForActiveFile(loaded, null);
    })();
    return hydrationPromise;
  },

  toggleSidebar: () => {
    const next = produce(get().workspace, (draft) => {
      draft.sidebarOpen = !draft.sidebarOpen;
    });
    set({ workspace: next });
    scheduleWorkspaceSave(next, reportPersistenceError);
  },

  resizeSidebar: (nextWidth) => {
    const clamped = Math.min(480, Math.max(210, Math.round(nextWidth)));
    const next = produce(get().workspace, (draft) => {
      draft.sidebarWidth = clamped;
    });
    set({ workspace: next });
    scheduleWorkspaceSave(next, reportPersistenceError);
  },

  toggleProjectExpanded: (projectKey) => {
    const next = produce(get().workspace, (draft) => {
      const p = draft.projects.find((item) => item.projectKey === projectKey);
      if (p) p.expanded = !p.expanded;
    });
    set({ workspace: next });
    scheduleWorkspaceSave(next, reportPersistenceError);
  },

  openFile: (fileId) => {
    const { workspace, selectedVersion } = get();
    if (workspace.activeFileId === fileId && selectedVersion === null) return;

    const withCam = snapshotCameraIntoState(workspace);
    const nextState = normalizeWorkspaceConsistency(
      produce(withCam, (draft) => {
        if (!draft.openTabIds.includes(fileId)) {
          draft.openTabIds.push(fileId);
        }
        draft.activeFileId = fileId;
        for (const p of draft.projects) {
          const f = p.files.find((item) => item.id === fileId);
          if (f) f.unread = false;
        }
      })
    );

    set({ workspace: nextState, selectedVersion: null });
    syncCameraForActiveFile(nextState, null);
    scheduleWorkspaceSave(nextState, reportPersistenceError);
  },

  closeTab: (fileId) => {
    const withCam = snapshotCameraIntoState(get().workspace);
    const idx = withCam.openTabIds.indexOf(fileId);
    if (idx < 0) return;

    const remaining = withCam.openTabIds.filter((id) => id !== fileId);
    let nextActive = withCam.activeFileId;
    if (withCam.activeFileId === fileId) {
      nextActive =
        remaining.length > 0 ? remaining[Math.min(idx, remaining.length - 1)]! : null;
    }

    const nextState = normalizeWorkspaceConsistency({
      ...withCam,
      openTabIds: remaining,
      activeFileId: nextActive,
    });

    set({ workspace: nextState, selectedVersion: null });
    syncCameraForActiveFile(nextState, null);
    scheduleWorkspaceSave(nextState, reportPersistenceError);
  },

  createGraph: (targetProjectKey, parentDir = '', rawName) => {
    const cur = snapshotCameraIntoState(get().workspace);
    const activeEntry = findFileWithProject(cur, cur.activeFileId);
    const fallbackProj =
      activeEntry?.project.projectKey || cur.projects[0]?.projectKey || SCRATCHPAD_PROJECT_KEY;
    const projKey = targetProjectKey || fallbackProj;
    const proj = cur.projects.find((p) => p.projectKey === projKey);
    const projectName = proj?.projectLabel || 'scratchpad';

    let baseName = rawName?.trim() || '';
    if (!baseName) {
      const count = (proj?.files.length ?? 0) + 1;
      baseName = `diagram-${count}.mmd`;
    }

    try {
      const fullRel = parentDir
        ? `${normalizeRelativeDirPath(parentDir)}/${baseName}`
        : baseName;
      let relPath = normalizeRelativeGraphPath(fullRel);

      if (proj?.files.some((f) => f.path === relPath) && !rawName) {
        relPath = normalizeRelativeGraphPath(
          parentDir
            ? `${parentDir}/diagram-${randomToken(4)}.mmd`
            : `diagram-${randomToken(4)}.mmd`
        );
      }

      const upserted = upsertGraphInVfs(cur, {
        projectName,
        path: relPath,
        code: NEW_TAB_STARTER,
        diagramType: 'flowchart-v2',
        agentSlug: 'user',
        agentLabel: 'You',
        agentShortLabel: 'you',
        autoOpenTab: true,
        autoFocus: true,
      });

      set({ workspace: upserted.nextState, selectedVersion: null });
      syncCameraForActiveFile(upserted.nextState, null);
      void saveWorkspaceImmediate(upserted.nextState, reportPersistenceError);
    } catch (err: unknown) {
      useUiStore
        .getState()
        .notifyToast(err instanceof Error ? err.message : 'Invalid graph path');
    }
  },

  createFolder: (projectKey, parentDir, rawFolderName) => {
    try {
      const combined = parentDir
        ? `${parentDir}/${rawFolderName.trim()}`
        : rawFolderName.trim();
      const cleanDir = normalizeRelativeDirPath(combined);
      if (!cleanDir) return;

      const next = produce(get().workspace, (draft) => {
        const p = draft.projects.find((item) => item.projectKey === projectKey);
        if (!p) return;
        p.expanded = true;
        if (!p.folders.includes(cleanDir)) {
          p.folders.push(cleanDir);
          p.updatedAt = Date.now();
        }
      });

      set({ workspace: next });
      void saveWorkspaceImmediate(next, reportPersistenceError);
    } catch (err: unknown) {
      useUiStore
        .getState()
        .notifyToast(err instanceof Error ? err.message : 'Invalid folder name');
    }
  },

  renamePath: (projectKey, fromPath, toPath) => {
    try {
      const cur = get().workspace;
      const proj = cur.projects.find((p) => p.projectKey === projectKey);
      if (!proj) return;
      const moved = movePathInProject(cur, proj.projectLabel, fromPath, toPath);
      set({ workspace: moved.nextState });
      void saveWorkspaceImmediate(moved.nextState, reportPersistenceError);
    } catch (err: unknown) {
      useUiStore.getState().notifyToast(err instanceof Error ? err.message : 'Rename failed');
    }
  },

  deleteGraph: (projectKey, fileId) => {
    const withCam = snapshotCameraIntoState(get().workspace);
    const nextState = deleteGraphFromProject(withCam, projectKey, fileId);
    set({ workspace: nextState, selectedVersion: null });
    syncCameraForActiveFile(nextState, null);
    void saveWorkspaceImmediate(nextState, reportPersistenceError);
    useUiStore.getState().notifyToast('File deleted');
  },

  deleteFolder: (projectKey, folderPath) => {
    const withCam = snapshotCameraIntoState(get().workspace);
    const nextState = deleteFolderFromProject(withCam, projectKey, folderPath);
    set({ workspace: nextState, selectedVersion: null });
    syncCameraForActiveFile(nextState, null);
    void saveWorkspaceImmediate(nextState, reportPersistenceError);
    useUiStore.getState().notifyToast('Folder deleted');
  },

  deleteProject: (projectKey) => {
    const withCam = snapshotCameraIntoState(get().workspace);
    const nextState = deleteProjectFromWorkspace(withCam, projectKey);
    set({ workspace: nextState, selectedVersion: null });
    syncCameraForActiveFile(nextState, null);
    void saveWorkspaceImmediate(nextState, reportPersistenceError);
    useUiStore.getState().notifyToast('Project deleted');
  },

  selectVersion: (version) => {
    const { workspace } = get();
    set({ selectedVersion: version });
    syncCameraForActiveFile(workspace, version);
  },

  restoreVersion: (version) => {
    const { workspace } = get();
    if (!workspace.activeFileId) return;
    const restored = restoreGraphVersion(workspace, workspace.activeFileId, version);
    set({ workspace: restored.nextState, selectedVersion: null });
    syncCameraForActiveFile(restored.nextState, null);
    void saveWorkspaceImmediate(restored.nextState, reportPersistenceError);
    useUiStore.getState().notifyToast(`Restored v${version}`);
  },

  editActiveCode: (nextCode) => {
    const { workspace, selectedVersion } = get();
    if (!workspace.activeFileId) return;
    const next = editGraphByHuman(workspace, workspace.activeFileId, nextCode);
    set({
      workspace: next,
      ...(selectedVersion !== null ? { selectedVersion: null } : {}),
    });
    scheduleWorkspaceSave(next, reportPersistenceError);
  },

  rotateWorkspaceId: () => {
    const fresh = `ws_${randomToken(12)}`;
    persistWorkspaceId(fresh);
    const next: WorkspaceState = { ...get().workspace, workspaceId: fresh };
    set({
      workspace: next,
      connectedAgentsMap: {},
      sessionProjectMap: {},
    });
    void saveWorkspaceImmediate(next, reportPersistenceError);
    useUiStore.getState().notifyToast('Workspace key updated');
  },

  applyAgentStatus: (agent, { silent, shouldAnnounce }) => {
    if (agent.status === 'disconnected') {
      set((s) => {
        if (!s.connectedAgentsMap[agent.sessionId]) return s;
        const nextAgents = { ...s.connectedAgentsMap };
        delete nextAgents[agent.sessionId];
        const nextProjMap = { ...s.sessionProjectMap };
        delete nextProjMap[agent.sessionId];
        return {
          connectedAgentsMap: nextAgents,
          sessionProjectMap: nextProjMap,
        };
      });
      if (!silent) {
        useUiStore.getState().notifyToast(`${agent.agentLabel} disconnected`);
      }
      return;
    }

    const { workspace, sessionProjectMap } = get();
    const prevProjKey = sessionProjectMap[agent.sessionId] ?? null;
    const alloc = allocateProjectSpace(workspace, {
      projectName: agent.project,
      previousProjectKey: prevProjKey,
    });

    set((s) => ({
      workspace: alloc.nextState,
      connectedAgentsMap: {
        ...s.connectedAgentsMap,
        [agent.sessionId]: agent,
      },
      sessionProjectMap: {
        ...s.sessionProjectMap,
        [agent.sessionId]: alloc.projectKey,
      },
    }));
    scheduleWorkspaceSave(alloc.nextState, reportPersistenceError);

    if (!silent && shouldAnnounce) {
      const projNote = agent.project ? ` (${agent.project})` : '';
      useUiStore.getState().notifyToast(`${agent.agentLabel} connected${projNote}`);
    }
  },

  applyIncomingDiagram: (diag) => {
    const { workspace, sessionProjectMap } = get();
    const prevActiveId = workspace.activeFileId;
    const prevProjKey = diag.agentSessionId
      ? (sessionProjectMap[diag.agentSessionId] ?? null)
      : null;

    const withCam = snapshotCameraIntoState(workspace);
    const canAutoFocus = useUiStore.getState().stageMode === 'preview';

    const upserted = upsertGraphInVfs(withCam, {
      projectName: diag.project,
      previousProjectKey: prevProjKey,
      path: diag.path,
      title: diag.title,
      code: diag.code,
      guide: diag.guide,
      diagramType: diag.diagramType,
      agentSlug: diag.agentSlug,
      agentLabel: diag.agentLabel,
      agentShortLabel: diag.agentShortLabel,
      agentSessionId: diag.agentSessionId,
      autoOpenTab: true,
      autoFocus: canAutoFocus,
    });

    set((s) => {
      const nextAgents = { ...s.connectedAgentsMap };
      const nextProjMap = { ...s.sessionProjectMap };
      if (diag.agentSessionId) {
        nextProjMap[diag.agentSessionId] = upserted.projectKey;
        const existingAg = nextAgents[diag.agentSessionId];
        if (existingAg) {
          nextAgents[diag.agentSessionId] = {
            ...existingAg,
            project: diag.project,
            lastActiveAt: Date.now(),
          };
        }
      }
      return {
        workspace: upserted.nextState,
        ...(upserted.nextState.activeFileId === upserted.file.id
          ? { selectedVersion: null }
          : {}),
        connectedAgentsMap: nextAgents,
        sessionProjectMap: nextProjMap,
      };
    });

    if (
      upserted.nextState.activeFileId === upserted.file.id ||
      upserted.nextState.activeFileId !== prevActiveId
    ) {
      syncCameraForActiveFile(upserted.nextState, null);
    }

    void saveWorkspaceImmediate(upserted.nextState, reportPersistenceError);
  },

  executeVfsRpc: (query) => {
    const { workspace } = get();
    if (query.op === 'ls') {
      return evaluateVfsLs(workspace, query.project, query.dirPath);
    }
    if (query.op === 'read') {
      return evaluateVfsRead(workspace, query.project, query.filePath, query.version);
    }
    const moved = movePathInProject(workspace, query.project, query.fromPath, query.toPath);
    set({ workspace: moved.nextState });
    void saveWorkspaceImmediate(moved.nextState, reportPersistenceError);
    return moved.result;
  },
}));
