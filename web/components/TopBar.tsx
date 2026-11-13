import { BookOpen, Copy, Download, FileCode2, Moon, PanelLeft, Sun } from 'lucide-react';
import type { StudioPage } from '../store/uiStore';
import type { AppearanceMode } from '../theme/comfortTheme';
import { BrandLogo } from './BrandLogo';
import { ActionMenu, DropdownItem } from './DropdownMenu';

const DEFAULT_GITHUB_URL = 'https://github.com/kasundularaam/MFHMFA';

interface TopBarProps {
  isMobile?: boolean;
  page: StudioPage;
  onChangePage: (page: StudioPage) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  appearanceMode: AppearanceMode;
  onToggleAppearance: () => void;
  connectedAgentCount: number;
  activeBreadcrumb: string | null;
  onBrandClick: () => void;
  repoUrl?: string;
  onExportPng: () => void;
  onExportSvg: () => void;
  onCopyCode: () => void;
}

export function TopBar({
  isMobile = false,
  page,
  onChangePage,
  sidebarOpen,
  onToggleSidebar,
  appearanceMode,
  onToggleAppearance,
  connectedAgentCount,
  activeBreadcrumb,
  onBrandClick,
  repoUrl,
  onExportPng,
  onExportSvg,
  onCopyCode,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        {!isMobile && page === 'studio' && (
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
          className={`brand-lockup ${!isMobile && page === 'docs' ? 'clickable' : ''}`.trim()}
          onClick={isMobile ? undefined : onBrandClick}
          title={!isMobile && page === 'docs' ? 'Home' : 'MFHMFA'}
        >
          <BrandLogo height={isMobile ? 19 : 21} className="brand-logo" />
        </button>

        {!isMobile && page === 'studio' && !sidebarOpen && connectedAgentCount > 0 && (
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
        {!isMobile &&
          (page === 'studio' ? (
            activeBreadcrumb && <span className="topbar-breadcrumb">{activeBreadcrumb}</span>
          ) : (
            <span className="topbar-page-title">Documentation</span>
          ))}
      </div>

      <div className="topbar-right">
        {!isMobile && page === 'studio' && (
          <ActionMenu
            align="end"
            trigger={
              <button type="button" className="icon-btn" title="Export" aria-label="Export">
                <Download size={18} />
              </button>
            }
          >
            <DropdownItem onSelect={onExportPng}>
              <Download size={15} /> Export PNG
            </DropdownItem>
            <DropdownItem onSelect={onExportSvg}>
              <FileCode2 size={15} /> Export SVG
            </DropdownItem>
            <DropdownItem onSelect={onCopyCode}>
              <Copy size={15} /> Copy code
            </DropdownItem>
          </ActionMenu>
        )}

        {!isMobile && (
          <button
            type="button"
            className={`icon-btn ${page === 'docs' ? 'active' : ''}`}
            onClick={() => onChangePage(page === 'docs' ? 'studio' : 'docs')}
            title="Documentation"
            aria-label="Documentation"
          >
            <BookOpen size={18} />
          </button>
        )}

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
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.07 11.07 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.06.78 2.14 0 1.55-.01 2.79-.01 3.17 0 .31.21.68.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
          </svg>
        </a>
      </div>
    </header>
  );
}
