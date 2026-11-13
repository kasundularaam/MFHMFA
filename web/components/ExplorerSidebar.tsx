import {
  ChevronDown,
  ChevronRight,
  Copy,
  FileCode,
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
  getHeadVersion,
  resolveProjectGraphHierarchy,
  type VfsGraphFile,
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
  onCreateFolder: (projectKey: string, parentDir: string, folderName: string) => void;
  onRenameFolder: (projectKey: string, fromPath: string, toPath: string) => void;
  onDeleteGraph: (projectKey: string, fileId: string) => void;
  onDeleteFolder: (projectKey: string, folderPath: string) => void;
  onDeleteProject: (projectKey: string) => void;
  onNotifyToast: (msg: string) => void;
}

type InlinePromptState =
  | {
      kind: 'new-folder';
      projectKey: string;
      parentDir: string;
    }
  | {
      kind: 'rename-folder';
      projectKey: string;
      oldPath: string;
    };

interface SidebarRootGraphItem {
  file: VfsGraphFile;
  hasSubGraphs: boolean;
  hasUnreadInTree: boolean;
}

interface SidebarFolderNode {
  name: string;
  path: string;
  folders: SidebarFolderNode[];
  graphs: SidebarRootGraphItem[];
}

function buildRootGraphSidebarTree(project: VfsProjectRoot): {
  tree: SidebarFolderNode;
  activeRootResolver: (fileId: string | null) => string | null;
} {
  const hierarchy = resolveProjectGraphHierarchy(project);

  const root: SidebarFolderNode = {
    name: project.projectLabel,
    path: '',
    folders: [],
    graphs: [],
  };

  const folderMap = new Map<string, SidebarFolderNode>();
  folderMap.set('', root);

  const ensureFolderChain = (relDir: string): SidebarFolderNode => {
    if (!relDir) return root;
    const cached = folderMap.get(relDir);
    if (cached) return cached;

    const parts = relDir.split('/').filter(Boolean);
    let currentPath = '';
    let parentNode = root;

    for (const seg of parts) {
      currentPath = currentPath ? `${currentPath}/${seg}` : seg;
      let node = folderMap.get(currentPath);
      if (!node) {
        node = {
          name: seg,
          path: currentPath,
          folders: [],
          graphs: [],
        };
        folderMap.set(currentPath, node);
        parentNode.folders.push(node);
      }
      parentNode = node;
    }
    return parentNode;
  };

  for (const dir of project.folders) {
    ensureFolderChain(dir);
  }

  const hasUnreadDescendant = (fileId: string, seen = new Set<string>()): boolean => {
    if (seen.has(fileId)) return false;
    seen.add(fileId);
    for (const child of hierarchy.childrenByFileId.get(fileId) ?? []) {
      if (child.unread || hasUnreadDescendant(child.id, seen)) {
        return true;
      }
    }
    return false;
  };

  for (const file of project.files) {
    // Sub-graphs are strictly hidden from the Explorer sidebar
    const isLinkedChild = hierarchy.parentByFileId.has(file.id);
    const hasPendingParent = Boolean(getHeadVersion(file).guide?.parentPath);
    if (isLinkedChild || hasPendingParent) {
      continue;
    }

    const parentDir = parentDirOfPath(file.path);
    const folderNode = ensureFolderChain(parentDir);
    const childCount = hierarchy.childrenByFileId.get(file.id)?.length ?? 0;

    folderNode.graphs.push({
      file,
      hasSubGraphs: childCount > 0,
      hasUnreadInTree: file.unread || hasUnreadDescendant(file.id),
    });
  }

  const sortRecursive = (node: SidebarFolderNode) => {
    node.folders.sort((a, b) => a.name.localeCompare(b.name));
    node.graphs.sort((a, b) => {
      if (a.hasSubGraphs !== b.hasSubGraphs) return a.hasSubGraphs ? -1 : 1;
      const aLabel = a.file.title || graphTitleFromPath(a.file.path);
      const bLabel = b.file.title || graphTitleFromPath(b.file.path);
      return aLabel.localeCompare(bLabel);
    });
    for (const sub of node.folders) {
      sortRecursive(sub);
    }
  };

  sortRecursive(root);

  return {
    tree: root,
    activeRootResolver: (fileId: string | null) => {
      if (!fileId) return null;
      const rootFile = hierarchy.getRootForFile(fileId);
      return rootFile?.id ?? null;
    },
  };
}

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
  onCreateFolder,
  onRenameFolder,
  onDeleteGraph,
  onDeleteFolder,
  onDeleteProject,
  onNotifyToast,
}: ExplorerSidebarProps) {
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(() => new Set());
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

  const startNewFolder = (projectKey: string, parentDir = '') => {
    if (parentDir) {
      const dirKey = `${projectKey}::${parentDir}`;
      setCollapsedDirs((prev) => {
        if (!prev.has(dirKey)) return prev;
        const next = new Set(prev);
        next.delete(dirKey);
        return next;
      });
    }
    setInlinePrompt({ kind: 'new-folder', projectKey, parentDir });
    setDraftValue('');
  };

  const commitInlinePrompt = () => {
    const current = inlinePrompt;
    const val = draftValue.trim();
    setInlinePrompt(null);
    if (!current || !val) return;

    if (current.kind === 'new-folder') {
      onCreateFolder(current.projectKey, current.parentDir, val);
      return;
    }
    const parent = parentDirOfPath(current.oldPath);
    const nextRel = val.includes('/') ? val : parent ? `${parent}/${val}` : val;
    onRenameFolder(current.projectKey, current.oldPath, nextRel);
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
            title="New folder"
            aria-label="New folder"
            onClick={() => startNewFolder(targetTopProjectKey, '')}
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
            inlinePrompt={inlinePrompt}
            openMenuKey={openMenuKey}
            setOpenMenuKey={setOpenMenuKey}
            onToggleProjectExpanded={onToggleProjectExpanded}
            onToggleFolder={toggleFolder}
            onOpenFile={onOpenFile}
            onStartNewFolder={startNewFolder}
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
            {connectedAgents.length > 0 && (
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
  inlinePrompt: InlinePromptState | null;
  openMenuKey: string | null;
  setOpenMenuKey: (key: string | null) => void;
  onToggleProjectExpanded: (projectKey: string) => void;
  onToggleFolder: (projectKey: string, folderPath: string) => void;
  onOpenFile: (fileId: string) => void;
  onStartNewFolder: (projectKey: string, parentDir: string) => void;
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
  inlinePrompt,
  openMenuKey,
  setOpenMenuKey,
  onToggleProjectExpanded,
  onToggleFolder,
  onOpenFile,
  onStartNewFolder,
  onStartRenameFolder,
  onDeleteGraph,
  onDeleteFolder,
  onDeleteProject,
  renderInlineInput,
}: ExplorerProjectSectionProps) {
  const { tree: treeRoot, activeRootResolver } = useMemo(
    () => buildRootGraphSidebarTree(project),
    [project]
  );

  const activeRootFileId = useMemo(
    () => activeRootResolver(activeFileId),
    [activeRootResolver, activeFileId]
  );

  const projectMenuKey = `project::${project.projectKey}`;
  const isProjectMenuOpen = openMenuKey === projectMenuKey;

  const renderGraphRow = (item: SidebarRootGraphItem, depth: number): React.ReactNode => {
    const { file, hasSubGraphs, hasUnreadInTree } = item;
    const isActive = activeRootFileId === file.id;
    const displayLabel = file.title?.trim() || graphTitleFromPath(file.path);
    const menuKey = `file::${file.id}`;
    const isMenuOpen = openMenuKey === menuKey;

    return (
      <div
        key={file.id}
        data-explorer-path={`${project.projectKey}/${file.path}`}
        data-explorer-role={hasSubGraphs ? 'parent' : 'standalone'}
        className={`tree-row tree-file-row ${isActive ? 'active' : ''} ${
          isMenuOpen ? 'menu-open' : ''
        } ${hasSubGraphs ? 'parent-overview-row' : ''}`}
        style={{
          paddingLeft: `${16 + depth * 15}px`,
        }}
        onClick={() => onOpenFile(file.id)}
        title={`${project.projectLabel}/${file.path}`}
      >
        {hasSubGraphs ? (
          <Layers size={15} className="tree-file-icon overview-icon" />
        ) : (
          <FileCode size={15} className="tree-file-icon" />
        )}

        <span className="tree-item-label">{displayLabel}</span>
        {hasUnreadInTree && <span className="tab-unread-dot" />}

        <div className="tree-row-actions" onClick={(e) => e.stopPropagation()}>
          <ActionMenu
            align="start"
            contentClassName="explorer-context-menu"
            onOpenChange={(open) => setOpenMenuKey(open ? menuKey : null)}
            trigger={
              <button
                type="button"
                className={`tree-action-btn tree-menu-trigger ${isMenuOpen ? 'open' : ''}`}
                aria-label="Graph actions"
              >
                <MoreHorizontal size={16} />
              </button>
            }
          >
            <DropdownItem danger onSelect={() => onDeleteGraph(project.projectKey, file.id)}>
              <Trash2 size={15} />
              <span>Delete graph</span>
            </DropdownItem>
          </ActionMenu>
        </div>
      </div>
    );
  };

  const renderFolderNode = (node: SidebarFolderNode, depth: number): React.ReactNode => {
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
            onDoubleClick={(e) => {
              e.stopPropagation();
              onStartRenameFolder(project.projectKey, node.path, node.name);
            }}
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
                <DropdownItem onSelect={() => onStartNewFolder(project.projectKey, node.path)}>
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
            {inlinePrompt?.kind === 'new-folder' &&
              inlinePrompt.projectKey === project.projectKey &&
              inlinePrompt.parentDir === node.path &&
              renderInlineInput(depth + 1, 'folder-name')}

            {node.folders.map((sub) => renderFolderNode(sub, depth + 1))}
            {node.graphs.map((gItem) => renderGraphRow(gItem, depth + 1))}
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
                onStartNewFolder(project.projectKey, '');
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
          {inlinePrompt?.kind === 'new-folder' &&
            inlinePrompt.projectKey === project.projectKey &&
            inlinePrompt.parentDir === '' &&
            renderInlineInput(1, 'folder-name')}

          {treeRoot.folders.map((folder) => renderFolderNode(folder, 1))}
          {treeRoot.graphs.map((gItem) => renderGraphRow(gItem, 1))}

          {treeRoot.folders.length === 0 &&
            treeRoot.graphs.length === 0 &&
            !(
              inlinePrompt?.kind === 'new-folder' &&
              inlinePrompt.projectKey === project.projectKey &&
              inlinePrompt.parentDir === ''
            ) && <div className="tree-empty-hint">Ask your AI agent to explain a topic</div>}
        </div>
      )}
    </div>
  );
});
