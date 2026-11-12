import { useEffect, useRef, useState } from 'react';
import { Code2, Eye, History, Plus, RotateCcw, X } from 'lucide-react';
import type { OpenTabEntry, StageMode } from '../hooks/useStudioController';
import {
  getHeadVersion,
  type GraphVersionRecord,
  type VfsGraphFile,
} from '../services/workspaceStorage';

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
}: TabBarProps) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (!historyOpen) return undefined;
    const close = () => setHistoryOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [historyOpen]);

  useEffect(() => {
    if (!activeFile) return;
    const activeEl = stripRef.current?.querySelector(
      `[data-tab-id="${CSS.escape(activeFile.id)}"]`
    ) as HTMLElement | null;
    activeEl?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeFile]);

  // Disambiguate tabs that share the same filename in different folders/projects (just like VS Code)
  const labelCounts = new Map<string, number>();
  for (const entry of openTabs) {
    const base = (entry.file.path.split('/').pop() || entry.file.title).replace(
      /\.(mmd|mermaid)$/i,
      ''
    );
    labelCounts.set(base, (labelCounts.get(base) ?? 0) + 1);
  }

  return (
    <div className="tabbar" role="tablist" aria-label="Open editor tabs">
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
          const head = getHeadVersion(file);
          const baseName = (file.path.split('/').pop() || file.title).replace(
            /\.(mmd|mermaid)$/i,
            ''
          );
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
              title={`${project.projectLabel}/${file.path} · v${file.currentVersion} (${head.authorLabel})`}
            >
              {file.unread && (
                <span className="tab-unread-dot" aria-label="New update" />
              )}

              <span className="tab-label">{baseName}</span>
              {disambiguator && (
                <span className="tab-subpath">{disambiguator}</span>
              )}

              <button
                type="button"
                className="tab-close-btn"
                aria-label={`Close ${baseName} tab`}
                title="Close tab (keeps file in Explorer)"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(file.id);
                }}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}

        <button
          type="button"
          className="tab-add-btn"
          onClick={onNewTab}
          title="New graph"
          aria-label="New graph"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Right Edge Actions: Version Pill + Single-Icon View Switcher */}
      <div className="tabbar-right-actions">
        {activeFile && activeVersionRecord && (
          <div className="dropdown-wrap" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={`version-pill ${isHistoricalVersion ? 'historical' : ''}`}
              onClick={() => setHistoryOpen((v) => !v)}
              title="Immutable revision history (last 5 versions)"
            >
              <History size={11} />
              <span>
                v{activeVersionRecord.version} · {activeVersionRecord.authorBadge}
              </span>
            </button>

            {historyOpen && (
              <div className="dropdown-menu version-menu">
                <div className="version-menu-header">
                  Last {activeFile.versions.length} Revisions (Max 5)
                </div>
                {[...activeFile.versions].reverse().map((rev) => {
                  const isHead = rev.version === activeFile.currentVersion;
                  const isSelected = rev.version === activeVersionRecord.version;
                  return (
                    <div
                      key={rev.version}
                      className={`version-menu-item ${isSelected ? 'selected' : ''}`}
                    >
                      <button
                        type="button"
                        className="version-select-btn"
                        onClick={() => {
                          onSelectVersion(isHead ? null : rev.version);
                          setHistoryOpen(false);
                        }}
                      >
                        <span className="version-num">v{rev.version}</span>
                        <span
                          className={`tree-author-badge author-${rev.authorBadge}`}
                        >
                          {rev.authorBadge}
                        </span>
                        {isHead && <span className="version-head-tag">head</span>}
                      </button>

                      {!isHead && (
                        <button
                          type="button"
                          className="version-restore-btn"
                          title={`Restore v${rev.version} as new head`}
                          onClick={() => {
                            onRestoreVersion(rev.version);
                            setHistoryOpen(false);
                          }}
                        >
                          <RotateCcw size={11} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          className="icon-btn tabbar-view-toggle"
          disabled={!activeFile}
          onClick={onToggleStageMode}
          aria-label={
            stageMode === 'preview' ? 'Switch to Code view' : 'Switch to Preview'
          }
          title={
            stageMode === 'preview'
              ? 'Switch to Code view (Ctrl+E)'
              : 'Switch to Preview (Ctrl+E)'
          }
        >
          {stageMode === 'preview' ? <Code2 size={15} /> : <Eye size={15} />}
          {stageMode === 'preview' && hasError && (
            <span className="tabbar-error-dot" />
          )}
        </button>
      </div>
    </div>
  );
}
