import { create } from 'zustand';
import type { ParseErrorDetail } from '../../src/shared/types';
import type { ServerStatus } from '../services/studioClient';
import type { AppearanceMode } from '../theme/comfortTheme';

export type StudioPage = 'studio' | 'docs';
export type CanvasTransitionKind = 'crossfade' | 'dive-in' | 'zoom-out';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface AnchorPoint {
  clientX: number;
  clientY: number;
}

const APPEARANCE_STORAGE_KEY = 'mermaid-studio-mode';
const STORY_WIDTH_STORAGE_KEY = 'mfhmfa-story-width';
const DEFAULT_STORY_WIDTH = 404;
export const MIN_STORY_WIDTH = 320;
export const MAX_STORY_WIDTH = 560;

function readInitialAppearance(): AppearanceMode {
  try {
    const saved = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return saved === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function readInitialStoryWidth(): number {
  try {
    const raw = localStorage.getItem(STORY_WIDTH_STORAGE_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    if (Number.isFinite(parsed)) {
      return Math.min(MAX_STORY_WIDTH, Math.max(MIN_STORY_WIDTH, parsed));
    }
  } catch {
    // ignore
  }
  return DEFAULT_STORY_WIDTH;
}

let toastHideTimer: ReturnType<typeof setTimeout> | null = null;
let toastClearTimer: ReturnType<typeof setTimeout> | null = null;

export interface UiStoreState {
  appearanceMode: AppearanceMode;
  page: StudioPage;
  serverStatus: ServerStatus | null;

  storyWidth: number;
  storyCollapsed: boolean;

  activeFlowId: string | null;
  activeStepIndex: number | null;
  selectedNodeId: string | null;
  nodeAnchorPoint: AnchorPoint | null;
  drillStack: string[];

  renderedSvg: string;
  renderedKey: string;
  diagramType: string | null;
  parseError: ParseErrorDetail | null;
  dimensions: { width: number; height: number } | null;

  zoom: number;
  pan: { x: number; y: number };
  fitTrigger: number;
  needsViewportFit: boolean;
  userCameraAdjusted: boolean;

  toast: string | null;
  toastAction: ToastAction | null;
  toastVisible: boolean;

  toggleAppearanceMode: () => void;
  setPage: (page: StudioPage) => void;
  setServerStatus: (status: ServerStatus | null) => void;

  resizeStory: (nextWidth: number) => void;
  toggleStoryCollapsed: () => void;

  setActiveFlowId: (flowId: string | null) => void;
  setActiveStepIndex: (
    updater: number | null | ((prev: number | null) => number | null)
  ) => void;
  selectNode: (nodeId: string | null, anchorPoint?: AnchorPoint | null) => void;
  setSelectedNodeId: (nodeId: string | null) => void;
  resetComprehensionSelection: () => void;
  clearDrillStack: () => void;
  pushDrillOrigin: (fileId: string) => void;
  popDrillToAncestor: (ancestorFileId: string) => void;

  setRenderSuccess: (payload: {
    svg: string;
    renderedKey: string;
    diagramType: string | null;
    dimensions: { width: number; height: number } | null;
    requestFit?: boolean;
  }) => void;
  setRenderError: (error: ParseErrorDetail) => void;
  clearRenderStage: () => void;

  setZoom: (updater: number | ((prev: number) => number)) => void;
  setPan: (pan: { x: number; y: number }) => void;
  markUserCameraAdjusted: () => void;
  applyCamera: (camera: { zoom: number | null; pan: { x: number; y: number } }) => void;
  markViewportFitted: (fitZoom: number) => void;
  triggerFitCanvas: (fitZoom: number) => void;

  notifyToast: (message: string, action?: ToastAction | null) => void;
  dismissToast: () => void;
}

export const useUiStore = create<UiStoreState>((set, get) => ({
  appearanceMode: readInitialAppearance(),
  page: 'studio',
  serverStatus: null,

  storyWidth: readInitialStoryWidth(),
  storyCollapsed: false,

  activeFlowId: null,
  activeStepIndex: null,
  selectedNodeId: null,
  nodeAnchorPoint: null,
  drillStack: [],

  renderedSvg: '',
  renderedKey: '',
  diagramType: 'flowchart-v2',
  parseError: null,
  dimensions: null,

  zoom: 1,
  pan: { x: 0, y: 0 },
  fitTrigger: 0,
  needsViewportFit: true,
  userCameraAdjusted: false,

  toast: null,
  toastAction: null,
  toastVisible: false,

  toggleAppearanceMode: () => {
    const next: AppearanceMode = get().appearanceMode === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(APPEARANCE_STORAGE_KEY, next);
    } catch {
      // ignore
    }
    document.documentElement.dataset.mode = next;
    document.documentElement.style.colorScheme = next;
    set({ appearanceMode: next });
  },

  setPage: (page) => set({ page }),

  setServerStatus: (serverStatus) => set({ serverStatus }),

  resizeStory: (nextWidth) => {
    const clamped = Math.min(MAX_STORY_WIDTH, Math.max(MIN_STORY_WIDTH, Math.round(nextWidth)));
    try {
      localStorage.setItem(STORY_WIDTH_STORAGE_KEY, String(clamped));
    } catch {
      // ignore
    }
    set({ storyWidth: clamped });
  },

  toggleStoryCollapsed: () => set((s) => ({ storyCollapsed: !s.storyCollapsed })),

  setActiveFlowId: (activeFlowId) =>
    set((s) => ({
      activeFlowId,
      activeStepIndex:
        activeFlowId !== s.activeFlowId && s.activeStepIndex !== null ? 0 : s.activeStepIndex,
    })),

  setActiveStepIndex: (updater) =>
    set((s) => ({
      activeStepIndex: typeof updater === 'function' ? updater(s.activeStepIndex) : updater,
    })),

  selectNode: (nodeId, anchorPoint = null) =>
    set({
      selectedNodeId: nodeId,
      nodeAnchorPoint: nodeId ? anchorPoint : null,
    }),

  setSelectedNodeId: (selectedNodeId) =>
    set({
      selectedNodeId,
      nodeAnchorPoint: selectedNodeId ? get().nodeAnchorPoint : null,
    }),

  resetComprehensionSelection: () =>
    set({
      activeFlowId: null,
      activeStepIndex: null,
      selectedNodeId: null,
      nodeAnchorPoint: null,
    }),

  clearDrillStack: () => set({ drillStack: [] }),

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

  setRenderSuccess: ({ svg, renderedKey, diagramType, dimensions, requestFit }) =>
    set({
      renderedSvg: svg,
      renderedKey,
      diagramType,
      dimensions,
      parseError: null,
      ...(requestFit ? { needsViewportFit: true, userCameraAdjusted: false } : {}),
    }),

  setRenderError: (parseError) =>
    set({
      renderedSvg: '',
      renderedKey: '',
      parseError,
    }),

  clearRenderStage: () =>
    set({
      renderedSvg: '',
      renderedKey: '',
      parseError: null,
      dimensions: null,
    }),

  setZoom: (updater) =>
    set((s) => ({
      zoom: typeof updater === 'function' ? updater(s.zoom) : updater,
    })),

  setPan: (pan) => set({ pan }),

  markUserCameraAdjusted: () => set({ userCameraAdjusted: true }),

  applyCamera: (camera) => {
    if (camera.zoom !== null) {
      set({
        zoom: camera.zoom,
        pan: camera.pan,
        needsViewportFit: false,
        userCameraAdjusted: true,
      });
    } else {
      set({ needsViewportFit: true, userCameraAdjusted: false });
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
      userCameraAdjusted: false,
    })),

  notifyToast: (message, action = null) => {
    if (toastHideTimer) clearTimeout(toastHideTimer);
    if (toastClearTimer) clearTimeout(toastClearTimer);

    const holdMs = action ? 5200 : 2400;

    set({ toast: message, toastAction: action, toastVisible: false });
    requestAnimationFrame(() => {
      set({ toastVisible: true });
    });

    toastHideTimer = setTimeout(() => {
      set({ toastVisible: false });
      toastClearTimer = setTimeout(() => {
        set({ toast: null, toastAction: null });
      }, 200);
    }, holdMs);
  },

  dismissToast: () => {
    if (toastHideTimer) clearTimeout(toastHideTimer);
    if (toastClearTimer) clearTimeout(toastClearTimer);
    set({ toastVisible: false });
    toastClearTimer = setTimeout(() => {
      set({ toast: null, toastAction: null });
    }, 180);
  },
}));
