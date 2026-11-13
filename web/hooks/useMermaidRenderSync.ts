import { useEffect, useMemo, useRef } from 'react';
import { findFileWithProject, getHeadVersion } from '../../src/shared/vfs';
import { getCachedClientRender, renderMermaidClient } from '../services/mermaidRenderer';
import { studioApi } from '../services/studioClient';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';

/**
 * Race-safe client Mermaid render + syntax diagnostic pipeline.
 */
export function useMermaidRenderSync(enabled = true): void {
  const hydrated = useWorkspaceStore((s) => s.hydrated);
  const workspace = useWorkspaceStore((s) => s.workspace);
  const activeEntry = useMemo(
    () => findFileWithProject(workspace, workspace.activeFileId),
    [workspace]
  );
  const appearanceMode = useUiStore((s) => s.appearanceMode);

  const activeFile = activeEntry?.file ?? null;
  const activeFileId = activeFile?.id ?? null;
  const headRecord = activeFile ? getHeadVersion(activeFile) : null;
  const code = headRecord?.code ?? '';
  const verNum = headRecord?.version ?? 1;

  const renderSeqRef = useRef(0);

  useEffect(() => {
    if (!enabled || !hydrated) return undefined;

    if (!activeFile) {
      useUiStore.getState().clearRenderStage();
      return undefined;
    }

    const renderedKey = `${activeFileId}:v${verNum}:${appearanceMode}:${code.length}`;

    if (!code.trim()) {
      useUiStore.getState().setRenderError({
        message: 'Diagram source is empty',
        rawMessage: 'Empty code',
        line: 1,
        column: 1,
        snippet: null,
        expected: null,
        suggestion: null,
      });
      return undefined;
    }

    const cached = getCachedClientRender(code, appearanceMode);
    if (cached) {
      useUiStore.getState().setRenderSuccess({
        svg: cached.svg,
        renderedKey,
        diagramType: cached.diagramType,
        dimensions: cached.dimensions,
      });
      return undefined;
    }

    const seq = ++renderSeqRef.current;

    const runRender = async () => {
      if (seq !== renderSeqRef.current) return;

      const outcome = await renderMermaidClient(code, appearanceMode);
      if (seq !== renderSeqRef.current) return;

      if (outcome.ok) {
        useUiStore.getState().setRenderSuccess({
          svg: outcome.svg,
          renderedKey,
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
        suggestion: null,
      });
    };

    void runRender();
    return undefined;
  }, [enabled, hydrated, activeFile, activeFileId, verNum, code, appearanceMode]);
}
