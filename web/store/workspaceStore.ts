import { produce } from 'immer';
import { create } from 'zustand';
import { normalizeProjectName } from '../../src/shared/agentIdentity';
import { resolveGuideFlows } from '../../src/shared/comprehension';
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
  evaluateVfsLs,
  evaluateVfsRead,
  findFileWithProject,
  getHeadVersion,
  movePathInProject,
  normalizeWorkspaceConsistency,
  resolveProjectGraphHierarchy,
  toProjectKey,
  upsertGraphInVfs,
  type WorkspaceState,
} from '../../src/shared/vfs';
import { normalizeRelativeDirPath } from '../../src/shared/vfsPath';
import {
  getOrCreateWorkspaceId,
  loadWorkspaceFromIndexedDb,
  persistWorkspaceId,
  saveWorkspaceImmediate,
  scheduleWorkspaceSave,
} from '../services/workspacePersistence';
import { useUiStore } from './uiStore';

function reportPersistenceError(): void {
  useUiStore
    .getState()
    .notifyToast('Browser storage is full or unavailable. Export important diagrams.');
}

function snapshotCameraIntoState(state: WorkspaceState): WorkspaceState {
  if (!state.activeFileId) return state;
  const { zoom, pan, userCameraAdjusted } = useUiStore.getState();
  return produce(state, (draft) => {
    for (const p of draft.projects) {
      const f = p.files.find((item) => item.id === state.activeFileId);
      if (f) {
        if (userCameraAdjusted) {
          f.zoom = zoom;
          f.pan = pan;
        } else {
          f.zoom = null;
          f.pan = { x: 0, y: 0 };
        }
        return;
      }
    }
  });
}

