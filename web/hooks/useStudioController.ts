import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { slugify } from '../../src/shared/svg';
import type { ParseErrorDetail } from '../../src/shared/types';
import {
  getCachedClientRender,
  renderMermaidClient,
} from '../services/mermaidRenderer';
import { studioApi, type ServerStatus } from '../services/studioClient';
import type { AppearanceMode } from '../theme/comfortTheme';

export type StudioPage = 'studio' | 'docs';
export type StageMode = 'preview' | 'code';

const DRAFT_CODE_KEY = 'mfhmfa-stateless-draft';

const INITIAL_CODE = `flowchart TB
  subgraph Agents["AI Coding Agents"]
    A1["Pi / Claude Code"]
    A2["Cursor / Antigravity"]
  end

  subgraph Engine["MFHMFA Stateless MCP"]
    MCP["Streamable HTTP (/mcp) & Stdio"]
    POOL["Parallel Chromium Pool (2x Retina PNG)"]
  end

  A1 & A2 <-->|"mermaid_render (PNG Vision)"| MCP
  MCP --> POOL`;

export function useStudioController() {
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>(() => {
    const saved = localStorage.getItem('mermaid-studio-mode');
    return saved === 'light' ? 'light' : 'dark';
  });

  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [page, setPage] = useState<StudioPage>('studio');
  const [stageMode, setStageMode] = useState<StageMode>('preview');

  const [code, setCode] = useState(() => localStorage.getItem(DRAFT_CODE_KEY) || INITIAL_CODE);

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

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const appearanceRef = useRef(appearanceMode);
  appearanceRef.current = appearanceMode;

  useEffect(() => {
    document.documentElement.dataset.mode = appearanceMode;
    localStorage.setItem('mermaid-studio-mode', appearanceMode);
  }, [appearanceMode]);

  useEffect(() => {
    localStorage.setItem(DRAFT_CODE_KEY, code);
  }, [code]);

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

  // Initial bootstrap
  useEffect(() => {
    studioApi
      .getStatus()
      .then((st) => setStatus(st))
      .catch(() => {});

    renderMermaidClient(code, appearanceRef.current)
      .then((initial) => {
        ++renderCounterRef.current;
        skipNextCodeEffectRef.current = true;
        if (initial.ok) {
          setRenderedSvg(initial.svg);
          setDiagramType(initial.diagramType);
          setDimensions(initial.dimensions);
        }
        bootstrappedRef.current = true;
      })
      .catch(() => {
        bootstrappedRef.current = true;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Background client render on code edits or Dark/Light theme switch
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
  }, [code, appearanceMode, stageMode]);

  // Keyboard shortcut: Ctrl/Cmd + E flips Preview <-> Code
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === 'e' && page === 'studio') {
        e.preventDefault();
        setStageMode((m) => (m === 'preview' ? 'code' : 'preview'));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [page]);

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
        a.download = `${slugify(res.title || 'diagram')}.png`;
        a.click();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      notifyToast(`Export failed: ${message}`);
    }
  }, [appearanceMode, code, notifyToast]);

  const handleExportSvg = useCallback(() => {
    if (!renderedSvg) return;
    const blob = new Blob([renderedSvg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'diagram.svg';
    a.click();
    URL.revokeObjectURL(url);
  }, [renderedSvg]);

  return {
    appearanceMode,
    toggleAppearanceMode,
    status,
    page,
    setPage,
    stageMode,
    setStageMode,
    code,
    setCode,
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
    handleExportPng,
    handleExportSvg,
  };
}
