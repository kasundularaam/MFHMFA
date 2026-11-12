import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  normalizeAgentIdentity,
  normalizeProjectName,
} from '../../src/shared/agentIdentity';
import {
  buildPermalinkUrl,
  decodePermalinkPayload,
  extractHashToken,
} from '../../src/shared/permalink';
import { slugify } from '../../src/shared/svg';
import type {
  AgentSessionInfo,
  DiagramComprehensionGuide,
  DiagramRelayPayload,
  ParseErrorDetail,
  VfsRpcRequest,
} from '../../src/shared/types';
import {
  inferPathFromTitle,
  normalizeRelativeDirPath,
  normalizeRelativeGraphPath,
} from '../../src/shared/vfsPath';
import {
  getCachedClientRender,
  renderMermaidClient,
} from '../services/mermaidRenderer';
import { studioApi, type ServerStatus } from '../services/studioClient';
import {
  allocateProjectSpace,
  computeStorageStats,
  editGraphByHuman,
  evaluateVfsLs,
  evaluateVfsRead,
  findFileWithProject,
  GENERAL_PROJECT_KEY,
  getHeadVersion,
  getVersionRecord,
  initializeWorkspaceStorage,
  movePathInProject,
  NEW_TAB_STARTER,
  normalizeWorkspaceConsistency,
  persistWorkspaceState,
  randomToken,
  restoreGraphVersion,
  SCRATCHPAD_PROJECT_KEY,
  toProjectKey,
  upsertGraphInVfs,
  WORKSPACE_ID_KEY,
  type VfsGraphFile,
  type VfsProjectRoot,
  type WorkspaceState,
} from '../services/workspaceStorage';
import type { AppearanceMode } from '../theme/comfortTheme';

export type StudioPage = 'studio' | 'docs';
export type StageMode = 'preview' | 'code';
export type RelayConnectionState = 'connecting' | 'connected' | 'paused' | 'reconnecting';

const LOCAL_WORKSPACE_CHANNEL = 'local_workspace';

export interface OpenTabEntry {
  file: VfsGraphFile;
  project: VfsProjectRoot;
}

