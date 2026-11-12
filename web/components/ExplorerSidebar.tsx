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
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentSessionInfo } from '../../src/shared/types';
import {
  buildExplorerSubtree,
  type ExplorerFileTreeNode,
  type ExplorerFolderNode,
  type VfsProjectRoot,
} from '../../src/shared/vfs';
import { graphTitleFromPath, parentDirOfPath } from '../../src/shared/vfsPath';
import { useDragResize } from '../hooks/useDragResize';
import { ActionMenu, DropdownItem, DropdownSeparator } from './DropdownMenu';

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
      kind: 'new-file';
      projectKey: string;
      parentDir: string;
    }
  | {
      kind: 'new-folder';
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
  const [agentsPaneOpen, setAgentsPaneOpen] = useState(false);
  const [inlinePrompt, setInlinePrompt] = useState<InlinePromptState | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);

  const promptInputRef = useRef<HTMLInputElement | null>(null);
  const dragOriginWidthRef = useRef(width);

  useEffect(() => {
    if (inlinePrompt && promptInputRef.current) {
      promptInputRef.current.focus();
      promptInputRef.current.select();
    }
  }, [inlinePrompt]);

  const startResizeDrag = useDragResize((dx) => {
    onResizeWidth(dragOriginWidthRef.current + dx);
  });

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
    const parent = parentDirOfPath(current.oldPath);
    const nextRel = val.includes('/') ? val : parent ? `${parent}/${val}` : val;
    onRenamePath(current.projectKey, current.oldPath, nextRel);
  };

  const targetTopProjectKey = activeProjectKey || projects[0]?.projectKey || 'scratchpad';

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

  return (
    <aside className="explorer-sidebar" style={{ width: `${width}px` }}>
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

      <div className="explorer-tree" role="tree" aria-label="Diagram Explorer">
        {projects.map((project) => (
          <ExplorerProjectSection
            key={project.projectKey}
            project={project}
            liveCount={liveProjectCounts.get(project.projectKey) ?? 0}
            activeFileId={activeFileId}
            collapsedDirs={collapsedDirs}
            collapsedGraphs={collapsedGraphs}
            inlinePrompt={inlinePrompt}
            openMenuKey={openMenuKey}
            setOpenMenuKey={setOpenMenuKey}
            onToggleProjectExpanded={onToggleProjectExpanded}
            onToggleFolder={toggleFolder}
            onToggleGraphChildren={toggleGraphChildren}
            onOpenFile={onOpenFile}
            onStartNewItem={startNewItem}
            onStartRenameFile={(projectKey, fileId, oldPath, baseLabel) => {
              setInlinePrompt({ kind: 'rename-file', projectKey, fileId, oldPath });
              setDraftValue(baseLabel);
            }}
            onStartRenameFolder={(projectKey, oldPath, folderName) => {
              setInlinePrompt({ kind: 'rename-folder', projectKey, oldPath });
              setDraftValue(folderName);
            }}
            onDeleteGraph={onDeleteGraph}
            onDeleteFolder={onDeleteFolder}
            onDeleteProject={onDeleteProject}
            renderInlineInput={renderInlineInput}
          />
        ))}
      </div>

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
            <span className={`agents-count-pill ${connectedAgents.length > 0 ? 'online' : ''}`}>
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
                    <span className="sidebar-agent-proj">{ag.project || 'General'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div
        className="sidebar-resizer"
        onMouseDown={(e) => {
          dragOriginWidthRef.current = width;
          startResizeDrag(e);
        }}
      />
    </aside>
  );
}

interface ExplorerProjectSectionProps {
  project: VfsProjectRoot;
  liveCount: number;
  activeFileId: string | null;
  collapsedDirs: Set<string>;
  collapsedGraphs: Set<string>;
  inlinePrompt: InlinePromptState | null;
  openMenuKey: string | null;
  setOpenMenuKey: (key: string | null) => void;
  onToggleProjectExpanded: (projectKey: string) => void;
  onToggleFolder: (projectKey: string, folderPath: string) => void;
  onToggleGraphChildren: (fileId: string) => void;
  onOpenFile: (fileId: string) => void;
  onStartNewItem: (
    kind: 'new-file' | 'new-folder',
    projectKey: string,
    parentDir: string
  ) => void;
  onStartRenameFile: (
    projectKey: string,
    fileId: string,
    oldPath: string,
    baseLabel: string
  ) => void;
  onStartRenameFolder: (projectKey: string, oldPath: string, folderName: string) => void;
  onDeleteGraph: (projectKey: string, fileId: string) => void;
  onDeleteFolder: (projectKey: string, folderPath: string) => void;
  onDeleteProject: (projectKey: string) => void;
  renderInlineInput: (depth: number, placeholder: string) => React.ReactNode;
}

