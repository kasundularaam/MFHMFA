import { useEffect, useRef, useState } from 'react';
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
  Pause,
  Pencil,
  Play,
  Trash2,
} from 'lucide-react';
import type { AgentSessionInfo } from '../../src/shared/types';
import { parentDirOfPath } from '../../src/shared/vfsPath';
import type { RelayConnectionState } from '../hooks/useStudioController';
import {
  buildExplorerSubtree,
  getHeadVersion,
  type ExplorerFileTreeNode,
  type ExplorerFolderNode,
  type StorageAllocationStats,
  type VfsProjectRoot,
} from '../services/workspaceStorage';

interface ExplorerSidebarProps {
  width: number;
  projects: VfsProjectRoot[];
  activeFileId: string | null;
  activeProjectKey: string | null;
  workspaceId: string;
  relayState: RelayConnectionState;
  hasBufferedLiveUpdate: boolean;
  connectedAgents: AgentSessionInfo[];
  liveProjectCounts: Map<string, number>;
  storageStats: StorageAllocationStats;
  onResizeWidth: (width: number) => void;
  onToggleProjectExpanded: (projectKey: string) => void;
  onOpenFile: (fileId: string) => void;
  onCreateGraph: (projectKey?: string, parentDir?: string, name?: string) => void;
  onCreateFolder: (projectKey: string, parentDir: string, folderName: string) => void;
  onRenamePath: (projectKey: string, fromPath: string, toPath: string) => void;
  onDeleteGraph: (projectKey: string, fileId: string) => void;
  onDeleteFolder: (projectKey: string, folderPath: string) => void;
  onDeleteProject: (projectKey: string) => void;
  onToggleLivePause: () => void;
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function ExplorerSidebar({
  width,
  projects,
  activeFileId,
  activeProjectKey,
  workspaceId,
  relayState,
  hasBufferedLiveUpdate,
  connectedAgents,
  liveProjectCounts,
  storageStats,
  onResizeWidth,
  onToggleProjectExpanded,
  onOpenFile,
  onCreateGraph,
  onCreateFolder,
  onRenamePath,
  onDeleteGraph,
  onDeleteFolder,
  onDeleteProject,
  onToggleLivePause,
  onNotifyToast,
}: ExplorerSidebarProps) {
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(() => new Set());
  const [collapsedGraphs, setCollapsedGraphs] = useState<Set<string>>(() => new Set());
  const [agentsPaneOpen, setAgentsPaneOpen] = useState(true);
  const [inlinePrompt, setInlinePrompt] = useState<InlinePromptState | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const promptInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (inlinePrompt && promptInputRef.current) {
      promptInputRef.current.focus();
      promptInputRef.current.select();
    }
  }, [inlinePrompt]);

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
      style={{ paddingLeft: `${12 + depth * 13}px` }}
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

    const head = getHeadVersion(file);
    const isActive = file.id === activeFileId;
    const baseLabel = (file.path.split('/').pop() || file.title).replace(
      /\.(mmd|mermaid)$/i,
      ''
    );

    const roleHint = hasSubGraphs
      ? `Overview (${children.length} sub-graph${children.length === 1 ? '' : 's'})`
      : isChildGraph
        ? 'Sub-graph'
        : 'Graph';

    return (
      <div
        key={file.id}
        className={`tree-graph-branch ${hasSubGraphs ? 'has-subgraphs' : ''} ${
          isChildGraph ? 'is-subgraph' : ''
        }`}
      >
        {isRenaming ? (
          renderInlineInput(depth, 'graph-name.mmd')
        ) : (
          <div
            data-explorer-path={`${project.projectKey}/${file.path}`}
            data-explorer-role={
              hasSubGraphs ? 'parent' : isChildGraph ? 'child' : 'standalone'
            }
            className={`tree-row tree-file-row ${isActive ? 'active' : ''} ${
              hasSubGraphs ? 'parent-overview-row' : ''
            } ${isChildGraph ? 'child-subgraph-row' : ''}`}
            style={{
              paddingLeft: `${(hasSubGraphs ? 8 : 14) + depth * 13}px`,
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
            title={`${roleHint}: ${project.projectLabel}/${file.path} (v${file.currentVersion}, updated by ${head.authorLabel})`}
          >
            {hasSubGraphs && (
              <button
                type="button"
                className="tree-subgraph-toggle"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleGraphChildren(file.id);
                }}
                aria-label={
                  isGraphCollapsed ? 'Expand sub-graphs' : 'Collapse sub-graphs'
                }
              >
                {isGraphCollapsed ? (
                  <ChevronRight size={11} className="tree-chevron" />
                ) : (
                  <ChevronDown size={11} className="tree-chevron" />
                )}
              </button>
            )}

            {hasSubGraphs ? (
              <Layers size={13} className="tree-file-icon overview-icon" />
            ) : isChildGraph ? (
              <CornerDownRight size={12} className="tree-file-icon child-icon" />
            ) : (
              <FileCode size={13} className="tree-file-icon" />
            )}

            <span className="tree-item-label">{baseLabel}</span>
            {file.unread && <span className="tab-unread-dot" />}
            <span className={`tree-author-badge author-${head.authorBadge}`}>
              {head.authorBadge}
            </span>

            <div className="tree-row-actions" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="tree-action-btn"
                title="Rename or move graph"
                onClick={() => {
                  setInlinePrompt({
                    kind: 'rename-file',
                    projectKey: project.projectKey,
                    fileId: file.id,
                    oldPath: file.path,
                  });
                  setDraftValue(baseLabel);
                }}
              >
                <Pencil size={11} />
              </button>
              <button
                type="button"
                className="tree-action-btn danger"
                title="Delete graph"
                onClick={() => onDeleteGraph(project.projectKey, file.id)}
              >
                <Trash2 size={11} />
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

    return (
      <div key={node.path} className="tree-folder-group">
        {isRenaming ? (
          renderInlineInput(depth, 'folder-name')
        ) : (
          <div
            data-explorer-folder={`${project.projectKey}/${node.path}`}
            className="tree-row tree-folder-row"
            style={{ paddingLeft: `${10 + depth * 13}px` }}
            onClick={() => toggleFolder(project.projectKey, node.path)}
          >
            {isCollapsed ? (
              <ChevronRight size={12} className="tree-chevron" />
            ) : (
              <ChevronDown size={12} className="tree-chevron" />
            )}
            {isCollapsed ? (
              <Folder size={13} className="tree-folder-icon" />
            ) : (
              <FolderOpen size={13} className="tree-folder-icon" />
            )}
            <span className="tree-item-label">{node.name}</span>

            <div className="tree-row-actions" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="tree-action-btn"
                title="New graph in folder"
                onClick={() =>
                  startNewItem('new-file', project.projectKey, node.path)
                }
              >
                <FilePlus2 size={11} />
              </button>
              <button
                type="button"
                className="tree-action-btn"
                title="New subfolder"
                onClick={() =>
                  startNewItem('new-folder', project.projectKey, node.path)
                }
              >
                <FolderPlus size={11} />
              </button>
              <button
                type="button"
                className="tree-action-btn"
                title="Rename folder"
                onClick={() => {
                  setInlinePrompt({
                    kind: 'rename-folder',
                    projectKey: project.projectKey,
                    oldPath: node.path,
                  });
                  setDraftValue(node.name);
                }}
              >
                <Pencil size={11} />
              </button>
              <button
                type="button"
                className="tree-action-btn danger"
                title="Delete folder"
                onClick={() => onDeleteFolder(project.projectKey, node.path)}
              >
                <Trash2 size={11} />
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
                  ? 'graph-name.mmd'
                  : 'subfolder-name'
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
      {/* Top Header: EXPLORER */}
      <div className="sidebar-section-header explorer-top-header">
        <span className="sidebar-section-title">EXPLORER</span>
        <div className="sidebar-header-actions">
          <button
            type="button"
            className="tree-action-btn visible"
            title="New Graph"
            onClick={() => startNewItem('new-file', targetTopProjectKey, '')}
          >
            <FilePlus2 size={13} />
          </button>
          <button
            type="button"
            className="tree-action-btn visible"
            title="New Folder"
            onClick={() => startNewItem('new-folder', targetTopProjectKey, '')}
          >
            <FolderPlus size={13} />
          </button>
        </div>
      </div>

      {/* Scrollable Project Tree */}
      <div className="explorer-tree" role="tree" aria-label="Diagram Explorer">
        {projects.map((project) => {
          const liveCount = liveProjectCounts.get(project.projectKey) ?? 0;
          const treeRoot = buildExplorerSubtree(project, '');

          return (
            <div
              key={project.projectKey}
              className="explorer-project-section"
              data-project-key={project.projectKey}
            >
              <div
                className="tree-row tree-project-row"
                onClick={() => onToggleProjectExpanded(project.projectKey)}
              >
                {project.expanded ? (
                  <ChevronDown size={12} className="tree-chevron" />
                ) : (
                  <ChevronRight size={12} className="tree-chevron" />
                )}
                <span className="tree-project-label">{project.projectLabel}</span>
                {liveCount > 0 && (
                  <span
                    className="project-live-badge"
                    title={`${liveCount} coding agent(s) connected`}
                  >
                    <span className="live-dot online" />
                    {liveCount}
                  </span>
                )}

                <div
                  className="tree-row-actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className="tree-action-btn"
                    title={`New graph in ${project.projectLabel}`}
                    onClick={() => {
                      if (!project.expanded) {
                        onToggleProjectExpanded(project.projectKey);
                      }
                      startNewItem('new-file', project.projectKey, '');
                    }}
                  >
                    <FilePlus2 size={11} />
                  </button>
                  <button
                    type="button"
                    className="tree-action-btn"
                    title={`New folder in ${project.projectLabel}`}
                    onClick={() => {
                      if (!project.expanded) {
                        onToggleProjectExpanded(project.projectKey);
                      }
                      startNewItem('new-folder', project.projectKey, '');
                    }}
                  >
                    <FolderPlus size={11} />
                  </button>
                  <button
                    type="button"
                    className="tree-action-btn danger"
                    title={`Delete project ${project.projectLabel}`}
                    onClick={() => onDeleteProject(project.projectKey)}
                  >
                    <Trash2 size={11} />
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
                        ? 'auth/oauth-flow.mmd'
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
                    ) && (
                      <div className="tree-empty-hint">
                        {liveCount > 0
                          ? 'Connected · waiting for graphs'
                          : 'Empty project'}
                      </div>
                    )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* VS Code-Style Bottom Pane: Connected Agents & Browser Storage */}
      <div className="sidebar-agents-pane">
        <div
          className="sidebar-section-header clickable"
          onClick={() => setAgentsPaneOpen((v) => !v)}
        >
          <div className="sidebar-section-left">
            {agentsPaneOpen ? (
              <ChevronDown size={12} className="tree-chevron" />
            ) : (
              <ChevronRight size={12} className="tree-chevron" />
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

          <div
            className="sidebar-header-actions"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className={`tree-action-btn visible ${
                relayState === 'paused' ? 'paused-accent' : ''
              }`}
              title={
                relayState === 'paused'
                  ? hasBufferedLiveUpdate
                    ? 'Update queued — click to resume sync'
                    : 'Resume live MCP sync'
                  : 'Pause auto-focus'
              }
              onClick={onToggleLivePause}
            >
              {relayState === 'paused' ? <Play size={11} /> : <Pause size={11} />}
            </button>
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
                  onNotifyToast('Copied paired MCP URL');
                }}
                title="Copy paired MCP URL to connect Claude Code, Pi, or Cursor"
              >
                <Copy size={11} />
                <span>Copy MCP URL</span>
              </button>
            ) : (
              <ul className="sidebar-agent-list">
                {connectedAgents.map((ag) => (
                  <li key={ag.sessionId} className="sidebar-agent-item">
                    <span
                      className={`live-dot ${
                        relayState === 'paused' ? 'paused' : 'online'
                      }`}
                    />
                    <span className="sidebar-agent-name">{ag.agentLabel}</span>
                    <span className="sidebar-agent-proj">
                      {ag.project || 'General'}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div className="sidebar-storage-footer">
              <span>localStorage {formatBytes(storageStats.bytesUsed)}</span>
              <span>·</span>
              <span>{storageStats.diagramCount} graphs</span>
              <span>·</span>
              <span>0 B server</span>
            </div>
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
