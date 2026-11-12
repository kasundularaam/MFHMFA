import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  CornerDownRight,
  FileCode,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  Layers,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import type { AgentSessionInfo } from '../../src/shared/types';
import { parentDirOfPath } from '../../src/shared/vfsPath';
import {
  buildExplorerSubtree,
  type ExplorerFileTreeNode,
  type ExplorerFolderNode,
  type VfsProjectRoot,
} from '../services/workspaceStorage';

interface ExplorerSidebarProps {
  width: number;
  projects: VfsProjectRoot[];
  activeFileId: string | null;
  activeProjectKey: string | null;
  workspaceId: string;
  connectedAgents: AgentSessionInfo[];
  liveProjectCounts: Map<string, number>;
  onResizeWidth: (width: number) => void;
  onToggleProjectExpanded: (projectKey: string) => void;
  onOpenFile: (fileId: string) => void;
  onCreateGraph: (projectKey?: string, parentDir?: string, name?: string) => void;
  onCreateFolder: (projectKey: string, parentDir: string, folderName: string) => void;
  onRenamePath: (projectKey: string, fromPath: string, toPath: string) => void;
  onDeleteGraph: (projectKey: string, fileId: string) => void;
  onDeleteFolder: (projectKey: string, folderPath: string) => void;
  onDeleteProject: (projectKey: string) => void;
  onNotifyToast: (msg: string) => void;
}

type InlinePromptState =
  | {
      kind: 'new-file' | 'new-folder';
      projectKey: string;
      parentDir: string;
    }
  | {
      kind: 'rename-file';
      projectKey: string;
      fileId: string;
      oldPath: string;
    }
  | {
      kind: 'rename-folder';
      projectKey: string;
      oldPath: string;
    };

type ActiveRowMenu =
  | {
      kind: 'project';
      key: string;
      projectKey: string;
      expanded: boolean;
      x: number;
      y: number;
    }
  | {
      kind: 'folder';
      key: string;
      projectKey: string;
      folderPath: string;
      folderName: string;
      x: number;
      y: number;
    }
  | {
      kind: 'file';
      key: string;
      projectKey: string;
      fileId: string;
      filePath: string;
      baseLabel: string;
      x: number;
      y: number;
    };

