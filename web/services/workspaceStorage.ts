import {
  normalizeAgentIdentity,
  normalizeProjectName,
} from '../../src/shared/agentIdentity';
import {
  rewriteGuidePaths,
  sanitizeComprehensionGuide,
  serializeGuideCanonical,
} from '../../src/shared/comprehension';
import { slugify } from '../../src/shared/svg';
import type {
  DiagramComprehensionGuide,
  VfsLsEntry,
  VfsLsResult,
  VfsMoveResult,
  VfsReadResult,
} from '../../src/shared/types';
import {
  graphTitleFromPath,
  inferPathFromTitle,
  normalizeRelativeDirPath,
  normalizeRelativeGraphPath,
  parentDirOfPath,
} from '../../src/shared/vfsPath';

export const WORKSPACE_V4_STORAGE_KEY = 'mfhmfa-workspace-v4';
const LEGACY_V3_STORAGE_KEY = 'mfhmfa-workspace-v3';
const LEGACY_V2_STORAGE_KEY = 'mfhmfa-studio-tabs-v2';
const LEGACY_DRAFT_KEY = 'mfhmfa-stateless-draft';
export const WORKSPACE_ID_KEY = 'mfhmfa-workspace-id';

export const SCRATCHPAD_PROJECT_KEY = 'scratchpad';
export const GENERAL_PROJECT_KEY = 'general';
export const MAX_GRAPH_VERSIONS = 5;
const HUMAN_EDIT_COALESCE_MS = 45_000;
export const AGENT_ITERATION_COALESCE_MS = 90_000;

export const WELCOME_CODE = `flowchart TB
  Agents(["Coding Agents"])

  subgraph Server["Stateless Server (0 Stored Graphs)"]
    Render[["PNG Renderer"]]
    Relay["Live Pass-Through"]
  end

  subgraph Browser["Your Browser (100% Local Storage)"]
    Studio["Interactive Canvas"]
    VFS[("Project VFS")]
  end

  Agents -->|"1. Validate & render"| Render
  Render -.->|"2. 2x Retina PNG"| Agents
  Agents -->|"3. Stream graph"| Relay
  Relay <==>|"4. Live sync + ls/read"| Studio
  Studio <-->|"Last 5 versions"| VFS`;

export const WELCOME_GUIDE: DiagramComprehensionGuide = {
  gist: 'The server holds zero diagrams — agents verify layout via temporary PNGs while all folders, graphs, and history live in your browser.',
  steps: [
    {
      title: '1. Agent renders & inspects PNG',
      caption:
        'Your coding agent sends Mermaid code to the server, receives a 2x Retina PNG to check visual layout, and the PNG buffer is discarded immediately.',
      focusNodes: ['Agents', 'Render'],
    },
    {
      title: '2. Live pass-through to your browser',
      caption:
        'Once valid, the server streams the graph + comprehension guide straight into your open browser tab without storing a copy on disk or in RAM.',
      focusNodes: ['Agents', 'Relay', 'Studio'],
    },
    {
      title: '3. Saved in your browser VFS',
      caption:
        'Your browser coalesces rapid retries and saves up to the last 5 versions per file in localStorage. Agents run ls/read directly against this open tab.',
      focusNodes: ['Studio', 'VFS', 'Relay'],
    },
  ],
  nodes: {
    Agents: {
      label: 'Coding Agents (Claude, Pi, Cursor)',
      summary:
        'AI agents connect over MCP, inspect existing graphs with mermaid_ls / mermaid_read, and push interactive diagrams with Story Mode steps and node cards.',
      example: 'mermaid_render({ path: "arch/overview.mmd", code, guide }) -> 2x PNG + live browser sync',
      whatIf: 'If two agents work on different repositories, each session is jailed strictly to its own project folder.',
    },
    Render: {
      label: 'Headless Chromium Pool',
      summary:
        'A bounded pool of 4–16 isolated Chromium contexts validates syntax, renders 2x Retina PNGs for agent vision, clears DOM nodes after every call, and recycles workers after 150 ops.',
      example: '1.2 KB Mermaid text -> ~180 KB PNG returned to agent -> 0 bytes retained on server',
      whatIf: 'If all workers are busy, incoming renders wait in an in-memory queue; if a render hangs >12s, that worker is killed and replaced.',
      files: ['src/infrastructure/renderer/chromiumEngine.ts'],
    },
    Relay: {
      label: 'Stateless SSE Relay',
      summary:
        'Forwards incoming diagrams to open browser tabs and proxies ephemeral ls, read, and mv queries down to your browser with a 2.5s timeout.',
      example: 'mermaid_ls -> SSE query to browser -> JSON folder tree reply in ~10ms (0 stored diagrams)',
      whatIf: 'Close all MFHMFA Studio browser tabs -> mermaid_ls and mermaid_read fail after 2.5s because the server stores nothing.',
      files: ['src/infrastructure/ephemeral/workspaceRelay.ts'],
    },
    Studio: {
      label: 'Interactive Comprehension Canvas',
      summary:
        'Renders crisp SVGs locally (caching the last 80 views in tab memory), spotlights Story Mode steps, and opens inspector cards when you click any box.',
      example: 'Click any box to inspect examples & failure modes, or press Left/Right arrows to step through a flow.',
      whatIf: 'Pause Live Sync in the sidebar -> incoming agent updates buffer safely in tab memory until you resume.',
      files: ['web/components/PreviewCanvas.tsx', 'web/services/mermaidRenderer.ts'],
    },
    VFS: {
      label: 'Browser localStorage VFS',
      summary:
        'Persists all project trees, `.mmd` files, and interactive guides on your device under `mfhmfa-workspace-v4`.',
      example: 'Rapid retries within 90s merge into 1 clean version; each graph keeps an immutable 5-version ring buffer.',
      whatIf: 'Clear browser site data -> local diagrams are wiped unless exported or shared via a compressed `#z=` permalink.',
      files: ['web/services/workspaceStorage.ts'],
    },
  },
};

