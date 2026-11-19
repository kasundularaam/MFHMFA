import { create } from 'zustand';
import type { ParseErrorDetail } from '../../src/shared/types';
import type { ServerStatus } from '../services/studioClient';
import type { AppearanceMode } from '../theme/comfortTheme';
import { DEFAULT_LEFT_FRACTION, DEFAULT_RIGHT_FRACTION } from '../utils/ideLayout';

export type StudioPage = 'studio' | 'docs';
export type LeftToolId = 'explorer';
export type RightToolId = 'graph';
export type CanvasTransitionKind = 'crossfade' | 'dive-in' | 'zoom-out';
export type NotificationKind = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface NotificationOptions {
  id?: string;
  kind?: NotificationKind;
  source?: string;
  action?: ToastAction | null;
  sticky?: boolean;
  durationMs?: number;
}

export interface StudioNotification {
  id: string;
  kind: NotificationKind;
  message: string;
  source?: string;
  action: ToastAction | null;
  sticky: boolean;
  createdAt: number;
}

export interface AnchorPoint {
  clientX: number;
  clientY: number;
}

const APPEARANCE_STORAGE_KEY = 'mermaid-studio-mode';
const RIGHT_TOOL_STORAGE_KEY = 'mfhmfa-right-tool';
const LEFT_FRACTION_STORAGE_KEY = 'mfhmfa-left-panel-fraction';
const RIGHT_FRACTION_STORAGE_KEY = 'mfhmfa-right-panel-fraction';
const PARSE_ERROR_NOTIFICATION_ID = 'mermaid-parse-error';
const MAX_VISIBLE_NOTIFICATIONS = 4;

