import { useEffect } from 'react';
import { resolveGuideFlows } from '../../src/shared/comprehension';
import type { DiagramComprehensionGuide } from '../../src/shared/types';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';

export function useStudioShortcuts(activeGuide: DiagramComprehensionGuide | undefined): void {
  const page = useUiStore((s) => s.page);
  const stageMode = useUiStore((s) => s.stageMode);
  const activeFlowId = useUiStore((s) => s.activeFlowId);
  const activeStepIndex = useUiStore((s) => s.activeStepIndex);
  const selectedNodeId = useUiStore((s) => s.selectedNodeId);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (page !== 'studio') return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        useWorkspaceStore.getState().toggleSidebar();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        if (useWorkspaceStore.getState().workspace.activeFileId) {
          useUiStore.getState().setStageMode((m) => (m === 'preview' ? 'code' : 'preview'));
        }
        return;
      }

      if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
        const idx = Number.parseInt(e.key, 10) - 1;
        const targetId = useWorkspaceStore.getState().workspace.openTabIds[idx];
        if (targetId) {
          e.preventDefault();
          useWorkspaceStore.getState().openFile(targetId);
        }
        return;
      }

      const targetEl = e.target as HTMLElement | null;
      const inEditable = Boolean(
        targetEl &&
          (targetEl.tagName === 'INPUT' ||
            targetEl.tagName === 'TEXTAREA' ||
            targetEl.isContentEditable ||
            targetEl.closest('.cm-editor'))
      );
      if (inEditable || stageMode !== 'preview') return;

      const flows = resolveGuideFlows(activeGuide);
      const currentFlow =
        (activeFlowId && flows.find((f) => f.id === activeFlowId)) || flows[0] || null;
      const stepTotal = currentFlow?.steps.length ?? 0;

      if (e.key === 'Escape') {
        if (selectedNodeId !== null) {
          e.preventDefault();
          useUiStore.getState().setSelectedNodeId(null);
          return;
        }
        if (activeStepIndex !== null) {
          e.preventDefault();
          useUiStore.getState().setActiveStepIndex(null);
          return;
        }
      }

      if (!e.metaKey && !e.ctrlKey && !e.altKey && stepTotal > 0 && e.key === 'ArrowRight') {
        e.preventDefault();
        useUiStore
          .getState()
          .setActiveStepIndex((prev) =>
            prev === null ? 0 : Math.min(stepTotal - 1, prev + 1)
          );
        return;
      }

      if (!e.metaKey && !e.ctrlKey && !e.altKey && stepTotal > 0 && e.key === 'ArrowLeft') {
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
  }, [activeFlowId, activeGuide, activeStepIndex, page, selectedNodeId, stageMode]);
}
