import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { slugify } from '../src/shared/strings';
import {
  findFileWithProject,
  GENERAL_PROJECT_KEY,
  getVersionRecord,
  resolveProjectGraphHierarchy,
  toProjectKey,
  type GraphBreadcrumbHop,
  type VfsGraphFile,
} from '../src/shared/vfs';
import { normalizeRelativeGraphPath } from '../src/shared/vfsPath';
const CodeEditorStage = lazy(() =>
  import('./components/CodeEditorStage').then((m) => ({ default: m.CodeEditorStage }))
);
const DocsView = lazy(() =>
  import('./components/DocsView').then((m) => ({ default: m.DocsView }))
);
import { ExplorerSidebar } from './components/ExplorerSidebar';
import { PreviewCanvas } from './components/PreviewCanvas';
import { TabBar } from './components/TabBar';
import { TopBar } from './components/TopBar';
import { useMermaidRenderSync } from './hooks/useMermaidRenderSync';
import { useStudioShortcuts } from './hooks/useStudioShortcuts';
import { useWorkspaceRelay } from './hooks/useWorkspaceRelay';
import { studioApi } from './services/studioClient';
import { useUiStore, type CanvasTransitionKind } from './store/uiStore';
import { useWorkspaceStore, type OpenTabEntry } from './store/workspaceStore';

function computeViewportFitZoom(
  vp: HTMLDivElement | null,
  w: number,
  h: number
): number | null {
  if (!vp || vp.clientWidth === 0 || vp.clientHeight === 0) return null;
  const vw = Math.max(280, vp.clientWidth - 88);
  const vh = Math.max(200, vp.clientHeight - 80);
  const fit = Math.min(1, Math.max(0.22, Math.min(vw / (w + 48), vh / (h + 48))));
  return Number(fit.toFixed(2));
}

