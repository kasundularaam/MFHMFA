import { CodeEditorStage } from './components/CodeEditorStage';
import { DocsView } from './components/DocsView';
import { PreviewCanvas } from './components/PreviewCanvas';
import { TabBar } from './components/TabBar';
import { TopBar } from './components/TopBar';
import { useStudioController } from './hooks/useStudioController';

export function App() {
  const ctrl = useStudioController();

  return (
    <div className="studio-shell">
      <TopBar
        page={ctrl.page}
        onChangePage={ctrl.setPage}
        stageMode={ctrl.stageMode}
        onChangeStageMode={ctrl.setStageMode}
        appearanceMode={ctrl.appearanceMode}
        onToggleAppearance={ctrl.toggleAppearanceMode}
        viewMode={ctrl.viewMode}
        linkedLiveToken={ctrl.linkedLiveToken}
        liveState={ctrl.liveState}
        hasBufferedLiveUpdate={ctrl.hasBufferedLiveUpdate}
        onBrandClick={ctrl.handleBrandClick}
        onToggleLivePause={ctrl.handleToggleLivePause}
        onWatchLive={ctrl.handleWatchLive}
        onCopyPermalink={ctrl.handleCopyPermalink}
        repoUrl={ctrl.status?.repoUrl}
        hasError={Boolean(ctrl.parseError)}
        onExportPng={ctrl.handleExportPng}
        onExportSvg={ctrl.handleExportSvg}
        onCopyCode={() => {
          navigator.clipboard.writeText(ctrl.code);
          ctrl.notifyToast('Copied source');
        }}
      />

      {ctrl.page === 'studio' ? (
        <>
          <TabBar
            tabs={ctrl.tabs}
            activeTabId={ctrl.activeTabId}
            onSelectTab={ctrl.handleSelectTab}
            onCloseTab={ctrl.handleCloseTab}
            onNewTab={ctrl.handleNewTab}
            onRenameTab={ctrl.handleRenameTab}
          />
          <div className="workspace-body">
            <main className="single-stage">
              {ctrl.stageMode === 'preview' ? (
                <PreviewCanvas
                  viewportRef={ctrl.viewportRef}
                  chartKey={ctrl.chartKey}
                  renderedSvg={ctrl.renderedSvg}
                  waitingForLive={ctrl.waitingForLive}
                  parseError={ctrl.parseError}
                  zoom={ctrl.zoom}
                  pan={ctrl.pan}
                  onChangeZoom={ctrl.setZoom}
                  onResetView={() => {
                    ctrl.setZoom(1);
                    ctrl.setPan({ x: 0, y: 0 });
                  }}
                  onChangePan={ctrl.setPan}
                  onFitCanvas={ctrl.handleFitCanvas}
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
        </>
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
