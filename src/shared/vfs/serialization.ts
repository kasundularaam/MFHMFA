import { randomToken } from '../strings.js';
import { graphTitleFromPath, inferPathFromTitle } from '../vfsPath.js';
import { normalizeWorkspaceConsistency, toAuthorBadge } from './operations.js';
import {
  MAX_GRAPH_VERSIONS,
  PersistedWorkspaceV4Schema,
  type PersistedWorkspaceV4,
  SCRATCHPAD_PROJECT_KEY,
  type VfsGraphFile,
  type VfsProjectRoot,
  type WorkspaceState,
} from './types.js';

export function toPersistedWorkspaceV4(state: WorkspaceState): PersistedWorkspaceV4 {
  return {
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
}

export function hydrateWorkspaceFromPersistedV4(
  raw: unknown,
  workspaceId: string,
  now = Date.now()
): WorkspaceState | null {
  const parsed = PersistedWorkspaceV4Schema.safeParse(raw);
  if (!parsed.success) return null;
  const data = parsed.data;

  const projects: VfsProjectRoot[] = data.projects.map((p) => ({
    projectKey: p.projectKey,
    projectLabel: p.projectLabel || p.projectKey,
    isScratchpad: Boolean(p.isScratchpad),
    expanded: p.expanded,
    folders: p.folders.filter(Boolean),
    createdAt: p.createdAt ?? now,
    updatedAt: p.updatedAt ?? now,
    files: p.files.map((f) => ({
      id: f.id || `file-${randomToken(7)}`,
      path: f.path,
      title: f.title || graphTitleFromPath(f.path),
      diagramType: f.diagramType ?? null,
      unread: false,
      isWelcome: Boolean(f.isWelcome),
      currentVersion: f.currentVersion ?? f.versions[f.versions.length - 1]!.version ?? 1,
      versions: f.versions.slice(-MAX_GRAPH_VERSIONS).map((v) => ({
        version: v.version,
        code: v.code,
        ...(v.guide ? { guide: v.guide } : {}),
        authorSlug: v.authorSlug,
        authorLabel: v.authorLabel,
        authorBadge: v.authorBadge,
        ...(v.agentSessionId ? { agentSessionId: v.agentSessionId } : {}),
        createdAt: v.createdAt,
      })),
      zoom: null,
      pan: { x: 0, y: 0 },
    })),
  }));

  return normalizeWorkspaceConsistency({
    version: 4,
    workspaceId,
    sidebarOpen: data.sidebarOpen,
    sidebarWidth: Math.min(480, Math.max(210, data.sidebarWidth)),
    openTabIds: data.openTabIds,
    activeFileId: data.activeFileId,
    projects,
  });
}

export function migrateLegacyV3Workspace(
  raw: unknown,
  workspaceId: string,
  now = Date.now()
): WorkspaceState | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsedV3 = raw as {
    projects?: Array<{
      projectKey?: string;
      projectLabel?: string;
      isScratchpad?: boolean;
      agents?: Array<{
        agentKey?: string;
        agentLabel?: string;
        agentShortLabel?: string;
        tabs?: Array<{
          id?: string;
          tabKey?: string;
          title?: string;
          code?: string;
          isWelcome?: boolean;
          updatedAt?: number;
        }>;
      }>;
    }>;
  };
  if (!Array.isArray(parsedV3.projects) || parsedV3.projects.length === 0) {
    return null;
  }

  const openTabIds: string[] = [];
  const migratedProjects: VfsProjectRoot[] = parsedV3.projects
    .filter((p) => p && typeof p.projectKey === 'string')
    .map((p) => {
      const files: VfsGraphFile[] = [];
      const usedPaths = new Set<string>();

      for (const ag of p.agents ?? []) {
        const agentKey = ag.agentKey || 'agent';
        const agentLabel = ag.agentLabel || 'Agent';
        for (const t of ag.tabs ?? []) {
          if (typeof t?.code !== 'string') continue;
          let relPath = inferPathFromTitle(t.title || t.tabKey || 'diagram');
          if (usedPaths.has(relPath)) {
            relPath = `${agentKey}/${relPath}`;
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
                authorSlug: agentKey,
                authorLabel: agentLabel,
                authorBadge: toAuthorBadge(agentKey, ag.agentShortLabel),
                createdAt: t.updatedAt || now,
              },
            ],
            zoom: null,
            pan: { x: 0, y: 0 },
          });
        }
      }

      return {
        projectKey: p.projectKey!,
        projectLabel: p.projectLabel || p.projectKey!,
        isScratchpad: Boolean(p.isScratchpad),
        expanded: true,
        folders: [],
        files,
        createdAt: now,
        updatedAt: now,
      };
    });

  if (migratedProjects.length === 0) return null;

  return normalizeWorkspaceConsistency({
    version: 4,
    workspaceId,
    sidebarOpen: true,
    sidebarWidth: 256,
    openTabIds,
    activeFileId: openTabIds[0] ?? null,
    projects: migratedProjects,
  });
}

export function migrateLegacyV2Workspace(
  raw: unknown,
  workspaceId: string,
  now = Date.now()
): WorkspaceState | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsedV2 = raw as {
    tabs?: Array<{ id?: string; title?: string; code?: string; isWelcome?: boolean }>;
  };
  if (!Array.isArray(parsedV2.tabs) || parsedV2.tabs.length === 0) return null;

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

  if (files.length === 0) return null;
  const openIds = files.map((f) => f.id);
  return {
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
}
