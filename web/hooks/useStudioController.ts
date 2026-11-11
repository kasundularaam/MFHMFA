import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  buildPermalinkUrl,
  decodePermalinkPayload,
  extractHashToken,
} from '../../src/shared/permalink';
import { slugify } from '../../src/shared/svg';
import type { ParseErrorDetail, PreviewSnapshot } from '../../src/shared/types';
import type { StudioTab } from '../components/TabBar';
import {
  getCachedClientRender,
  renderMermaidClient,
} from '../services/mermaidRenderer';
import { studioApi, type ServerStatus } from '../services/studioClient';
import type { AppearanceMode } from '../theme/comfortTheme';

export type StudioPage = 'studio' | 'docs';
export type StageMode = 'preview' | 'code';
export type ViewMode = 'scratchpad' | 'snapshot' | 'permalink' | 'live';
export type LiveConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'paused'
  | 'reconnecting';

const TABS_STORAGE_KEY = 'mfhmfa-studio-tabs-v2';
const LEGACY_DRAFT_KEY = 'mfhmfa-stateless-draft';
const WORKSPACE_ID_KEY = 'mfhmfa-workspace-id';
const LOCAL_WORKSPACE_CHANNEL = 'local_workspace';

const WELCOME_CODE = `flowchart TB
  subgraph Agents["AI Coding Agents"]
    A1["Pi / Claude Code"]
    A2["Cursor / Antigravity"]
  end

  subgraph Engine["MFHMFA Stateless MCP"]
    MCP["Streamable HTTP (/mcp?workspace=...)"]
    POOL["Parallel Chromium Pool (2x Retina PNG)"]
    HUB["Auto-Push Multi-Tab Hub (SSE)"]
  end

  Tabs["VS Code Browser Tabs<br/>(Overview · Sequence · ER Schema)"]

  A1 & A2 <-->|"mermaid_render (PNG Vision)"| MCP
  MCP --> POOL & HUB
  HUB ==>|"Zero-Link Live Tabs"| Tabs`;

const NEW_TAB_STARTER = `flowchart LR
  Start(["Start"]) --> Step["Process"] --> Done(["Done"])`;

function randomToken(len = 12): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += alphabet[bytes[i]! & 63];
  }
  return out;
}

function getOrCreateWorkspaceId(): string {
  const urlParams = new URLSearchParams(window.location.search);
  const fromQuery = urlParams.get('workspace') || urlParams.get('ws');
  if (fromQuery && /^[A-Za-z0-9_-]{4,64}$/.test(fromQuery.trim())) {
    const clean = fromQuery.trim();
    localStorage.setItem(WORKSPACE_ID_KEY, clean);
    return clean;
  }

  const saved = localStorage.getItem(WORKSPACE_ID_KEY);
  if (saved && /^[A-Za-z0-9_-]{4,64}$/.test(saved)) {
    return saved;
  }

  const fresh = `ws_${randomToken(12)}`;
  localStorage.setItem(WORKSPACE_ID_KEY, fresh);
  return fresh;
}

interface PersistedWorkspaceState {
  tabs: Array<{
    id: string;
    tabKey: string;
    title: string;
    code: string;
    origin: 'user' | 'agent' | 'shared';
    isWelcome?: boolean;
  }>;
  activeTabId: string;
}