function readInitialAppearance(): AppearanceMode {
  try {
    const saved = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return saved === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function readInitialRightTool(): RightToolId | null {
  try {
    const saved = localStorage.getItem(RIGHT_TOOL_STORAGE_KEY);
    if (saved === 'none') return null;
    if (saved === 'graph') return 'graph';
  } catch {
    // ignore
  }
  return 'graph';
}

function readInitialFraction(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? Number.parseFloat(raw) : Number.NaN;
    if (Number.isFinite(parsed) && parsed > 0.05 && parsed < 0.9) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return fallback;
}

function isToastAction(val: ToastAction | NotificationOptions): val is ToastAction {
  return 'label' in val && typeof val.onClick === 'function';
}

let notificationSeq = 0;
const notificationTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearNotificationTimer(id: string): void {
  const existing = notificationTimers.get(id);
  if (existing) {
    clearTimeout(existing);
    notificationTimers.delete(id);
  }
}

export interface UiStoreState {
  appearanceMode: AppearanceMode;
  page: StudioPage;
  serverStatus: ServerStatus | null;

  activeRightTool: RightToolId | null;
  leftPanelFraction: number;
  rightPanelFraction: number;

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

  notifications: StudioNotification[];

  toggleAppearanceMode: () => void;
  setPage: (page: StudioPage) => void;
  setServerStatus: (status: ServerStatus | null) => void;

  toggleRightTool: (tool: RightToolId) => void;
  setPanelFractions: (next: { leftFraction?: number; rightFraction?: number }) => void;

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

  notifyToast: (
    message: string,
    actionOrOptions?: ToastAction | NotificationOptions | null
  ) => string;
  dismissToast: (id?: string) => void;
}

export const useUiStore = create<UiStoreState>((set, get) => ({
  appearanceMode: readInitialAppearance(),
  page: 'studio',
  serverStatus: null,

  activeRightTool: readInitialRightTool(),
  leftPanelFraction: readInitialFraction(LEFT_FRACTION_STORAGE_KEY, DEFAULT_LEFT_FRACTION),
  rightPanelFraction: readInitialFraction(RIGHT_FRACTION_STORAGE_KEY, DEFAULT_RIGHT_FRACTION),

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

  notifications: [],

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

  toggleRightTool: (tool) => {
    const next = get().activeRightTool === tool ? null : tool;
    try {
      localStorage.setItem(RIGHT_TOOL_STORAGE_KEY, next ?? 'none');
    } catch {
      // ignore
    }
    set({ activeRightTool: next });
  },

  setPanelFractions: ({ leftFraction, rightFraction }) => {
    const updates: Partial<UiStoreState> = {};
    if (typeof leftFraction === 'number' && Number.isFinite(leftFraction)) {
      updates.leftPanelFraction = leftFraction;
      try {
        localStorage.setItem(LEFT_FRACTION_STORAGE_KEY, leftFraction.toFixed(4));
      } catch {
        // ignore
      }
    }
    if (typeof rightFraction === 'number' && Number.isFinite(rightFraction)) {
      updates.rightPanelFraction = rightFraction;
      try {
        localStorage.setItem(RIGHT_FRACTION_STORAGE_KEY, rightFraction.toFixed(4));
      } catch {
        // ignore
      }
    }
    if (Object.keys(updates).length > 0) {
      set(updates);
    }
  },

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

  setRenderSuccess: ({ svg, renderedKey, diagramType, dimensions, requestFit }) => {
    get().dismissToast(PARSE_ERROR_NOTIFICATION_ID);
    set({
      renderedSvg: svg,
      renderedKey,
      diagramType,
      dimensions,
      parseError: null,
      ...(requestFit ? { needsViewportFit: true, userCameraAdjusted: false } : {}),
    });
  },

  setRenderError: (parseError) => {
    set({
      renderedSvg: '',
      renderedKey: '',
      parseError,
    });
    const formatted = parseError.line
      ? `Diagram render error on line ${parseError.line}: ${parseError.message}`
      : parseError.message;
    get().notifyToast(formatted, {
      id: PARSE_ERROR_NOTIFICATION_ID,
      kind: 'error',
      source: 'Mermaid Renderer',
      sticky: true,
    });
  },

  clearRenderStage: () => {
    get().dismissToast(PARSE_ERROR_NOTIFICATION_ID);
    set({
      renderedSvg: '',
      renderedKey: '',
      parseError: null,
      dimensions: null,
    });
  },

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

  notifyToast: (message, actionOrOptions = null) => {
    const opts: NotificationOptions =
      actionOrOptions && isToastAction(actionOrOptions)
        ? { action: actionOrOptions }
        : (actionOrOptions ?? {});

    const id = opts.id || `notif-${++notificationSeq}`;
    const kind: NotificationKind = opts.kind || 'info';
    const action = opts.action ?? null;
    const sticky = Boolean(opts.sticky);

    clearNotificationTimer(id);

    const entry: StudioNotification = {
      id,
      kind,
      message,
      ...(opts.source ? { source: opts.source } : {}),
      action,
      sticky,
      createdAt: Date.now(),
    };

    set((s) => {
      const withoutId = s.notifications.filter((n) => n.id !== id);
      const next = [entry, ...withoutId];
      if (next.length > MAX_VISIBLE_NOTIFICATIONS) {
        const overflow = next.slice(MAX_VISIBLE_NOTIFICATIONS);
        for (const evicted of overflow) {
          clearNotificationTimer(evicted.id);
        }
        return { notifications: next.slice(0, MAX_VISIBLE_NOTIFICATIONS) };
      }
      return { notifications: next };
    });

    if (!sticky) {
      const holdMs =
        opts.durationMs ??
        (action ? 6000 : kind === 'error' || kind === 'warning' ? 4800 : 3000);
      const timer = setTimeout(() => {
        notificationTimers.delete(id);
        set((s) => ({
          notifications: s.notifications.filter((n) => n.id !== id),
        }));
      }, holdMs);
      notificationTimers.set(id, timer);
    }

    return id;
  },

  dismissToast: (id) => {
    if (id) {
      clearNotificationTimer(id);
      set((s) => ({
        notifications: s.notifications.filter((n) => n.id !== id),
      }));
      return;
    }
    const newest = get().notifications[0];
    if (!newest) return;
    clearNotificationTimer(newest.id);
    set((s) => ({
      notifications: s.notifications.filter((n) => n.id !== newest.id),
    }));
  },
}));
