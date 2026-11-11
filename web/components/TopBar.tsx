import { useState } from 'react';
import { ArrowLeft, Copy, Download, FileCode2, Settings } from 'lucide-react';
import type { StageMode, StudioPage } from '../hooks/useStudioController';

interface TopBarProps {
  page: StudioPage;
  onChangePage: (page: StudioPage) => void;
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
        <button
          className="brand-lockup"
          onClick={() => page === 'settings' && onChangePage('studio')}
          title="MFHMFA — Mermaid For Humans, Mermaid For Agents"
        >
          <svg
            className="brand-logo"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <rect
              x="2.5"
              y="3"
              width="7"
              height="5.5"
              rx="1.5"
              stroke="currentColor"
              strokeWidth="1.7"
            />
            <rect
              x="14.5"
              y="3"
              width="7"
              height="5.5"
              rx="1.5"
              stroke="currentColor"
              strokeWidth="1.7"
            />
            <rect
              x="8.5"
              y="15.5"
              width="7"
              height="5.5"
              rx="1.5"
              fill="currentColor"
            />
            <path
              d="M6 8.5V12C6 12.8284 6.67157 13.5 7.5 13.5H16.5C17.3284 13.5 18 12.8284 18 12V8.5M12 13.5V15.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          <span className="brand-name">MFHMFA</span>
        </button>

        {page === 'settings' && (
          <button className="btn ghost sm" onClick={() => onChangePage('studio')}>
            <ArrowLeft size={13} /> Studio
          </button>
        )}
      </div>

      <div className="topbar-center">
        {page === 'studio' ? (
          <div className="segmented-track" title="Switch view (Ctrl+E)">
            <span
              className={`segmented-thumb ${stageMode === 'code' ? 'right' : ''}`}
            />
            <button
              className={`segmented-btn ${stageMode === 'preview' ? 'active' : ''}`}
              onClick={() => onChangeStageMode('preview')}
            >
              Preview
            </button>
            <button
              className={`segmented-btn ${stageMode === 'code' ? 'active' : ''}`}
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
            {isDirty && <span className="dirty-indicator">Edited</span>}

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