export const NEW_TAB_STARTER = `flowchart LR
  Start(["Start"]) --> Step["Process"] --> Done(["Done"])`;

export interface GraphVersionRecord {
  version: number;
  code: string;
  guide?: DiagramComprehensionGuide;
  authorSlug: string;
  authorLabel: string;
  authorBadge: string;
  agentSessionId?: string | null;
  createdAt: number;
}

export interface VfsGraphFile {
  id: string;
  path: string;
  title: string;
  diagramType: string | null;
  unread: boolean;
  isWelcome?: boolean;
  currentVersion: number;
  versions: GraphVersionRecord[];
  zoom: number | null;
  pan: { x: number; y: number };
}

export interface VfsProjectRoot {
  projectKey: string;
  projectLabel: string;
  isScratchpad?: boolean;
  expanded: boolean;
  folders: string[];
  files: VfsGraphFile[];
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceState {
  version: 4;
  workspaceId: string;
  sidebarOpen: boolean;
  sidebarWidth: number;
  openTabIds: string[];
  activeFileId: string | null;
  projects: VfsProjectRoot[];
}

export interface StorageAllocationStats {
  bytesUsed: number;
  projectCount: number;
  folderCount: number;
  diagramCount: number;
  versionCount: number;
}

export interface ExplorerFolderNode {
  kind: 'folder';
  name: string;
  path: string;
  folders: ExplorerFolderNode[];
  files: VfsGraphFile[];
}

interface PersistedGraphFileV4 {
  id: string;
  path: string;
  title: string;
  diagramType: string | null;
  isWelcome?: boolean;
  currentVersion: number;
  versions: GraphVersionRecord[];
}

interface PersistedProjectV4 {
  projectKey: string;
  projectLabel: string;
  isScratchpad?: boolean;
  expanded: boolean;
  folders: string[];
  files: PersistedGraphFileV4[];
  createdAt: number;
  updatedAt: number;
}

interface PersistedWorkspaceV4 {
  version: 4;
  workspaceId: string;
  sidebarOpen: boolean;
  sidebarWidth: number;
  openTabIds: string[];
  activeFileId: string | null;
  projects: PersistedProjectV4[];
}

export function randomToken(len = 12): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += alphabet[bytes[i]! & 63];
  }
  return out;
}

export function toProjectKey(projectLabel: string): string {
  return slugify(projectLabel, GENERAL_PROJECT_KEY);
}

export function toAuthorBadge(agentSlug: string, shortLabel?: string): string {
  if (agentSlug === 'user') return 'you';
  if (agentSlug === 'claude-code' || agentSlug === 'claude') return 'claude';
  if (agentSlug === 'pi') return 'pi';
  if (agentSlug === 'cursor') return 'cursor';
  if (agentSlug === 'antigravity') return 'antigravity';
  return (shortLabel || agentSlug || 'agent').toLowerCase().slice(0, 12);
}

export function getHeadVersion(file: VfsGraphFile): GraphVersionRecord {
  return (
    file.versions[file.versions.length - 1] ?? {
      version: file.currentVersion || 1,
      code: '',
      authorSlug: 'user',
      authorLabel: 'You',
      authorBadge: 'you',
      createdAt: Date.now(),
    }
  );
}

export function getVersionRecord(
  file: VfsGraphFile,
  version: number | null | undefined
): GraphVersionRecord {
  if (typeof version === 'number') {
    const match = file.versions.find((v) => v.version === version);
    if (match) return match;
  }
  return getHeadVersion(file);
}

export function findFileWithProject(
  state: WorkspaceState,
  fileId: string | null | undefined
): { project: VfsProjectRoot; file: VfsGraphFile } | null {
  if (!fileId) return null;
  for (const project of state.projects) {
    const file = project.files.find((f) => f.id === fileId);
    if (file) return { project, file };
  }
  return null;
}

export function getOrCreateWorkspaceId(): string {
  const urlParams = new URLSearchParams(window.location.search);
  const fromQuery = urlParams.get('workspace') || urlParams.get('ws');
  if (fromQuery && /^[A-Za-z0-9_-]{4,64}$/.test(fromQuery.trim())) {
    const clean = fromQuery.trim();
    localStorage.setItem(WORKSPACE_ID_KEY, clean);
    return clean;
  }

  const saved = localStorage.getItem(WORKSPACE_ID_KEY);
  if (saved && /^[A-Za-z0-9_-]{4,64}$/.test(saved)) {
    return saved;
  }

  const fresh = `ws_${randomToken(12)}`;
  localStorage.setItem(WORKSPACE_ID_KEY, fresh);
  return fresh;
}

