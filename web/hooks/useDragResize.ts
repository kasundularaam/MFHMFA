import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';

/**
 * Reusable, unmount-safe drag-sash hook that cleans up window listeners automatically.
 */
export function useDragResize(
  onDragDelta: (dx: number, dy: number) => void
): (e: ReactMouseEvent<HTMLElement>) => void {
  const callbackRef = useRef(onDragDelta);
  callbackRef.current = onDragDelta;

  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      cleanupRef.current?.();
    },
    []
  );

  return useCallback((e: ReactMouseEvent<HTMLElement>) => {
    e.preventDefault();
    cleanupRef.current?.();

    const startX = e.clientX;
    const startY = e.clientY;

    const onMove = (ev: MouseEvent) => {
      callbackRef.current(ev.clientX - startX, ev.clientY - startY);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      cleanupRef.current = null;
    };

    cleanupRef.current = onUp;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);
}
