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
import { resolveGuideFlows } from '../src/shared/comprehension';
import { slugify } from '../src/shared/strings';
import {
  extractNodeLabelFromMermaid,
  findFileWithProject,
  GENERAL_PROJECT_KEY,
  getHeadVersion,
  resolveProjectGraphHierarchy,
  toProjectKey,
  type GraphBreadcrumbHop,
  type ParentComponentBranch,
  type VfsGraphFile,
} from '../src/shared/vfs';
import { normalizeRelativeGraphPath } from '../src/shared/vfsPath';
import { ExplorerSidebar } from './components/ExplorerSidebar';
import { MobileInfoPage } from './components/MobileInfoPage';
import { PreviewCanvas } from './components/PreviewCanvas';
import { StoryPanel } from './components/StoryPanel';
import { TopBar } from './components/TopBar';
import { useIsMobileViewport } from './hooks/useIsMobileViewport';
import { useMermaidRenderSync } from './hooks/useMermaidRenderSync';
import { useStudioShortcuts } from './hooks/useStudioShortcuts';
import { useWorkspaceRelay } from './hooks/useWorkspaceRelay';
import { studioApi } from './services/studioClient';
import { useUiStore, type CanvasTransitionKind } from './store/uiStore';
import { useWorkspaceStore } from './store/workspaceStore';

const DocsView = lazy(() =>
  import('./components/DocsView').then((m) => ({ default: m.DocsView }))
);

const STAGE_PADDING_PX = 48;
const VIEWPORT_FIT_MARGIN_PX = 24;
const MIN_AUTO_FIT_ZOOM = 0.15;
const MAX_AUTO_FIT_ZOOM = 1.3;

function resolveDiagramSize(
  vp: HTMLDivElement | null,
  dimensions: { width: number; height: number } | null
): { width: number; height: number } | null {
  if (dimensions && dimensions.width > 0 && dimensions.height > 0) {
    return dimensions;
  }
  const svg = vp?.querySelector('.canvas-stage svg') as SVGSVGElement | null;
  if (!svg) return null;
  const vb = svg.viewBox?.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) {
    return { width: Math.ceil(vb.width), height: Math.ceil(vb.height) };
  }
  const wAttr = Number.parseFloat(svg.getAttribute('width') || '');
  const hAttr = Number.parseFloat(svg.getAttribute('height') || '');
  if (wAttr > 0 && hAttr > 0) {
    return { width: Math.ceil(wAttr), height: Math.ceil(hAttr) };
  }
  return null;
}

function computeViewportFitZoom(
  vp: HTMLDivElement | null,
  dimensions: { width: number; height: number } | null
): number | null {
  if (!vp || vp.clientWidth <= 0 || vp.clientHeight <= 0) return null;
  const size = resolveDiagramSize(vp, dimensions);
  if (!size) return null;

  const availW = Math.max(64, vp.clientWidth - VIEWPORT_FIT_MARGIN_PX);
  const availH = Math.max(64, vp.clientHeight - VIEWPORT_FIT_MARGIN_PX);
  const stageW = size.width + STAGE_PADDING_PX;
  const stageH = size.height + STAGE_PADDING_PX;

  const rawFit = Math.min(availW / stageW, availH / stageH);
  const clamped = Math.min(MAX_AUTO_FIT_ZOOM, Math.max(MIN_AUTO_FIT_ZOOM, rawFit));
  return Number(clamped.toFixed(2));
}

