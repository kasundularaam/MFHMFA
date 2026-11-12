import { useEffect, useMemo, useRef } from 'react';
import { findFileWithProject, getVersionRecord } from '../../src/shared/vfs';
import { getCachedClientRender, renderMermaidClient } from '../services/mermaidRenderer';
import { studioApi } from '../services/studioClient';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';

/**
 * Unified, race-safe client Mermaid render + syntax diagnostic pipeline.
 * Replaces the old split `activateStateAndRender` + `useEffect` dual path
 * so switching tabs, restoring history, theme toggles, and CodeMirror edits
 * all share one consistent render & `parseError` flow.
 */
export function useMermaidRenderSync(): void {
  const hydrated = useWorkspaceStore((s) => s.hydrated);
  const workspace = useWorkspaceStore((s) => s.workspace);
  const selectedVersion = useWorkspaceStore((s) => s.selectedVersion);
  const activeEntry = useMemo(
    () => findFileWithProject(workspace, workspace.activeFileId),
    [workspace]
  );
  const appearanceMode = useUiStore((s) => s.appearanceMode);
  const stageMode = useUiStore((s) => s.stageMode);

  const activeFile = activeEntry?.file ?? null;
  const activeFileId = activeFile?.id ?? null;
  const activeVerRecord = activeFile ? getVersionRecord(activeFile, selectedVersion) : null;
  const code = activeVerRecord?.code ?? '';

  const renderSeqRef = useRef(0);
  const prevFileKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!hydrated) return undefined;

    if (!activeFile) {
      prevFileKeyRef.current = null;
      useUiStore.getState().clearRenderStage();
      return undefined;
    }

    const fileKey = `${activeFileId}::${selectedVersion ?? 'head'}::${appearanceMode}`;
    const isFileOrThemeSwitch = prevFileKeyRef.current !== fileKey;
    prevFileKeyRef.current = fileKey;

    if (!code.trim()) {
      useUiStore.getState().setRenderError({
        message: 'Diagram source is empty',
        rawMessage: 'Empty code',
        line: 1,
        column: 1,
        snippet: null,
        expected: null,
        suggestion: 'Start with `flowchart TD`, `sequenceDiagram`, or `erDiagram`.',
      });
      return undefined;
    }

    const cached = getCachedClientRender(code, appearanceMode);
    if (cached) {
      useUiStore.getState().setRenderSuccess({
        svg: cached.svg,
        diagramType: cached.diagramType,
        dimensions: cached.dimensions,
      });
      return undefined;
    }

    const seq = ++renderSeqRef.current;
    // Render immediately when switching files/versions/themes; debounce 90ms while typing in Code view
    const delayMs = isFileOrThemeSwitch || stageMode === 'preview' ? 0 : 90;

    const runRender = async () => {
      if (seq !== renderSeqRef.current) return;

      const outcome = await renderMermaidClient(code, appearanceMode);
      if (seq !== renderSeqRef.current) return;

      if (outcome.ok) {
        useUiStore.getState().setRenderSuccess({
          svg: outcome.svg,
          diagramType: outcome.diagramType,
          dimensions: outcome.dimensions,
        });
        return;
      }

      try {
        const diag = await studioApi.validate(code);
        if (seq !== renderSeqRef.current) return;
        if (!diag.valid && diag.error) {
          useUiStore.getState().setRenderError(diag.error);
          return;
        }
      } catch {
        // Fall through to local fallback error message
      }

      if (seq !== renderSeqRef.current) return;
      const fallbackMessage =
        outcome.error instanceof Error ? outcome.error.message : 'Syntax error';
      useUiStore.getState().setRenderError({
        message: fallbackMessage,
        rawMessage: String(outcome.error),
        line: null,
        column: null,
        snippet: null,
        expected: null,
        suggestion: 'Wrap special characters inside double quotes ["..."].',
      });
    };

    if (delayMs === 0) {
      void runRender();
      return undefined;
    }

    const timer = setTimeout(() => {
      void runRender();
    }, delayMs);
    return () => clearTimeout(timer);
  }, [hydrated, activeFile, activeFileId, selectedVersion, code, appearanceMode, stageMode]);
}