function loadSavedTabs(): { tabs: StudioTab[]; activeTabId: string } {
  try {
    const raw = localStorage.getItem(TABS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedWorkspaceState>;
      if (Array.isArray(parsed.tabs) && parsed.tabs.length > 0) {
        const loaded: StudioTab[] = parsed.tabs
          .filter((t) => t && typeof t.code === 'string' && typeof t.title === 'string')
          .map((t) => ({
            id: t.id || `tab-${randomToken(6)}`,
            tabKey: t.tabKey || slugify(t.title, 'diagram'),
            title: t.title,
            code: t.code,
            origin: t.origin ?? 'user',
            unread: false,
            isWelcome: Boolean(t.isWelcome),
            zoom: null,
            pan: { x: 0, y: 0 },
          }));

        if (loaded.length > 0) {
          const activeExists = loaded.some((t) => t.id === parsed.activeTabId);
          return {
            tabs: loaded,
            activeTabId: activeExists ? parsed.activeTabId! : loaded[0]!.id,
          };
        }
      }
    }
  } catch {
    // Ignore storage corruption
  }

  const legacyDraft = localStorage.getItem(LEGACY_DRAFT_KEY);
  const initialTab: StudioTab = {
    id: 'tab-welcome',
    tabKey: legacyDraft ? 'scratchpad' : 'welcome',
    title: legacyDraft ? 'Scratchpad' : 'Architecture Overview',
    code: legacyDraft || WELCOME_CODE,
    origin: 'user',
    unread: false,
    isWelcome: !legacyDraft,
    zoom: null,
    pan: { x: 0, y: 0 },
  };
  return { tabs: [initialTab], activeTabId: initialTab.id };
}

function persistTabsToStorage(tabs: StudioTab[], activeTabId: string): void {
  try {
    const payload: PersistedWorkspaceState = {
      tabs: tabs.map((t) => ({
        id: t.id,
        tabKey: t.tabKey,
        title: t.title,
        code: t.code,
        origin: t.origin,
        ...(t.isWelcome ? { isWelcome: true } : {}),
      })),
      activeTabId,
    };
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore quota errors
  }
}

type ParsedRoute =
  | { kind: 'snapshot'; previewId: string }
  | { kind: 'live'; liveToken: string }
  | { kind: 'permalink'; zToken: string }
  | { kind: 'scratchpad' };

function parseBrowserRoute(): ParsedRoute {
  const pathname = window.location.pathname;
  const snapMatch = pathname.match(/^\/p\/([A-Za-z0-9_-]+)\/?$/);
  if (snapMatch?.[1]) {
    return { kind: 'snapshot', previewId: snapMatch[1] };
  }
  const liveMatch = pathname.match(/^\/live\/([A-Za-z0-9_-]+)\/?$/);
  if (liveMatch?.[1]) {
    return { kind: 'live', liveToken: liveMatch[1] };
  }
  const zToken = extractHashToken(window.location.hash);
  if (zToken) {
    return { kind: 'permalink', zToken };
  }
  return { kind: 'scratchpad' };
}

