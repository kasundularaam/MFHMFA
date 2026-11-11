import { useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Copy,
  Download,
  FileCode2,
  Link2,
  Moon,
  Radio,
  Sun,
} from 'lucide-react';
import type {
  LiveConnectionState,
  StageMode,
  StudioPage,
  ViewMode,
} from '../hooks/useStudioController';
import type { AppearanceMode } from '../theme/comfortTheme';
import { BrandLogo } from './BrandLogo';

const DEFAULT_GITHUB_URL = 'https://github.com/kasundularaam/MFHMFA';

interface TopBarProps {
  page: StudioPage;
  onChangePage: (page: StudioPage) => void;
  stageMode: StageMode;
  onChangeStageMode: (mode: StageMode) => void;
  appearanceMode: AppearanceMode;
  onToggleAppearance: () => void;
  viewMode: ViewMode;
  linkedLiveToken: string | null;
  liveState: LiveConnectionState;
  hasBufferedLiveUpdate: boolean;
  onBrandClick: () => void;
  onToggleLivePause: () => void;
  onWatchLive: () => void;
  onCopyPermalink: () => void;
  repoUrl?: string;
  hasError: boolean;
  onExportPng: () => void;
  onExportSvg: () => void;
  onCopyCode: () => void;
}

export function TopBar({
  page,
  onChangePage,
  stageMode,
  onChangeStageMode,
  appearanceMode,
  onToggleAppearance,
  viewMode,
  linkedLiveToken,
  liveState,
  hasBufferedLiveUpdate,
  onBrandClick,
  onToggleLivePause,
  onWatchLive,
  onCopyPermalink,
  repoUrl,
  hasError,
  onExportPng,
  onExportSvg,
  onCopyCode,
}: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const brandInteractive = page === 'docs' || viewMode !== 'scratchpad';
  const showLiveBadge =
    viewMode === 'live' ||
    (viewMode === 'scratchpad' && (liveState === 'connected' || liveState === 'paused'));

  return (
    <header className="topbar" onClick={() => menuOpen && setMenuOpen(false)}>
      <div className="topbar-left">
        <button
          className="brand-lockup"
          onClick={onBrandClick}
          style={{ cursor: brandInteractive ? 'pointer' : 'default' }}
          title={
            page === 'docs'
              ? 'Back to Studio'
              : viewMode !== 'scratchpad'
                ? 'Return to local workspace'
                : 'MFHMFA — Mermaid For Humans, Mermaid For Agents'
          }
        >
          <BrandLogo height={19} className="brand-logo" />
        </button>

        {page === 'docs' ? (
          <button className="btn ghost sm" onClick={() => onChangePage('studio')}>
            <ArrowLeft size={13} /> Studio
          </button>
        ) : (
          <>
            {showLiveBadge && (
              <button
                className={`live-pill ${liveState === 'paused' ? 'paused' : 'active'}`}
                onClick={onToggleLivePause}
                title={
                  liveState === 'paused'
                    ? 'Click to resume auto-opening agent tabs'
                    : 'Auto-syncing agent diagrams into tabs — click to pause'
                }
              >
                <span
                  className={`live-dot ${
                    liveState === 'connected'
                      ? 'online'
                      : liveState === 'paused'
                        ? 'paused'
                        : 'connecting'
                  }`}
                />
                <span>
                  {liveState === 'paused'
                    ? hasBufferedLiveUpdate
                      ? 'Update ready · Resume'
                      : 'Paused · Resume'
                    : liveState === 'connected'
                      ? 'Live'
                      : 'Connecting…'}
                </span>
              </button>
            )}

            {viewMode === 'snapshot' && linkedLiveToken && (
              <button
                className="btn ghost sm"
                onClick={onWatchLive}
                title="Follow real-time updates from this AI agent session"
              >
                <Radio size={12} /> Watch Live
              </button>
            )}
          </>
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
          <span style={{ fontWeight: 550, fontSize: 13 }}>Docs</span>
        )}
      </div>

      <div className="topbar-right">
        <button
          className="icon-btn"
          onClick={onCopyPermalink}
          title="Copy Shareable Permalink (all open tabs)"
        >
          <Link2 size={15} />
        </button>

        <div className="dropdown-wrap" onClick={(e) => e.stopPropagation()}>
          <button
            className="icon-btn"
            onClick={() => setMenuOpen((v) => !v)}
            title="Download / Export"
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
                  onCopyPermalink();
                }}
              >
                <Link2 size={13} /> Copy Permalink
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

        <button
          className={`icon-btn ${page === 'docs' ? 'active' : ''}`}
          onClick={() => onChangePage(page === 'docs' ? 'studio' : 'docs')}
          title="Documentation & MCP Setup"
        >
          <BookOpen size={15} />
        </button>

        <button
          className="icon-btn"
          onClick={onToggleAppearance}
          title={appearanceMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {appearanceMode === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>

        <a
          className="icon-btn"
          href={repoUrl || DEFAULT_GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          title="GitHub Repository"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 .5C5.648.5.5 5.648.5 12c0 5.088 3.292 9.395 7.868 10.915.575.107.785-.25.785-.555 0-.273-.01-1-.015-1.962-3.2.695-3.875-1.542-3.875-1.542-.523-1.33-1.278-1.684-1.278-1.684-1.044-.714.08-.7.08-.7 1.155.082 1.763 1.186 1.763 1.186 1.026 1.758 2.692 1.25 3.348.956.104-.743.402-1.25.73-1.538-2.554-.29-5.238-1.277-5.238-5.683 0-1.255.448-2.28 1.184-3.084-.118-.29-.513-1.462.112-3.048 0 0 .966-.31 3.166 1.18a11.01 11.01 0 0 1 2.882-.388c.978.005 1.963.132 2.882.388 2.2-1.49 3.164-1.18 3.164-1.18.627 1.586.232 2.758.114 3.048.738.804 1.182 1.83 1.182 3.084 0 4.418-2.688 5.39-5.25 5.674.412.356.78 1.058.78 2.132 0 1.54-.014 2.782-.014 3.16 0 .308.208.668.792.554C20.212 21.39 23.5 17.085 23.5 12 23.5 5.648 18.352.5 12 .5Z" />
          </svg>
        </a>
      </div>
    </header>
  );
}
