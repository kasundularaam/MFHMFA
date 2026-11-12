import { normalizeProjectName } from '../agentIdentity.js';
import type { VfsLsEntry, VfsLsResult, VfsReadResult } from '../types.js';
import { normalizeRelativeDirPath, normalizeRelativeGraphPath } from '../vfsPath.js';
import { buildExplorerSubtree } from './hierarchy.js';
import { getHeadVersion, toProjectKey } from './operations.js';
import type {
  ExplorerFileTreeNode,
  ExplorerFolderNode,
  GraphVersionRecord,
  VfsGraphFile,
  WorkspaceState,
} from './types.js';

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

  const treeLines: string[] = [`${proj.projectLabel}/${dirPath ? `${dirPath}/` : ''}`];
  const subtreeRoot = buildExplorerSubtree(proj, dirPath);
  const renderFileNodeLine = (
    fNode: ExplorerFileTreeNode,
    indent: string,
    isNestedChild: boolean
  ) => {
    const f = fNode.file;
    const head = getHeadVersion(f);
    const baseName = f.path.split('/').pop() || f.path;
    const typeNote = f.diagramType ? `${f.diagramType}, ` : '';
    const stepCount = head.guide?.steps?.length ?? 0;
    const guideNote = stepCount > 0 ? `, ${stepCount} steps` : '';
    const prefixGlyph = isNestedChild ? '↳ ' : '';
    treeLines.push(
      `${indent}${prefixGlyph}${baseName}  (${typeNote}v${f.currentVersion}, by ${head.authorBadge}${guideNote})`
    );
    for (const child of fNode.children) {
      renderFileNodeLine(child, `${indent}  `, true);
    }
  };
  const renderNode = (node: ExplorerFolderNode, indent: string) => {
    for (const sub of node.folders) {
      treeLines.push(`${indent}${sub.name}/`);
      renderNode(sub, `${indent}  `);
    }
    for (const fNode of node.fileTree) {
      renderFileNodeLine(fNode, indent, false);
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
