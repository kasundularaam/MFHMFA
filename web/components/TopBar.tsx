import { useEffect, useState } from 'react';
import {
  BookOpen,
  Copy,
  Download,
  FileCode2,
  Link2,
  Moon,
  PanelLeft,
  Sun,
} from 'lucide-react';
import type { StudioPage } from '../hooks/useStudioController';
import type { AppearanceMode } from '../theme/comfortTheme';
import { BrandLogo } from './BrandLogo';

const DEFAULT_GITHUB_URL = 'https://github.com/kasundularaam/MFHMFA';

interface TopBarProps {
  page: StudioPage;
  onChangePage: (page: StudioPage) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  appearanceMode: AppearanceMode;
  onToggleAppearance: () => void;
  connectedAgentCount: number;
  activeBreadcrumb: string | null;
  onBrandClick: () => void;
  onCopyPermalink: () => void;
  repoUrl?: string;
  onExportPng: () => void;
  onExportSvg: () => void;
  onCopyCode: () => void;
}

export function TopBar({
  page,
  onChangePage,
  sidebarOpen,
  onToggleSidebar,
  appearanceMode,
  onToggleAppearance,
  connectedAgentCount,
  activeBreadcrumb,
  onBrandClick,
  onCopyPermalink,
  repoUrl,
  onExportPng,
  onExportSvg,
  onCopyCode,
}: TopBarProps) {
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  useEffect(() => {
    if (!exportMenuOpen) return undefined;
    const onDocClick = () => setExportMenuOpen(false);
    window.addEventListener('click', onDocClick);
    return () => window.removeEventListener('click', onDocClick);
  }, [exportMenuOpen]);

  return (
    <header className="topbar">
      <div className="topbar-left">
        {page === 'studio' && (
          <button
            type="button"
            className={`icon-btn ${sidebarOpen ? 'active' : ''}`}
            onClick={onToggleSidebar}
            title="Toggle sidebar (Ctrl+B)"
            aria-label="Toggle sidebar"
          >
            <PanelLeft size={18} />
          </button>
        )}

        <button
          type="button"
          className="brand-lockup"
          onClick={onBrandClick}
          style={{ cursor: page === 'docs' ? 'pointer' : 'default' }}
          title={page === 'docs' ? 'Home' : 'MFHMFA'}
        >
          <BrandLogo height={21} className="brand-logo" />
        </button>

        {page === 'studio' && !sidebarOpen && connectedAgentCount > 0 && (
          <button
            type="button"
            className="live-pill active"
            onClick={onToggleSidebar}
            title="Show connected agents"
          >
            <span className="live-dot online" />
            <span>{connectedAgentCount} connected</span>
          </button>
        )}
      </div>

      <div className="topbar-center">
        {page === 'studio' ? (
          activeBreadcrumb && (
            <span className="topbar-breadcrumb">{activeBreadcrumb}</span>
          )
        ) : (
          <span className="topbar-page-title">Documentation</span>
        )}
      </div>

      <div className="topbar-right">
        {page === 'studio' && (
          <>
            <button
              type="button"
              className="icon-btn"
              onClick={onCopyPermalink}
              title="Copy link"
              aria-label="Copy link"
            >
              <Link2 size={18} />
            </button>

            <div className="dropdown-wrap" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setExportMenuOpen((v) => !v)}
                title="Export"
                aria-label="Export"
              >
                <Download size={18} />
              </button>
              {exportMenuOpen && (
                <div className="dropdown-menu">
                  <button
                    type="button"
                    className="dropdown-item"
                    onClick={() => {
                      setExportMenuOpen(false);
                      onExportPng();
                    }}
                  >
                    <Download size={15} /> Export PNG
                  </button>
                  <button
                    type="button"
                    className="dropdown-item"
                    onClick={() => {
                      setExportMenuOpen(false);
                      onExportSvg();
                    }}
                  >
                    <FileCode2 size={15} /> Export SVG
                  </button>
                  <button
                    type="button"
                    className="dropdown-item"
                    onClick={() => {
                      setExportMenuOpen(false);
                      onCopyPermalink();
                    }}
                  >
                    <Link2 size={15} /> Copy link
                  </button>
                  <button
                    type="button"
                    className="dropdown-item"
                    onClick={() => {
                      setExportMenuOpen(false);
                      onCopyCode();
                    }}
                  >
                    <Copy size={15} /> Copy code
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        <button
          type="button"
          className={`icon-btn ${page === 'docs' ? 'active' : ''}`}
          onClick={() => onChangePage(page === 'docs' ? 'studio' : 'docs')}
          title="Documentation"
          aria-label="Documentation"
        >
          <BookOpen size={18} />
        </button>

        <button
          type="button"
          className="icon-btn"
          onClick={onToggleAppearance}
          title={appearanceMode === 'dark' ? 'Light theme' : 'Dark theme'}
          aria-label={appearanceMode === 'dark' ? 'Light theme' : 'Dark theme'}
        >
          {appearanceMode === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        <a
          className="icon-btn"
          href={repoUrl || DEFAULT_GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          title="GitHub"
          aria-label="GitHub"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 .5C5.648.5.5 5.648.5 12c0 5.088 3.292 9.395 7.868 10.915.575.107.785-.25.785-.555 0-.273-.01-1-.015-1.962-3.2.695-3.875-1.542-3.875-1.542-.523-1.33-1.278-1.684-1.278-1.684-1.044-.714.08-.7.08-.7 1.155.082 1.763 1.186 1.763 1.186 1.026 1.758 2.692 1.25 3.348.956.104-.743.402-1.25.73-1.538-2.554-.29-5.238-1.277-5.238-5.683 0-1.255.448-2.28 1.184-3.084-.118-.29-.513-1.462.112-3.048 0 0 .966-.31 3.166 1.18a11.01 11.01 0 0 1 2.882-.388c.978.005 1.963.132 2.882.388 2.2-1.49 3.164-1.18 3.164-1.18.627 1.586.232 2.758.114 3.048.738.804 1.182 1.83 1.182 3.084 0 4.418-2.688 5.39-5.25 5.674.412.356.78 1.058.78 2.132 0 1.54-.014 2.782-.014 3.16 0 .308.208.668.792.554C20.212 21.39 23.5 17.085 23.5 12 23.5 5.648 18.352.5 12 .5Z" />
          </svg>
        </a>
      </div>
    </header>
  );
}