export function useStudioController() {
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>(() => {
    const saved = localStorage.getItem('mermaid-studio-mode');
    return saved === 'light' ? 'light' : 'dark';
  });

  const [workspaceId, setWorkspaceId] = useState<string>(() => getOrCreateWorkspaceId());
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [page, setPage] = useState<StudioPage>('studio');
  const [stageMode, setStageMode] = useState<StageMode>('preview');

  const initialRoute = useRef(parseBrowserRoute());
  const [viewMode, setViewMode] = useState<ViewMode>(() => initialRoute.current.kind);
  const [linkedLiveToken, setLinkedLiveToken] = useState<string | null>(null);
  const [liveToken, setLiveToken] = useState<string | null>(() =>
    initialRoute.current.kind === 'live' ? initialRoute.current.liveToken : null
  );

  const [liveState, setLiveState] = useState<LiveConnectionState>('idle');
  const [waitingForLive, setWaitingForLive] = useState<boolean>(false);
  const [hasBufferedLiveUpdate, setHasBufferedLiveUpdate] = useState<boolean>(false);

  const initialData = useRef(loadSavedTabs());
  const [tabs, setTabs] = useState<StudioTab[]>(initialData.current.tabs);
  const [activeTabId, setActiveTabId] = useState<string>(initialData.current.activeTabId);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]!;
  const code = activeTab?.code ?? '';
  const title = activeTab?.title ?? null;
  const chartKey = `${activeTab?.id ?? 'tab'}`;

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

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const stageModeRef = useRef(stageMode);
  stageModeRef.current = stageMode;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const panRef = useRef(pan);
  panRef.current = pan;
  const appearanceRef = useRef(appearanceMode);
  appearanceRef.current = appearanceMode;

  const livePausedRef = useRef(false);
  const seenSnapshotIdsRef = useRef<Set<string>>(new Set());
  const bufferedSnapshotsRef = useRef<PreviewSnapshot[]>([]);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    document.documentElement.dataset.mode = appearanceMode;
    localStorage.setItem('mermaid-studio-mode', appearanceMode);
  }, [appearanceMode]);

  useEffect(() => {
    if (bootstrappedRef.current && viewMode === 'scratchpad') {
      persistTabsToStorage(tabs, activeTabId);
    }
  }, [tabs, activeTabId, viewMode]);

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
    }, 2200);
  }, []);

  const computeViewportFitZoom = useCallback((w: number, h: number): number | null => {
    const vp = viewportRef.current;
    if (!vp || vp.clientWidth === 0 || vp.clientHeight === 0) {
      return null;
    }
    const vw = Math.max(320, vp.clientWidth - 96);
    const vh = Math.max(240, vp.clientHeight - 96);
    const fit = Math.min(1, Math.max(0.22, Math.min(vw / (w + 48), vh / (h + 48))));
    return Number(fit.toFixed(2));
  }, []);

  useLayoutEffect(() => {
    if (page === 'studio' && stageMode === 'preview' && needsFitOnPreviewRef.current && dimensions) {
      const fit = computeViewportFitZoom(dimensions.width, dimensions.height);
      if (fit !== null) {
        setZoom(fit);
        setPan({ x: 0, y: 0 });
        needsFitOnPreviewRef.current = false;
      }
    }
  }, [page, stageMode, dimensions, computeViewportFitZoom]);

  const renderAndActivateTab = useCallback(async (targetTab: StudioTab) => {
    const outcome = await renderMermaidClient(targetTab.code, appearanceRef.current);
    ++renderCounterRef.current;
    skipNextCodeEffectRef.current = true;

    setActiveTabId(targetTab.id);
    setWaitingForLive(false);

    if (targetTab.zoom !== null) {
      needsFitOnPreviewRef.current = false;
      setZoom(targetTab.zoom);
      setPan(targetTab.pan);
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
  }, []);

  const upsertIncomingSnapshots = useCallback(
    async (
      snapshots: PreviewSnapshot[],
      opts?: {
        replaceAll?: boolean;
        focusSnapshotId?: string;
        origin?: 'agent' | 'shared';
      }
    ) => {
      if (snapshots.length === 0) return;

      const fresh = opts?.replaceAll
        ? snapshots
        : snapshots.filter((s) => !seenSnapshotIdsRef.current.has(s.id));

      if (fresh.length === 0) return;
      for (const s of fresh) {
        seenSnapshotIdsRef.current.add(s.id);
      }

      if (livePausedRef.current && !opts?.replaceAll) {
        bufferedSnapshotsRef.current.push(...fresh);
        setHasBufferedLiveUpdate(true);
        return;
      }

      const origin = opts?.origin ?? 'agent';
      const currentTabs = opts?.replaceAll
        ? []
        : tabsRef.current.map((t) =>
            t.id === activeTabIdRef.current
              ? { ...t, zoom: zoomRef.current, pan: panRef.current }
              : t
          );

      const nextTabs = [...currentTabs];
      let targetFocusTab: StudioTab | null = null;
      const canAutoFocus =
        opts?.replaceAll ||
        (!livePausedRef.current && stageModeRef.current === 'preview');

      for (const snap of fresh) {
        const key = snap.tabKey || slugify(snap.title, 'diagram');
        const existingIdx = nextTabs.findIndex((t) => t.tabKey === key);

        if (existingIdx >= 0) {
          const prev = nextTabs[existingIdx]!;
          const isCurrentlyActive = prev.id === activeTabIdRef.current;
          const updated: StudioTab = {
            ...prev,
            // Bump id slightly on live content change so PreviewCanvas 2-layer cross-dissolves!
            id: isCurrentlyActive && prev.code !== snap.code ? `tab-${key}-${snap.id.slice(0, 5)}` : prev.id,
            title: snap.title,
            code: snap.code,
            origin,
            isWelcome: false,
            unread: !canAutoFocus && !isCurrentlyActive ? true : false,
            zoom: null,
            pan: { x: 0, y: 0 },
          };
          nextTabs[existingIdx] = updated;
          if (opts?.focusSnapshotId === snap.id || (!opts?.focusSnapshotId && canAutoFocus)) {
            targetFocusTab = updated;
          } else if (isCurrentlyActive) {
            targetFocusTab = updated;
          }
        } else if (nextTabs.length === 1 && nextTabs[0]!.isWelcome) {
          const replaced: StudioTab = {
            id: `tab-${key}-${snap.id.slice(0, 5)}`,
            tabKey: key,
            title: snap.title,
            code: snap.code,
            origin,
            unread: false,
            isWelcome: false,
            zoom: null,
            pan: { x: 0, y: 0 },
          };
          nextTabs[0] = replaced;
          targetFocusTab = replaced;
        } else {
          const created: StudioTab = {
            id: `tab-${key}-${snap.id.slice(0, 5)}`,
            tabKey: key,
            title: snap.title,
            code: snap.code,
            origin,
            unread: !canAutoFocus,
            isWelcome: false,
            zoom: null,
            pan: { x: 0, y: 0 },
          };
          nextTabs.push(created);
          if (opts?.focusSnapshotId === snap.id || (!opts?.focusSnapshotId && canAutoFocus)) {
            targetFocusTab = created;
          }
        }
      }

      if (!targetFocusTab && opts?.replaceAll && nextTabs.length > 0) {
        targetFocusTab = nextTabs[nextTabs.length - 1]!;
      }

      if (targetFocusTab) {
        targetFocusTab.unread = false;
        const outcome = await renderMermaidClient(targetFocusTab.code, appearanceRef.current);
        ++renderCounterRef.current;
        skipNextCodeEffectRef.current = true;
        needsFitOnPreviewRef.current = true;

        tabsRef.current = nextTabs;
        activeTabIdRef.current = targetFocusTab.id;
        setTabs(nextTabs);
        setActiveTabId(targetFocusTab.id);
        setWaitingForLive(false);

        if (outcome.ok) {
          setRenderedSvg(outcome.svg);
          setDiagramType(outcome.diagramType);
          setDimensions(outcome.dimensions);
          setParseError(null);
        } else {
          setRenderedSvg('');
        }
      } else {
        tabsRef.current = nextTabs;
        setTabs(nextTabs);
      }
    },
    []
  );

  const loadLocalWorkspace = useCallback(async () => {
    const saved = loadSavedTabs();
    livePausedRef.current = false;
    bufferedSnapshotsRef.current = [];
    setLiveToken(null);
    setLinkedLiveToken(null);
    setViewMode('scratchpad');
    setHasBufferedLiveUpdate(false);

    tabsRef.current = saved.tabs;
    activeTabIdRef.current = saved.activeTabId;
    setTabs(saved.tabs);

    const current = saved.tabs.find((t) => t.id === saved.activeTabId) ?? saved.tabs[0]!;
    await renderAndActivateTab(current);
  }, [renderAndActivateTab]);

  const hydrateFromCurrentLocation = useCallback(async () => {
    const route = parseBrowserRoute();

    if (route.kind === 'snapshot') {
      try {
        const snap = await studioApi.getPreview(route.previewId);
        setViewMode('snapshot');
        setLiveToken(null);
        setLiveState('idle');
        setLinkedLiveToken(snap.liveToken);
        const group = snap.sessionTabs?.length ? snap.sessionTabs : [snap];
        await upsertIncomingSnapshots(group, {
          replaceAll: true,
          focusSnapshotId: snap.id,
          origin: 'shared',
        });
        return;
      } catch {
        window.history.replaceState(null, '', '/');
        notifyToast('Preview link expired — opened workspace');
        await loadLocalWorkspace();
        return;
      }
    }

    if (route.kind === 'permalink') {
      try {
        const decoded = await decodePermalinkPayload(route.zToken);
        setViewMode('permalink');
        setLiveToken(null);
        setLiveState('idle');
        setLinkedLiveToken(null);

        const rawItems =
          decoded.tabs && decoded.tabs.length > 0
            ? decoded.tabs
            : [{ code: decoded.code, title: decoded.title }];

        const builtTabs: StudioTab[] = rawItems.map((item, idx) => {
          const itemTitle = item.title?.trim() || `Diagram ${idx + 1}`;
          return {
            id: `perm-${idx}-${route.zToken.slice(0, 8)}`,
            tabKey: slugify(`${itemTitle}-${idx}`, `tab-${idx}`),
            title: itemTitle,
            code: item.code,
            origin: 'shared',
            unread: false,
            zoom: null,
            pan: { x: 0, y: 0 },
          };
        });

        const focusIdx =
          typeof decoded.activeIndex === 'number' &&
          decoded.activeIndex >= 0 &&
          decoded.activeIndex < builtTabs.length
            ? decoded.activeIndex
            : 0;
        const target = builtTabs[focusIdx]!;

        tabsRef.current = builtTabs;
        activeTabIdRef.current = target.id;
        setTabs(builtTabs);
        await renderAndActivateTab(target);
        return;
      } catch {
        window.history.replaceState(null, '', '/');
        notifyToast('Invalid permalink — opened workspace');
        await loadLocalWorkspace();
        return;
      }
    }

    if (route.kind === 'live') {
      livePausedRef.current = false;
      bufferedSnapshotsRef.current = [];
      seenSnapshotIdsRef.current.clear();
      setHasBufferedLiveUpdate(false);
      setViewMode('live');
      setLiveToken(route.liveToken);
      setLinkedLiveToken(null);
      setLiveState('connecting');

      try {
        const session = await studioApi.getLiveSession(route.liveToken);
        if (session.tabs && session.tabs.length > 0) {
          await upsertIncomingSnapshots(session.tabs, {
            replaceAll: true,
            focusSnapshotId: session.latest?.id,
            origin: 'agent',
          });
        } else {
          const placeholder: StudioTab = {
            id: 'tab-live-waiting',
            tabKey: 'waiting',
            title: 'Waiting for Agent…',
            code: '',
            origin: 'agent',
            unread: false,
            isWelcome: true,
            zoom: null,
            pan: { x: 0, y: 0 },
          };
          tabsRef.current = [placeholder];
          activeTabIdRef.current = placeholder.id;
          setTabs([placeholder]);
          setActiveTabId(placeholder.id);
          setRenderedSvg('');
          setParseError(null);
          setWaitingForLive(true);
        }
      } catch {
        setWaitingForLive(true);
      }
      return;
    }

    await loadLocalWorkspace();
  }, [loadLocalWorkspace, notifyToast, renderAndActivateTab, upsertIncomingSnapshots]);

  // Initial bootstrap + browser back/forward + hashchange
  useEffect(() => {
    studioApi
      .getStatus()
      .then((st) => setStatus(st))
      .catch(() => {});

    hydrateFromCurrentLocation().finally(() => {
      bootstrappedRef.current = true;
    });

    const onPopOrHash = () => {
      hydrateFromCurrentLocation().catch(() => {});
    };

    window.addEventListener('popstate', onPopOrHash);
    window.addEventListener('hashchange', onPopOrHash);
    return () => {
      window.removeEventListener('popstate', onPopOrHash);
      window.removeEventListener('hashchange', onPopOrHash);
    };
  }, [hydrateFromCurrentLocation]);

  // Real-Time SSE Subscription:
  // - In `/live/:token` mode -> subscribes to `liveToken`
  // - In normal workspace (`scratchpad`) mode -> subscribes automatically to `workspaceId`
  //   (AND `local_workspace` when running on localhost!) so agent-generated graphs open as
  //   VS Code tabs automatically WITHOUT needing any links shared in chat!
  useEffect(() => {
    const channels: string[] = [];

    if (viewMode === 'live' && liveToken) {
      channels.push(liveToken);
    } else if (viewMode === 'scratchpad') {
      channels.push(workspaceId);
      const searchParams = new URLSearchParams(window.location.search);
      const explicitUrlWs = searchParams.get('workspace') || searchParams.get('ws');
      const host = window.location.hostname;
      if (
        !explicitUrlWs &&
        (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') &&
        workspaceId !== LOCAL_WORKSPACE_CHANNEL
      ) {
        channels.push(LOCAL_WORKSPACE_CHANNEL);
      }
    }


    if (channels.length === 0) {
      return undefined;
    }

    const sources: EventSource[] = [];

    for (const channel of channels) {
      const es = new EventSource(`/api/live/${encodeURIComponent(channel)}/events`);

      es.onopen = () => {
        if (!livePausedRef.current) {
          setLiveState('connected');
        }
      };

      es.onerror = () => {
        if (!livePausedRef.current && viewModeRef.current === 'live') {
          setLiveState('reconnecting');
        }
      };

      es.addEventListener('tabs', (ev: MessageEvent) => {
        try {
          const data = JSON.parse(String(ev.data)) as { tabs?: PreviewSnapshot[] };
          if (Array.isArray(data.tabs) && data.tabs.length > 0) {
            upsertIncomingSnapshots(data.tabs, { origin: 'agent' }).catch(() => {});
          }
        } catch {
          // ignore malformed payload
        }
      });

      es.addEventListener('snapshot', (ev: MessageEvent) => {
        try {
          const snap = JSON.parse(String(ev.data)) as PreviewSnapshot;
          upsertIncomingSnapshots([snap], { origin: 'agent' }).catch(() => {});
        } catch {
          // ignore malformed payload
        }
      });

      sources.push(es);
    }

    return () => {
      for (const es of sources) {
        es.close();
      }
    };
  }, [viewMode, liveToken, workspaceId, upsertIncomingSnapshots]);

  // Tab Actions
  const handleSelectTab = useCallback(
    (tabId: string) => {
      if (tabId === activeTabIdRef.current) return;
      const target = tabsRef.current.find((t) => t.id === tabId);
      if (!target) return;

      const updatedTabs = tabsRef.current.map((t) => {
        if (t.id === activeTabIdRef.current) {
          return { ...t, zoom: zoomRef.current, pan: panRef.current };
        }
        if (t.id === tabId) {
          return { ...t, unread: false };
        }
        return t;
      });

      const cleanTarget = updatedTabs.find((t) => t.id === tabId)!;
      tabsRef.current = updatedTabs;
      activeTabIdRef.current = tabId;
      setTabs(updatedTabs);
      renderAndActivateTab(cleanTarget).catch(() => {});
    },
    [renderAndActivateTab]
  );

  const handleNewTab = useCallback(() => {
    const nextNum = tabsRef.current.length + 1;
    const newTitle = `Diagram ${nextNum}`;
    const created: StudioTab = {
      id: `tab-${randomToken(7)}`,
      tabKey: slugify(`${newTitle}-${randomToken(4)}`),
      title: newTitle,
      code: NEW_TAB_STARTER,
      origin: 'user',
      unread: false,
      isWelcome: false,
      zoom: null,
      pan: { x: 0, y: 0 },
    };

    const withSavedCamera = tabsRef.current.map((t) =>
      t.id === activeTabIdRef.current
        ? { ...t, zoom: zoomRef.current, pan: panRef.current }
        : t
    );

    const nextTabs = [...withSavedCamera, created];
    if (viewModeRef.current === 'snapshot' || viewModeRef.current === 'permalink') {
      setViewMode('scratchpad');
      window.history.replaceState(null, '', '/');
    }

    tabsRef.current = nextTabs;
    activeTabIdRef.current = created.id;
    setTabs(nextTabs);
    renderAndActivateTab(created).catch(() => {});
  }, [renderAndActivateTab]);

  const handleCloseTab = useCallback(
    (tabId: string) => {
      const idx = tabsRef.current.findIndex((t) => t.id === tabId);
      if (idx < 0) return;

      if (tabsRef.current.length === 1) {
        const fresh: StudioTab = {
          id: `tab-${randomToken(7)}`,
          tabKey: 'diagram-1',
          title: 'Diagram 1',
          code: NEW_TAB_STARTER,
          origin: 'user',
          unread: false,
          zoom: null,
          pan: { x: 0, y: 0 },
        };
        tabsRef.current = [fresh];
        activeTabIdRef.current = fresh.id;
        setTabs([fresh]);
        renderAndActivateTab(fresh).catch(() => {});
        return;
      }

      const remaining = tabsRef.current.filter((t) => t.id !== tabId);
      tabsRef.current = remaining;
      setTabs(remaining);

      if (tabId === activeTabIdRef.current) {
        const nextActive = remaining[Math.min(idx, remaining.length - 1)]!;
        activeTabIdRef.current = nextActive.id;
        renderAndActivateTab({ ...nextActive, unread: false }).catch(() => {});
      }
    },
    [renderAndActivateTab]
  );

  const handleRenameTab = useCallback((tabId: string, nextTitle: string) => {
    const updated = tabsRef.current.map((t) =>
      t.id === tabId
        ? {
            ...t,
            title: nextTitle,
            tabKey: slugify(nextTitle, t.tabKey),
            isWelcome: false,
          }
        : t
    );
    tabsRef.current = updated;
    setTabs(updated);
  }, []);

  // User edits in CodeMirror
  const handleChangeCode = useCallback(
    (nextCode: string) => {
      const updated = tabsRef.current.map((t) =>
        t.id === activeTabIdRef.current
          ? { ...t, code: nextCode, isWelcome: false }
          : t
      );
      tabsRef.current = updated;
      setTabs(updated);

      if (viewMode === 'live' && !livePausedRef.current) {
        livePausedRef.current = true;
        setLiveState('paused');
        notifyToast('Live sync paused while editing');
        return;
      }

      if (viewMode === 'snapshot' || viewMode === 'permalink') {
        setViewMode('scratchpad');
        setLinkedLiveToken(null);
        window.history.replaceState(null, '', '/');
      }
    },
    [notifyToast, viewMode]
  );

  // Background client render on code edits or Dark/Light theme switch
  useEffect(() => {
    if (!bootstrappedRef.current) return undefined;

    if (skipNextCodeEffectRef.current) {
      skipNextCodeEffectRef.current = false;
      return undefined;
    }

    if (waitingForLive && !code.trim()) {
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
  }, [code, appearanceMode, stageMode, waitingForLive]);

  // Keyboard shortcuts: Ctrl/Cmd+E (Preview <-> Code), Alt+1..9 (Switch Tab)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (page !== 'studio') return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        setStageMode((m) => (m === 'preview' ? 'code' : 'preview'));
        return;
      }

      if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
        const idx = Number.parseInt(e.key, 10) - 1;
        const target = tabsRef.current[idx];
        if (target) {
          e.preventDefault();
          handleSelectTab(target.id);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSelectTab, page]);

  const handleFitCanvas = useCallback(() => {
    if (!dimensions) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }
    const fit = computeViewportFitZoom(dimensions.width, dimensions.height);
    setZoom(fit ?? 1);
    setPan({ x: 0, y: 0 });
  }, [computeViewportFitZoom, dimensions]);

  const handleCopyPermalink = useCallback(async () => {
    if (!code.trim()) {
      notifyToast('Nothing to share');
      return;
    }
    try {
      const currentTabs = tabsRef.current;
      const activeIdx = Math.max(
        0,
        currentTabs.findIndex((t) => t.id === activeTabIdRef.current)
      );
      const url = await buildPermalinkUrl(window.location.origin, {
        code,
        title: title ?? undefined,
        ...(currentTabs.length > 1
          ? {
              tabs: currentTabs.map((t) => ({ code: t.code, title: t.title })),
              activeIndex: activeIdx,
            }
          : {}),
      });
      await navigator.clipboard.writeText(url);
      if (viewMode !== 'live') {
        const hashPart = url.slice(url.indexOf('#'));
        window.history.replaceState(null, '', `/${hashPart}`);
      }
      notifyToast(
        currentTabs.length > 1
          ? `Copied permalink (${currentTabs.length} tabs)`
          : 'Copied stateless permalink'
      );
    } catch {
      notifyToast('Failed to copy permalink');
    }
  }, [code, notifyToast, title, viewMode]);

  const handleToggleLivePause = useCallback(async () => {
    if (livePausedRef.current) {
      livePausedRef.current = false;
      setLiveState('connected');
      setHasBufferedLiveUpdate(false);
      const pending = [...bufferedSnapshotsRef.current];
      bufferedSnapshotsRef.current = [];
      if (pending.length > 0) {
        for (const p of pending) {
          seenSnapshotIdsRef.current.delete(p.id);
        }
        await upsertIncomingSnapshots(pending, { origin: 'agent' });
      }
      notifyToast('Resumed live agent sync');
    } else {
      livePausedRef.current = true;
      setLiveState('paused');
      notifyToast('Paused live agent sync');
    }
  }, [notifyToast, upsertIncomingSnapshots]);

  const handleRotateWorkspaceId = useCallback(() => {
    const fresh = `ws_${randomToken(12)}`;
    localStorage.setItem(WORKSPACE_ID_KEY, fresh);
    seenSnapshotIdsRef.current.clear();
    setWorkspaceId(fresh);
    notifyToast('Generated new private workspace key');
  }, [notifyToast]);

  const handleWatchLive = useCallback(() => {
    if (!linkedLiveToken) return;
    window.history.pushState(null, '', `/live/${linkedLiveToken}`);
    setPage('studio');
    setStageMode('preview');
    hydrateFromCurrentLocation().catch(() => {});
  }, [hydrateFromCurrentLocation, linkedLiveToken]);

  const handleBrandClick = useCallback(() => {
    if (page === 'docs') {
      setPage('studio');
      return;
    }
    if (viewMode !== 'scratchpad') {
      window.history.pushState(null, '', '/');
      loadLocalWorkspace().catch(() => {});
      notifyToast('Returned to local workspace');
    }
  }, [loadLocalWorkspace, notifyToast, page, viewMode]);

  const handleExportPng = useCallback(async () => {
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
    workspaceId,
    handleRotateWorkspaceId,
    status,
    page,
    setPage,
    stageMode,
    setStageMode,
    viewMode,
    tabs,
    activeTabId,
    handleSelectTab,
    handleNewTab,
    handleCloseTab,
    handleRenameTab,
    title,
    chartKey,
    linkedLiveToken,
    liveState,
    waitingForLive,
    hasBufferedLiveUpdate,
    code,
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
    handleWatchLive,
    handleBrandClick,
    handleExportPng,
    handleExportSvg,
  };
}
