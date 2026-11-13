import * as RadixDropdown from '@radix-ui/react-dropdown-menu';
import { Code2, Eye, History, Maximize2, Plus, RotateCcw, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { GraphVersionRecord, VfsGraphFile } from '../../src/shared/vfs';
import { graphTitleFromPath } from '../../src/shared/vfsPath';
import type { StageMode } from '../store/uiStore';
import type { OpenTabEntry } from '../store/workspaceStore';
import { ActionMenu } from './DropdownMenu';

interface TabBarProps {
  openTabs: OpenTabEntry[];
  activeFile: VfsGraphFile | null;
  activeVersionRecord: GraphVersionRecord | null;
  isHistoricalVersion: boolean;
  stageMode: StageMode;
  hasError: boolean;
  onSelectTab: (fileId: string) => void;
  onCloseTab: (fileId: string) => void;
  onNewTab: () => void;
  onSelectVersion: (version: number | null) => void;
  onRestoreVersion: (version: number) => void;
  onToggleStageMode: () => void;
  onFitCanvas: () => void;
}

export function TabBar({
  openTabs,
  activeFile,
  activeVersionRecord,
  isHistoricalVersion,
  stageMode,
  hasError,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onSelectVersion,
  onRestoreVersion,
  onToggleStageMode,
  onFitCanvas,
}: TabBarProps) {
  const stripRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!activeFile) return;
    const activeEl = stripRef.current?.querySelector(
      `[data-tab-id="${CSS.escape(activeFile.id)}"]`
    ) as HTMLElement | null;
    activeEl?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeFile]);

  const labelCounts = new Map<string, number>();
  for (const entry of openTabs) {
    const base = graphTitleFromPath(entry.file.path);
    labelCounts.set(base, (labelCounts.get(base) ?? 0) + 1);
  }

  return (
    <div className="tabbar" role="tablist" aria-label="Open files">
      <div
        ref={stripRef}
        className="tabbar-strip"
        onWheel={(e) => {
          if (stripRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            stripRef.current.scrollLeft += e.deltaY;
          }
        }}
      >
        {openTabs.map(({ file, project }) => {
          const isActive = activeFile?.id === file.id;
          const baseName = graphTitleFromPath(file.path);
          const isDuplicate = (labelCounts.get(baseName) ?? 0) > 1;
          const disambiguator = isDuplicate
            ? file.path.includes('/')
              ? file.path.slice(0, file.path.lastIndexOf('/'))
              : project.projectLabel
            : null;

          return (
            <div
              key={file.id}
              data-tab-id={file.id}
              role="tab"
              aria-selected={isActive}
              tabIndex={0}
              className={`editor-tab ${isActive ? 'active' : ''} ${
                file.unread ? 'unread' : ''
              }`}
              onClick={() => onSelectTab(file.id)}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onCloseTab(file.id);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectTab(file.id);
                }
              }}
              title={`${project.projectLabel}/${file.path}`}
            >
              {file.unread && (
                <span className="tab-unread-dot" role="img" aria-label="Updated" />
              )}

              <span className="tab-label">{baseName}</span>
              {disambiguator && <span className="tab-subpath">{disambiguator}</span>}

              <button
                type="button"
                className="tab-close-btn"
                aria-label={`Close ${baseName}`}
                title="Close tab"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(file.id);
                }}
              >
                <X size={14} />
              </button>
            </div>
          );
        })}

        <button
          type="button"
          className="tab-add-btn"
          onClick={onNewTab}
          title="New file"
          aria-label="New file"
        >
          <Plus size={16} />
        </button>
      </div>

      <div className="tabbar-right-actions">
        {activeFile && activeVersionRecord && (
          <ActionMenu
            align="end"
            contentClassName="version-menu"
            trigger={
              <button
                type="button"
                className={`version-pill ${isHistoricalVersion ? 'historical' : ''}`}
                title="File history"
                aria-label="File history"
              >
                <History size={15} />
                <span>v{activeVersionRecord.version}</span>
              </button>
            }
          >
            <div className="version-menu-header">File history</div>
            {[...activeFile.versions].reverse().map((rev) => {
              const isHead = rev.version === activeFile.currentVersion;
              const isSelected = rev.version === activeVersionRecord.version;
              return (
                <div
                  key={rev.version}
                  className={`version-menu-item ${isSelected ? 'selected' : ''}`}
                >
                  <RadixDropdown.Item
                    asChild
                    onSelect={() => onSelectVersion(isHead ? null : rev.version)}
                  >
                    <button type="button" className="version-select-btn">
                      <span className="version-num">v{rev.version}</span>
                      <span className="version-author">{rev.authorBadge}</span>
                      <span className="version-time">{formatRelativeAge(rev.createdAt)}</span>
                    </button>
                  </RadixDropdown.Item>
                  {!isHead && (
                    <RadixDropdown.Item asChild onSelect={() => onRestoreVersion(rev.version)}>
                      <button
                        type="button"
                        className="version-restore-btn"
                        title={`Restore v${rev.version}`}
                      >
                        <RotateCcw size={13} />
                      </button>
                    </RadixDropdown.Item>
                  )}
                </div>
              );
            })}
          </ActionMenu>
        )}

        <button
          type="button"
          className={`icon-btn tabbar-view-toggle ${
            stageMode === 'code' ? 'active' : ''
          } ${hasError ? 'has-error' : ''}`}
          onClick={onToggleStageMode}
          disabled={!activeFile}
          title={
            stageMode === 'preview'
              ? 'Switch to Code view (Ctrl+E)'
              : 'Switch to Preview (Ctrl+E)'
          }
          aria-label={stageMode === 'preview' ? 'Switch to Code view' : 'Switch to Preview'}
        >
          {stageMode === 'preview' ? <Code2 size={17} /> : <Eye size={17} />}
          {hasError && <span className="tabbar-error-dot" />}
        </button>

        {stageMode === 'preview' && activeFile && (
          <button
            type="button"
            className="icon-btn tabbar-fit-btn"
            onClick={onFitCanvas}
            title="Fit to screen"
            aria-label="Fit to screen"
          >
            <Maximize2 size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

function formatRelativeAge(ts: number): string {
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 45) return 'now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}
