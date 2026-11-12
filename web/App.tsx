import { CodeEditorStage } from './components/CodeEditorStage';
import { DocsView } from './components/DocsView';
import { ExplorerSidebar } from './components/ExplorerSidebar';
import { PreviewCanvas } from './components/PreviewCanvas';
import { TabBar } from './components/TabBar';
import { TopBar } from './components/TopBar';
import { useStudioController } from './hooks/useStudioController';

export function App() {
  const ctrl = useStudioController();

  const activeBreadcrumb =
    ctrl.activeProject && ctrl.activeFile
      ? `${ctrl.activeProject.projectLabel} / ${ctrl.activeFile.path}`
      : null;

  return (
    <div className="studio-shell">
      <TopBar
        page={ctrl.page}
        onChangePage={ctrl.setPage}
        sidebarOpen={ctrl.workspace.sidebarOpen}
        onToggleSidebar={ctrl.handleToggleSidebar}
        appearanceMode={ctrl.appearanceMode}
        onToggleAppearance={ctrl.toggleAppearanceMode}
        connectedAgentCount={ctrl.connectedAgents.length}
        activeBreadcrumb={activeBreadcrumb}
        onBrandClick={ctrl.handleBrandClick}
        onCopyPermalink={ctrl.handleCopyPermalink}
        repoUrl={ctrl.status?.repoUrl}
        onExportPng={ctrl.handleExportPng}
        onExportSvg={ctrl.handleExportSvg}
        onCopyCode={() => {
          if (!ctrl.code) return;
          navigator.clipboard.writeText(ctrl.code);
          ctrl.notifyToast('Copied code');
        }}
      />

      {ctrl.page === 'studio' ? (
        <div className="workspace-body">
          {ctrl.workspace.sidebarOpen && (
            <ExplorerSidebar
              width={ctrl.workspace.sidebarWidth}
              projects={ctrl.workspace.projects}
              activeFileId={ctrl.workspace.activeFileId}
              activeProjectKey={ctrl.activeProject?.projectKey ?? null}
              workspaceId={ctrl.workspaceId}
              connectedAgents={ctrl.connectedAgents}
              liveProjectCounts={ctrl.liveProjectCounts}
              onResizeWidth={ctrl.handleResizeSidebar}
              onToggleProjectExpanded={ctrl.handleToggleProjectExpanded}
              onOpenFile={ctrl.handleOpenFile}
              onCreateGraph={ctrl.handleCreateGraph}
              onCreateFolder={ctrl.handleCreateFolder}
              onRenamePath={ctrl.handleRenamePath}
              onDeleteGraph={ctrl.handleDeleteGraph}
              onDeleteFolder={ctrl.handleDeleteFolder}
              onDeleteProject={ctrl.handleDeleteProject}
              onNotifyToast={ctrl.notifyToast}
            />
          )}

          <div className="editor-column">
            <TabBar
              openTabs={ctrl.openTabs}
              activeFile={ctrl.activeFile}
              activeVersionRecord={ctrl.activeVersionRecord}
              isHistoricalVersion={ctrl.isHistoricalVersion}
              stageMode={ctrl.stageMode}
              hasError={Boolean(ctrl.parseError)}
              onSelectTab={ctrl.handleOpenFile}
              onCloseTab={ctrl.handleCloseTab}
              onNewTab={() => ctrl.handleCreateGraph()}
              onSelectVersion={ctrl.handleSelectVersion}
              onRestoreVersion={ctrl.handleRestoreVersion}
              onToggleStageMode={() =>
                ctrl.setStageMode((m) => (m === 'preview' ? 'code' : 'preview'))
              }
              onFitCanvas={ctrl.handleFitCanvas}
            />

            <main className="single-stage">
              {ctrl.stageMode === 'preview' || !ctrl.activeFile ? (
                <PreviewCanvas
                  viewportRef={ctrl.viewportRef}
                  chartKey={ctrl.chartKey}
                  renderedSvg={ctrl.renderedSvg}
                  hasActiveFile={Boolean(ctrl.activeFile)}
                  historicalVersion={
                    ctrl.isHistoricalVersion && ctrl.activeVersionRecord
                      ? ctrl.activeVersionRecord.version
                      : null
                  }
                  onExitHistoricalVersion={() => ctrl.handleSelectVersion(null)}
                  parseError={ctrl.parseError}
                  guide={ctrl.activeGuide}
                  activeStepIndex={ctrl.activeStepIndex}
                  onChangeStepIndex={ctrl.setActiveStepIndex}
                  selectedNodeId={ctrl.selectedNodeId}
                  onSelectNode={ctrl.setSelectedNodeId}
                  breadcrumbHops={ctrl.breadcrumbHops}
                  transitionKind={ctrl.transitionKind}
                  onJumpToAncestor={ctrl.handleJumpToAncestor}
                  onDrillToPath={ctrl.handleDrillToPath}
                  onCopyFilePath={(fp) => {
                    navigator.clipboard.writeText(fp);
                    ctrl.notifyToast(`Copied ${fp}`);
                  }}
                  zoom={ctrl.zoom}
                  pan={ctrl.pan}
                  fitTrigger={ctrl.fitTrigger}
                  onChangeZoom={ctrl.setZoom}
                  onChangePan={ctrl.setPan}
                  onFlipToCode={() => ctrl.setStageMode('code')}
                />
              ) : (
                <CodeEditorStage
                  code={ctrl.code}
                  appearanceMode={ctrl.appearanceMode}
                  diagramType={ctrl.diagramType}
                  parseError={ctrl.parseError}
                  onChangeCode={ctrl.setCode}
                />
              )}
            </main>
          </div>
        </div>
      ) : (
        <DocsView
          workspaceId={ctrl.workspaceId}
          onRotateWorkspaceId={ctrl.handleRotateWorkspaceId}
        />
      )}

      {ctrl.toast && (
        <div className={`toast-banner ${ctrl.toastVisible ? 'visible' : ''}`}>
          {ctrl.toast}
        </div>
      )}
    </div>
  );
}
