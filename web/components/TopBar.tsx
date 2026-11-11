import { useState } from 'react';
import {
  ArrowLeft,
  Copy,
  Download,
  FileCode2,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
} from 'lucide-react';
import type { StageMode, StudioPage } from '../hooks/useStudioController';

interface TopBarProps {
  page: StudioPage;
  onChangePage: (page: StudioPage) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  title: string;
  onChangeTitle: (value: string) => void;
  isDirty: boolean;
  stageMode: StageMode;
  onChangeStageMode: (mode: StageMode) => void;
  hasError: boolean;
  saving: boolean;
  onSave: () => void;
  onExportPng: () => void;
  onExportSvg: () => void;
  onCopyCode: () => void;
}

export function TopBar({
  page,
  onChangePage,
  sidebarOpen,
  onToggleSidebar,
  title,
  onChangeTitle,
  isDirty,
  stageMode,
  onChangeStageMode,
  hasError,
  saving,
  onSave,
  onExportPng,
  onExportSvg,
  onCopyCode,
}: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="topbar" onClick={() => menuOpen && setMenuOpen(false)}>
      <div className="topbar-left">
        {page === 'studio' ? (
          <>
            <button
              className="icon-btn"
              onClick={onToggleSidebar}
              title={`${sidebarOpen ? 'Collapse' : 'Expand'} panel (Ctrl+B)`}
            >
              {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
            </button>
            <input
              className="title-input"
              value={title}
              onChange={(e) => onChangeTitle(e.target.value)}
              placeholder="Untitled Diagram"
            />
            {isDirty && <span className="dirty-indicator">Edited</span>}
          </>
        ) : (
          <button className="btn ghost" onClick={() => onChangePage('studio')}>
            <ArrowLeft size={14} /> Studio
          </button>
        )}
      </div>

      <div className="topbar-center">
        {page === 'studio' ? (
          <div className="mode-flip" title="Switch view (Ctrl+E)">
            <button
              className={`mode-flip-btn ${stageMode === 'preview' ? 'active' : ''}`}
              onClick={() => onChangeStageMode('preview')}
            >
              Preview
            </button>
            <button
              className={`mode-flip-btn ${stageMode === 'code' ? 'active' : ''}`}
              onClick={() => onChangeStageMode('code')}
            >
              Code
              {hasError && <span className="error-dot" />}
            </button>
          </div>
        ) : (
          <span style={{ fontWeight: 550, fontSize: 13 }}>Settings</span>
        )}
      </div>

      <div className="topbar-right">
        {page === 'studio' && (
          <>
            <button className="btn primary" onClick={onSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>

            <div className="dropdown-wrap" onClick={(e) => e.stopPropagation()}>
              <button
                className="icon-btn"
                onClick={() => setMenuOpen((v) => !v)}
                title="Export"
              >
                <Download size={15} />
              </button>
              {menuOpen && (
                <div className="dropdown-menu">
                  <button
                    className="dropdown-item"
                    onClick={() => {
                      setMenuOpen(false);
                      onExportPng();
                    }}
                  >
                    <Download size={13} /> Export PNG
                  </button>
                  <button
                    className="dropdown-item"
                    onClick={() => {
                      setMenuOpen(false);
                      onExportSvg();
                    }}
                  >
                    <FileCode2 size={13} /> Export SVG
                  </button>
                  <button
                    className="dropdown-item"
                    onClick={() => {
                      setMenuOpen(false);
                      onCopyCode();
                    }}
                  >
                    <Copy size={13} /> Copy Mermaid Code
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        <button
          className={`icon-btn ${page === 'settings' ? 'active' : ''}`}
          onClick={() => onChangePage(page === 'studio' ? 'settings' : 'studio')}
          title="Settings"
        >
          <Settings size={16} />
        </button>
      </div>
    </header>
  );
}
