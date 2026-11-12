import { produce } from 'immer';
import { normalizeAgentIdentity, normalizeProjectName } from '../agentIdentity.js';
import {
  rewriteGuidePaths,
  sanitizeComprehensionGuide,
  serializeGuideCanonical,
} from '../comprehension.js';
import { randomToken, slugify } from '../strings.js';
import type { DiagramComprehensionGuide, VfsMoveResult } from '../types.js';
import {
  graphTitleFromPath,
  normalizeRelativeDirPath,
  normalizeRelativeGraphPath,
} from '../vfsPath.js';
import { resolveProjectGraphHierarchy } from './hierarchy.js';
import {
  AGENT_ITERATION_COALESCE_MS,
  GENERAL_PROJECT_KEY,
  HUMAN_EDIT_COALESCE_MS,
  MAX_GRAPH_VERSIONS,
  SCRATCHPAD_PROJECT_KEY,
  type GraphVersionRecord,
  type VfsGraphFile,
  type VfsProjectRoot,
  type WorkspaceState,
} from './types.js';
import { WELCOME_CODE, WELCOME_GUIDE } from './welcome.js';

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

export function createDefaultScratchpadProject(
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

export function createFreshWorkspaceState(
  workspaceId: string,
  now = Date.now(),
  legacyCode?: string | null
): WorkspaceState {
  const scratchpad = createDefaultScratchpadProject(now, legacyCode);
  const welcomeId = scratchpad.files[0]!.id;
  return {
    version: 4,
    workspaceId,
    sidebarOpen: true,
    sidebarWidth: 268,
    openTabIds: [welcomeId],
    activeFileId: welcomeId,
    projects: [scratchpad],
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
    state.activeFileId && existingFileIds.has(state.activeFileId) ? state.activeFileId : null;

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

/**
 * Allocates a project working directory in the VFS when an MCP connects,
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

  const mutated = produce(state, (draft) => {
    let migratedFiles: VfsGraphFile[] = [];
    let migratedFolders: string[] = [];

    if (
      params.previousProjectKey &&
      params.previousProjectKey !== targetKey &&
      params.previousProjectKey === GENERAL_PROJECT_KEY
    ) {
      const genIdx = draft.projects.findIndex((p) => p.projectKey === GENERAL_PROJECT_KEY);
      if (genIdx >= 0) {
        const gen = draft.projects[genIdx]!;
        migratedFiles = gen.files;
        migratedFolders = gen.folders;
        draft.projects.splice(genIdx, 1);
      }
    }

    const existing = draft.projects.find((p) => p.projectKey === targetKey);
    if (!existing) {
      draft.projects.push({
        projectKey: targetKey,
        projectLabel: cleanLabel,
        expanded: true,
        folders: migratedFolders,
        files: migratedFiles,
        createdAt: now,
        updatedAt: now,
      });
    } else if (migratedFiles.length > 0 || migratedFolders.length > 0) {
      for (const mf of migratedFiles) {
        if (!existing.files.some((f) => f.path === mf.path)) {
          existing.files.push(mf);
        }
      }
      existing.folders = Array.from(new Set([...existing.folders, ...migratedFolders]));
      existing.expanded = true;
      existing.updatedAt = now;
    }
  });

  return {
    nextState: normalizeWorkspaceConsistency(mutated),
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
  const authorBadge = toAuthorBadge(authorSlug, params.agentShortLabel || normAgent.shortLabel);

  let targetFileId = '';

  const nextDraftState = produce(alloc.nextState, (draft) => {
    const removedWelcomeIds: string[] = [];

    // Remove untouched Welcome scratchpad once a real project diagram arrives
    draft.projects = draft.projects.filter((p) => {
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

    const proj = draft.projects.find((p) => p.projectKey === projectKey)!;
    const existingIdx = proj.files.findIndex((f) => f.path === relPath);

    if (existingIdx >= 0) {
      const prev = proj.files[existingIdx]!;
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
              ...(params.agentSessionId ? { agentSessionId: params.agentSessionId } : {}),
              createdAt: now,
            },
          ];
        } else {
          nextVersionNum = prev.currentVersion + 1;
          nextVersions = [
            ...prev.versions,
            {
              version: nextVersionNum,
              code: params.code,
              ...(incomingGuide ? { guide: incomingGuide } : {}),
              authorSlug,
              authorLabel,
              authorBadge,
              ...(params.agentSessionId ? { agentSessionId: params.agentSessionId } : {}),
              createdAt: now,
            },
          ].slice(-MAX_GRAPH_VERSIONS);
        }
      }

      prev.title = displayTitle;
      prev.diagramType = params.diagramType ?? prev.diagramType;
      prev.unread = !params.autoFocus && !isSelected;
      prev.isWelcome = false;
      prev.currentVersion = nextVersionNum;
      prev.versions = nextVersions;
      prev.zoom = null;
      prev.pan = { x: 0, y: 0 };
      targetFileId = prev.id;
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
            ...(params.agentSessionId ? { agentSessionId: params.agentSessionId } : {}),
            createdAt: now,
          },
        ],
        zoom: null,
        pan: { x: 0, y: 0 },
      };
      proj.files.push(created);
      targetFileId = created.id;
    }

    proj.expanded = true;
    proj.updatedAt = now;

    const hierarchy = resolveProjectGraphHierarchy(proj);
    const targetFile = proj.files.find((f) => f.id === targetFileId)!;
    const rootFile = hierarchy.getRootForFile(targetFile.id) || targetFile;
    const hasParentInProject = rootFile.id !== targetFile.id;
    const declaredPendingParent = Boolean(
      !hasParentInProject && getHeadVersion(targetFile).guide?.parentPath
    );

    const descendantIds = new Set<string>();
    const stack = [...(hierarchy.childrenByFileId.get(targetFile.id) ?? [])];
    while (stack.length > 0) {
      const child = stack.pop()!;
      if (descendantIds.has(child.id)) continue;
      descendantIds.add(child.id);
      for (const grand of hierarchy.childrenByFileId.get(child.id) ?? []) {
        stack.push(grand);
      }
    }

    if (authorSlug !== 'user' && (hasParentInProject || declaredPendingParent)) {
      targetFile.unread = false;
    }

    let openTabIds = draft.openTabIds.filter((id) => !removedWelcomeIds.includes(id));
    const priorActiveId =
      draft.activeFileId && !removedWelcomeIds.includes(draft.activeFileId)
        ? draft.activeFileId
        : null;
    let nextActiveFileId = priorActiveId;

    if (authorSlug === 'user') {
      if (
        (params.autoOpenTab || openTabIds.includes(targetFile.id)) &&
        !openTabIds.includes(targetFile.id)
      ) {
        openTabIds.push(targetFile.id);
      }
      if (params.autoFocus || !nextActiveFileId) {
        nextActiveFileId = targetFile.id;
      }
    } else if (hasParentInProject) {
      if (params.autoOpenTab && !openTabIds.includes(rootFile.id)) {
        openTabIds.push(rootFile.id);
      }
      if (params.autoFocus || !nextActiveFileId) {
        nextActiveFileId = rootFile.id;
      }
    } else if (descendantIds.size > 0) {
      openTabIds = openTabIds.filter((id) => !descendantIds.has(id));
      if (
        (params.autoOpenTab || openTabIds.includes(targetFile.id) || openTabIds.length === 0) &&
        !openTabIds.includes(targetFile.id)
      ) {
        openTabIds.push(targetFile.id);
      }
      if (params.autoFocus || !nextActiveFileId || descendantIds.has(nextActiveFileId)) {
        nextActiveFileId = targetFile.id;
      }
    } else if (declaredPendingParent && priorActiveId) {
      nextActiveFileId = priorActiveId;
    } else {
      if (
        (params.autoOpenTab || openTabIds.includes(targetFile.id)) &&
        !openTabIds.includes(targetFile.id)
      ) {
        openTabIds.push(targetFile.id);
      }
      if (params.autoFocus || !nextActiveFileId) {
        nextActiveFileId = targetFile.id;
      }
    }

    draft.openTabIds = openTabIds;
    draft.activeFileId = nextActiveFileId;
  });

  const normalized = normalizeWorkspaceConsistency(nextDraftState);
  const file = findFileWithProject(normalized, targetFileId)!.file;
  return { nextState: normalized, file, projectKey };
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

  return produce(state, (draft) => {
    for (const p of draft.projects) {
      const file = p.files.find((f) => f.id === fileId);
      if (!file) continue;

      const head = getHeadVersion(file);
      if (head.code === nextCode) return;

      const canCoalesceKeystroke =
        head.authorSlug === 'user' &&
        !file.isWelcome &&
        now - head.createdAt < HUMAN_EDIT_COALESCE_MS;

      if (canCoalesceKeystroke) {
        const last = file.versions[file.versions.length - 1]!;
        last.code = nextCode;
        last.createdAt = now;
      } else {
        const nextVersionNum = file.currentVersion + 1;
        file.currentVersion = nextVersionNum;
        file.versions.push({
          version: nextVersionNum,
          code: nextCode,
          ...(head.guide ? { guide: head.guide } : {}),
          authorSlug: 'user',
          authorLabel: 'You',
          authorBadge: 'you',
          createdAt: now,
        });
        if (file.versions.length > MAX_GRAPH_VERSIONS) {
          file.versions.splice(0, file.versions.length - MAX_GRAPH_VERSIONS);
        }
      }

      file.isWelcome = false;
      p.updatedAt = now;
      return;
    }
  });
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

  const nextState = produce(state, (draft) => {
    for (const p of draft.projects) {
      const file = p.files.find((f) => f.id === fileId);
      if (!file) continue;

      const targetRec = file.versions.find((v) => v.version === versionToRestore);
      if (!targetRec) return;

      restoredCode = targetRec.code;
      const head = getHeadVersion(file);
      if (
        head.code === targetRec.code &&
        serializeGuideCanonical(head.guide) === serializeGuideCanonical(targetRec.guide)
      ) {
        return;
      }

      const nextVer = file.currentVersion + 1;
      file.currentVersion = nextVer;
      file.versions.push({
        version: nextVer,
        code: targetRec.code,
        ...(targetRec.guide ? { guide: targetRec.guide } : {}),
        authorSlug: 'user',
        authorLabel: 'You',
        authorBadge: 'you',
        createdAt: now,
      });
      if (file.versions.length > MAX_GRAPH_VERSIONS) {
        file.versions.splice(0, file.versions.length - MAX_GRAPH_VERSIONS);
      }
      file.zoom = null;
      file.pan = { x: 0, y: 0 };
      p.updatedAt = now;
      return;
    }
  });

  return { nextState, restoredCode };
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

  // 1. Check exact `.mmd` file match first
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

    const nextState = produce(state, (draft) => {
      const p = draft.projects[projIdx]!;
      p.updatedAt = now;
      p.files.forEach((f, idx) => {
        if (idx === exactFileIdx) {
          f.path = destFilePath;
          f.title = graphTitleFromPath(destFilePath);
        }
        f.versions.forEach((v) => {
          const rewritten = rewriteGuidePaths(v.guide, rewriteSingleFile);
          if (rewritten !== v.guide) {
            v.guide = rewritten;
          }
        });
      });
    });

    return {
      nextState,
      result: {
        project: proj.projectLabel,
        fromPath: candidateFileFrom,
        toPath: destFilePath,
        movedFiles: 1,
      },
    };
  }

  // 2. Otherwise treat as directory move (`fromDir/*` -> `toDir/*`)
  const fromDir = normalizeRelativeDirPath(rawFrom);
  const toDir = normalizeRelativeDirPath(rawTo);
  if (!fromDir || !toDir) {
    throw new Error(`ENOENT: Path "${rawFrom}" not found in "${proj.projectLabel}".`);
  }

  const fromPrefix = `${fromDir}/`;
  const matchingFiles = proj.files.filter((f) => f.path.startsWith(fromPrefix));
  const matchingFolders = proj.folders.filter((d) => d === fromDir || d.startsWith(fromPrefix));

  if (matchingFiles.length === 0 && matchingFolders.length === 0) {
    throw new Error(`ENOENT: Path "${rawFrom}" not found in "${proj.projectLabel}".`);
  }

  const rewriteDirFile = (oldPath: string) =>
    oldPath.startsWith(fromPrefix) ? `${toDir}/${oldPath.slice(fromPrefix.length)}` : oldPath;

  const nextState = produce(state, (draft) => {
    const p = draft.projects[projIdx]!;
    p.updatedAt = now;
    p.files.forEach((f) => {
      if (f.path.startsWith(fromPrefix)) {
        f.path = `${toDir}/${f.path.slice(fromPrefix.length)}`;
      }
      f.versions.forEach((v) => {
        const rewritten = rewriteGuidePaths(v.guide, rewriteDirFile);
        if (rewritten !== v.guide) {
          v.guide = rewritten;
        }
      });
    });

    const nextFolderSet = new Set<string>();
    for (const d of p.folders) {
      if (d === fromDir) {
        nextFolderSet.add(toDir);
      } else if (d.startsWith(fromPrefix)) {
        nextFolderSet.add(`${toDir}/${d.slice(fromPrefix.length)}`);
      } else {
        nextFolderSet.add(d);
      }
    }
    p.folders = Array.from(nextFolderSet);
  });

  return {
    nextState,
    result: {
      project: proj.projectLabel,
      fromPath: fromDir,
      toPath: toDir,
      movedFiles: matchingFiles.length,
    },
  };
}

export function deleteGraphFromProject(
  state: WorkspaceState,
  projectKey: string,
  fileId: string
): WorkspaceState {
  const mutated = produce(state, (draft) => {
    const proj = draft.projects.find((p) => p.projectKey === projectKey);
    if (!proj) return;
    proj.updatedAt = Date.now();
    proj.files = proj.files.filter((f) => f.id !== fileId);
    draft.openTabIds = draft.openTabIds.filter((id) => id !== fileId);
    if (draft.activeFileId === fileId) {
      draft.activeFileId = null;
    }
  });
  return normalizeWorkspaceConsistency(mutated);
}

export function deleteFolderFromProject(
  state: WorkspaceState,
  projectKey: string,
  folderPath: string
): WorkspaceState {
  const prefix = `${folderPath}/`;
  const mutated = produce(state, (draft) => {
    const proj = draft.projects.find((p) => p.projectKey === projectKey);
    if (!proj) return;
    const removedIds = new Set<string>();
    for (const f of proj.files) {
      if (f.path.startsWith(prefix)) removedIds.add(f.id);
    }
    proj.updatedAt = Date.now();
    proj.folders = proj.folders.filter((d) => d !== folderPath && !d.startsWith(prefix));
    proj.files = proj.files.filter((f) => !f.path.startsWith(prefix));
    draft.openTabIds = draft.openTabIds.filter((id) => !removedIds.has(id));
    if (draft.activeFileId && removedIds.has(draft.activeFileId)) {
      draft.activeFileId = null;
    }
  });
  return normalizeWorkspaceConsistency(mutated);
}

export function deleteProjectFromWorkspace(
  state: WorkspaceState,
  projectKey: string
): WorkspaceState {
  const mutated = produce(state, (draft) => {
    const target = draft.projects.find((p) => p.projectKey === projectKey);
    const removedIds = new Set(target?.files.map((f) => f.id) ?? []);
    draft.projects = draft.projects.filter((p) => p.projectKey !== projectKey);

    if (draft.projects.length === 0) {
      const now = Date.now();
      draft.projects.push({
        projectKey: SCRATCHPAD_PROJECT_KEY,
        projectLabel: 'scratchpad',
        isScratchpad: true,
        expanded: true,
        folders: [],
        files: [],
        createdAt: now,
        updatedAt: now,
      });
    }

    draft.openTabIds = draft.openTabIds.filter((id) => !removedIds.has(id));
    if (draft.activeFileId && removedIds.has(draft.activeFileId)) {
      draft.activeFileId = null;
    }
  });
  return normalizeWorkspaceConsistency(mutated);
}
