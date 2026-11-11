import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { slugify } from '../../src/shared/svg';
import type {
  AgentEventRecord,
  ChartRecord,
  ChartVersionSummary,
  MermaidTemplate,
  ParseErrorDetail,
} from '../../src/shared/types';
import {
  getCachedClientRender,
  renderMermaidClient,
} from '../services/mermaidRenderer';
import { connectLiveSocket, studioApi, type ServerStatus } from '../services/studioClient';
import type { AppearanceMode } from '../theme/comfortTheme';

export type StudioPage = 'studio' | 'settings';
export type StageMode = 'preview' | 'code';
export type SettingsSection = 'general' | 'mcp' | 'activity' | 'history';

const INITIAL_CODE = `flowchart TB\n  User(["Developer / Agent"]) --> Studio["Mermaid Studio"]\n  Studio --> Validate["Validate Syntax"]\n  Studio --> Render["Render Preview"]`;

export function useStudioController() {
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>(() => {
    const saved = localStorage.getItem('mermaid-studio-mode');
    return saved === 'light' ? 'light' : 'dark';
  });

  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  const [page, setPage] = useState<StudioPage>('studio');
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [stageMode, setStageMode] = useState<StageMode>('preview');
  const [defaultOpenMode, setDefaultOpenMode] = useState<StageMode>('preview');

  const [sidebarTab, setSidebarTab] = useState<'charts' | 'templates'>('charts');
  const [charts, setCharts] = useState<ChartRecord[]>([]);
  const [templates, setTemplates] = useState<MermaidTemplate[]>([]);
  const [events, setEvents] = useState<AgentEventRecord[]>([]);
  const [search, setSearch] = useState('');

  const [activeChartId, setActiveChartId] = useState<string | null>(null);
  const [diagramIdentity, setDiagramIdentity] = useState<string>('initial');
  const [title, setTitle] = useState('Untitled Diagram');
  const [code, setCode] = useState('');
  const [version, setVersion] = useState(1);
  const [versions, setVersions] = useState<ChartVersionSummary[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [renderedSvg, setRenderedSvg] = useState<string>('');
  const [diagramType, setDiagramType] = useState<string | null>('flowchart-v2');
  const [parseError, setParseError] = useState<ParseErrorDetail | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  const [followAgentLive, setFollowAgentLive] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [guideText, setGuideText] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState(false);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const bootstrappedRef = useRef(false);
  const renderCounterRef = useRef(0);
  const loadSeqRef = useRef(0);
  const skipNextCodeEffectRef = useRef(false);
  const needsFitOnPreviewRef = useRef(true);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const appearanceRef = useRef(appearanceMode);
  appearanceRef.current = appearanceMode;
  const followRef = useRef(followAgentLive);
  followRef.current = followAgentLive;
  const activeIdRef = useRef(activeChartId);
  activeIdRef.current = activeChartId;
  const defaultOpenModeRef = useRef(defaultOpenMode);
  defaultOpenModeRef.current = defaultOpenMode;

  useEffect(() => {
    document.documentElement.dataset.mode = appearanceMode;
    localStorage.setItem('mermaid-studio-mode', appearanceMode);
  }, [appearanceMode]);

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

  // Pre-paint fit when entering Preview mode (zero visual jump!)
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

  // Atomic chart loader: renders new SVG offscreen FIRST, then commits all state in one paint frame
  const loadChartIntoWorkspace = useCallback(
    async (id: string, ver?: number) => {
      const seq = ++loadSeqRef.current;
      try {
        const detail = await studioApi.getChart(id, ver);
        if (seq !== loadSeqRef.current) return;

        const mode = appearanceRef.current;
        const cached = getCachedClientRender(detail.code, mode);
        const outcome = cached ?? (await renderMermaidClient(detail.code, mode));
        if (seq !== loadSeqRef.current) return;

        ++renderCounterRef.current;
        skipNextCodeEffectRef.current = true;

        setActiveChartId(detail.chart.id);
        setDiagramIdentity(`${detail.chart.id}:v${detail.selectedVersion}`);
        setTitle(detail.chart.title);
        setCode(detail.code);
        setVersion(detail.selectedVersion);
        setVersions(detail.versions);
        setIsDirty(false);

        if (outcome.ok) {
          setRenderedSvg(outcome.svg);
          setDiagramType(outcome.diagramType);
          setParseError(null);
          setDimensions(outcome.dimensions);

          if (outcome.dimensions) {
            const fit = computeViewportFitZoom(
              outcome.dimensions.width,
              outcome.dimensions.height
            );
            if (fit !== null) {
              setZoom(fit);
              setPan({ x: 0, y: 0 });
              needsFitOnPreviewRef.current = false;
            } else {
              needsFitOnPreviewRef.current = true;
            }
          }
        } else {
          setParseError(detail.chart.error);
        }

        const url = new URL(window.location.href);
        url.searchParams.set('chart', detail.chart.id);
        window.history.replaceState({}, '', url.toString());
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        notifyToast(`Could not load chart: ${message}`);
      }
    },
    [computeViewportFitZoom, notifyToast]
  );

  const handleSelectTemplate = useCallback(
    async (tpl: MermaidTemplate) => {
      const seq = ++loadSeqRef.current;
      const mode = appearanceRef.current;
      const serverTheme = mode === 'dark' ? 'dark' : 'neutral';
      const serverBg = mode === 'dark' ? '#191918' : '#f5f3ee';

      try {
        const [outcome, created] = await Promise.all([
          renderMermaidClient(tpl.code, mode),
          studioApi.createChart({
            title: tpl.name,
            code: tpl.code,
            theme: serverTheme,
            look: 'classic',
            background: serverBg,
          }),
        ]);
        if (seq !== loadSeqRef.current) return;

        ++renderCounterRef.current;
        skipNextCodeEffectRef.current = true;
        setActiveChartId(created.chart.id);
        setDiagramIdentity(`${created.chart.id}:v1`);
        setTitle(created.chart.title);
        setCode(tpl.code);
        setVersion(1);
        setVersions([]);
        setIsDirty(false);
        setSidebarTab('charts');
        setStageMode('preview');
        setCharts((prev) => [created.chart, ...prev.filter((c) => c.id !== created.chart.id)]);

        if (outcome.ok) {
          setRenderedSvg(outcome.svg);
          setDiagramType(outcome.diagramType);
          setParseError(null);
          setDimensions(outcome.dimensions);

          if (outcome.dimensions) {
            const fit = computeViewportFitZoom(outcome.dimensions.width, outcome.dimensions.height);
            if (fit !== null) {
              setZoom(fit);
              setPan({ x: 0, y: 0 });
              needsFitOnPreviewRef.current = false;
            } else {
              needsFitOnPreviewRef.current = true;
            }
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        notifyToast(`Could not create from template: ${message}`);
      }
    },
    [computeViewportFitZoom, notifyToast]
  );

  // Initial bootstrap
  useEffect(() => {
    Promise.all([
      studioApi.getStatus(),
      studioApi.listCharts(),
      studioApi.listTemplates(),
      studioApi.listEvents(),
      studioApi.getGuide('all'),
    ])
      .then(async ([st, ch, tpl, ev, gd]) => {
        setStatus(st);
        setCharts(ch.charts);
        setTemplates(tpl.templates);
        setEvents(ev.events);
        setGuideText(gd.guide);

        const urlChart = new URLSearchParams(window.location.search).get('chart');
        const target =
          (urlChart && ch.charts.find((c) => c.id === urlChart)) || ch.charts[0];
        if (target) {
          await loadChartIntoWorkspace(target.id);
        } else {
          const initial = await renderMermaidClient(INITIAL_CODE, appearanceRef.current);
          ++renderCounterRef.current;
          skipNextCodeEffectRef.current = true;
          setCode(INITIAL_CODE);
          if (initial.ok) {
            setRenderedSvg(initial.svg);
            setDimensions(initial.dimensions);
          }
        }
        bootstrappedRef.current = true;
      })
      .catch((err: unknown) => console.error('Bootstrap error:', err));
  }, [loadChartIntoWorkspace]);

  // Live WebSocket sync
  useEffect(() => {
    return connectLiveSocket(
      (msg) => {
        if (msg.type === 'chart:created') {
          const created = msg.data as ChartRecord;
          setCharts((prev) => [created, ...prev.filter((c) => c.id !== created.id)]);
          if (msg.focusInUi && followRef.current && created.author !== 'web') {
            setStageMode(defaultOpenModeRef.current);
            loadChartIntoWorkspace(created.id);
            notifyToast(`Agent created "${created.title}"`);
          }
        } else if (msg.type === 'chart:updated') {
          const updated = msg.data as ChartRecord;
          setCharts((prev) => [updated, ...prev.filter((c) => c.id !== updated.id)]);
          if (
            (msg.focusInUi && followRef.current && updated.author !== 'web') ||
            (activeIdRef.current === updated.id && updated.author !== 'web')
          ) {
            loadChartIntoWorkspace(updated.id);
            notifyToast(`Agent updated "${updated.title}"`);
          }
        } else if (msg.type === 'chart:deleted') {
          const deletedId = (msg.data as { id?: string } | undefined)?.id;
          if (deletedId) {
            setCharts((prev) => prev.filter((c) => c.id !== deletedId));
          }
        } else if (msg.type === 'agent:event') {
          const ev = msg.data as AgentEventRecord;
          setEvents((prev) => [ev, ...prev].slice(0, 100));
        }
      },
      (connected) => setWsConnected(connected)
    );
  }, [loadChartIntoWorkspace, notifyToast]);

  // Background render on code edits or Dark/Light theme switch
  useEffect(() => {
    if (!bootstrappedRef.current) return undefined;

    if (skipNextCodeEffectRef.current) {
      skipNextCodeEffectRef.current = false;
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
          suggestion: 'Start with `flowchart TD`, `sequenceDiagram`, `erDiagram`, or choose a template.',
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
  }, [code, appearanceMode, stageMode]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    const serverTheme = appearanceMode === 'dark' ? 'dark' : 'neutral';
    const serverBg = appearanceMode === 'dark' ? '#191918' : '#f5f3ee';

    try {
      if (activeChartId) {
        const res = await studioApi.updateChart(activeChartId, {
          title,
          code,
          theme: serverTheme,
          look: 'classic',
          background: serverBg,
          changeNote: 'Saved in Studio',
        });
        setVersion(res.chart.version);
        setParseError(res.chart.error);
        setIsDirty(false);
        setCharts((prev) => [res.chart, ...prev.filter((c) => c.id !== res.chart.id)]);
        const full = await studioApi.getChart(res.chart.id);
        setVersions(full.versions);
        notifyToast('Saved');
      } else {
        const res = await studioApi.createChart({
          title,
          code,
          theme: serverTheme,
          look: 'classic',
          background: serverBg,
        });
        setActiveChartId(res.chart.id);
        setDiagramIdentity(`${res.chart.id}:v${res.chart.version}`);
        setVersion(res.chart.version);
        setIsDirty(false);
        setCharts((prev) => [res.chart, ...prev.filter((c) => c.id !== res.chart.id)]);
        notifyToast('Created');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      notifyToast(`Save error: ${message}`);
    } finally {
      setSaving(false);
    }
  }, [activeChartId, appearanceMode, title, code, notifyToast]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        handleSave();
      } else if (k === 'b' && page === 'studio') {
        e.preventDefault();
        setSidebarOpen((v) => !v);
      } else if (k === 'e' && page === 'studio') {
        e.preventDefault();
        setStageMode((m) => (m === 'preview' ? 'code' : 'preview'));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSave, page]);

  const handleNewChart = useCallback(async () => {
    const draftCode = `flowchart TD\n  Start(["Start"]) --> Step["Design Flow"]\n  Step --> Done(["Complete"])`;
    const mode = appearanceRef.current;
    const serverTheme = mode === 'dark' ? 'dark' : 'neutral';
    const serverBg = mode === 'dark' ? '#191918' : '#f5f3ee';

    try {
      const [outcome, created] = await Promise.all([
        renderMermaidClient(draftCode, mode),
        studioApi.createChart({
          title: 'Untitled Diagram',
          code: draftCode,
          theme: serverTheme,
          look: 'classic',
          background: serverBg,
        }),
      ]);

      ++renderCounterRef.current;
      skipNextCodeEffectRef.current = true;
      setActiveChartId(created.chart.id);
      setDiagramIdentity(`${created.chart.id}:v1`);
      setTitle(created.chart.title);
      setCode(draftCode);
      setVersion(1);
      setVersions([]);
      setIsDirty(false);
      setSidebarTab('charts');
      setCharts((prev) => [created.chart, ...prev.filter((c) => c.id !== created.chart.id)]);

      if (outcome.ok) {
        setRenderedSvg(outcome.svg);
        setDiagramType(outcome.diagramType);
        setDimensions(outcome.dimensions);
        setParseError(null);
        needsFitOnPreviewRef.current = true;
      }
      setPage('studio');
      setStageMode('code');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      notifyToast(`Could not create chart: ${message}`);
    }
  }, [notifyToast]);

  const handleRenameChart = useCallback(
    async (id: string, nextTitle: string) => {
      const trimmed = nextTitle.trim();
      if (!trimmed) return;
      try {
        const res = await studioApi.updateChart(id, { title: trimmed });
        setCharts((prev) =>
          prev.map((c) => (c.id === id ? { ...c, title: res.chart.title } : c))
        );
        if (activeChartId === id) {
          setTitle(res.chart.title);
        }
        notifyToast('Renamed');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        notifyToast(`Rename failed: ${message}`);
      }
    },
    [activeChartId, notifyToast]
  );

  const handleDeleteChart = useCallback(
    async (id: string) => {
      await studioApi.deleteChart(id);
      const remaining = charts.filter((c) => c.id !== id);
      setCharts(remaining);
      if (activeChartId === id) {
        if (remaining[0]) {
          await loadChartIntoWorkspace(remaining[0].id);
        } else {
          await handleNewChart();
        }
      }
      notifyToast('Deleted');
    },
    [activeChartId, charts, handleNewChart, loadChartIntoWorkspace, notifyToast]
  );

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

  const handleExportPng = useCallback(async () => {
    const serverTheme = appearanceMode === 'dark' ? 'dark' : 'neutral';
    const serverBg = appearanceMode === 'dark' ? '#191918' : '#f5f3ee';
    try {
      const res = await studioApi.renderServer({
        code,
        theme: serverTheme,
        look: 'classic',
        background: serverBg,
        includePngBase64: true,
      });
      if (res.pngDataUrl) {
        const a = document.createElement('a');
        a.href = res.pngDataUrl;
        a.download = `${slugify(title)}.png`;
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
    a.download = `${slugify(title)}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [renderedSvg, title]);

  const filteredCharts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return charts;
    return charts.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        (c.diagramType || '').toLowerCase().includes(q)
    );
  }, [charts, search]);

  return {
    appearanceMode,
    setAppearanceMode,
    status,
    wsConnected,
    page,
    setPage,
    settingsSection,
    setSettingsSection,
    sidebarOpen,
    setSidebarOpen,
    stageMode,
    setStageMode,
    defaultOpenMode,
    setDefaultOpenMode,
    sidebarTab,
    setSidebarTab,
    filteredCharts,
    templates,
    events,
    search,
    setSearch,
    activeChartId,
    diagramIdentity,
    title,
    setTitle,
    code,
    setCode,
    version,
    versions,
    isDirty,
    setIsDirty,
    saving,
    renderedSvg,
    diagramType,
    parseError,
    followAgentLive,
    setFollowAgentLive,
    zoom,
    setZoom,
    pan,
    setPan,
    guideText,
    toast,
    toastVisible,
    viewportRef,
    notifyToast,
    loadChartIntoWorkspace,
    handleSelectTemplate,
    handleSave,
    handleNewChart,
    handleRenameChart,
    handleDeleteChart,
    handleFitCanvas,
    handleExportPng,
    handleExportSvg,
  };
}