function createDefaultScratchpadProject(
  now = Date.now(),
  legacyCode?: string | null
): VfsProjectRoot {
  const welcomeFile: VfsGraphFile = {
    id: 'file-welcome',
    path: legacyCode ? 'scratchpad.mmd' : 'architecture-overview.mmd',
    title: legacyCode ? 'scratchpad' : 'architecture-overview',
    diagramType: 'flowchart-v2',
    unread: false,
    isWelcome: !legacyCode,
    currentVersion: 1,
    versions: [
      {
        version: 1,
        code: legacyCode || WELCOME_CODE,
        ...(!legacyCode ? { guide: WELCOME_GUIDE } : {}),
        authorSlug: 'user',
        authorLabel: 'You',
        authorBadge: 'you',
        createdAt: now,
      },
    ],
    zoom: null,
    pan: { x: 0, y: 0 },
  };

  return {
    projectKey: SCRATCHPAD_PROJECT_KEY,
    projectLabel: 'scratchpad',
    isScratchpad: true,
    expanded: true,
    folders: [],
    files: [welcomeFile],
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeWorkspaceConsistency(state: WorkspaceState): WorkspaceState {
  const existingFileIds = new Set<string>();
  for (const p of state.projects) {
    for (const f of p.files) {
      existingFileIds.add(f.id);
    }
  }

  const seenTabs = new Set<string>();
  const cleanOpenTabs: string[] = [];
  for (const id of state.openTabIds) {
    if (existingFileIds.has(id) && !seenTabs.has(id)) {
      seenTabs.add(id);
      cleanOpenTabs.push(id);
    }
  }

  let activeFileId =
    state.activeFileId && existingFileIds.has(state.activeFileId)
      ? state.activeFileId
      : null;

  if (activeFileId && !cleanOpenTabs.includes(activeFileId)) {
    cleanOpenTabs.push(activeFileId);
  }

  if (!activeFileId && cleanOpenTabs.length > 0) {
    activeFileId = cleanOpenTabs[cleanOpenTabs.length - 1]!;
  }

  return {
    ...state,
    openTabIds: cleanOpenTabs,
    activeFileId,
  };
}

export function serializeWorkspaceForStorage(state: WorkspaceState): string {
  const payload: PersistedWorkspaceV4 = {
    version: 4,
    workspaceId: state.workspaceId,
    sidebarOpen: state.sidebarOpen,
    sidebarWidth: state.sidebarWidth,
    openTabIds: state.openTabIds,
    activeFileId: state.activeFileId,
    projects: state.projects.map((p) => ({
      projectKey: p.projectKey,
      projectLabel: p.projectLabel,
      ...(p.isScratchpad ? { isScratchpad: true } : {}),
      expanded: p.expanded,
      folders: p.folders,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      files: p.files.map((f) => ({
        id: f.id,
        path: f.path,
        title: f.title,
        diagramType: f.diagramType,
        ...(f.isWelcome ? { isWelcome: true } : {}),
        currentVersion: f.currentVersion,
        versions: f.versions.slice(-MAX_GRAPH_VERSIONS),
      })),
    })),
  };
  return JSON.stringify(payload);
}

export function persistWorkspaceState(state: WorkspaceState): void {
  try {
    localStorage.setItem(WORKSPACE_V4_STORAGE_KEY, serializeWorkspaceForStorage(state));
  } catch {
    // Ignore quota errors
  }
}

export function initializeWorkspaceStorage(): WorkspaceState {
  const workspaceId = getOrCreateWorkspaceId();
  const now = Date.now();

  try {
    const rawV4 = localStorage.getItem(WORKSPACE_V4_STORAGE_KEY);
    if (rawV4) {
      const parsed = JSON.parse(rawV4) as Partial<PersistedWorkspaceV4>;
      if (parsed.version === 4 && Array.isArray(parsed.projects)) {
        const projects: VfsProjectRoot[] = parsed.projects
          .filter((p) => p && typeof p.projectKey === 'string')
          .map((p) => ({
            projectKey: p.projectKey,
            projectLabel: p.projectLabel || p.projectKey,
            isScratchpad: Boolean(p.isScratchpad),
            expanded: p.expanded !== false,
            folders: Array.isArray(p.folders) ? p.folders.filter(Boolean) : [],
            createdAt: p.createdAt || now,
            updatedAt: p.updatedAt || now,
            files: Array.isArray(p.files)
              ? p.files
                  .filter(
                    (f) =>
                      f &&
                      typeof f.path === 'string' &&
                      Array.isArray(f.versions) &&
                      f.versions.length > 0
                  )
                  .map((f) => ({
                    id: f.id || `file-${randomToken(7)}`,
                    path: f.path,
                    title: f.title || graphTitleFromPath(f.path),
                    diagramType: f.diagramType ?? null,
                    unread: false,
                    isWelcome: Boolean(f.isWelcome),
                    currentVersion:
                      f.currentVersion ||
                      f.versions[f.versions.length - 1]!.version ||
                      1,
                    versions: f.versions.slice(-MAX_GRAPH_VERSIONS).map((v) => {
                      let safeGuide: DiagramComprehensionGuide | undefined;
                      try {
                        safeGuide = sanitizeComprehensionGuide(v.guide);
                      } catch {
                        safeGuide = undefined;
                      }
                      return {
                        ...v,
                        ...(safeGuide ? { guide: safeGuide } : { guide: undefined }),
                      };
                    }),
                    zoom: null,
                    pan: { x: 0, y: 0 },
                  }))
              : [],
          }));

        if (projects.length > 0) {
          const loaded = normalizeWorkspaceConsistency({
            version: 4,
            workspaceId,
            sidebarOpen: parsed.sidebarOpen !== false,
            sidebarWidth:
              typeof parsed.sidebarWidth === 'number'
                ? Math.min(440, Math.max(190, parsed.sidebarWidth))
                : 256,
            openTabIds: Array.isArray(parsed.openTabIds) ? parsed.openTabIds : [],
            activeFileId: parsed.activeFileId ?? null,
            projects,
          });
          persistWorkspaceState(loaded);
          return loaded;
        }
      }
    }

    // Migrate v3 grouped state if present
    const rawV3 = localStorage.getItem(LEGACY_V3_STORAGE_KEY);
    if (rawV3) {
      const parsedV3 = JSON.parse(rawV3) as {
        projects?: Array<{
          projectKey: string;
          projectLabel: string;
          isScratchpad?: boolean;
          agents?: Array<{
            agentKey: string;
            agentLabel: string;
            agentShortLabel?: string;
            tabs?: Array<{
              id: string;
              tabKey: string;
              title: string;
              code: string;
              isWelcome?: boolean;
              updatedAt?: number;
            }>;
          }>;
        }>;
      };
      if (Array.isArray(parsedV3.projects) && parsedV3.projects.length > 0) {
        const openTabIds: string[] = [];
        const migratedProjects: VfsProjectRoot[] = parsedV3.projects.map((p) => {
          const files: VfsGraphFile[] = [];
          const usedPaths = new Set<string>();

          for (const ag of p.agents ?? []) {
            for (const t of ag.tabs ?? []) {
              let relPath = inferPathFromTitle(t.title || t.tabKey || 'diagram');
              if (usedPaths.has(relPath)) {
                relPath = `${ag.agentKey}/${relPath}`;
              }
              usedPaths.add(relPath);
              const fileId = t.id || `file-${randomToken(7)}`;
              openTabIds.push(fileId);
              files.push({
                id: fileId,
                path: relPath,
                title: t.title || graphTitleFromPath(relPath),
                diagramType: null,
                unread: false,
                isWelcome: Boolean(t.isWelcome),
                currentVersion: 1,
                versions: [
                  {
                    version: 1,
                    code: t.code,
                    authorSlug: ag.agentKey,
                    authorLabel: ag.agentLabel,
                    authorBadge: toAuthorBadge(ag.agentKey, ag.agentShortLabel),
                    createdAt: t.updatedAt || now,
                  },
                ],
                zoom: null,
                pan: { x: 0, y: 0 },
              });
            }
          }

          return {
            projectKey: p.projectKey,
            projectLabel: p.projectLabel,
            isScratchpad: Boolean(p.isScratchpad),
            expanded: true,
            folders: [],
            files,
            createdAt: now,
            updatedAt: now,
          };
        });

        const migrated = normalizeWorkspaceConsistency({
          version: 4,
          workspaceId,
          sidebarOpen: true,
          sidebarWidth: 256,
          openTabIds,
          activeFileId: openTabIds[0] ?? null,
          projects: migratedProjects,
        });
        persistWorkspaceState(migrated);
        return migrated;
      }
    }

    // Migrate v2 flat tabs if present
    const rawV2 = localStorage.getItem(LEGACY_V2_STORAGE_KEY);
    if (rawV2) {
      const parsedV2 = JSON.parse(rawV2) as {
        tabs?: Array<{ id?: string; title?: string; code?: string; isWelcome?: boolean }>;
      };
      if (Array.isArray(parsedV2.tabs) && parsedV2.tabs.length > 0) {
        const files: VfsGraphFile[] = parsedV2.tabs
          .filter((t) => t && typeof t.code === 'string')
          .map((t, idx) => {
            const relPath = inferPathFromTitle(t.title || `diagram-${idx + 1}`);
            return {
              id: t.id || `file-${randomToken(7)}`,
              path: relPath,
              title: t.title || graphTitleFromPath(relPath),
              diagramType: null,
              unread: false,
              isWelcome: Boolean(t.isWelcome),
              currentVersion: 1,
              versions: [
                {
                  version: 1,
                  code: t.code!,
                  authorSlug: 'user',
                  authorLabel: 'You',
                  authorBadge: 'you',
                  createdAt: now,
                },
              ],
              zoom: null,
              pan: { x: 0, y: 0 },
            };
          });

        if (files.length > 0) {
          const openIds = files.map((f) => f.id);
          const migrated: WorkspaceState = {
            version: 4,
            workspaceId,
            sidebarOpen: true,
            sidebarWidth: 256,
            openTabIds: openIds,
            activeFileId: openIds[0]!,
            projects: [
              {
                projectKey: SCRATCHPAD_PROJECT_KEY,
                projectLabel: 'scratchpad',
                isScratchpad: true,
                expanded: true,
                folders: [],
                files,
                createdAt: now,
                updatedAt: now,
              },
            ],
          };
          persistWorkspaceState(migrated);
          return migrated;
        }
      }
    }
  } catch {
    // Fall back to fresh workspace
  }

  const legacyDraft = localStorage.getItem(LEGACY_DRAFT_KEY);
  const scratchpad = createDefaultScratchpadProject(now, legacyDraft);
  const welcomeId = scratchpad.files[0]!.id;
  const fresh: WorkspaceState = {
    version: 4,
    workspaceId,
    sidebarOpen: true,
    sidebarWidth: 256,
    openTabIds: [welcomeId],
    activeFileId: welcomeId,
    projects: [scratchpad],
  };

  persistWorkspaceState(fresh);
  return fresh;
}

export function computeStorageStats(state: WorkspaceState): StorageAllocationStats {
  const json = serializeWorkspaceForStorage(state);
  let folderCount = 0;
  let diagramCount = 0;
  let versionCount = 0;

  for (const p of state.projects) {
    const dirSet = new Set<string>(p.folders);
    for (const f of p.files) {
      diagramCount += 1;
      versionCount += f.versions.length;
      const dir = parentDirOfPath(f.path);
      if (dir) {
        const parts = dir.split('/');
        let cur = '';
        for (const seg of parts) {
          cur = cur ? `${cur}/${seg}` : seg;
          dirSet.add(cur);
        }
      }
    }
    folderCount += dirSet.size;
  }

  return {
    bytesUsed: new Blob([json]).size,
    projectCount: state.projects.length,
    folderCount,
    diagramCount,
    versionCount,
  };
}

/**
 * Allocates a project working directory in browser `localStorage` when an MCP connects,
 * migrating any empty `'general'` pre-allocation once MCP `roots/list` resolves.
 */
export function allocateProjectSpace(
  state: WorkspaceState,
  params: {
    projectName: string | null;
    previousProjectKey?: string | null;
  }
): { nextState: WorkspaceState; projectKey: string } {
  const now = Date.now();
  const cleanLabel = normalizeProjectName(params.projectName) || 'General';
  const targetKey = toProjectKey(cleanLabel);

  let projects = [...state.projects];
  let migratedFiles: VfsGraphFile[] = [];
  let migratedFolders: string[] = [];

  if (
    params.previousProjectKey &&
    params.previousProjectKey !== targetKey &&
    params.previousProjectKey === GENERAL_PROJECT_KEY
  ) {
    const gen = projects.find((p) => p.projectKey === GENERAL_PROJECT_KEY);
    if (gen) {
      migratedFiles = gen.files;
      migratedFolders = gen.folders;
      projects = projects.filter((p) => p.projectKey !== GENERAL_PROJECT_KEY);
    }
  }

  const idx = projects.findIndex((p) => p.projectKey === targetKey);
  if (idx < 0) {
    projects.push({
      projectKey: targetKey,
      projectLabel: cleanLabel,
      expanded: true,
      folders: migratedFolders,
      files: migratedFiles,
      createdAt: now,
      updatedAt: now,
    });
  } else if (migratedFiles.length > 0 || migratedFolders.length > 0) {
    const existing = projects[idx]!;
    const mergedFiles = [...existing.files];
    for (const mf of migratedFiles) {
      if (!mergedFiles.some((f) => f.path === mf.path)) {
        mergedFiles.push(mf);
      }
    }
    const folderSet = new Set([...existing.folders, ...migratedFolders]);
    projects[idx] = {
      ...existing,
      expanded: true,
      folders: Array.from(folderSet),
      files: mergedFiles,
      updatedAt: now,
    };
  }

  return {
    nextState: normalizeWorkspaceConsistency({ ...state, projects }),
    projectKey: targetKey,
  };
}

/**
 * Writes/updates a `.mmd` graph in the project VFS using the immutable last-5 versions ring buffer.
 * Rapid iterative renders of the same `path` by the same coding agent within 90s coalesce into
 * the active head revision so layout self-corrections do not pollute version history.
 */
export function upsertGraphInVfs(
  state: WorkspaceState,
  params: {
    projectName: string;
    previousProjectKey?: string | null;
    path: string;
    title?: string;
    code: string;
    guide?: DiagramComprehensionGuide;
    diagramType?: string | null;
    agentSlug: string;
    agentLabel: string;
    agentShortLabel?: string;
    agentSessionId?: string | null;
    autoOpenTab: boolean;
    autoFocus: boolean;
    now?: number;
  }
): { nextState: WorkspaceState; file: VfsGraphFile; projectKey: string } {
  let incomingGuide: DiagramComprehensionGuide | undefined;
  try {
    incomingGuide = sanitizeComprehensionGuide(params.guide);
  } catch {
    incomingGuide = undefined;
  }

  const alloc = allocateProjectSpace(state, {
    projectName: params.projectName,
    previousProjectKey: params.previousProjectKey,
  });

  const now = params.now ?? Date.now();
  const projectKey = alloc.projectKey;
  const relPath = normalizeRelativeGraphPath(params.path);
  const displayTitle = params.title?.trim() || graphTitleFromPath(relPath);
  const normAgent = normalizeAgentIdentity(params.agentLabel);
  const authorSlug = params.agentSlug || normAgent.slug;
  const authorLabel = params.agentLabel || normAgent.label;
  const authorBadge = toAuthorBadge(
    authorSlug,
    params.agentShortLabel || normAgent.shortLabel
  );

  let targetFile!: VfsGraphFile;
  let removedWelcomeIds: string[] = [];

  // Remove untouched Welcome scratchpad once a real project diagram arrives
  let projects = alloc.nextState.projects.filter((p) => {
    if (
      p.isScratchpad &&
      p.projectKey !== projectKey &&
      p.files.length === 1 &&
      p.files[0]?.isWelcome &&
      p.folders.length === 0
    ) {
      removedWelcomeIds.push(p.files[0].id);
      return false;
    }
    return true;
  });

  projects = projects.map((proj) => {
    if (proj.projectKey !== projectKey) return proj;

    const existingIdx = proj.files.findIndex((f) => f.path === relPath);
    const nextFiles = [...proj.files];

    if (existingIdx >= 0) {
      const prev = nextFiles[existingIdx]!;
      const head = getHeadVersion(prev);
      const isSelected = state.activeFileId === prev.id;

      let nextVersionNum = prev.currentVersion;
      let nextVersions = prev.versions;

      const canCoalesceAgentIteration =
        !prev.isWelcome &&
        authorSlug !== 'user' &&
        head.authorSlug === authorSlug &&
        (!params.agentSessionId ||
          !head.agentSessionId ||
          head.agentSessionId === params.agentSessionId) &&
        now - head.createdAt < AGENT_ITERATION_COALESCE_MS;

      const effectiveGuide =
        incomingGuide ?? (canCoalesceAgentIteration ? head.guide : undefined);
      const guideChanged =
        serializeGuideCanonical(head.guide) !== serializeGuideCanonical(effectiveGuide);

      if (head.code !== params.code || head.authorSlug !== authorSlug || guideChanged) {
        if (canCoalesceAgentIteration) {
          nextVersions = [
            ...prev.versions.slice(0, -1),
            {
              ...head,
              code: params.code,
              ...(effectiveGuide ? { guide: effectiveGuide } : { guide: undefined }),
              authorLabel,
              authorBadge,
              ...(params.agentSessionId
                ? { agentSessionId: params.agentSessionId }
                : {}),
              createdAt: now,
            },
          ];
        } else {
          nextVersionNum = prev.currentVersion + 1;
          const newRec: GraphVersionRecord = {
            version: nextVersionNum,
            code: params.code,
            ...(incomingGuide ? { guide: incomingGuide } : {}),
            authorSlug,
            authorLabel,
            authorBadge,
            ...(params.agentSessionId
              ? { agentSessionId: params.agentSessionId }
              : {}),
            createdAt: now,
          };
          nextVersions = [...prev.versions, newRec].slice(-MAX_GRAPH_VERSIONS);
        }
      }

      const updated: VfsGraphFile = {
        ...prev,
        title: displayTitle,
        diagramType: params.diagramType ?? prev.diagramType,
        unread: !params.autoFocus && !isSelected,
        isWelcome: false,
        currentVersion: nextVersionNum,
        versions: nextVersions,
        zoom: null,
        pan: { x: 0, y: 0 },
      };
      nextFiles[existingIdx] = updated;
      targetFile = updated;
    } else {
      const created: VfsGraphFile = {
        id: `file-${randomToken(8)}`,
        path: relPath,
        title: displayTitle,
        diagramType: params.diagramType ?? null,
        unread: !params.autoFocus,
        isWelcome: false,
        currentVersion: 1,
        versions: [
          {
            version: 1,
            code: params.code,
            ...(incomingGuide ? { guide: incomingGuide } : {}),
            authorSlug,
            authorLabel,
            authorBadge,
            ...(params.agentSessionId
              ? { agentSessionId: params.agentSessionId }
              : {}),
            createdAt: now,
          },
        ],
        zoom: null,
        pan: { x: 0, y: 0 },
      };
      nextFiles.push(created);
      targetFile = created;
    }

    return {
      ...proj,
      expanded: true,
      updatedAt: now,
      files: nextFiles,
    };
  });

  let openTabIds = alloc.nextState.openTabIds.filter(
    (id) => !removedWelcomeIds.includes(id)
  );
  if (
    (params.autoOpenTab || openTabIds.includes(targetFile.id)) &&
    !openTabIds.includes(targetFile.id)
  ) {
    openTabIds = [...openTabIds, targetFile.id];
  }

  const nextActiveFileId =
    params.autoFocus ||
    !alloc.nextState.activeFileId ||
    removedWelcomeIds.includes(alloc.nextState.activeFileId)
      ? targetFile.id
      : alloc.nextState.activeFileId;

  const nextState = normalizeWorkspaceConsistency({
    ...alloc.nextState,
    projects,
    openTabIds,
    activeFileId: nextActiveFileId,
  });

  return { nextState, file: targetFile, projectKey };
}

/**
 * Applies a human edit in CodeMirror while preserving agent versions immutably
 * (coalesces rapid consecutive human keystrokes within 45s into the active `'you'` head version).
 */
export function editGraphByHuman(
  state: WorkspaceState,
  fileId: string,
  nextCode: string
): WorkspaceState {
  const now = Date.now();

  const projects = state.projects.map((p) => {
    const idx = p.files.findIndex((f) => f.id === fileId);
    if (idx < 0) return p;

    const file = p.files[idx]!;
    const head = getHeadVersion(file);
    if (head.code === nextCode) return p;

    let nextVersionNum = file.currentVersion;
    let nextVersions: GraphVersionRecord[];

    const canCoalesceKeystroke =
      head.authorSlug === 'user' &&
      !file.isWelcome &&
      now - head.createdAt < HUMAN_EDIT_COALESCE_MS;

    if (canCoalesceKeystroke) {
      nextVersions = [
        ...file.versions.slice(0, -1),
        {
          ...head,
          code: nextCode,
          createdAt: now,
        },
      ];
    } else {
      nextVersionNum = file.currentVersion + 1;
      nextVersions = [
        ...file.versions,
        {
          version: nextVersionNum,
          code: nextCode,
          ...(head.guide ? { guide: head.guide } : {}),
          authorSlug: 'user',
          authorLabel: 'You',
          authorBadge: 'you',
          createdAt: now,
        },
      ].slice(-MAX_GRAPH_VERSIONS);
    }

    const updatedFile: VfsGraphFile = {
      ...file,
      isWelcome: false,
      currentVersion: nextVersionNum,
      versions: nextVersions,
    };

    const nextFiles = [...p.files];
    nextFiles[idx] = updatedFile;
    return {
      ...p,
      updatedAt: now,
      files: nextFiles,
    };
  });

  return { ...state, projects };
}

/**
 * Restores an earlier immutable version by appending a new head revision with its code.
 */
export function restoreGraphVersion(
  state: WorkspaceState,
  fileId: string,
  versionToRestore: number
): { nextState: WorkspaceState; restoredCode: string | null } {
  const now = Date.now();
  let restoredCode: string | null = null;

  const projects = state.projects.map((p) => {
    const idx = p.files.findIndex((f) => f.id === fileId);
    if (idx < 0) return p;

    const file = p.files[idx]!;
    const targetRec = file.versions.find((v) => v.version === versionToRestore);
    if (!targetRec) return p;

    restoredCode = targetRec.code;
    const head = getHeadVersion(file);
    if (
      head.code === targetRec.code &&
      serializeGuideCanonical(head.guide) === serializeGuideCanonical(targetRec.guide)
    ) {
      return p;
    }

    const nextVer = file.currentVersion + 1;
    const nextVersions = [
      ...file.versions,
      {
        version: nextVer,
        code: targetRec.code,
        ...(targetRec.guide ? { guide: targetRec.guide } : {}),
        authorSlug: 'user',
        authorLabel: 'You',
        authorBadge: 'you',
        createdAt: now,
      },
    ].slice(-MAX_GRAPH_VERSIONS);

    const nextFiles = [...p.files];
    nextFiles[idx] = {
      ...file,
      currentVersion: nextVer,
      versions: nextVersions,
      zoom: null,
      pan: { x: 0, y: 0 },
    };

    return {
      ...p,
      updatedAt: now,
      files: nextFiles,
    };
  });

  return {
    nextState: { ...state, projects },
    restoredCode,
  };
}

// ============================================================================
// Browser VFS RPC Evaluators (`ls`, `read`, `mv` — strictly jailed per project)
// ============================================================================

export function evaluateVfsLs(
  state: WorkspaceState,
  projectName: string,
  rawDirPath?: string
): VfsLsResult {
  const cleanProject = normalizeProjectName(projectName) || 'General';
  const projKey = toProjectKey(cleanProject);
  const dirPath = normalizeRelativeDirPath(rawDirPath);
  const prefix = dirPath ? `${dirPath}/` : '';

  const proj = state.projects.find((p) => p.projectKey === projKey);
  if (!proj) {
    return {
      project: cleanProject,
      cwd: dirPath ? `/${dirPath}` : '/',
      entries: [],
      treeText: `${cleanProject}/${dirPath ? `${dirPath}/` : ''}\n  (empty working directory)`,
    };
  }

  const childDirs = new Set<string>();
  const childFiles: VfsGraphFile[] = [];

  for (const folder of proj.folders) {
    if (!dirPath) {
      const firstSeg = folder.split('/')[0];
      if (firstSeg) childDirs.add(firstSeg);
    } else if (folder.startsWith(prefix)) {
      const rest = folder.slice(prefix.length);
      const firstSeg = rest.split('/')[0];
      if (firstSeg) childDirs.add(firstSeg);
    }
  }

  for (const file of proj.files) {
    if (!dirPath) {
      const slashIdx = file.path.indexOf('/');
      if (slashIdx < 0) {
        childFiles.push(file);
      } else {
        childDirs.add(file.path.slice(0, slashIdx));
      }
    } else if (file.path.startsWith(prefix)) {
      const rest = file.path.slice(prefix.length);
      const slashIdx = rest.indexOf('/');
      if (slashIdx < 0) {
        childFiles.push(file);
      } else {
        childDirs.add(rest.slice(0, slashIdx));
      }
    }
  }

  const sortedDirs = Array.from(childDirs).sort((a, b) => a.localeCompare(b));
  const sortedFiles = [...childFiles].sort((a, b) => a.path.localeCompare(b.path));

  const entries: VfsLsEntry[] = [
    ...sortedDirs.map((name) => ({
      name,
      path: dirPath ? `${dirPath}/${name}` : name,
      kind: 'dir' as const,
    })),
    ...sortedFiles.map((f) => {
      const head = getHeadVersion(f);
      const baseName = f.path.split('/').pop() || f.path;
      const stepCount = head.guide?.steps?.length ?? 0;
      const nodeNoteCount = head.guide?.nodes ? Object.keys(head.guide.nodes).length : 0;
      return {
        name: baseName,
        path: f.path,
        kind: 'file' as const,
        diagramType: f.diagramType,
        currentVersion: f.currentVersion,
        author: head.authorBadge,
        updatedAt: head.createdAt,
        ...(stepCount > 0 ? { stepCount } : {}),
        ...(nodeNoteCount > 0 ? { nodeNoteCount } : {}),
      };
    }),
  ];

  // Build concise full subtree ASCII overview for LLM context
  const treeLines: string[] = [`${proj.projectLabel}/${dirPath ? `${dirPath}/` : ''}`];
  const subtreeRoot = buildExplorerSubtree(proj, dirPath);
  const renderNode = (node: ExplorerFolderNode, indent: string) => {
    for (const sub of node.folders) {
      treeLines.push(`${indent}${sub.name}/`);
      renderNode(sub, `${indent}  `);
    }
    for (const f of node.files) {
      const head = getHeadVersion(f);
      const baseName = f.path.split('/').pop() || f.path;
      const typeNote = f.diagramType ? `${f.diagramType}, ` : '';
      const stepCount = head.guide?.steps?.length ?? 0;
      const guideNote = stepCount > 0 ? `, ${stepCount} steps` : '';
      treeLines.push(
        `${indent}${baseName}  (${typeNote}v${f.currentVersion}, by ${head.authorBadge}${guideNote})`
      );
    }
  };
  renderNode(subtreeRoot, '  ');
  if (treeLines.length === 1) {
    treeLines.push('  (empty directory)');
  }

  return {
    project: proj.projectLabel,
    cwd: dirPath ? `/${dirPath}` : '/',
    entries,
    treeText: treeLines.join('\n'),
  };
}

export function evaluateVfsRead(
  state: WorkspaceState,
  projectName: string,
  rawFilePath: string,
  requestedVersion?: number
): VfsReadResult {
  const cleanProject = normalizeProjectName(projectName) || 'General';
  const projKey = toProjectKey(cleanProject);
  const filePath = normalizeRelativeGraphPath(rawFilePath);

  const proj = state.projects.find((p) => p.projectKey === projKey);
  const file = proj?.files.find((f) => f.path === filePath);

  if (!proj || !file) {
    throw new Error(
      `ENOENT: Graph "${filePath}" not found in working directory "${cleanProject}". Call \`mermaid_ls\` to see available paths.`
    );
  }

  let targetRec: GraphVersionRecord | undefined;
  if (typeof requestedVersion === 'number') {
    targetRec = file.versions.find((v) => v.version === requestedVersion);
    if (!targetRec) {
      const available = file.versions.map((v) => `v${v.version}`).join(', ');
      throw new Error(
        `Version v${requestedVersion} is not in the 5-version history buffer for "${filePath}". Available versions: ${available}.`
      );
    }
  } else {
    targetRec = getHeadVersion(file);
  }

  return {
    project: proj.projectLabel,
    path: file.path,
    title: file.title,
    diagramType: file.diagramType,
    requestedVersion: targetRec.version,
    currentVersion: file.currentVersion,
    code: targetRec.code,
    ...(targetRec.guide ? { guide: targetRec.guide } : {}),
    author: targetRec.authorBadge,
    updatedAt: targetRec.createdAt,
    versions: file.versions.map((v) => ({
      version: v.version,
      author: v.authorBadge,
      authorLabel: v.authorLabel,
      createdAt: v.createdAt,
    })),
  };
}

export function movePathInProject(
  state: WorkspaceState,
  projectNameOrKey: string,
  rawFrom: string,
  rawTo: string
): { nextState: WorkspaceState; result: VfsMoveResult } {
  const cleanProject = normalizeProjectName(projectNameOrKey) || projectNameOrKey;
  const projKey = toProjectKey(cleanProject);
  const projIdx = state.projects.findIndex((p) => p.projectKey === projKey);

  if (projIdx < 0) {
    throw new Error(`Working directory "${cleanProject}" has no files to move.`);
  }

  const proj = state.projects[projIdx]!;
  const now = Date.now();

  // Check if `rawFrom` matches an exact `.mmd` file first
  const candidateFileFrom = normalizeRelativeGraphPath(rawFrom);
  const exactFileIdx = proj.files.findIndex((f) => f.path === candidateFileFrom);

  if (exactFileIdx >= 0) {
    const destFilePath = normalizeRelativeGraphPath(rawTo);
    if (destFilePath === candidateFileFrom) {
      return {
        nextState: state,
        result: {
          project: proj.projectLabel,
          fromPath: candidateFileFrom,
          toPath: destFilePath,
          movedFiles: 0,
        },
      };
    }

    if (proj.files.some((f, i) => i !== exactFileIdx && f.path === destFilePath)) {
      throw new Error(
        `EEXIST: Destination graph "${destFilePath}" already exists. Choose a distinct path.`
      );
    }

    const rewriteSingleFile = (oldPath: string) =>
      oldPath === candidateFileFrom ? destFilePath : oldPath;

    const nextFiles = proj.files.map((f, idx) => {
      const base =
        idx === exactFileIdx
          ? {
              ...f,
              path: destFilePath,
              title: graphTitleFromPath(destFilePath),
            }
          : f;
      return {
        ...base,
        versions: base.versions.map((v) => {
          const rewritten = rewriteGuidePaths(v.guide, rewriteSingleFile);
          return rewritten !== v.guide ? { ...v, guide: rewritten } : v;
        }),
      };
    });

    const nextProjects = [...state.projects];
    nextProjects[projIdx] = {
      ...proj,
      updatedAt: now,
      files: nextFiles,
    };

    return {
      nextState: { ...state, projects: nextProjects },
      result: {
        project: proj.projectLabel,
        fromPath: candidateFileFrom,
        toPath: destFilePath,
        movedFiles: 1,
      },
    };
  }

  // Otherwise treat as directory move (`fromDir/*` -> `toDir/*`)
  const fromDir = normalizeRelativeDirPath(rawFrom);
  const toDir = normalizeRelativeDirPath(rawTo);
  if (!fromDir || !toDir) {
    throw new Error(`ENOENT: Path "${rawFrom}" not found in "${proj.projectLabel}".`);
  }

  const fromPrefix = `${fromDir}/`;
  const matchingFiles = proj.files.filter((f) => f.path.startsWith(fromPrefix));
  const matchingFolders = proj.folders.filter(
    (d) => d === fromDir || d.startsWith(fromPrefix)
  );

  if (matchingFiles.length === 0 && matchingFolders.length === 0) {
    throw new Error(`ENOENT: Path "${rawFrom}" not found in "${proj.projectLabel}".`);
  }

  const rewriteDirFile = (oldPath: string) =>
    oldPath.startsWith(fromPrefix)
      ? `${toDir}/${oldPath.slice(fromPrefix.length)}`
      : oldPath;

  const nextFiles = proj.files.map((f) => {
    const movedBase = f.path.startsWith(fromPrefix)
      ? { ...f, path: `${toDir}/${f.path.slice(fromPrefix.length)}` }
      : f;
    return {
      ...movedBase,
      versions: movedBase.versions.map((v) => {
        const rewritten = rewriteGuidePaths(v.guide, rewriteDirFile);
        return rewritten !== v.guide ? { ...v, guide: rewritten } : v;
      }),
    };
  });

  const nextFolderSet = new Set<string>();
  for (const d of proj.folders) {
    if (d === fromDir) {
      nextFolderSet.add(toDir);
    } else if (d.startsWith(fromPrefix)) {
      nextFolderSet.add(`${toDir}/${d.slice(fromPrefix.length)}`);
    } else {
      nextFolderSet.add(d);
    }
  }

  const nextProjects = [...state.projects];
  nextProjects[projIdx] = {
    ...proj,
    updatedAt: now,
    folders: Array.from(nextFolderSet),
    files: nextFiles,
  };

  return {
    nextState: { ...state, projects: nextProjects },
    result: {
      project: proj.projectLabel,
      fromPath: fromDir,
      toPath: toDir,
      movedFiles: matchingFiles.length,
    },
  };
}

// ============================================================================
// Explorer Tree Builder (Folders sorted first, then Files alphabetically)
// ============================================================================

export function buildExplorerSubtree(
  project: VfsProjectRoot,
  baseDir = ''
): ExplorerFolderNode {
  const root: ExplorerFolderNode = {
    kind: 'folder',
    name: baseDir.split('/').pop() || project.projectLabel,
    path: baseDir,
    folders: [],
    files: [],
  };

  const folderMap = new Map<string, ExplorerFolderNode>();
  folderMap.set(baseDir, root);

  const ensureFolderChain = (relDir: string): ExplorerFolderNode => {
    if (!relDir) return root;
    if (folderMap.has(relDir)) return folderMap.get(relDir)!;

    const parts = relDir.split('/').filter(Boolean);
    let currentPath = '';
    let parentNode = root;

    for (const seg of parts) {
      currentPath = currentPath ? `${currentPath}/${seg}` : seg;
      if (baseDir && !currentPath.startsWith(baseDir)) {
        continue;
      }
      if (currentPath === baseDir) {
        parentNode = root;
        continue;
      }
      let node = folderMap.get(currentPath);
      if (!node) {
        node = {
          kind: 'folder',
          name: seg,
          path: currentPath,
          folders: [],
          files: [],
        };
        folderMap.set(currentPath, node);
        parentNode.folders.push(node);
      }
      parentNode = node;
    }

    return parentNode;
  };

  const prefix = baseDir ? `${baseDir}/` : '';

  for (const dir of project.folders) {
    if (!baseDir || dir === baseDir || dir.startsWith(prefix)) {
      ensureFolderChain(dir);
    }
  }

  for (const file of project.files) {
    if (baseDir && !file.path.startsWith(prefix)) continue;
    const parentDir = parentDirOfPath(file.path);
    const folderNode = ensureFolderChain(parentDir);
    folderNode.files.push(file);
  }

  const sortRecursive = (node: ExplorerFolderNode) => {
    node.folders.sort((a, b) => a.name.localeCompare(b.name));
    node.files.sort((a, b) => {
      const aName = a.path.split('/').pop() || a.path;
      const bName = b.path.split('/').pop() || b.path;
      return aName.localeCompare(bName);
    });
    for (const sub of node.folders) {
      sortRecursive(sub);
    }
  };

  sortRecursive(root);
  return root;
}