export function App() {
  useWorkspaceRelay();
  useMermaidRenderSync();

  const viewportRef = useRef<HTMLDivElement | null>(null);

  // Workspace store subscriptions (never triggered by 60fps canvas pan/zoom!)
  const workspace = useWorkspaceStore((s) => s.workspace);
  const selectedVersion = useWorkspaceStore((s) => s.selectedVersion);
  const connectedAgentsMap = useWorkspaceStore((s) => s.connectedAgentsMap);

  const toggleSidebar = useWorkspaceStore((s) => s.toggleSidebar);
  const resizeSidebar = useWorkspaceStore((s) => s.resizeSidebar);
  const toggleProjectExpanded = useWorkspaceStore((s) => s.toggleProjectExpanded);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const createGraph = useWorkspaceStore((s) => s.createGraph);
  const createFolder = useWorkspaceStore((s) => s.createFolder);
  const renamePath = useWorkspaceStore((s) => s.renamePath);
  const deleteGraph = useWorkspaceStore((s) => s.deleteGraph);
  const deleteFolder = useWorkspaceStore((s) => s.deleteFolder);
  const deleteProject = useWorkspaceStore((s) => s.deleteProject);
  const selectVersion = useWorkspaceStore((s) => s.selectVersion);
  const restoreVersion = useWorkspaceStore((s) => s.restoreVersion);
  const editActiveCode = useWorkspaceStore((s) => s.editActiveCode);
  const rotateWorkspaceId = useWorkspaceStore((s) => s.rotateWorkspaceId);

  // UI store subscriptions (excluding zoom/pan so App never re-renders while panning!)
  const appearanceMode = useUiStore((s) => s.appearanceMode);
  const page = useUiStore((s) => s.page);
  const stageMode = useUiStore((s) => s.stageMode);
  const serverStatus = useUiStore((s) => s.serverStatus);
  const activeStepIndex = useUiStore((s) => s.activeStepIndex);
  const selectedNodeId = useUiStore((s) => s.selectedNodeId);
  const drillStack = useUiStore((s) => s.drillStack);
  const renderedSvg = useUiStore((s) => s.renderedSvg);
  const diagramType = useUiStore((s) => s.diagramType);
  const parseError = useUiStore((s) => s.parseError);
  const dimensions = useUiStore((s) => s.dimensions);
  const needsViewportFit = useUiStore((s) => s.needsViewportFit);
  const toast = useUiStore((s) => s.toast);
  const toastVisible = useUiStore((s) => s.toastVisible);

  const toggleAppearanceMode = useUiStore((s) => s.toggleAppearanceMode);
  const setPage = useUiStore((s) => s.setPage);
  const setStageMode = useUiStore((s) => s.setStageMode);
  const setActiveStepIndex = useUiStore((s) => s.setActiveStepIndex);
  const setSelectedNodeId = useUiStore((s) => s.setSelectedNodeId);

  const pushDrillOrigin = useUiStore((s) => s.pushDrillOrigin);
  const popDrillToAncestor = useUiStore((s) => s.popDrillToAncestor);
  const markViewportFitted = useUiStore((s) => s.markViewportFitted);
  const triggerFitCanvas = useUiStore((s) => s.triggerFitCanvas);
  const notifyToast = useUiStore((s) => s.notifyToast);

  const openTabs: OpenTabEntry[] = useMemo(() => {
    const list: OpenTabEntry[] = [];
    for (const tabId of workspace.openTabIds) {
      const found = findFileWithProject(workspace, tabId);
      if (found) list.push(found);
    }
    return list;
  }, [workspace]);

  const activeEntry = useMemo(
    () => findFileWithProject(workspace, workspace.activeFileId),
    [workspace]
  );

  const activeFile = activeEntry?.file ?? null;
  const activeProject = activeEntry?.project ?? null;
  const activeFileId = activeFile?.id ?? null;

  const activeVersionRecord = useMemo(
    () => (activeFile ? getVersionRecord(activeFile, selectedVersion) : null),
    [activeFile, selectedVersion]
  );

  const isHistoricalVersion = Boolean(
    activeFile &&
      activeVersionRecord &&
      activeVersionRecord.version !== activeFile.currentVersion
  );

  const code = activeVersionRecord?.code ?? '';
  const activeGuide = activeVersionRecord?.guide;
  const title = activeFile?.title ?? null;
  const chartKey = activeFile
    ? `${activeFile.id}:v${activeVersionRecord?.version ?? activeFile.currentVersion}`
    : 'empty-stage';

  useStudioShortcuts(activeGuide);

  const connectedAgents = useMemo(
    () => Object.values(connectedAgentsMap),
    [connectedAgentsMap]
  );

  const liveProjectCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ag of connectedAgents) {
      const pKey = ag.project ? toProjectKey(ag.project) : GENERAL_PROJECT_KEY;
      counts.set(pKey, (counts.get(pKey) ?? 0) + 1);
    }
    return counts;
  }, [connectedAgents]);

  // Clamp step index & node selection safely if a live update alters the active guide
  useEffect(() => {
    const stepLen = activeGuide?.steps?.length ?? 0;
    if (activeStepIndex !== null && (stepLen === 0 || activeStepIndex >= stepLen)) {
      setActiveStepIndex(stepLen > 0 ? stepLen - 1 : null);
    }
    if (selectedNodeId && !activeGuide?.nodes?.[selectedNodeId]) {
      setSelectedNodeId(null);
    }
  }, [activeGuide, activeStepIndex, selectedNodeId, setActiveStepIndex, setSelectedNodeId]);

  const projectHierarchy = useMemo(
    () => (activeProject ? resolveProjectGraphHierarchy(activeProject) : null),
    [activeProject]
  );

  const ancestorChain: VfsGraphFile[] = useMemo(() => {
    if (!activeFileId) return [];
    const fromGraph = projectHierarchy?.getAncestors(activeFileId) ?? [];
    if (fromGraph.length > 0) return fromGraph;

    const fallback: VfsGraphFile[] = [];
    for (const sid of drillStack) {
      if (sid === activeFileId) break;
      const found = findFileWithProject(workspace, sid);
      if (found && !fallback.some((f) => f.id === found.file.id)) {
        fallback.push(found.file);
      }
    }
    return fallback;
  }, [activeFileId, projectHierarchy, drillStack, workspace]);

  const breadcrumbHops: GraphBreadcrumbHop[] = useMemo(() => {
    if (!activeFile) return [];
    const fromGraph = projectHierarchy?.getBreadcrumbHops(activeFile.id) ?? [];
    if (fromGraph.length > 0) return fromGraph;

    if (ancestorChain.length === 0) return [];
    const full = [...ancestorChain, activeFile];
    const fallbackHops: GraphBreadcrumbHop[] = [];
    for (let i = 0; i < full.length - 1; i++) {
      fallbackHops.push({
        parentFile: full[i]!,
        viaNodeId: null,
        viaComponentLabel: null,
        siblingBranches: [],
        childFile: full[i + 1]!,
      });
    }
    return fallbackHops;
  }, [activeFile, projectHierarchy, ancestorChain]);

  const prevFileIdRef = useRef<string | null>(activeFileId);
  const [transitionKind, setTransitionKind] = useState<CanvasTransitionKind>('crossfade');

  useLayoutEffect(() => {
    const prevId = prevFileIdRef.current;
    if (prevId && activeFileId && prevId !== activeFileId) {
      if (ancestorChain.some((a) => a.id === prevId)) {
        setTransitionKind('dive-in');
      } else if (projectHierarchy?.getAncestors(prevId).some((a) => a.id === activeFileId)) {
        setTransitionKind('zoom-out');
      } else {
        setTransitionKind('crossfade');
      }
    }
    prevFileIdRef.current = activeFileId;
  }, [activeFileId, ancestorChain, projectHierarchy]);

  // Fit diagram cleanly into viewport whenever a new un-fitted diagram renders
  useLayoutEffect(() => {
    if (
      page === 'studio' &&
      stageMode === 'preview' &&
      needsViewportFit &&
      dimensions &&
      activeFile
    ) {
      const fit = computeViewportFitZoom(
        viewportRef.current,
        dimensions.width,
        dimensions.height
      );
      if (fit !== null) {
        markViewportFitted(fit);
      }
    }
  }, [page, stageMode, needsViewportFit, dimensions, activeFile, markViewportFitted]);

  const handleFitCanvas = useCallback(() => {
    if (!dimensions) {
      triggerFitCanvas(1);
      return;
    }
    const fit = computeViewportFitZoom(
      viewportRef.current,
      dimensions.width,
      dimensions.height
    );
    triggerFitCanvas(fit ?? 1);
  }, [dimensions, triggerFitCanvas]);

  const handleDrillToPath = useCallback(
    (rawTargetPath: string) => {
      if (!activeProject) return;
      try {
        const targetRel = normalizeRelativeGraphPath(rawTargetPath);
        const targetFile = activeProject.files.find((f) => f.path === targetRel);
        if (!targetFile) {
          notifyToast(`File "${targetRel}" not found`);
          return;
        }
        if (activeFile && activeFile.id !== targetFile.id) {
          pushDrillOrigin(activeFile.id);
        }
        openFile(targetFile.id);
      } catch (err: unknown) {
        notifyToast(err instanceof Error ? err.message : 'Invalid file path');
      }
    },
    [activeFile, activeProject, notifyToast, openFile, pushDrillOrigin]
  );

  const handleJumpToAncestor = useCallback(
    (ancestorFileId: string) => {
      popDrillToAncestor(ancestorFileId);
      openFile(ancestorFileId);
    },
    [openFile, popDrillToAncestor]
  );

  const handleExportPng = useCallback(async () => {
    if (!code.trim()) return;
    const serverTheme = appearanceMode === 'dark' ? 'dark' : 'neutral';
    const serverBg = appearanceMode === 'dark' ? '#191918' : '#f5f3ee';
    try {
      const res = await studioApi.renderServer({
        code,
        title: title ?? undefined,
        theme: serverTheme,
        look: 'classic',
        background: serverBg,
        includePngBase64: true,
      });
      if (res.pngDataUrl) {
        const a = document.createElement('a');
        a.href = res.pngDataUrl;
        a.download = `${slugify(title || res.title || 'diagram')}.png`;
        a.click();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      notifyToast(`Export failed: ${message}`);
    }
  }, [appearanceMode, code, notifyToast, title]);

  const handleExportSvg = useCallback(() => {
    if (!renderedSvg) return;
    const blob = new Blob([renderedSvg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slugify(title || 'diagram')}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [renderedSvg, title]);

  const activeBreadcrumb =
    activeProject && activeFile ? `${activeProject.projectLabel} / ${activeFile.path}` : null;

  return (
    <div className="studio-shell">
      <TopBar
        page={page}
        onChangePage={setPage}
        sidebarOpen={workspace.sidebarOpen}
        onToggleSidebar={toggleSidebar}
        appearanceMode={appearanceMode}
        onToggleAppearance={toggleAppearanceMode}
        connectedAgentCount={connectedAgents.length}
        activeBreadcrumb={activeBreadcrumb}
        onBrandClick={() => {
          if (page === 'docs') setPage('studio');
        }}
        repoUrl={serverStatus?.repoUrl}
        onExportPng={handleExportPng}
        onExportSvg={handleExportSvg}
        onCopyCode={() => {
          if (!code) return;
          navigator.clipboard.writeText(code);
          notifyToast('Copied code');
        }}
      />

      {page === 'studio' ? (
        <div className="workspace-body">
          {workspace.sidebarOpen && (
            <ExplorerSidebar
              width={workspace.sidebarWidth}
              projects={workspace.projects}
              activeFileId={workspace.activeFileId}
              activeProjectKey={activeProject?.projectKey ?? null}
              workspaceId={workspace.workspaceId}
              connectedAgents={connectedAgents}
              liveProjectCounts={liveProjectCounts}
              onResizeWidth={resizeSidebar}
              onToggleProjectExpanded={toggleProjectExpanded}
              onOpenFile={openFile}
              onCreateGraph={createGraph}
              onCreateFolder={createFolder}
              onRenamePath={renamePath}
              onDeleteGraph={deleteGraph}
              onDeleteFolder={deleteFolder}
              onDeleteProject={deleteProject}
              onNotifyToast={notifyToast}
            />
          )}

          <div className="editor-column">
            <TabBar
              openTabs={openTabs}
              activeFile={activeFile}
              activeVersionRecord={activeVersionRecord}
              isHistoricalVersion={isHistoricalVersion}
              stageMode={stageMode}
              hasError={Boolean(parseError)}
              onSelectTab={openFile}
              onCloseTab={closeTab}
              onNewTab={() => createGraph()}
              onSelectVersion={selectVersion}
              onRestoreVersion={restoreVersion}
              onToggleStageMode={() =>
                setStageMode((m) => (m === 'preview' ? 'code' : 'preview'))
              }
              onFitCanvas={handleFitCanvas}
            />

            <main className="single-stage">
              {stageMode === 'preview' || !activeFile ? (
                <PreviewCanvas
                  viewportRef={viewportRef}
                  chartKey={chartKey}
                  renderedSvg={renderedSvg}
                  hasActiveFile={Boolean(activeFile)}
                  historicalVersion={
                    isHistoricalVersion && activeVersionRecord
                      ? activeVersionRecord.version
                      : null
                  }
                  onExitHistoricalVersion={() => selectVersion(null)}
                  parseError={parseError}
                  guide={activeGuide}
                  activeStepIndex={activeStepIndex}
                  onChangeStepIndex={(next) => setActiveStepIndex(next)}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={setSelectedNodeId}
                  breadcrumbHops={breadcrumbHops}
                  transitionKind={transitionKind}
                  onJumpToAncestor={handleJumpToAncestor}
                  onDrillToPath={handleDrillToPath}
                  onCopyFilePath={(fp) => {
                    navigator.clipboard.writeText(fp);
                    notifyToast(`Copied ${fp}`);
                  }}
                  onFlipToCode={() => setStageMode('code')}
                />
              ) : (
                <Suspense fallback={null}>
                  <CodeEditorStage
                    code={code}
                    appearanceMode={appearanceMode}
                    diagramType={diagramType}
                    parseError={parseError}
                    onChangeCode={editActiveCode}
                  />
                </Suspense>
              )}
            </main>
          </div>
        </div>
      ) : (
        <Suspense fallback={null}>
          <DocsView
            workspaceId={workspace.workspaceId}
            onRotateWorkspaceId={rotateWorkspaceId}
          />
        </Suspense>
      )}

      {toast && <div className={`toast-banner ${toastVisible ? 'visible' : ''}`}>{toast}</div>}
    </div>
  );
}
