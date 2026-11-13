import { useEffect } from 'react';
import { resolveGuideFlows } from '../../src/shared/comprehension';
import type { DiagramComprehensionGuide } from '../../src/shared/types';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';

export function useStudioShortcuts(
  activeGuide: DiagramComprehensionGuide | undefined,
  onNavigateParent?: (() => void) | null,
  enabled = true
): void {
  const page = useUiStore((s) => s.page);
  const activeFlowId = useUiStore((s) => s.activeFlowId);
  const activeStepIndex = useUiStore((s) => s.activeStepIndex);
  const selectedNodeId = useUiStore((s) => s.selectedNodeId);

  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (page !== 'studio') return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        useWorkspaceStore.getState().toggleSidebar();
        return;
      }

      const targetEl = e.target as HTMLElement | null;
      const inEditable = Boolean(
        targetEl &&
          (targetEl.tagName === 'INPUT' ||
            targetEl.tagName === 'TEXTAREA' ||
            targetEl.isContentEditable)
      );
      if (inEditable) return;

      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowLeft' && onNavigateParent) {
        e.preventDefault();
        onNavigateParent();
        return;
      }

      const flows = resolveGuideFlows(activeGuide);
      const currentFlow =
        (activeFlowId && flows.find((f) => f.id === activeFlowId)) || flows[0] || null;
      const stepTotal = currentFlow?.steps.length ?? 0;

      if (e.key === 'Escape') {
        if (selectedNodeId !== null) {
          e.preventDefault();
          useUiStore.getState().selectNode(null);
          return;
        }
        if (activeStepIndex !== null) {
          e.preventDefault();
          useUiStore.getState().setActiveStepIndex(null);
          return;
        }
      }

      if (
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        stepTotal > 0 &&
        (e.key === 'ArrowRight' || e.key === 'ArrowDown')
      ) {
        e.preventDefault();
        useUiStore
          .getState()
          .setActiveStepIndex((prev) =>
            prev === null ? 0 : Math.min(stepTotal - 1, prev + 1)
          );
        return;
      }

      if (
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        stepTotal > 0 &&
        (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      ) {
        e.preventDefault();
        useUiStore
          .getState()
          .setActiveStepIndex((prev) =>
            prev === null ? stepTotal - 1 : prev === 0 ? null : prev - 1
          );
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    enabled,
    activeFlowId,
    activeGuide,
    activeStepIndex,
    onNavigateParent,
    page,
    selectedNodeId,
  ]);
}
