import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 6;

interface UseCanvasViewportOptions {
  viewportRef: RefObject<HTMLDivElement | null>;
  zoom: number;
  pan: { x: number; y: number };
  onChangeZoom: (nextZoom: number) => void;
  onChangePan: (nextPan: { x: number; y: number }) => void;
  onUserCameraGesture?: () => void;
}

/**
 * Non-passive cursor-centered wheel/trackpad zoom + PointerEvent drag panning.
 */
export function useCanvasViewport({
  viewportRef,
  zoom,
  pan,
  onChangeZoom,
  onChangePan,
  onUserCameraGesture,
}: UseCanvasViewportOptions) {
  const latestRef = useRef({ zoom, pan, onChangeZoom, onChangePan, onUserCameraGesture });
  latestRef.current = { zoom, pan, onChangeZoom, onChangePan, onUserCameraGesture };

  const dragStateRef = useRef({
    active: false,
    pointerId: -1,
    moved: false,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
  });

  // Attach non-passive wheel listener so `preventDefault()` never triggers passive warnings
  // and zoom anchors smoothly around the cursor position!
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const {
        zoom: curZoom,
        pan: curPan,
        onChangeZoom: setZ,
        onChangePan: setP,
        onUserCameraGesture: onGesture,
      } = latestRef.current;

      onGesture?.();

      const factor = e.deltaY < 0 ? 1.08 : 0.92;
      const nextZoom = Number(
        Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, curZoom * factor)).toFixed(2)
      );
      if (nextZoom === curZoom) return;

      const rect = el.getBoundingClientRect();
      const cursorOffsetX = e.clientX - (rect.left + rect.width / 2);
      const cursorOffsetY = e.clientY - (rect.top + rect.height / 2);
      const ratio = nextZoom / curZoom;

      const nextPanX = cursorOffsetX - (cursorOffsetX - curPan.x) * ratio;
      const nextPanY = cursorOffsetY - (cursorOffsetY - curPan.y) * ratio;

      setZ(nextZoom);
      setP({ x: nextPanX, y: nextPanY });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [viewportRef]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as Element | null;
    if (target?.closest('button, aside, nav')) return;

    latestRef.current.onUserCameraGesture?.();
    dragStateRef.current = {
      active: true,
      pointerId: e.pointerId,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      origX: latestRef.current.pan.x,
      origY: latestRef.current.pan.y,
    };
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const st = dragStateRef.current;
    if (!st.active || e.pointerId !== st.pointerId) return;
    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;
    if (!st.moved && Math.hypot(dx, dy) >= 5) {
      st.moved = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    if (st.moved) {
      latestRef.current.onChangePan({
        x: st.origX + dx,
        y: st.origY + dy,
      });
    }
  }, []);

  const endPointerDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const st = dragStateRef.current;
    if (!st.active || e.pointerId !== st.pointerId) return;
    if (st.moved && e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    st.active = false;
  }, []);

  const wasDraggedRecently = useCallback(() => dragStateRef.current.moved, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: endPointerDrag,
    onPointerCancel: endPointerDrag,
    wasDraggedRecently,
  };
}