export function useStudioController() {
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>(() => {
    const saved = localStorage.getItem('mermaid-studio-mode');
    return saved === 'light' ? 'light' : 'dark';
  });

  const initialWorkspace = useRef<WorkspaceState | null>(null);
  if (!initialWorkspace.current) {
    initialWorkspace.current = initializeWorkspaceStorage();
  }

  const [workspace, setWorkspace] = useState<WorkspaceState>(initialWorkspace.current);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [page, setPage] = useState<StudioPage>('studio');
  const [stageMode, setStageMode] = useState<StageMode>('preview');

  const [relayState, setRelayState] = useState<RelayConnectionState>('connecting');
  const [connectedAgentsMap, setConnectedAgentsMap] = useState<
    Record<string, AgentSessionInfo>
  >({});
  const [hasBufferedLiveUpdate, setHasBufferedLiveUpdate] = useState(false);

  const openTabs: OpenTabEntry[] = useMemo(() => {
    const list: OpenTabEntry[] = [];
    for (const tabId of workspace.openTabIds) {
      const found = findFileWithProject(workspace, tabId);
      if (found) list.push(found);
    }
    return list;
  }, [workspace]);

  const activeEntry = useMemo(
    () => findFileWithProject(workspace, workspace.activeFileId),
    [workspace]
  );

  const activeFile = activeEntry?.file ?? null;
  const activeProject = activeEntry?.project ?? null;
  const activeVersionRecord = useMemo(
    () => (activeFile ? getVersionRecord(activeFile, selectedVersion) : null),
    [activeFile, selectedVersion]
  );
  const isHistoricalVersion = Boolean(
    activeFile &&
      activeVersionRecord &&
      activeVersionRecord.version !== activeFile.currentVersion
  );

  const code = activeVersionRecord?.code ?? '';
  const activeGuide = activeVersionRecord?.guide;
  const title = activeFile?.title ?? null;
  const chartKey = activeFile
    ? `${activeFile.id}:v${activeVersionRecord?.version ?? activeFile.currentVersion}`
    : 'empty-stage';

  const [activeStepIndex, setActiveStepIndex] = useState<number | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [drillStack, setDrillStack] = useState<string[]>([]);

  const [renderedSvg, setRenderedSvg] = useState<string>('');
  const [diagramType, setDiagramType] = useState<string | null>('flowchart-v2');
  const [parseError, setParseError] = useState<ParseErrorDetail | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [toast, setToast] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState(false);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const bootstrappedRef = useRef(false);
  const renderCounterRef = useRef(0);
  const skipNextCodeEffectRef = useRef(false);
  const needsFitOnPreviewRef = useRef(true);

  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const stageModeRef = useRef(stageMode);
  stageModeRef.current = stageMode;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const panRef = useRef(pan);
  panRef.current = pan;
  const appearanceRef = useRef(appearanceMode);
  appearanceRef.current = appearanceMode;

  const livePausedRef = useRef(false);
  const seenRenderIdsRef = useRef<Set<string>>(new Set());
  const handledRpcIdsRef = useRef<Set<string>>(new Set());
  const announcedSessionsRef = useRef<Set<string>>(new Set());
  const sessionProjectMapRef = useRef<Map<string, string>>(new Map());
  const bufferedDiagramsRef = useRef<DiagramRelayPayload[]>([]);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connectedAgents = useMemo(
    () => Object.values(connectedAgentsMap),
    [connectedAgentsMap]
  );

  const liveProjectCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ag of connectedAgents) {
      const pKey = ag.project ? toProjectKey(ag.project) : GENERAL_PROJECT_KEY;
      counts.set(pKey, (counts.get(pKey) ?? 0) + 1);
    }
    return counts;
  }, [connectedAgents]);

  const storageStats = useMemo(() => computeStorageStats(workspace), [workspace]);

  useEffect(() => {
    document.documentElement.dataset.mode = appearanceMode;
    localStorage.setItem('mermaid-studio-mode', appearanceMode);
  }, [appearanceMode]);

  useEffect(() => {
    persistWorkspaceState(workspace);
  }, [workspace]);

  // Reset transient Story Stepper & Node Inspector selection when switching files/versions
  const activeFileIdVal = activeFile?.id ?? null;
  useEffect(() => {
    setActiveStepIndex(null);
    setSelectedNodeId(null);
  }, [activeFileIdVal, selectedVersion]);

  // Clamp step index & node selection safely if a live update alters the active guide
  useEffect(() => {
    const stepLen = activeGuide?.steps?.length ?? 0;
    if (activeStepIndex !== null && (stepLen === 0 || activeStepIndex >= stepLen)) {
      setActiveStepIndex(stepLen > 0 ? stepLen - 1 : null);
    }
    if (selectedNodeId && !activeGuide?.nodes?.[selectedNodeId]) {
      setSelectedNodeId(null);
    }
  }, [activeGuide, activeStepIndex, selectedNodeId]);

  const parentGraphEntry = useMemo(() => {
    for (let i = drillStack.length - 1; i >= 0; i--) {
      const candidateId = drillStack[i]!;
      if (candidateId === activeFileIdVal) continue;
      const found = findFileWithProject(workspace, candidateId);
      if (found) return { file: found.file, fromStack: true };
    }
    if (activeGuide?.parentPath && activeProject) {
      try {
        const cleanParent = normalizeRelativeGraphPath(activeGuide.parentPath);
        const match = activeProject.files.find(
          (f) => f.path === cleanParent && f.id !== activeFileIdVal
        );
        if (match) return { file: match, fromStack: false };
      } catch {
        // ignore invalid parentPath
      }
    }
    return null;
  }, [drillStack, activeFileIdVal, workspace, activeGuide, activeProject]);

  const toggleAppearanceMode = useCallback(() => {
    setAppearanceMode((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const notifyToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    if (toastClearRef.current) clearTimeout(toastClearRef.current);

    setToast(msg);
    requestAnimationFrame(() => setToastVisible(true));

    toastTimerRef.current = setTimeout(() => {
      setToastVisible(false);
      toastClearRef.current = setTimeout(() => {
        setToast(null);
      }, 200);
    }, 2400);
  }, []);

  const hasGuideDock = Boolean(
    activeGuide?.gist ||
      (activeGuide?.steps && activeGuide.steps.length > 0) ||
      (activeGuide?.nodes && Object.keys(activeGuide.nodes).length > 0)
  );

  const computeViewportFitZoom = useCallback(
    (w: number, h: number): number | null => {
      const vp = viewportRef.current;
      if (!vp || vp.clientWidth === 0 || vp.clientHeight === 0) {
        return null;
      }
      const vw = Math.max(280, vp.clientWidth - 96);
      const vh = Math.max(200, vp.clientHeight - (hasGuideDock ? 186 : 96));
      const fit = Math.min(1, Math.max(0.22, Math.min(vw / (w + 48), vh / (h + 48))));
      return Number(fit.toFixed(2));
    },
    [hasGuideDock]
  );

  useLayoutEffect(() => {
    if (
      page === 'studio' &&
      stageMode === 'preview' &&
      needsFitOnPreviewRef.current &&
      dimensions &&
      activeFile
    ) {
      const fit = computeViewportFitZoom(dimensions.width, dimensions.height);
      if (fit !== null) {
        setZoom(fit);
        setPan({ x: 0, y: hasGuideDock ? -34 : 0 });
        needsFitOnPreviewRef.current = false;
      }
    }
  }, [page, stageMode, dimensions, activeFile, computeViewportFitZoom, hasGuideDock]);

  const snapshotCurrentCamera = useCallback((state: WorkspaceState): WorkspaceState => {
    if (!state.activeFileId) return state;
    return {
      ...state,
      projects: state.projects.map((p) => {
        if (!p.files.some((f) => f.id === state.activeFileId)) return p;
        return {
          ...p,
          files: p.files.map((f) =>
            f.id === state.activeFileId
              ? { ...f, zoom: zoomRef.current, pan: panRef.current }
              : f
          ),
        };
      }),
    };
  }, []);

  const activateStateAndRender = useCallback(
    async (nextState: WorkspaceState, versionOverride: number | null = null) => {
      const normalized = normalizeWorkspaceConsistency(nextState);
      const found = findFileWithProject(normalized, normalized.activeFileId);
      const seq = ++renderCounterRef.current;

      // Commit VFS state synchronously so concurrent SSE frames & `ls`/`read`/`mv` RPCs
      // always observe the latest workspace state immediately without race windows.
      workspaceRef.current = normalized;
      skipNextCodeEffectRef.current = true;
      setSelectedVersion(versionOverride);
      setWorkspace(normalized);

      if (!found) {
        setRenderedSvg('');
        setParseError(null);
        setDimensions(null);
        return;
      }

      const targetVer = getVersionRecord(found.file, versionOverride);
      const outcome = await renderMermaidClient(targetVer.code, appearanceRef.current);
      if (seq !== renderCounterRef.current) return;

      if (found.file.zoom !== null && versionOverride === null) {
        needsFitOnPreviewRef.current = false;
        setZoom(found.file.zoom);
        setPan(found.file.pan);
      } else {
        needsFitOnPreviewRef.current = true;
      }

      if (outcome.ok) {
        setRenderedSvg(outcome.svg);
        setDiagramType(outcome.diagramType);
        setDimensions(outcome.dimensions);
        setParseError(null);
      } else {
        setRenderedSvg('');
      }
    },
    []
  );

  const importHashPermalinkIfPresent = useCallback(async (): Promise<boolean> => {
    const zToken = extractHashToken(window.location.hash);
    if (!zToken) return false;

    try {
      const decoded = await decodePermalinkPayload(zToken);
      const rawItems =
        decoded.tabs && decoded.tabs.length > 0
          ? decoded.tabs
          : [
              {
                code: decoded.code,
                title: decoded.title,
                path: decoded.path,
                project: decoded.project,
                agent: decoded.agent,
                guide: decoded.guide,
              },
            ];

      let nextState = snapshotCurrentCamera(workspaceRef.current);
      let focusFileId: string | null = null;
      const targetIdx =
        typeof decoded.activeIndex === 'number' &&
        decoded.activeIndex >= 0 &&
        decoded.activeIndex < rawItems.length
          ? decoded.activeIndex
          : 0;

      rawItems.forEach((item, idx) => {
        const itemTitle = item.title?.trim() || `diagram-${idx + 1}`;
        const projLabel = normalizeProjectName(item.project) || 'shared';
        const relPath = item.path?.trim()
          ? normalizeRelativeGraphPath(item.path)
          : inferPathFromTitle(itemTitle);
        const agentNorm = item.agent?.trim()
          ? normalizeAgentIdentity(item.agent)
          : { slug: 'shared', label: 'Shared Link', shortLabel: 'shared' };

        const upserted = upsertGraphInVfs(nextState, {
          projectName: projLabel,
          path: relPath,
          title: itemTitle,
          code: item.code,
          guide: item.guide ?? (rawItems.length === 1 ? decoded.guide : undefined),
          agentSlug: agentNorm.slug,
          agentLabel: agentNorm.label,
          agentShortLabel: agentNorm.shortLabel,
          autoOpenTab: true,
          autoFocus: idx === targetIdx,
        });
        nextState = upserted.nextState;
        if (idx === targetIdx) {
          focusFileId = upserted.file.id;
        }
      });

      if (focusFileId) {
        nextState = { ...nextState, activeFileId: focusFileId };
      }

      await activateStateAndRender(nextState);
      return true;
    } catch {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      notifyToast('Invalid permalink — opened local workspace');
      return false;
    }
  }, [activateStateAndRender, notifyToast, snapshotCurrentCamera]);

  // Initial bootstrap & hashchange
  useEffect(() => {
    studioApi
      .getStatus()
      .then((st) => setStatus(st))
      .catch(() => {});

    (async () => {
      const imported = await importHashPermalinkIfPresent();
      if (!imported) {
        await activateStateAndRender(workspaceRef.current);
      }
      bootstrappedRef.current = true;
    })();

    const onHashChange = () => {
      importHashPermalinkIfPresent().catch(() => {});
    };

    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [activateStateAndRender, importHashPermalinkIfPresent]);

  const handleIncomingAgentStatus = useCallback(
    (agent: AgentSessionInfo, silent = false) => {
      if (agent.status === 'disconnected') {
        announcedSessionsRef.current.delete(agent.sessionId);
        sessionProjectMapRef.current.delete(agent.sessionId);
        setConnectedAgentsMap((prev) => {
          if (!prev[agent.sessionId]) return prev;
          const copy = { ...prev };
          delete copy[agent.sessionId];
          return copy;
        });
        if (!silent) {
          notifyToast(`${agent.agentLabel} disconnected`);
        }
        return;
      }

      setConnectedAgentsMap((prev) => ({
        ...prev,
        [agent.sessionId]: agent,
      }));

      const prevProjKey = sessionProjectMapRef.current.get(agent.sessionId) ?? null;
      const alloc = allocateProjectSpace(workspaceRef.current, {
        projectName: agent.project,
        previousProjectKey: prevProjKey,
      });

      sessionProjectMapRef.current.set(agent.sessionId, alloc.projectKey);
      workspaceRef.current = alloc.nextState;
      setWorkspace(alloc.nextState);

      if (!silent && !announcedSessionsRef.current.has(agent.sessionId)) {
        announcedSessionsRef.current.add(agent.sessionId);
        const projNote = agent.project ? ` (${agent.project})` : '';
        notifyToast(`${agent.agentLabel} connected${projNote}`);
      }
    },
    [notifyToast]
  );

  const applyIncomingDiagram = useCallback(
    async (diag: DiagramRelayPayload) => {
      if (seenRenderIdsRef.current.has(diag.renderId)) return;
      seenRenderIdsRef.current.add(diag.renderId);

      if (livePausedRef.current) {
        bufferedDiagramsRef.current.push(diag);
        setHasBufferedLiveUpdate(true);
        return;
      }

      const prevProjKey = diag.agentSessionId
        ? sessionProjectMapRef.current.get(diag.agentSessionId) ?? null
        : null;

      const withCamera = snapshotCurrentCamera(workspaceRef.current);
      const canAutoFocus = stageModeRef.current === 'preview';

      const upserted = upsertGraphInVfs(withCamera, {
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

      if (diag.agentSessionId) {
        sessionProjectMapRef.current.set(diag.agentSessionId, upserted.projectKey);
        setConnectedAgentsMap((prev) => {
          const existing = prev[diag.agentSessionId!];
          if (!existing) return prev;
          return {
            ...prev,
            [diag.agentSessionId!]: {
              ...existing,
              project: diag.project,
              lastActiveAt: Date.now(),
            },
          };
        });
      }

      if (upserted.nextState.activeFileId === upserted.file.id) {
        await activateStateAndRender(upserted.nextState, null);
      } else {
        workspaceRef.current = upserted.nextState;
        setWorkspace(upserted.nextState);
      }
    },
    [activateStateAndRender, snapshotCurrentCamera]
  );

  const handleIncomingVfsRequest = useCallback(
    (channelToken: string, req: VfsRpcRequest) => {
      if (handledRpcIdsRef.current.has(req.requestId)) return;
      handledRpcIdsRef.current.add(req.requestId);

      try {
        if (req.op === 'ls') {
          const result = evaluateVfsLs(workspaceRef.current, req.project, req.dirPath);
          studioApi
            .replyVfsRequest(channelToken, {
              requestId: req.requestId,
              ok: true,
              result,
            })
            .catch(() => {});
          return;
        }

        if (req.op === 'read') {
          const result = evaluateVfsRead(
            workspaceRef.current,
            req.project,
            req.filePath,
            req.version
          );
          studioApi
            .replyVfsRequest(channelToken, {
              requestId: req.requestId,
              ok: true,
              result,
            })
            .catch(() => {});
          return;
        }

        if (req.op === 'mv') {
          const moved = movePathInProject(
            workspaceRef.current,
            req.project,
            req.fromPath,
            req.toPath
          );
          workspaceRef.current = moved.nextState;
          setWorkspace(moved.nextState);
          studioApi
            .replyVfsRequest(channelToken, {
              requestId: req.requestId,
              ok: true,
              result: moved.result,
            })
            .catch(() => {});
          return;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        studioApi
          .replyVfsRequest(channelToken, {
            requestId: req.requestId,
            ok: false,
            error: message,
          })
          .catch(() => {});
      }
    },
    []
  );

  // Bidirectional Stateless SSE Relay Connection
  useEffect(() => {
    const channels: string[] = [workspace.workspaceId];
    const searchParams = new URLSearchParams(window.location.search);
    const explicitUrlWs = searchParams.get('workspace') || searchParams.get('ws');
    const host = window.location.hostname;
    if (
      !explicitUrlWs &&
      (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') &&
      workspace.workspaceId !== LOCAL_WORKSPACE_CHANNEL
    ) {
      channels.push(LOCAL_WORKSPACE_CHANNEL);
    }

    const sources: EventSource[] = [];

    for (const channel of channels) {
      const es = new EventSource(`/api/workspace/${encodeURIComponent(channel)}/events`);

      es.onopen = () => {
        if (!livePausedRef.current) {
          setRelayState('connected');
        }
      };

      es.onerror = () => {
        if (!livePausedRef.current) {
          setRelayState('reconnecting');
        }
      };

      es.addEventListener('connected_agents', (ev: MessageEvent) => {
        try {
          const parsed = JSON.parse(String(ev.data)) as {
            agents?: AgentSessionInfo[];
          };
          if (Array.isArray(parsed.agents)) {
            for (const ag of parsed.agents) {
              announcedSessionsRef.current.add(ag.sessionId);
              handleIncomingAgentStatus(ag, true);
            }
          }
        } catch {
          // ignore
        }
      });

      es.addEventListener('agent_status', (ev: MessageEvent) => {
        try {
          const ag = JSON.parse(String(ev.data)) as AgentSessionInfo;
          if (ag && typeof ag.sessionId === 'string') {
            handleIncomingAgentStatus(ag, false);
          }
        } catch {
          // ignore
        }
      });

      es.addEventListener('diagram', (ev: MessageEvent) => {
        try {
          const diag = JSON.parse(String(ev.data)) as DiagramRelayPayload;
          if (diag && typeof diag.code === 'string') {
            applyIncomingDiagram(diag).catch(() => {});
          }
        } catch {
          // ignore
        }
      });

      es.addEventListener('vfs_request', (ev: MessageEvent) => {
        try {
          const req = JSON.parse(String(ev.data)) as VfsRpcRequest;
          if (req && typeof req.requestId === 'string') {
            handleIncomingVfsRequest(channel, req);
          }
        } catch {
          // ignore
        }
      });

      sources.push(es);
    }

    return () => {
      for (const es of sources) {
        es.close();
      }
    };
  }, [
    workspace.workspaceId,
    handleIncomingAgentStatus,
    applyIncomingDiagram,
    handleIncomingVfsRequest,
  ]);

  // ============================================================================
  // Sidebar, Explorer Tree & Open Tab Actions
  // ============================================================================

  const handleToggleSidebar = useCallback(() => {
    setWorkspace((prev) => {
      const next = { ...prev, sidebarOpen: !prev.sidebarOpen };
      workspaceRef.current = next;
      return next;
    });
  }, []);

  const handleResizeSidebar = useCallback((nextWidth: number) => {
    const clamped = Math.min(460, Math.max(190, Math.round(nextWidth)));
    setWorkspace((prev) => {
      const next = { ...prev, sidebarWidth: clamped };
      workspaceRef.current = next;
      return next;
    });
  }, []);

  const handleToggleProjectExpanded = useCallback((projectKey: string) => {
    setWorkspace((prev) => {
      const next: WorkspaceState = {
        ...prev,
        projects: prev.projects.map((p) =>
          p.projectKey === projectKey ? { ...p, expanded: !p.expanded } : p
        ),
      };
      workspaceRef.current = next;
      return next;
    });
  }, []);

  const handleOpenFile = useCallback(
    (fileId: string) => {
      const cur = workspaceRef.current;
      if (cur.activeFileId === fileId && selectedVersion === null) {
        return;
      }

      const withCamera = snapshotCurrentCamera(cur);
      const nextOpenTabs = withCamera.openTabIds.includes(fileId)
        ? withCamera.openTabIds
        : [...withCamera.openTabIds, fileId];

      const nextState: WorkspaceState = {
        ...withCamera,
        openTabIds: nextOpenTabs,
        activeFileId: fileId,
        projects: withCamera.projects.map((p) => ({
          ...p,
          files: p.files.map((f) =>
            f.id === fileId ? { ...f, unread: false } : f
          ),
        })),
      };

      activateStateAndRender(nextState, null).catch(() => {});
    },
    [activateStateAndRender, selectedVersion, snapshotCurrentCamera]
  );

  /**
   * Closes the open editor tab ONLY — the diagram remains safely in the Left Explorer tree!
   */
  const handleCloseTab = useCallback(
    (fileId: string) => {
      const cur = snapshotCurrentCamera(workspaceRef.current);
      const idx = cur.openTabIds.indexOf(fileId);
      if (idx < 0) return;

      const remaining = cur.openTabIds.filter((id) => id !== fileId);
      let nextActive = cur.activeFileId;
      if (cur.activeFileId === fileId) {
        nextActive =
          remaining.length > 0
            ? remaining[Math.min(idx, remaining.length - 1)]!
            : null;
      }

      const nextState: WorkspaceState = {
        ...cur,
        openTabIds: remaining,
        activeFileId: nextActive,
      };
      activateStateAndRender(nextState, null).catch(() => {});
    },
    [activateStateAndRender, snapshotCurrentCamera]
  );

  const handleCreateGraph = useCallback(
    (targetProjectKey?: string, parentDir = '', rawName?: string) => {
      const cur = snapshotCurrentCamera(workspaceRef.current);
      const fallbackProj =
        activeEntry?.project.projectKey ||
        cur.projects[0]?.projectKey ||
        SCRATCHPAD_PROJECT_KEY;
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

        // Avoid overwriting an existing graph when clicking quick `+`
        if (proj && proj.files.some((f) => f.path === relPath) && !rawName) {
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

        activateStateAndRender(upserted.nextState, null).catch(() => {});
      } catch (err: unknown) {
        notifyToast(err instanceof Error ? err.message : 'Invalid graph path');
      }
    },
    [activateStateAndRender, activeEntry, notifyToast, snapshotCurrentCamera]
  );

  const handleCreateFolder = useCallback(
    (projectKey: string, parentDir: string, rawFolderName: string) => {
      try {
        const combined = parentDir
          ? `${parentDir}/${rawFolderName.trim()}`
          : rawFolderName.trim();
        const cleanDir = normalizeRelativeDirPath(combined);
        if (!cleanDir) return;

        setWorkspace((prev) => {
          const next: WorkspaceState = {
            ...prev,
            projects: prev.projects.map((p) => {
              if (p.projectKey !== projectKey) return p;
              if (p.folders.includes(cleanDir)) return { ...p, expanded: true };
              return {
                ...p,
                expanded: true,
                updatedAt: Date.now(),
                folders: [...p.folders, cleanDir],
              };
            }),
          };
          workspaceRef.current = next;
          return next;
        });
      } catch (err: unknown) {
        notifyToast(err instanceof Error ? err.message : 'Invalid folder name');
      }
    },
    [notifyToast]
  );

  const handleRenamePath = useCallback(
    (projectKey: string, fromPath: string, toPath: string) => {
      try {
        const proj = workspaceRef.current.projects.find(
          (p) => p.projectKey === projectKey
        );
        if (!proj) return;
        const moved = movePathInProject(
          workspaceRef.current,
          proj.projectLabel,
          fromPath,
          toPath
        );
        workspaceRef.current = moved.nextState;
        setWorkspace(moved.nextState);
      } catch (err: unknown) {
        notifyToast(err instanceof Error ? err.message : 'Rename failed');
      }
    },
    [notifyToast]
  );

  // Human-Only Deletion Actions
  const handleDeleteGraph = useCallback(
    (projectKey: string, fileId: string) => {
      const cur = snapshotCurrentCamera(workspaceRef.current);
      const nextProjects = cur.projects.map((p) => {
        if (p.projectKey !== projectKey) return p;
        return {
          ...p,
          updatedAt: Date.now(),
          files: p.files.filter((f) => f.id !== fileId),
        };
      });

      const nextState = normalizeWorkspaceConsistency({
        ...cur,
        projects: nextProjects,
        openTabIds: cur.openTabIds.filter((id) => id !== fileId),
        activeFileId: cur.activeFileId === fileId ? null : cur.activeFileId,
      });

      activateStateAndRender(nextState, null).catch(() => {});
      notifyToast('Deleted graph');
    },
    [activateStateAndRender, notifyToast, snapshotCurrentCamera]
  );

  const handleDeleteFolder = useCallback(
    (projectKey: string, folderPath: string) => {
      const cur = snapshotCurrentCamera(workspaceRef.current);
      const prefix = `${folderPath}/`;
      const removedIds = new Set<string>();

      const nextProjects = cur.projects.map((p) => {
        if (p.projectKey !== projectKey) return p;
        for (const f of p.files) {
          if (f.path.startsWith(prefix)) removedIds.add(f.id);
        }
        return {
          ...p,
          updatedAt: Date.now(),
          folders: p.folders.filter(
            (d) => d !== folderPath && !d.startsWith(prefix)
          ),
          files: p.files.filter((f) => !f.path.startsWith(prefix)),
        };
      });

      const nextState = normalizeWorkspaceConsistency({
        ...cur,
        projects: nextProjects,
        openTabIds: cur.openTabIds.filter((id) => !removedIds.has(id)),
        activeFileId:
          cur.activeFileId && removedIds.has(cur.activeFileId)
            ? null
            : cur.activeFileId,
      });

      activateStateAndRender(nextState, null).catch(() => {});
      notifyToast(`Deleted folder "${folderPath}"`);
    },
    [activateStateAndRender, notifyToast, snapshotCurrentCamera]
  );

  const handleDeleteProject = useCallback(
    (projectKey: string) => {
      const cur = snapshotCurrentCamera(workspaceRef.current);
      const removedIds = new Set<string>();
      const target = cur.projects.find((p) => p.projectKey === projectKey);
      for (const f of target?.files ?? []) {
        removedIds.add(f.id);
      }

      let remaining = cur.projects.filter((p) => p.projectKey !== projectKey);
      if (remaining.length === 0) {
        const now = Date.now();
        remaining = [
          {
            projectKey: SCRATCHPAD_PROJECT_KEY,
            projectLabel: 'scratchpad',
            isScratchpad: true,
            expanded: true,
            folders: [],
            files: [],
            createdAt: now,
            updatedAt: now,
          },
        ];
      }

      const nextState = normalizeWorkspaceConsistency({
        ...cur,
        projects: remaining,
        openTabIds: cur.openTabIds.filter((id) => !removedIds.has(id)),
        activeFileId:
          cur.activeFileId && removedIds.has(cur.activeFileId)
            ? null
            : cur.activeFileId,
      });

      activateStateAndRender(nextState, null).catch(() => {});
      notifyToast(`Removed project "${target?.projectLabel || projectKey}"`);
    },
    [activateStateAndRender, notifyToast, snapshotCurrentCamera]
  );

  // Version History Actions (Last-5 Immutable Ring Buffer)
  const handleSelectVersion = useCallback(
    (version: number | null) => {
      activateStateAndRender(workspaceRef.current, version).catch(() => {});
    },
    [activateStateAndRender]
  );

  const handleRestoreVersion = useCallback(
    (version: number) => {
      const cur = workspaceRef.current;
      if (!cur.activeFileId) return;
      const restored = restoreGraphVersion(cur, cur.activeFileId, version);
      activateStateAndRender(restored.nextState, null).catch(() => {});
      notifyToast(`Restored v${version} as latest revision`);
    },
    [activateStateAndRender, notifyToast]
  );

  const handleChangeCode = useCallback(
    (nextCode: string) => {
      const cur = workspaceRef.current;
      if (!cur.activeFileId) return;

      if (selectedVersion !== null) {
        setSelectedVersion(null);
      }

      const next = editGraphByHuman(cur, cur.activeFileId, nextCode);
      workspaceRef.current = next;
      setWorkspace(next);
    },
    [selectedVersion]
  );

  // Client Mermaid re-render on edits or Dark/Light theme toggle
  useEffect(() => {
    if (!bootstrappedRef.current) return undefined;

    if (skipNextCodeEffectRef.current) {
      skipNextCodeEffectRef.current = false;
      return undefined;
    }

    if (!activeFile) {
      return undefined;
    }

    const cached = getCachedClientRender(code, appearanceMode);
    if (cached) {
      setRenderedSvg(cached.svg);
      setDiagramType(cached.diagramType);
      setParseError(null);
      setDimensions(cached.dimensions);
      return undefined;
    }

    const seq = ++renderCounterRef.current;
    const timer = setTimeout(async () => {
      if (seq !== renderCounterRef.current) return;

      if (!code.trim()) {
        setRenderedSvg('');
        setParseError({
          message: 'Diagram source is empty',
          rawMessage: 'Empty code',
          line: 1,
          column: 1,
          snippet: null,
          expected: null,
          suggestion: 'Start with `flowchart TD`, `sequenceDiagram`, or `erDiagram`.',
        });
        return;
      }

      const outcome = await renderMermaidClient(code, appearanceMode);
      if (seq !== renderCounterRef.current) return;

      if (outcome.ok) {
        setRenderedSvg(outcome.svg);
        setDiagramType(outcome.diagramType);
        setParseError(null);
        setDimensions(outcome.dimensions);
        if (stageMode === 'code') {
          needsFitOnPreviewRef.current = true;
        }
      } else {
        try {
          const diag = await studioApi.validate(code);
          if (seq !== renderCounterRef.current) return;
          if (!diag.valid && diag.error) {
            setParseError(diag.error);
          }
        } catch (fallbackErr: unknown) {
          if (seq !== renderCounterRef.current) return;
          const message =
            fallbackErr instanceof Error ? fallbackErr.message : 'Syntax error';
          setParseError({
            message,
            rawMessage: String(fallbackErr),
            line: null,
            column: null,
            snippet: null,
            expected: null,
            suggestion: 'Wrap special characters inside double quotes ["..."].',
          });
        }
      }
    }, 90);

    return () => clearTimeout(timer);
  }, [activeFile, code, appearanceMode, stageMode]);

  const handleDrillToPath = useCallback(
    (rawTargetPath: string) => {
      if (!activeProject) return;
      try {
        const targetRel = normalizeRelativeGraphPath(rawTargetPath);
        const targetFile = activeProject.files.find((f) => f.path === targetRel);
        if (!targetFile) {
          notifyToast(`Sub-graph "${targetRel}" is not in this workspace yet`);
          return;
        }
        if (activeFile && activeFile.id !== targetFile.id) {
          setDrillStack((prev) =>
            prev[prev.length - 1] === activeFile.id ? prev : [...prev, activeFile.id]
          );
        }
        handleOpenFile(targetFile.id);
      } catch (err: unknown) {
        notifyToast(err instanceof Error ? err.message : 'Invalid sub-graph path');
      }
    },
    [activeFile, activeProject, handleOpenFile, notifyToast]
  );

  const handleDrillBack = useCallback(() => {
    if (!parentGraphEntry) return;
    if (parentGraphEntry.fromStack) {
      setDrillStack((prev) => {
        const idx = prev.lastIndexOf(parentGraphEntry.file.id);
        return idx >= 0 ? prev.slice(0, idx) : prev;
      });
    }
    handleOpenFile(parentGraphEntry.file.id);
  }, [handleOpenFile, parentGraphEntry]);

  // Keyboard shortcuts: Ctrl/Cmd+B (Explorer), Ctrl/Cmd+E (Preview <-> Code), Alt+1..9 (Tabs),
  // plus Story Mode ArrowLeft/ArrowRight & Escape in Preview mode!
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (page !== 'studio') return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        handleToggleSidebar();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        if (workspaceRef.current.activeFileId) {
          setStageMode((m) => (m === 'preview' ? 'code' : 'preview'));
        }
        return;
      }

      if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
        const idx = Number.parseInt(e.key, 10) - 1;
        const targetId = workspaceRef.current.openTabIds[idx];
        if (targetId) {
          e.preventDefault();
          handleOpenFile(targetId);
        }
        return;
      }

      const targetEl = e.target as HTMLElement | null;
      const inEditable = Boolean(
        targetEl &&
          (targetEl.tagName === 'INPUT' ||
            targetEl.tagName === 'TEXTAREA' ||
            targetEl.isContentEditable ||
            targetEl.closest('.cm-editor'))
      );
      if (inEditable || stageMode !== 'preview') return;

      const stepTotal = activeGuide?.steps?.length ?? 0;

      if (e.key === 'Escape') {
        if (selectedNodeId !== null) {
          e.preventDefault();
          setSelectedNodeId(null);
          return;
        }
        if (activeStepIndex !== null) {
          e.preventDefault();
          setActiveStepIndex(null);
          return;
        }
      }

      if (
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        stepTotal > 0 &&
        e.key === 'ArrowRight'
      ) {
        e.preventDefault();
        setActiveStepIndex((prev) =>
          prev === null ? 0 : Math.min(stepTotal - 1, prev + 1)
        );
        return;
      }

      if (
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        stepTotal > 0 &&
        e.key === 'ArrowLeft'
      ) {
        e.preventDefault();
        setActiveStepIndex((prev) =>
          prev === null ? stepTotal - 1 : prev === 0 ? null : prev - 1
        );
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeGuide,
    activeStepIndex,
    handleOpenFile,
    handleToggleSidebar,
    page,
    selectedNodeId,
    stageMode,
  ]);

  const handleFitCanvas = useCallback(() => {
    const basePan = { x: 0, y: hasGuideDock ? -34 : 0 };
    if (!dimensions) {
      setZoom(1);
      setPan(basePan);
      return;
    }
    const fit = computeViewportFitZoom(dimensions.width, dimensions.height);
    setZoom(fit ?? 1);
    setPan(basePan);
  }, [computeViewportFitZoom, dimensions, hasGuideDock]);

  const handleCopyPermalink = useCallback(async () => {
    const flatItems: Array<{
      fileId: string;
      code: string;
      title: string;
      path: string;
      project?: string;
      agent?: string;
      guide?: DiagramComprehensionGuide;
    }> = [];

    for (const p of workspaceRef.current.projects) {
      for (const f of p.files) {
        const head = getHeadVersion(f);
        if (head.code.trim()) {
          flatItems.push({
            fileId: f.id,
            code: head.code,
            title: f.title,
            path: f.path,
            project: p.isScratchpad ? undefined : p.projectLabel,
            agent: head.authorSlug === 'user' ? undefined : head.authorLabel,
            ...(head.guide ? { guide: head.guide } : {}),
          });
        }
      }
    }

    if (flatItems.length === 0) {
      notifyToast('Nothing to share');
      return;
    }

    try {
      const activeIdx = Math.max(
        0,
        flatItems.findIndex((it) => it.fileId === workspaceRef.current.activeFileId)
      );
      const currentItem = flatItems[activeIdx]!;

      const url = await buildPermalinkUrl(window.location.origin, {
        code: currentItem.code,
        title: currentItem.title,
        path: currentItem.path,
        project: currentItem.project,
        agent: currentItem.agent,
        ...(currentItem.guide ? { guide: currentItem.guide } : {}),
        ...(flatItems.length > 1
          ? {
              tabs: flatItems.map((it) => ({
                code: it.code,
                title: it.title,
                path: it.path,
                project: it.project,
                agent: it.agent,
                ...(it.guide ? { guide: it.guide } : {}),
              })),
              activeIndex: activeIdx,
            }
          : {}),
      });
      await navigator.clipboard.writeText(url);
      const hashPart = url.slice(url.indexOf('#'));
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.search}${hashPart}`
      );
      notifyToast(
        flatItems.length > 1
          ? `Copied stateless permalink (${flatItems.length} graphs)`
          : 'Copied stateless permalink'
      );
    } catch {
      notifyToast('Failed to copy permalink');
    }
  }, [notifyToast]);

  const handleToggleLivePause = useCallback(async () => {
    if (livePausedRef.current) {
      livePausedRef.current = false;
      setRelayState('connected');
      setHasBufferedLiveUpdate(false);
      const pending = [...bufferedDiagramsRef.current];
      bufferedDiagramsRef.current = [];
      for (const diag of pending) {
        seenRenderIdsRef.current.delete(diag.renderId);
        await applyIncomingDiagram(diag);
      }
      notifyToast('Resumed live MCP sync');
    } else {
      livePausedRef.current = true;
      setRelayState('paused');
      notifyToast('Paused live MCP sync');
    }
  }, [applyIncomingDiagram, notifyToast]);

  const handleRotateWorkspaceId = useCallback(() => {
    const fresh = `ws_${randomToken(12)}`;
    localStorage.setItem(WORKSPACE_ID_KEY, fresh);
    seenRenderIdsRef.current.clear();
    announcedSessionsRef.current.clear();
    sessionProjectMapRef.current.clear();
    setConnectedAgentsMap({});
    setWorkspace((prev) => {
      const next: WorkspaceState = { ...prev, workspaceId: fresh };
      workspaceRef.current = next;
      return next;
    });
    notifyToast('Generated new private workspace key');
  }, [notifyToast]);

  const handleBrandClick = useCallback(() => {
    if (page === 'docs') {
      setPage('studio');
    }
  }, [page]);

  const handleExportPng = useCallback(async () => {
    if (!code.trim()) return;
    const serverTheme = appearanceMode === 'dark' ? 'dark' : 'neutral';
    const serverBg = appearanceMode === 'dark' ? '#191918' : '#f5f3ee';
    try {
      const res = await studioApi.renderServer({
        code,
        title: title ?? undefined,
        theme: serverTheme,
        look: 'classic',
        background: serverBg,
        includePngBase64: true,
      });
      if (res.pngDataUrl) {
        const a = document.createElement('a');
        a.href = res.pngDataUrl;
        a.download = `${slugify(title || res.title || 'diagram')}.png`;
        a.click();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      notifyToast(`Export failed: ${message}`);
    }
  }, [appearanceMode, code, notifyToast, title]);

  const handleExportSvg = useCallback(() => {
    if (!renderedSvg) return;
    const blob = new Blob([renderedSvg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slugify(title || 'diagram')}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [renderedSvg, title]);

  return {
    appearanceMode,
    toggleAppearanceMode,
    workspaceId: workspace.workspaceId,
    workspace,
    openTabs,
    activeFile,
    activeProject,
    activeVersionRecord,
    selectedVersion,
    isHistoricalVersion,
    storageStats,
    connectedAgents,
    liveProjectCounts,
    handleRotateWorkspaceId,
    status,
    page,
    setPage,
    stageMode,
    setStageMode,
    relayState,
    hasBufferedLiveUpdate,
    handleToggleSidebar,
    handleResizeSidebar,
    handleToggleProjectExpanded,
    handleOpenFile,
    handleCloseTab,
    handleCreateGraph,
    handleCreateFolder,
    handleRenamePath,
    handleDeleteGraph,
    handleDeleteFolder,
    handleDeleteProject,
    handleSelectVersion,
    handleRestoreVersion,
    title,
    chartKey,
    code,
    activeGuide,
    activeStepIndex,
    setActiveStepIndex,
    selectedNodeId,
    setSelectedNodeId,
    parentGraphFile: parentGraphEntry?.file ?? null,
    handleDrillToPath,
    handleDrillBack,
    setCode: handleChangeCode,
    renderedSvg,
    diagramType,
    parseError,
    zoom,
    setZoom,
    pan,
    setPan,
    toast,
    toastVisible,
    viewportRef,
    notifyToast,
    handleFitCanvas,
    handleCopyPermalink,
    handleToggleLivePause,
    handleBrandClick,
    handleExportPng,
    handleExportSvg,
  };
}