export function ExplorerSidebar({
  width,
  projects,
  activeFileId,
  activeProjectKey,
  workspaceId,
  connectedAgents,
  liveProjectCounts,
  onResizeWidth,
  onToggleProjectExpanded,
  onOpenFile,
  onCreateGraph,
  onCreateFolder,
  onRenamePath,
  onDeleteGraph,
  onDeleteFolder,
  onDeleteProject,
  onNotifyToast,
}: ExplorerSidebarProps) {
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(() => new Set());
  const [collapsedGraphs, setCollapsedGraphs] = useState<Set<string>>(() => new Set());
  const [agentsPaneOpen, setAgentsPaneOpen] = useState(true);
  const [inlinePrompt, setInlinePrompt] = useState<InlinePromptState | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [activeMenu, setActiveMenu] = useState<ActiveRowMenu | null>(null);
  const promptInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (inlinePrompt && promptInputRef.current) {
      promptInputRef.current.focus();
      promptInputRef.current.select();
    }
  }, [inlinePrompt]);

  useEffect(() => {
    if (!activeMenu) return undefined;
    const close = () => setActiveMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveMenu(null);
    };
    window.addEventListener('click', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [activeMenu]);

  const computeMenuCoords = (
    e: ReactMouseEvent<HTMLButtonElement>,
    estimatedHeight: number
  ): { x: number; y: number } => {
    const rect = e.currentTarget.getBoundingClientRect();
    const menuWidth = 176;
    const x = Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 12));
    const fitsBelow = rect.bottom + 6 + estimatedHeight <= window.innerHeight - 8;
    const y = fitsBelow
      ? rect.bottom + 4
      : Math.max(8, rect.top - estimatedHeight - 4);
    return { x, y };
  };

  const toggleFolder = (projectKey: string, folderPath: string) => {
    const key = `${projectKey}::${folderPath}`;
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleGraphChildren = (fileId: string) => {
    setCollapsedGraphs((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  };

  const startNewItem = (
    kind: 'new-file' | 'new-folder',
    projectKey: string,
    parentDir = ''
  ) => {
    if (parentDir) {
      const dirKey = `${projectKey}::${parentDir}`;
      setCollapsedDirs((prev) => {
        if (!prev.has(dirKey)) return prev;
        const next = new Set(prev);
        next.delete(dirKey);
        return next;
      });
    }
    setInlinePrompt({ kind, projectKey, parentDir });
    setDraftValue('');
  };

  const commitInlinePrompt = () => {
    const current = inlinePrompt;
    const val = draftValue.trim();
    setInlinePrompt(null);
    if (!current || !val) return;

    if (current.kind === 'new-file') {
      onCreateGraph(current.projectKey, current.parentDir, val);
      return;
    }
    if (current.kind === 'new-folder') {
      onCreateFolder(current.projectKey, current.parentDir, val);
      return;
    }
    if (current.kind === 'rename-file') {
      const parent = parentDirOfPath(current.oldPath);
      const nextRel = val.includes('/')
        ? val
        : parent
          ? `${parent}/${val}`
          : val;
      onRenamePath(current.projectKey, current.oldPath, nextRel);
      return;
    }
    if (current.kind === 'rename-folder') {
      const parent = parentDirOfPath(current.oldPath);
      const nextRel = val.includes('/')
        ? val
        : parent
          ? `${parent}/${val}`
          : val;
      onRenamePath(current.projectKey, current.oldPath, nextRel);
    }
  };

  const targetTopProjectKey =
    activeProjectKey || projects[0]?.projectKey || 'scratchpad';

  const pairedMcpUrl = `${window.location.origin}/mcp?workspace=${workspaceId}`;

  const renderInlineInput = (depth: number, placeholder: string) => (
    <div
      className="tree-inline-row"
      style={{ paddingLeft: `${14 + depth * 15}px` }}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={promptInputRef}
        className="tree-inline-input"
        value={draftValue}
        placeholder={placeholder}
        onChange={(e) => setDraftValue(e.target.value)}
        onBlur={commitInlinePrompt}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commitInlinePrompt();
          if (e.key === 'Escape') setInlinePrompt(null);
        }}
      />
    </div>
  );

  const renderFileTreeNode = (
    project: VfsProjectRoot,
    node: ExplorerFileTreeNode,
    depth: number,
    isChildGraph = false
  ) => {
    const { file, children } = node;
    const hasSubGraphs = children.length > 0;
    const isGraphCollapsed = collapsedGraphs.has(file.id);

    const isRenaming =
      inlinePrompt?.kind === 'rename-file' && inlinePrompt.fileId === file.id;

    const isActive = file.id === activeFileId;
    const baseLabel = (file.path.split('/').pop() || file.title).replace(
      /\.(mmd|mermaid)$/i,
      ''
    );
    const menuKey = `file::${file.id}`;
    const isMenuOpen = activeMenu?.key === menuKey;

    return (
      <div
        key={file.id}
        className={`tree-graph-branch ${hasSubGraphs ? 'has-subgraphs' : ''} ${
          isChildGraph ? 'is-subgraph' : ''
        }`}
      >
        {isRenaming ? (
          renderInlineInput(depth, 'filename.mmd')
        ) : (
          <div
            data-explorer-path={`${project.projectKey}/${file.path}`}
            data-explorer-role={
              hasSubGraphs ? 'parent' : isChildGraph ? 'child' : 'standalone'
            }
            className={`tree-row tree-file-row ${isActive ? 'active' : ''} ${
              isMenuOpen ? 'menu-open' : ''
            } ${hasSubGraphs ? 'parent-overview-row' : ''} ${
              isChildGraph ? 'child-subgraph-row' : ''
            }`}
            style={{
              paddingLeft: `${(hasSubGraphs ? 8 : 16) + depth * 15}px`,
            }}
            onClick={() => onOpenFile(file.id)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setInlinePrompt({
                kind: 'rename-file',
                projectKey: project.projectKey,
                fileId: file.id,
                oldPath: file.path,
              });
              setDraftValue(baseLabel);
            }}
            title={`${project.projectLabel}/${file.path}`}
          >
            {hasSubGraphs && (
              <button
                type="button"
                className="tree-subgraph-toggle"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleGraphChildren(file.id);
                }}
                aria-label={isGraphCollapsed ? 'Expand' : 'Collapse'}
              >
                {isGraphCollapsed ? (
                  <ChevronRight size={13} className="tree-chevron" />
                ) : (
                  <ChevronDown size={13} className="tree-chevron" />
                )}
              </button>
            )}

            {hasSubGraphs ? (
              <Layers size={15} className="tree-file-icon overview-icon" />
            ) : isChildGraph ? (
              <CornerDownRight size={14} className="tree-file-icon child-icon" />
            ) : (
              <FileCode size={15} className="tree-file-icon" />
            )}

            <span className="tree-item-label">{baseLabel}</span>
            {file.unread && <span className="tab-unread-dot" />}

            <div className="tree-row-actions" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className={`tree-action-btn tree-menu-trigger ${isMenuOpen ? 'open' : ''}`}
                aria-label="More actions"
                aria-expanded={isMenuOpen}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isMenuOpen) {
                    setActiveMenu(null);
                    return;
                  }
                  const coords = computeMenuCoords(e, 84);
                  setActiveMenu({
                    kind: 'file',
                    key: menuKey,
                    projectKey: project.projectKey,
                    fileId: file.id,
                    filePath: file.path,
                    baseLabel,
                    ...coords,
                  });
                }}
              >
                <MoreHorizontal size={16} />
              </button>
            </div>
          </div>
        )}

        {hasSubGraphs && !isGraphCollapsed && (
          <div className="tree-subgraph-children">
            {children.map((childNode) =>
              renderFileTreeNode(project, childNode, depth + 1, true)
            )}
          </div>
        )}
      </div>
    );
  };

  const renderFolderNode = (
    project: VfsProjectRoot,
    node: ExplorerFolderNode,
    depth: number
  ) => {
    const dirKey = `${project.projectKey}::${node.path}`;
    const isCollapsed = collapsedDirs.has(dirKey);
    const isRenaming =
      inlinePrompt?.kind === 'rename-folder' &&
      inlinePrompt.projectKey === project.projectKey &&
      inlinePrompt.oldPath === node.path;
    const menuKey = `folder::${dirKey}`;
    const isMenuOpen = activeMenu?.key === menuKey;

    return (
      <div key={node.path} className="tree-folder-group">
        {isRenaming ? (
          renderInlineInput(depth, 'folder-name')
        ) : (
          <div
            data-explorer-folder={`${project.projectKey}/${node.path}`}
            className={`tree-row tree-folder-row ${isMenuOpen ? 'menu-open' : ''}`}
            style={{ paddingLeft: `${10 + depth * 15}px` }}
            onClick={() => toggleFolder(project.projectKey, node.path)}
          >
            {isCollapsed ? (
              <ChevronRight size={14} className="tree-chevron" />
            ) : (
              <ChevronDown size={14} className="tree-chevron" />
            )}
            {isCollapsed ? (
              <Folder size={15} className="tree-folder-icon" />
            ) : (
              <FolderOpen size={15} className="tree-folder-icon" />
            )}
            <span className="tree-item-label">{node.name}</span>

            <div className="tree-row-actions" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className={`tree-action-btn tree-menu-trigger ${isMenuOpen ? 'open' : ''}`}
                aria-label="Folder actions"
                aria-expanded={isMenuOpen}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isMenuOpen) {
                    setActiveMenu(null);
                    return;
                  }
                  const coords = computeMenuCoords(e, 164);
                  setActiveMenu({
                    kind: 'folder',
                    key: menuKey,
                    projectKey: project.projectKey,
                    folderPath: node.path,
                    folderName: node.name,
                    ...coords,
                  });
                }}
              >
                <MoreHorizontal size={16} />
              </button>
            </div>
          </div>
        )}

        {!isCollapsed && (
          <div className="tree-folder-children">
            {inlinePrompt &&
              (inlinePrompt.kind === 'new-file' ||
                inlinePrompt.kind === 'new-folder') &&
              inlinePrompt.projectKey === project.projectKey &&
              inlinePrompt.parentDir === node.path &&
              renderInlineInput(
                depth + 1,
                inlinePrompt.kind === 'new-file'
                  ? 'filename.mmd'
                  : 'folder-name'
              )}

            {node.folders.map((sub) =>
              renderFolderNode(project, sub, depth + 1)
            )}
            {node.fileTree.map((fNode) =>
              renderFileTreeNode(project, fNode, depth + 1, false)
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="explorer-sidebar" style={{ width: `${width}px` }}>
      {/* Top Header: Explorer */}
      <div className="sidebar-section-header explorer-top-header">
        <span className="sidebar-section-title">EXPLORER</span>
        <div className="sidebar-header-actions">
          <button
            type="button"
            className="tree-action-btn visible"
            title="New file"
            aria-label="New file"
            onClick={() => startNewItem('new-file', targetTopProjectKey, '')}
          >
            <FilePlus2 size={15} />
          </button>
          <button
            type="button"
            className="tree-action-btn visible"
            title="New folder"
            aria-label="New folder"
            onClick={() => startNewItem('new-folder', targetTopProjectKey, '')}
          >
            <FolderPlus size={15} />
          </button>
        </div>
      </div>

      {/* Scrollable Project Tree */}
      <div
        className="explorer-tree"
        role="tree"
        aria-label="Diagram Explorer"
        onScroll={() => {
          if (activeMenu) setActiveMenu(null);
        }}
      >
        {projects.map((project) => {
          const liveCount = liveProjectCounts.get(project.projectKey) ?? 0;
          const treeRoot = buildExplorerSubtree(project, '');
          const menuKey = `project::${project.projectKey}`;
          const isMenuOpen = activeMenu?.key === menuKey;

          return (
            <div
              key={project.projectKey}
              className="explorer-project-section"
              data-project-key={project.projectKey}
            >
              <div
                className={`tree-row tree-project-row ${isMenuOpen ? 'menu-open' : ''}`}
                onClick={() => onToggleProjectExpanded(project.projectKey)}
              >
                {project.expanded ? (
                  <ChevronDown size={14} className="tree-chevron" />
                ) : (
                  <ChevronRight size={14} className="tree-chevron" />
                )}
                {liveCount > 0 && (
                  <span
                    className="live-dot online project-live-dot"
                    title="Agent connected"
                  />
                )}
                <span className="tree-project-label">{project.projectLabel}</span>

                <div
                  className="tree-row-actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className={`tree-action-btn tree-menu-trigger ${isMenuOpen ? 'open' : ''}`}
                    aria-label="Project actions"
                    aria-expanded={isMenuOpen}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isMenuOpen) {
                        setActiveMenu(null);
                        return;
                      }
                      const coords = computeMenuCoords(e, 130);
                      setActiveMenu({
                        kind: 'project',
                        key: menuKey,
                        projectKey: project.projectKey,
                        expanded: project.expanded,
                        ...coords,
                      });
                    }}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </div>
              </div>

              {project.expanded && (
                <div className="tree-project-children">
                  {inlinePrompt &&
                    (inlinePrompt.kind === 'new-file' ||
                      inlinePrompt.kind === 'new-folder') &&
                    inlinePrompt.projectKey === project.projectKey &&
                    inlinePrompt.parentDir === '' &&
                    renderInlineInput(
                      1,
                      inlinePrompt.kind === 'new-file'
                        ? 'filename.mmd'
                        : 'folder-name'
                    )}

                  {treeRoot.folders.map((folder) =>
                    renderFolderNode(project, folder, 1)
                  )}
                  {treeRoot.fileTree.map((fNode) =>
                    renderFileTreeNode(project, fNode, 1, false)
                  )}

                  {treeRoot.folders.length === 0 &&
                    treeRoot.fileTree.length === 0 &&
                    !(
                      inlinePrompt &&
                      (inlinePrompt.kind === 'new-file' ||
                        inlinePrompt.kind === 'new-folder') &&
                      inlinePrompt.projectKey === project.projectKey &&
                      inlinePrompt.parentDir === ''
                    ) && <div className="tree-empty-hint">No files yet</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Floating 3-Dot Action Menu */}
      {activeMenu && (
        <div
          className="dropdown-menu explorer-context-menu"
          role="menu"
          style={{
            position: 'fixed',
            top: `${activeMenu.y}px`,
            left: `${activeMenu.x}px`,
            right: 'auto',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {activeMenu.kind === 'project' && (
            <>
              <button
                type="button"
                role="menuitem"
                className="dropdown-item"
                onClick={() => {
                  const { projectKey, expanded } = activeMenu;
                  setActiveMenu(null);
                  if (!expanded) onToggleProjectExpanded(projectKey);
                  startNewItem('new-file', projectKey, '');
                }}
              >
                <FilePlus2 size={15} />
                <span>New file</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="dropdown-item"
                onClick={() => {
                  const { projectKey, expanded } = activeMenu;
                  setActiveMenu(null);
                  if (!expanded) onToggleProjectExpanded(projectKey);
                  startNewItem('new-folder', projectKey, '');
                }}
              >
                <FolderPlus size={15} />
                <span>New folder</span>
              </button>
              <div className="dropdown-divider" />
              <button
                type="button"
                role="menuitem"
                className="dropdown-item danger"
                onClick={() => {
                  const { projectKey } = activeMenu;
                  setActiveMenu(null);
                  onDeleteProject(projectKey);
                }}
              >
                <Trash2 size={15} />
                <span>Delete project</span>
              </button>
            </>
          )}

          {activeMenu.kind === 'folder' && (
            <>
              <button
                type="button"
                role="menuitem"
                className="dropdown-item"
                onClick={() => {
                  const { projectKey, folderPath } = activeMenu;
                  setActiveMenu(null);
                  startNewItem('new-file', projectKey, folderPath);
                }}
              >
                <FilePlus2 size={15} />
                <span>New file</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="dropdown-item"
                onClick={() => {
                  const { projectKey, folderPath } = activeMenu;
                  setActiveMenu(null);
                  startNewItem('new-folder', projectKey, folderPath);
                }}
              >
                <FolderPlus size={15} />
                <span>New folder</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="dropdown-item"
                onClick={() => {
                  const { projectKey, folderPath, folderName } = activeMenu;
                  setActiveMenu(null);
                  setInlinePrompt({
                    kind: 'rename-folder',
                    projectKey,
                    oldPath: folderPath,
                  });
                  setDraftValue(folderName);
                }}
              >
                <Pencil size={15} />
                <span>Rename</span>
              </button>
              <div className="dropdown-divider" />
              <button
                type="button"
                role="menuitem"
                className="dropdown-item danger"
                onClick={() => {
                  const { projectKey, folderPath } = activeMenu;
                  setActiveMenu(null);
                  onDeleteFolder(projectKey, folderPath);
                }}
              >
                <Trash2 size={15} />
                <span>Delete folder</span>
              </button>
            </>
          )}

          {activeMenu.kind === 'file' && (
            <>
              <button
                type="button"
                role="menuitem"
                className="dropdown-item"
                onClick={() => {
                  const { projectKey, fileId, filePath, baseLabel } = activeMenu;
                  setActiveMenu(null);
                  setInlinePrompt({
                    kind: 'rename-file',
                    projectKey,
                    fileId,
                    oldPath: filePath,
                  });
                  setDraftValue(baseLabel);
                }}
              >
                <Pencil size={15} />
                <span>Rename</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="dropdown-item danger"
                onClick={() => {
                  const { projectKey, fileId } = activeMenu;
                  setActiveMenu(null);
                  onDeleteGraph(projectKey, fileId);
                }}
              >
                <Trash2 size={15} />
                <span>Delete</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* Bottom Pane: Connected Agents */}
      <div className="sidebar-agents-pane">
        <div
          className="sidebar-section-header clickable"
          onClick={() => setAgentsPaneOpen((v) => !v)}
        >
          <div className="sidebar-section-left">
            {agentsPaneOpen ? (
              <ChevronDown size={14} className="tree-chevron" />
            ) : (
              <ChevronRight size={14} className="tree-chevron" />
            )}
            <span className="sidebar-section-title">CONNECTED AGENTS</span>
            <span
              className={`agents-count-pill ${
                connectedAgents.length > 0 ? 'online' : ''
              }`}
            >
              {connectedAgents.length}
            </span>
          </div>
        </div>

        {agentsPaneOpen && (
          <div className="sidebar-agents-body">
            {connectedAgents.length === 0 ? (
              <button
                type="button"
                className="sidebar-copy-mcp-btn"
                onClick={() => {
                  navigator.clipboard.writeText(pairedMcpUrl);
                  onNotifyToast('MCP URL copied');
                }}
                title="Copy MCP URL"
              >
                <Copy size={14} />
                <span>Copy MCP URL</span>
              </button>
            ) : (
              <ul className="sidebar-agent-list">
                {connectedAgents.map((ag) => (
                  <li key={ag.sessionId} className="sidebar-agent-item">
                    <span className="live-dot online" />
                    <span className="sidebar-agent-name">{ag.agentLabel}</span>
                    <span className="sidebar-agent-proj">
                      {ag.project || 'General'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Right Resize Sash */}
      <div
        className="sidebar-resizer"
        onMouseDown={(e) => {
          e.preventDefault();
          const startX = e.clientX;
          const origWidth = width;
          const onMove = (ev: MouseEvent) => {
            onResizeWidth(origWidth + (ev.clientX - startX));
          };
          const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
          };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        }}
      />
    </aside>
  );
}
