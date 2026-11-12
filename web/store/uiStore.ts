import { create } from 'zustand';
import type { ParseErrorDetail } from '../../src/shared/types';
import type { ServerStatus } from '../services/studioClient';
import type { AppearanceMode } from '../theme/comfortTheme';

export type StudioPage = 'studio' | 'docs';
export type StageMode = 'preview' | 'code';
export type CanvasTransitionKind = 'crossfade' | 'dive-in' | 'zoom-out';

const APPEARANCE_STORAGE_KEY = 'mermaid-studio-mode';

function readInitialAppearance(): AppearanceMode {
  try {
    const saved = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return saved === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

let toastHideTimer: ReturnType<typeof setTimeout> | null = null;
let toastClearTimer: ReturnType<typeof setTimeout> | null = null;

export interface UiStoreState {
  appearanceMode: AppearanceMode;
  page: StudioPage;
  stageMode: StageMode;
  serverStatus: ServerStatus | null;

  activeFlowId: string | null;
  activeStepIndex: number | null;
  selectedNodeId: string | null;
  drillStack: string[];

  renderedSvg: string;
  diagramType: string | null;
  parseError: ParseErrorDetail | null;
  dimensions: { width: number; height: number } | null;

  zoom: number;
  pan: { x: number; y: number };
  fitTrigger: number;
  needsViewportFit: boolean;

  toast: string | null;
  toastVisible: boolean;

  toggleAppearanceMode: () => void;
  setPage: (page: StudioPage) => void;
  setStageMode: (updater: StageMode | ((prev: StageMode) => StageMode)) => void;
  setServerStatus: (status: ServerStatus | null) => void;

  setActiveFlowId: (flowId: string | null) => void;
  setActiveStepIndex: (
    updater: number | null | ((prev: number | null) => number | null)
  ) => void;
  setSelectedNodeId: (nodeId: string | null) => void;
  resetComprehensionSelection: () => void;
  pushDrillOrigin: (fileId: string) => void;
  popDrillToAncestor: (ancestorFileId: string) => void;

  setRenderSuccess: (payload: {
    svg: string;
    diagramType: string | null;
    dimensions: { width: number; height: number } | null;
    requestFit?: boolean;
  }) => void;
  setRenderError: (error: ParseErrorDetail) => void;
  clearRenderStage: () => void;

  setZoom: (updater: number | ((prev: number) => number)) => void;
  setPan: (pan: { x: number; y: number }) => void;
  applyCamera: (camera: { zoom: number | null; pan: { x: number; y: number } }) => void;
  markViewportFitted: (fitZoom: number) => void;
  triggerFitCanvas: (fitZoom: number) => void;

  notifyToast: (message: string) => void;
}

export const useUiStore = create<UiStoreState>((set, get) => ({
  appearanceMode: readInitialAppearance(),
  page: 'studio',
  stageMode: 'preview',
  serverStatus: null,

  activeFlowId: null,
  activeStepIndex: null,
  selectedNodeId: null,
  drillStack: [],

  renderedSvg: '',
  diagramType: 'flowchart-v2',
  parseError: null,
  dimensions: null,

  zoom: 1,
  pan: { x: 0, y: 0 },
  fitTrigger: 0,
  needsViewportFit: true,

  toast: null,
  toastVisible: false,

  toggleAppearanceMode: () => {
    const next: AppearanceMode = get().appearanceMode === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(APPEARANCE_STORAGE_KEY, next);
    } catch {
      // ignore
    }
    document.documentElement.dataset.mode = next;
    set({ appearanceMode: next });
  },

  setPage: (page) => set({ page }),

  setStageMode: (updater) =>
    set((s) => ({
      stageMode: typeof updater === 'function' ? updater(s.stageMode) : updater,
    })),

  setServerStatus: (serverStatus) => set({ serverStatus }),

  setActiveFlowId: (activeFlowId) =>
    set((s) => ({
      activeFlowId,
      activeStepIndex: activeFlowId !== s.activeFlowId ? 0 : s.activeStepIndex,
    })),

  setActiveStepIndex: (updater) =>
    set((s) => ({
      activeStepIndex: typeof updater === 'function' ? updater(s.activeStepIndex) : updater,
    })),

  setSelectedNodeId: (selectedNodeId) => set({ selectedNodeId }),

  resetComprehensionSelection: () =>
    set({ activeFlowId: null, activeStepIndex: null, selectedNodeId: null }),

  pushDrillOrigin: (fileId) =>
    set((s) => ({
      drillStack:
        s.drillStack[s.drillStack.length - 1] === fileId
          ? s.drillStack
          : [...s.drillStack, fileId],
    })),

  popDrillToAncestor: (ancestorFileId) =>
    set((s) => {
      const idx = s.drillStack.lastIndexOf(ancestorFileId);
      return { drillStack: idx >= 0 ? s.drillStack.slice(0, idx) : s.drillStack };
    }),

  setRenderSuccess: ({ svg, diagramType, dimensions, requestFit }) =>
    set((s) => ({
      renderedSvg: svg,
      diagramType,
      dimensions,
      parseError: null,
      ...(requestFit ? { needsViewportFit: true } : {}),
      ...(s.stageMode === 'code' ? { needsViewportFit: true } : {}),
    })),

  setRenderError: (parseError) =>
    set({
      renderedSvg: '',
      parseError,
    }),

  clearRenderStage: () =>
    set({
      renderedSvg: '',
      parseError: null,
      dimensions: null,
    }),

  setZoom: (updater) =>
    set((s) => ({
      zoom: typeof updater === 'function' ? updater(s.zoom) : updater,
    })),

  setPan: (pan) => set({ pan }),

  applyCamera: (camera) => {
    if (camera.zoom !== null) {
      set({
        zoom: camera.zoom,
        pan: camera.pan,
        needsViewportFit: false,
      });
    } else {
      set({ needsViewportFit: true });
    }
  },

  markViewportFitted: (fitZoom) =>
    set({
      zoom: fitZoom,
      pan: { x: 0, y: 0 },
      needsViewportFit: false,
    }),

  triggerFitCanvas: (fitZoom) =>
    set((s) => ({
      fitTrigger: s.fitTrigger + 1,
      zoom: fitZoom,
      pan: { x: 0, y: 0 },
      needsViewportFit: false,
    })),

  notifyToast: (message) => {
    if (toastHideTimer) clearTimeout(toastHideTimer);
    if (toastClearTimer) clearTimeout(toastClearTimer);

    set({ toast: message, toastVisible: false });
    requestAnimationFrame(() => {
      set({ toastVisible: true });
    });

    toastHideTimer = setTimeout(() => {
      set({ toastVisible: false });
      toastClearTimer = setTimeout(() => {
        set({ toast: null });
      }, 200);
    }, 2400);
  },
}));