export function App() {
  const isMobile = useIsMobileViewport();
  useWorkspaceRelay(!isMobile);
  useMermaidRenderSync(!isMobile);

  const viewportRef = useRef<HTMLDivElement | null>(null);

  // Workspace store subscriptions
  const workspace = useWorkspaceStore((s) => s.workspace);
  const connectedAgentsMap = useWorkspaceStore((s) => s.connectedAgentsMap);

  const toggleSidebar = useWorkspaceStore((s) => s.toggleSidebar);
  const resizeSidebar = useWorkspaceStore((s) => s.resizeSidebar);
  const toggleProjectExpanded = useWorkspaceStore((s) => s.toggleProjectExpanded);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const createFolder = useWorkspaceStore((s) => s.createFolder);
  const renameFolder = useWorkspaceStore((s) => s.renameFolder);
  const deleteGraph = useWorkspaceStore((s) => s.deleteGraph);
  const deleteFolder = useWorkspaceStore((s) => s.deleteFolder);
  const deleteProject = useWorkspaceStore((s) => s.deleteProject);
  const rotateWorkspaceId = useWorkspaceStore((s) => s.rotateWorkspaceId);

  // UI store subscriptions (excluding zoom/pan so App never re-renders while panning!)
  const appearanceMode = useUiStore((s) => s.appearanceMode);
  const page = useUiStore((s) => s.page);
  const serverStatus = useUiStore((s) => s.serverStatus);
  const storyWidth = useUiStore((s) => s.storyWidth);
  const storyCollapsed = useUiStore((s) => s.storyCollapsed);
  const activeFlowId = useUiStore((s) => s.activeFlowId);
  const activeStepIndex = useUiStore((s) => s.activeStepIndex);
  const selectedNodeId = useUiStore((s) => s.selectedNodeId);
  const nodeAnchorPoint = useUiStore((s) => s.nodeAnchorPoint);
  const drillStack = useUiStore((s) => s.drillStack);
  const renderedSvg = useUiStore((s) => s.renderedSvg);
  const renderedKey = useUiStore((s) => s.renderedKey);
  const parseError = useUiStore((s) => s.parseError);
  const dimensions = useUiStore((s) => s.dimensions);
  const needsViewportFit = useUiStore((s) => s.needsViewportFit);
  const userCameraAdjusted = useUiStore((s) => s.userCameraAdjusted);
  const toast = useUiStore((s) => s.toast);
  const toastAction = useUiStore((s) => s.toastAction);
  const toastVisible = useUiStore((s) => s.toastVisible);

  const toggleAppearanceMode = useUiStore((s) => s.toggleAppearanceMode);
  const setPage = useUiStore((s) => s.setPage);
  const resizeStory = useUiStore((s) => s.resizeStory);
  const toggleStoryCollapsed = useUiStore((s) => s.toggleStoryCollapsed);
  const setActiveFlowId = useUiStore((s) => s.setActiveFlowId);
  const setActiveStepIndex = useUiStore((s) => s.setActiveStepIndex);
  const selectNode = useUiStore((s) => s.selectNode);
  const clearDrillStack = useUiStore((s) => s.clearDrillStack);
  const pushDrillOrigin = useUiStore((s) => s.pushDrillOrigin);
  const popDrillToAncestor = useUiStore((s) => s.popDrillToAncestor);
  const markViewportFitted = useUiStore((s) => s.markViewportFitted);
  const triggerFitCanvas = useUiStore((s) => s.triggerFitCanvas);
  const notifyToast = useUiStore((s) => s.notifyToast);

  const activeEntry = useMemo(
    () => findFileWithProject(workspace, workspace.activeFileId),
    [workspace]
  );

  const activeFile = activeEntry?.file ?? null;
  const activeProject = activeEntry?.project ?? null;
  const activeFileId = activeFile?.id ?? null;

  const headVersionRecord = useMemo(
    () => (activeFile ? getHeadVersion(activeFile) : null),
    [activeFile]
  );

  const code = headVersionRecord?.code ?? '';
  const activeGuide = headVersionRecord?.guide;
  const title = activeFile?.title ?? null;
  const activeVersionNumber = activeFile
    ? (headVersionRecord?.version ?? activeFile.currentVersion)
    : 1;
  const chartKey = activeFile ? `${activeFile.id}:v${activeVersionNumber}` : 'empty-stage';
  const expectedRenderedKey = activeFile
    ? `${activeFile.id}:v${activeVersionNumber}:${appearanceMode}:${code.length}`
    : '';

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

  const flows = useMemo(() => resolveGuideFlows(activeGuide), [activeGuide]);
  const currentFlow = useMemo(
    () => (activeFlowId && flows.find((f) => f.id === activeFlowId)) || flows[0] || null,
    [activeFlowId, flows]
  );

  // Clamp flow, step index & node selection safely if a live update alters the active guide
  useEffect(() => {
    if (activeFlowId !== null && !flows.some((f) => f.id === activeFlowId)) {
      setActiveFlowId(flows[0]?.id ?? null);
      return;
    }
    const stepLen = currentFlow?.steps.length ?? 0;
    if (activeStepIndex !== null && (stepLen === 0 || activeStepIndex >= stepLen)) {
      setActiveStepIndex(stepLen > 0 ? stepLen - 1 : null);
    }
    if (selectedNodeId && !activeGuide?.nodes?.[selectedNodeId]) {
      selectNode(null);
    }
  }, [
    activeFlowId,
    activeGuide,
    activeStepIndex,
    currentFlow,
    flows,
    selectNode,
    selectedNodeId,
    setActiveFlowId,
    setActiveStepIndex,
  ]);

  const projectHierarchy = useMemo(
    () => (activeProject ? resolveProjectGraphHierarchy(activeProject) : null),
    [activeProject]
  );

  const ancestorChain: VfsGraphFile[] = useMemo(() => {
    if (!activeFileId || !activeProject) return [];
    const fromGraph = projectHierarchy?.getAncestors(activeFileId) ?? [];
    if (fromGraph.length > 0) return fromGraph;

    const fallback: VfsGraphFile[] = [];
    for (const sid of drillStack) {
      if (sid === activeFileId) break;
      const found = findFileWithProject(workspace, sid);
      if (
        found &&
        found.project.projectKey === activeProject.projectKey &&
        !fallback.some((f) => f.id === found.file.id)
      ) {
        fallback.push(found.file);
      }
    }
    return fallback;
  }, [activeFileId, activeProject, projectHierarchy, drillStack, workspace]);

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

  const childBranches: ParentComponentBranch[] = useMemo(() => {
    if (!activeFile || !activeProject) return [];
    const list: ParentComponentBranch[] = [];
    const seenIds = new Set<string>();

    if (activeGuide?.nodes) {
      for (const [nodeId, detail] of Object.entries(activeGuide.nodes)) {
        if (!detail.childPath) continue;
        try {
          const norm = normalizeRelativeGraphPath(detail.childPath);
          const childFile = activeProject.files.find((f) => f.path === norm);
          if (childFile && childFile.id !== activeFile.id && !seenIds.has(childFile.id)) {
            seenIds.add(childFile.id);
            const componentLabel =
              detail.label?.trim() || extractNodeLabelFromMermaid(code, nodeId);
            list.push({ nodeId, componentLabel, childFile });
          }
        } catch {
          // ignore invalid childPath
        }
      }
    }

    for (const childFile of projectHierarchy?.childrenByFileId.get(activeFile.id) ?? []) {
      if (!seenIds.has(childFile.id)) {
        seenIds.add(childFile.id);
        list.push({
          nodeId: childFile.id,
          componentLabel: childFile.title,
          childFile,
        });
      }
    }

    return list;
  }, [activeFile, activeGuide, activeProject, code, projectHierarchy]);

  const handleJumpToAncestor = useCallback(
    (ancestorFileId: string) => {
      popDrillToAncestor(ancestorFileId);
      openFile(ancestorFileId);
    },
    [openFile, popDrillToAncestor]
  );

  const immediateParentId =
    breadcrumbHops.length > 0 ? breadcrumbHops[breadcrumbHops.length - 1]!.parentFile.id : null;

  useStudioShortcuts(
    activeGuide,
    immediateParentId ? () => handleJumpToAncestor(immediateParentId) : null,
    !isMobile
  );

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

  const hasStoryContent = Boolean(
    activeFile && (activeGuide?.gist || flows.length > 0 || childBranches.length > 0)
  );
  const showStoryPanel = Boolean(activeFile && hasStoryContent && !storyCollapsed);

  // Fit diagram into the available canvas height & width on initial render AND keep fitted
  // smoothly across window/sidebar/story resizes until the user manually zooms or pans!
  useLayoutEffect(() => {
    if (
      isMobile ||
      page !== 'studio' ||
      !activeFile ||
      !renderedSvg ||
      renderedKey !== expectedRenderedKey
    ) {
      return undefined;
    }

    const vp = viewportRef.current;
    if (!vp) return undefined;

    if (needsViewportFit) {
      const fit = computeViewportFitZoom(vp, dimensions);
      if (fit !== null) {
        markViewportFitted(fit);
      }
    }

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        const st = useUiStore.getState();
        if (!st.needsViewportFit && st.userCameraAdjusted) return;
        const nextFit = computeViewportFitZoom(vp, dimensions);
        if (nextFit !== null) {
          markViewportFitted(nextFit);
        }
      });
      ro.observe(vp);
      return () => ro.disconnect();
    }
    return undefined;
  }, [
    isMobile,
    page,
    activeFile,
    renderedSvg,
    renderedKey,
    expectedRenderedKey,
    dimensions,
    needsViewportFit,
    userCameraAdjusted,
    showStoryPanel,
    workspace.sidebarOpen,
    markViewportFitted,
  ]);

  const handleFitCanvas = useCallback(() => {
    const fit = computeViewportFitZoom(viewportRef.current, dimensions);
    triggerFitCanvas(fit ?? 1);
  }, [dimensions, triggerFitCanvas]);

  const handleDrillToPath = useCallback(
    (rawTargetPath: string) => {
      if (!activeProject) return;
      try {
        const targetRel = normalizeRelativeGraphPath(rawTargetPath);
        const targetFile = activeProject.files.find((f) => f.path === targetRel);
        if (!targetFile) {
          notifyToast(`Sub-diagram "${targetRel}" not found`);
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

  const handleExportPng = useCallback(async () => {
    if (!code.trim()) return;
    const serverTheme = appearanceMode === 'dark' ? 'dark' : 'neutral';
    const serverBg = appearanceMode === 'dark' ? '#191918' : '#f5f1e9';
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

  const rootTopicFile =
    activeFile && projectHierarchy
      ? (projectHierarchy.getRootForFile(activeFile.id) ?? activeFile)
      : activeFile;

  const activeBreadcrumb =
    activeProject && rootTopicFile
      ? `${activeProject.projectLabel} / ${rootTopicFile.title || rootTopicFile.path}`
      : null;

  return (
    <div className="studio-shell">
      <TopBar
        isMobile={isMobile}
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
      />

      {isMobile ? (
        <MobileInfoPage repoUrl={serverStatus?.repoUrl} />
      ) : page === 'studio' ? (
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
              onOpenFile={(fileId) => {
                clearDrillStack();
                openFile(fileId);
              }}
              onCreateFolder={createFolder}
              onRenameFolder={renameFolder}
              onDeleteGraph={deleteGraph}
              onDeleteFolder={deleteFolder}
              onDeleteProject={deleteProject}
              onNotifyToast={(msg) => notifyToast(msg)}
            />
          )}

          <main className="learning-stage">
            {showStoryPanel && activeFile && (
              <StoryPanel
                chartKey={chartKey}
                activeFile={activeFile}
                guide={activeGuide}
                flows={flows}
                currentFlow={currentFlow}
                activeStepIndex={activeStepIndex}
                breadcrumbHops={breadcrumbHops}
                childBranches={childBranches}
                width={storyWidth}
                onResizeWidth={resizeStory}
                onCollapse={toggleStoryCollapsed}
                onChangeFlowId={setActiveFlowId}
                onChangeStepIndex={(next) => setActiveStepIndex(next)}
                onJumpToAncestor={handleJumpToAncestor}
                onDrillToPath={handleDrillToPath}
              />
            )}

            <PreviewCanvas
              viewportRef={viewportRef}
              chartKey={chartKey}
              renderedSvg={renderedSvg}
              hasActiveFile={Boolean(activeFile)}
              activeProject={activeProject}
              parseError={parseError}
              guide={activeGuide}
              activeFlowId={activeFlowId}
              activeStepIndex={activeStepIndex}
              selectedNodeId={selectedNodeId}
              nodeAnchorPoint={nodeAnchorPoint}
              onSelectNode={selectNode}
              breadcrumbHops={breadcrumbHops}
              showInlineBreadcrumb={!showStoryPanel}
              canReopenStory={Boolean(activeFile && hasStoryContent && storyCollapsed)}
              onReopenStory={toggleStoryCollapsed}
              transitionKind={transitionKind}
              onJumpToAncestor={handleJumpToAncestor}
              onDrillToPath={handleDrillToPath}
              onFitCanvas={handleFitCanvas}
              onCopyRef={(fp) => {
                navigator.clipboard.writeText(fp);
                notifyToast(`Copied ${fp}`);
              }}
            />
          </main>
        </div>
      ) : (
        <Suspense fallback={null}>
          <DocsView
            workspaceId={workspace.workspaceId}
            onRotateWorkspaceId={rotateWorkspaceId}
          />
        </Suspense>
      )}

      {toast && (
        <div
          className={`toast-banner ${toastVisible ? 'visible' : ''} ${toastAction ? 'has-action' : ''}`}
        >
          <span>{toast}</span>
          {toastAction && (
            <button type="button" className="toast-action-btn" onClick={toastAction.onClick}>
              {toastAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
