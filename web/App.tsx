import { CodeEditorStage } from './components/CodeEditorStage';
import { PreviewCanvas } from './components/PreviewCanvas';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { useStudioController } from './hooks/useStudioController';
import { studioApi } from './services/studioClient';

export function App() {
  const ctrl = useStudioController();

  return (
    <div className="studio-shell">
      <TopBar
        page={ctrl.page}
        onChangePage={ctrl.setPage}
        sidebarOpen={ctrl.sidebarOpen}
        onToggleSidebar={() => ctrl.setSidebarOpen((v) => !v)}
        title={ctrl.title}
        onChangeTitle={(next) => {
          ctrl.setTitle(next);
          ctrl.setIsDirty(true);
        }}
        isDirty={ctrl.isDirty}
        stageMode={ctrl.stageMode}
        onChangeStageMode={ctrl.setStageMode}
        hasError={Boolean(ctrl.parseError)}
        saving={ctrl.saving}
        onSave={ctrl.handleSave}
        onExportPng={ctrl.handleExportPng}
        onExportSvg={ctrl.handleExportSvg}
        onCopyCode={() => {
          navigator.clipboard.writeText(ctrl.code);
          ctrl.notifyToast('Copied source');
        }}
      />

      {ctrl.page === 'studio' ? (
        <div className="workspace-body">
          <Sidebar
            open={ctrl.sidebarOpen}
            tab={ctrl.sidebarTab}
            onChangeTab={ctrl.setSidebarTab}
            search={ctrl.search}
            onChangeSearch={ctrl.setSearch}
            charts={ctrl.filteredCharts}
            templates={ctrl.templates}
            activeChartId={ctrl.activeChartId}
            onSelectChart={(id) => {
              ctrl.loadChartIntoWorkspace(id);
              ctrl.setStageMode(ctrl.defaultOpenMode);
            }}
            onDeleteChart={ctrl.handleDeleteChart}
            onSelectTemplate={(tpl) => {
              ctrl.setActiveChartId(null);
              ctrl.setTitle(tpl.name);
              ctrl.setCode(tpl.code);
              ctrl.setIsDirty(true);
              ctrl.setStageMode('preview');
            }}
            onNewChart={ctrl.handleNewChart}
          />

          <main className="single-stage">
            {ctrl.stageMode === 'preview' ? (
              <PreviewCanvas
                viewportRef={ctrl.viewportRef}
                chartKey={ctrl.activeChartId || ctrl.title}
                renderedSvg={ctrl.renderedSvg}
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
                onChangeCode={(next) => {
                  ctrl.setCode(next);
                  ctrl.setIsDirty(true);
                }}
              />
            )}
          </main>
        </div>
      ) : (
        <SettingsView
          section={ctrl.settingsSection}
          onChangeSection={ctrl.setSettingsSection}
          appearanceMode={ctrl.appearanceMode}
          onChangeAppearanceMode={ctrl.setAppearanceMode}
          followAgentLive={ctrl.followAgentLive}
          onToggleFollowAgentLive={() => ctrl.setFollowAgentLive((v) => !v)}
          defaultOpenMode={ctrl.defaultOpenMode}
          onChangeDefaultOpenMode={ctrl.setDefaultOpenMode}
          wsConnected={ctrl.wsConnected}
          status={ctrl.status}
          events={ctrl.events}
          activeChartId={ctrl.activeChartId}
          title={ctrl.title}
          version={ctrl.version}
          versions={ctrl.versions}
          guideText={ctrl.guideText}
          onOpenChartInStudio={(chartId, ver) => {
            ctrl.loadChartIntoWorkspace(chartId, ver);
            ctrl.setPage('studio');
          }}
          onRestoreVersion={async (ver) => {
            if (!ctrl.activeChartId) return;
            await studioApi.updateChart(ctrl.activeChartId, {
              code: ver.code,
              changeNote: `Restored from v${ver.version}`,
            });
            await ctrl.loadChartIntoWorkspace(ctrl.activeChartId);
            ctrl.setPage('studio');
            ctrl.notifyToast(`Restored v${ver.version}`);
          }}
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
