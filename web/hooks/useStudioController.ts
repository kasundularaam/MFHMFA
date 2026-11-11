import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import mermaid from 'mermaid';
import {
  extractSvgDimensions,
  normalizeSvgIntrinsicDimensions,
  slugify,
} from '../../src/shared/svg';
import type {
  AgentEventRecord,
  ChartRecord,
  ChartVersionSummary,
  MermaidTemplate,
  ParseErrorDetail,
} from '../../src/shared/types';
import { connectLiveSocket, studioApi, type ServerStatus } from '../services/studioClient';
import { getMermaidComfortConfig, type AppearanceMode } from '../theme/comfortTheme';

export type StudioPage = 'studio' | 'settings';
export type StageMode = 'preview' | 'code';
export type SettingsSection = 'general' | 'mcp' | 'activity' | 'history';

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
  const [title, setTitle] = useState('Untitled Diagram');
  const [code, setCode] = useState(
    `flowchart TB\n  User(["Developer / Agent"]) --> Studio["Mermaid Studio"]\n  Studio --> Validate["Validate Syntax"]\n  Studio --> Render["Render Preview"]`
  );
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
  const renderCounterRef = useRef(0);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const fitDimensionsInViewport = useCallback((w: number, h: number) => {
    requestAnimationFrame(() => {
      const vp = viewportRef.current;
      if (!vp) return;
      const vw = Math.max(320, vp.clientWidth - 96);
      const vh = Math.max(240, vp.clientHeight - 96);
      const fit = Math.min(1, Math.max(0.22, Math.min(vw / (w + 48), vh / (h + 48))));
      setZoom(Number(fit.toFixed(2)));
      setPan({ x: 0, y: 0 });
    });
  }, []);

  const loadChartIntoWorkspace = useCallback(
    async (id: string, ver?: number) => {
      try {
        const detail = await studioApi.getChart(id, ver);
        setActiveChartId(detail.chart.id);
        setTitle(detail.chart.title);
        setCode(detail.code);
        setVersion(detail.selectedVersion);
        setVersions(detail.versions);
        setDiagramType(detail.chart.diagramType);
        setParseError(detail.chart.error);
        if (detail.chart.width && detail.chart.height) {
          setDimensions({ width: detail.chart.width, height: detail.chart.height });
          fitDimensionsInViewport(detail.chart.width, detail.chart.height);
        } else {
          setZoom(1);
          setPan({ x: 0, y: 0 });
        }
        setIsDirty(false);

        const url = new URL(window.location.href);
        url.searchParams.set('chart', detail.chart.id);
        window.history.replaceState({}, '', url.toString());
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        notifyToast(`Could not load chart: ${message}`);
      }
    },
    [fitDimensionsInViewport, notifyToast]
  );

  // Initial load
  useEffect(() => {
    Promise.all([
      studioApi.getStatus(),
      studioApi.listCharts(),
      studioApi.listTemplates(),
      studioApi.listEvents(),
      studioApi.getGuide('all'),
    ])
      .then(([st, ch, tpl, ev, gd]) => {
        setStatus(st);
        setCharts(ch.charts);
        setTemplates(tpl.templates);
        setEvents(ev.events);
        setGuideText(gd.guide);

        const urlChart = new URLSearchParams(window.location.search).get('chart');
        const target =
          (urlChart && ch.charts.find((c) => c.id === urlChart)) || ch.charts[0];
        if (target) {
          loadChartIntoWorkspace(target.id);
        }
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

  // Re-fit diagram when switching back to Preview
  useEffect(() => {
    if (page === 'studio' && stageMode === 'preview' && dimensions) {
      fitDimensionsInViewport(dimensions.width, dimensions.height);
    }
  }, [page, stageMode, dimensions, fitDimensionsInViewport]);

  // Debounced Eye-Comfort Mermaid Renderer
  useEffect(() => {
    const timer = setTimeout(async () => {
      const seq = ++renderCounterRef.current;

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

      try {
        mermaid.initialize(getMermaidComfortConfig(appearanceMode));

        const parsed = await mermaid.parse(code);
        if (seq !== renderCounterRef.current) return;

        const uid = `comfort_svg_${seq}_${Date.now()}`;
        const out = await mermaid.render(uid, code);
        if (seq !== renderCounterRef.current) return;

        const cleanSvg = normalizeSvgIntrinsicDimensions(out.svg);
        setRenderedSvg(cleanSvg);
        setDiagramType(parsed?.diagramType || out.diagramType || null);
        setParseError(null);

        const dims = extractSvgDimensions(cleanSvg);
        if (dims) {
          setDimensions(dims);
        }
      } catch {
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
    }, 100);

    return () => clearTimeout(timer);
  }, [code, appearanceMode]);

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

  const handleNewChart = useCallback(() => {
    setActiveChartId(null);
    setTitle('Untitled Diagram');
    setCode(
      `flowchart TD\n  Start(["Start"]) --> Step["Design Flow"]\n  Step --> Done(["Complete"])`
    );
    setVersion(1);
    setVersions([]);
    setIsDirty(true);
    setPage('studio');
    setStageMode('code');
  }, []);

  const handleDeleteChart = useCallback(
    async (id: string) => {
      await studioApi.deleteChart(id);
      const remaining = charts.filter((c) => c.id !== id);
      setCharts(remaining);
      if (activeChartId === id) {
        if (remaining[0]) {
          loadChartIntoWorkspace(remaining[0].id);
        } else {
          handleNewChart();
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
    fitDimensionsInViewport(dimensions.width, dimensions.height);
  }, [dimensions, fitDimensionsInViewport]);

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
    setActiveChartId,
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
    handleSave,
    handleNewChart,
    handleDeleteChart,
    handleFitCanvas,
    handleExportPng,
    handleExportSvg,
  };
}