function syncCameraForActiveFile(
  nextState: WorkspaceState,
  opts?: { preserveSelection?: boolean }
): void {
  if (!opts?.preserveSelection) {
    useUiStore.getState().resetComprehensionSelection();
  }
  const found = findFileWithProject(nextState, nextState.activeFileId);
  if (!found) {
    useUiStore.getState().clearRenderStage();
    return;
  }
  if (found.file.zoom !== null) {
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
  connectedAgentsMap: Record<string, AgentSessionInfo>;
  sessionProjectMap: Record<string, string>;

  hydrate: () => Promise<void>;

  toggleSidebar: () => void;
  resizeSidebar: (nextWidth: number) => void;
  toggleProjectExpanded: (projectKey: string) => void;

  openFile: (fileId: string) => void;
  createFolder: (projectKey: string, parentDir: string, rawFolderName: string) => void;
  renameFolder: (projectKey: string, fromFolderPath: string, toFolderPath: string) => void;

  deleteGraph: (projectKey: string, fileId: string) => void;
  deleteFolder: (projectKey: string, folderPath: string) => void;
  deleteProject: (projectKey: string) => void;

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
  connectedAgentsMap: {},
  sessionProjectMap: {},

  hydrate: () => {
    if (hydrationPromise) return hydrationPromise;
    hydrationPromise = (async () => {
      const loaded = await loadWorkspaceFromIndexedDb(reportPersistenceError);
      set({ workspace: loaded, hydrated: true });
      syncCameraForActiveFile(loaded);
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
    const { workspace } = get();
    if (workspace.activeFileId === fileId) return;

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

    set({ workspace: nextState });
    syncCameraForActiveFile(nextState);
    scheduleWorkspaceSave(nextState, reportPersistenceError);
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

  renameFolder: (projectKey, fromFolderPath, toFolderPath) => {
    try {
      const cleanFrom = normalizeRelativeDirPath(fromFolderPath);
      const cleanTo = normalizeRelativeDirPath(toFolderPath);
      if (!cleanFrom || !cleanTo || cleanFrom === cleanTo) return;

      const cur = get().workspace;
      const proj = cur.projects.find((p) => p.projectKey === projectKey);
      if (!proj) return;
      const moved = movePathInProject(cur, proj.projectLabel, cleanFrom, cleanTo);
      set({ workspace: moved.nextState });
      void saveWorkspaceImmediate(moved.nextState, reportPersistenceError);
    } catch (err: unknown) {
      useUiStore.getState().notifyToast(err instanceof Error ? err.message : 'Rename failed');
    }
  },

  deleteGraph: (projectKey, fileId) => {
    const prevSnapshot = snapshotCameraIntoState(get().workspace);
    const nextState = deleteGraphFromProject(prevSnapshot, projectKey, fileId);
    set({ workspace: nextState });
    syncCameraForActiveFile(nextState);
    void saveWorkspaceImmediate(nextState, reportPersistenceError);

    useUiStore.getState().notifyToast('Graph deleted', {
      label: 'Undo',
      onClick: () => {
        set({ workspace: prevSnapshot });
        syncCameraForActiveFile(prevSnapshot);
        void saveWorkspaceImmediate(prevSnapshot, reportPersistenceError);
        useUiStore.getState().dismissToast();
      },
    });
  },

  deleteFolder: (projectKey, folderPath) => {
    const prevSnapshot = snapshotCameraIntoState(get().workspace);
    const nextState = deleteFolderFromProject(prevSnapshot, projectKey, folderPath);
    set({ workspace: nextState });
    syncCameraForActiveFile(nextState);
    void saveWorkspaceImmediate(nextState, reportPersistenceError);

    useUiStore.getState().notifyToast('Folder deleted', {
      label: 'Undo',
      onClick: () => {
        set({ workspace: prevSnapshot });
        syncCameraForActiveFile(prevSnapshot);
        void saveWorkspaceImmediate(prevSnapshot, reportPersistenceError);
        useUiStore.getState().dismissToast();
      },
    });
  },

  deleteProject: (projectKey) => {
    const prevSnapshot = snapshotCameraIntoState(get().workspace);
    const nextState = deleteProjectFromWorkspace(prevSnapshot, projectKey);
    set({ workspace: nextState });
    syncCameraForActiveFile(nextState);
    void saveWorkspaceImmediate(nextState, reportPersistenceError);

    useUiStore.getState().notifyToast('Project deleted', {
      label: 'Undo',
      onClick: () => {
        set({ workspace: prevSnapshot });
        syncCameraForActiveFile(prevSnapshot);
        void saveWorkspaceImmediate(prevSnapshot, reportPersistenceError);
        useUiStore.getState().dismissToast();
      },
    });
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
    const prevEntry = findFileWithProject(workspace, prevActiveId);
    const prevProjKey = diag.agentSessionId
      ? (sessionProjectMap[diag.agentSessionId] ?? null)
      : null;

    const ui = useUiStore.getState();
    const prevHierarchy = prevEntry ? resolveProjectGraphHierarchy(prevEntry.project) : null;
    const prevRootId =
      prevEntry && prevHierarchy
        ? (prevHierarchy.getRootForFile(prevEntry.file.id)?.id ?? prevEntry.file.id)
        : null;
    const isZoomedIntoSubgraph = Boolean(
      prevEntry && prevHierarchy?.parentByFileId.has(prevEntry.file.id)
    );
    const isIdleWelcome = !prevEntry || Boolean(prevEntry.file.isWelcome);
    const isDeeplyStudying =
      !isIdleWelcome &&
      (ui.activeStepIndex !== null || ui.selectedNodeId !== null || isZoomedIntoSubgraph);

    const withCam = snapshotCameraIntoState(workspace);

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
      autoFocus: !isDeeplyStudying,
    });

    let finalState = upserted.nextState;
    const targetProj = finalState.projects.find((p) => p.projectKey === upserted.projectKey);
    const targetHierarchy = targetProj ? resolveProjectGraphHierarchy(targetProj) : null;
    const incomingRoot = targetHierarchy?.getRootForFile(upserted.file.id) ?? upserted.file;

    // If user is mid-study on a DIFFERENT graph, notify calmly instead of stealing focus
    const switchedToDifferentTree =
      isDeeplyStudying &&
      prevActiveId !== null &&
      upserted.projectKey === prevEntry?.project.projectKey
        ? incomingRoot.id !== prevRootId
        : isDeeplyStudying && prevActiveId !== null;

    if (switchedToDifferentTree && prevActiveId) {
      finalState = normalizeWorkspaceConsistency(
        produce(finalState, (draft) => {
          draft.activeFileId = prevActiveId;
          for (const p of draft.projects) {
            const rf = p.files.find((f) => f.id === incomingRoot.id);
            if (rf) rf.unread = true;
          }
        })
      );
    }

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
        workspace: finalState,
        connectedAgentsMap: nextAgents,
        sessionProjectMap: nextProjMap,
      };
    });

    if (switchedToDifferentTree) {
      const targetId = incomingRoot.id;
      useUiStore.getState().notifyToast(`New view: ${incomingRoot.title}`, {
        label: 'Open',
        onClick: () => {
          get().openFile(targetId);
          useUiStore.getState().dismissToast();
        },
      });
    } else if (finalState.activeFileId !== prevActiveId) {
      syncCameraForActiveFile(finalState);
    } else if (finalState.activeFileId === upserted.file.id) {
      syncCameraForActiveFile(finalState, { preserveSelection: true });
    }

    void saveWorkspaceImmediate(finalState, reportPersistenceError);
  },

  executeVfsRpc: (query) => {
    const { workspace } = get();
    if (query.op === 'ls') {
      const lsRes = evaluateVfsLs(workspace, query.project, query.dirPath);
      const targetProjKey = toProjectKey(normalizeProjectName(query.project) || 'General');
      const activeEntry = findFileWithProject(workspace, workspace.activeFileId);
      if (activeEntry && activeEntry.project.projectKey === targetProjKey) {
        const ui = useUiStore.getState();
        const ver = getHeadVersion(activeEntry.file);
        const flows = resolveGuideFlows(ver.guide);
        const curFlow =
          (ui.activeFlowId && flows.find((f) => f.id === ui.activeFlowId)) || flows[0] || null;
        const curStep =
          ui.activeStepIndex !== null && curFlow?.steps[ui.activeStepIndex]
            ? curFlow.steps[ui.activeStepIndex]!
            : null;
        return {
          ...lsRes,
          viewerFocus: {
            activePath: activeEntry.file.path,
            viewingVersion: ver.version,
            activeFlowId: curFlow?.id ?? null,
            activeFlowLabel: flows.length > 1 ? (curFlow?.label ?? null) : null,
            activeStepIndex: ui.activeStepIndex,
            activeStepTitle: curStep?.title ?? null,
            selectedNodeId: ui.selectedNodeId,
          },
        };
      }
      return lsRes;
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