const ExplorerProjectSection = memo(function ExplorerProjectSection({
  project,
  liveCount,
  activeFileId,
  collapsedDirs,
  collapsedGraphs,
  inlinePrompt,
  openMenuKey,
  setOpenMenuKey,
  onToggleProjectExpanded,
  onToggleFolder,
  onToggleGraphChildren,
  onOpenFile,
  onStartNewItem,
  onStartRenameFile,
  onStartRenameFolder,
  onDeleteGraph,
  onDeleteFolder,
  onDeleteProject,
  renderInlineInput,
}: ExplorerProjectSectionProps) {
  const treeRoot = useMemo(() => buildExplorerSubtree(project, ''), [project]);

  const projectMenuKey = `project::${project.projectKey}`;
  const isProjectMenuOpen = openMenuKey === projectMenuKey;

  const renderFileTreeNode = (
    node: ExplorerFileTreeNode,
    depth: number,
    isChildGraph = false
  ): React.ReactNode => {
    const { file, children } = node;
    const hasSubGraphs = children.length > 0;
    const isGraphCollapsed = collapsedGraphs.has(file.id);
    const isRenaming = inlinePrompt?.kind === 'rename-file' && inlinePrompt.fileId === file.id;
    const isActive = file.id === activeFileId;
    const baseLabel = graphTitleFromPath(file.path);
    const menuKey = `file::${file.id}`;
    const isMenuOpen = openMenuKey === menuKey;

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
            data-explorer-role={hasSubGraphs ? 'parent' : isChildGraph ? 'child' : 'standalone'}
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
              onStartRenameFile(project.projectKey, file.id, file.path, baseLabel);
            }}
            title={`${project.projectLabel}/${file.path}`}
          >
            {hasSubGraphs && (
              <button
                type="button"
                className="tree-subgraph-toggle"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleGraphChildren(file.id);
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
              <ActionMenu
                align="start"
                contentClassName="explorer-context-menu"
                onOpenChange={(open) => setOpenMenuKey(open ? menuKey : null)}
                trigger={
                  <button
                    type="button"
                    className={`tree-action-btn tree-menu-trigger ${isMenuOpen ? 'open' : ''}`}
                    aria-label="More actions"
                  >
                    <MoreHorizontal size={16} />
                  </button>
                }
              >
                <DropdownItem
                  onSelect={() =>
                    onStartRenameFile(project.projectKey, file.id, file.path, baseLabel)
                  }
                >
                  <Pencil size={15} />
                  <span>Rename</span>
                </DropdownItem>
                <DropdownItem
                  danger
                  onSelect={() => onDeleteGraph(project.projectKey, file.id)}
                >
                  <Trash2 size={15} />
                  <span>Delete</span>
                </DropdownItem>
              </ActionMenu>
            </div>
          </div>
        )}

        {hasSubGraphs && !isGraphCollapsed && (
          <div className="tree-subgraph-children">
            {children.map((childNode) => renderFileTreeNode(childNode, depth + 1, true))}
          </div>
        )}
      </div>
    );
  };

  const renderFolderNode = (node: ExplorerFolderNode, depth: number): React.ReactNode => {
    const dirKey = `${project.projectKey}::${node.path}`;
    const isCollapsed = collapsedDirs.has(dirKey);
    const isRenaming =
      inlinePrompt?.kind === 'rename-folder' &&
      inlinePrompt.projectKey === project.projectKey &&
      inlinePrompt.oldPath === node.path;
    const menuKey = `folder::${dirKey}`;
    const isMenuOpen = openMenuKey === menuKey;

    return (
      <div key={node.path} className="tree-folder-group">
        {isRenaming ? (
          renderInlineInput(depth, 'folder-name')
        ) : (
          <div
            data-explorer-folder={`${project.projectKey}/${node.path}`}
            className={`tree-row tree-folder-row ${isMenuOpen ? 'menu-open' : ''}`}
            style={{ paddingLeft: `${10 + depth * 15}px` }}
            onClick={() => onToggleFolder(project.projectKey, node.path)}
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
              <ActionMenu
                align="start"
                contentClassName="explorer-context-menu"
                onOpenChange={(open) => setOpenMenuKey(open ? menuKey : null)}
                trigger={
                  <button
                    type="button"
                    className={`tree-action-btn tree-menu-trigger ${isMenuOpen ? 'open' : ''}`}
                    aria-label="Folder actions"
                  >
                    <MoreHorizontal size={16} />
                  </button>
                }
              >
                <DropdownItem
                  onSelect={() => onStartNewItem('new-file', project.projectKey, node.path)}
                >
                  <FilePlus2 size={15} />
                  <span>New file</span>
                </DropdownItem>
                <DropdownItem
                  onSelect={() => onStartNewItem('new-folder', project.projectKey, node.path)}
                >
                  <FolderPlus size={15} />
                  <span>New folder</span>
                </DropdownItem>
                <DropdownItem
                  onSelect={() => onStartRenameFolder(project.projectKey, node.path, node.name)}
                >
                  <Pencil size={15} />
                  <span>Rename</span>
                </DropdownItem>
                <DropdownSeparator />
                <DropdownItem
                  danger
                  onSelect={() => onDeleteFolder(project.projectKey, node.path)}
                >
                  <Trash2 size={15} />
                  <span>Delete folder</span>
                </DropdownItem>
              </ActionMenu>
            </div>
          </div>
        )}

        {!isCollapsed && (
          <div className="tree-folder-children">
            {inlinePrompt &&
              (inlinePrompt.kind === 'new-file' || inlinePrompt.kind === 'new-folder') &&
              inlinePrompt.projectKey === project.projectKey &&
              inlinePrompt.parentDir === node.path &&
              renderInlineInput(
                depth + 1,
                inlinePrompt.kind === 'new-file' ? 'filename.mmd' : 'folder-name'
              )}

            {node.folders.map((sub) => renderFolderNode(sub, depth + 1))}
            {node.fileTree.map((fNode) => renderFileTreeNode(fNode, depth + 1, false))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="explorer-project-section" data-project-key={project.projectKey}>
      <div
        className={`tree-row tree-project-row ${isProjectMenuOpen ? 'menu-open' : ''}`}
        onClick={() => onToggleProjectExpanded(project.projectKey)}
      >
        {project.expanded ? (
          <ChevronDown size={14} className="tree-chevron" />
        ) : (
          <ChevronRight size={14} className="tree-chevron" />
        )}
        {liveCount > 0 && (
          <span className="live-dot online project-live-dot" title="Agent connected" />
        )}
        <span className="tree-project-label">{project.projectLabel}</span>

        <div className="tree-row-actions" onClick={(e) => e.stopPropagation()}>
          <ActionMenu
            align="start"
            contentClassName="explorer-context-menu"
            onOpenChange={(open) => setOpenMenuKey(open ? projectMenuKey : null)}
            trigger={
              <button
                type="button"
                className={`tree-action-btn tree-menu-trigger ${
                  isProjectMenuOpen ? 'open' : ''
                }`}
                aria-label="Project actions"
              >
                <MoreHorizontal size={16} />
              </button>
            }
          >
            <DropdownItem
              onSelect={() => {
                if (!project.expanded) onToggleProjectExpanded(project.projectKey);
                onStartNewItem('new-file', project.projectKey, '');
              }}
            >
              <FilePlus2 size={15} />
              <span>New file</span>
            </DropdownItem>
            <DropdownItem
              onSelect={() => {
                if (!project.expanded) onToggleProjectExpanded(project.projectKey);
                onStartNewItem('new-folder', project.projectKey, '');
              }}
            >
              <FolderPlus size={15} />
              <span>New folder</span>
            </DropdownItem>
            <DropdownSeparator />
            <DropdownItem danger onSelect={() => onDeleteProject(project.projectKey)}>
              <Trash2 size={15} />
              <span>Delete project</span>
            </DropdownItem>
          </ActionMenu>
        </div>
      </div>

      {project.expanded && (
        <div className="tree-project-children">
          {inlinePrompt &&
            (inlinePrompt.kind === 'new-file' || inlinePrompt.kind === 'new-folder') &&
            inlinePrompt.projectKey === project.projectKey &&
            inlinePrompt.parentDir === '' &&
            renderInlineInput(
              1,
              inlinePrompt.kind === 'new-file' ? 'filename.mmd' : 'folder-name'
            )}

          {treeRoot.folders.map((folder) => renderFolderNode(folder, 1))}
          {treeRoot.fileTree.map((fNode) => renderFileTreeNode(fNode, 1, false))}

          {treeRoot.folders.length === 0 &&
            treeRoot.fileTree.length === 0 &&
            !(
              inlinePrompt &&
              (inlinePrompt.kind === 'new-file' || inlinePrompt.kind === 'new-folder') &&
              inlinePrompt.projectKey === project.projectKey &&
              inlinePrompt.parentDir === ''
            ) && <div className="tree-empty-hint">No files yet</div>}
        </div>
      )}
    </div>
  );
});
