import { normalizeRelativeGraphPath, parentDirOfPath } from '../vfsPath.js';
import { extractNodeLabelFromMermaid } from './mermaidLabels.js';
import { getHeadVersion } from './operations.js';
import type {
  ExplorerFileTreeNode,
  ExplorerFolderNode,
  GraphBreadcrumbHop,
  ParentComponentBranch,
  ProjectGraphHierarchy,
  VfsGraphFile,
  VfsProjectRoot,
} from './types.js';

function fileBaseName(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

export function resolveProjectGraphHierarchy(project: VfsProjectRoot): ProjectGraphHierarchy {
  const byId = new Map<string, VfsGraphFile>();
  const byPath = new Map<string, VfsGraphFile>();
  for (const f of project.files) {
    byId.set(f.id, f);
    byPath.set(f.path, f);
  }

  const parentByFileId = new Map<string, VfsGraphFile>();
  const childOrderHint = new Map<string, number>();
  const branchesByParentId = new Map<string, ParentComponentBranch[]>();
  const linkViaByChildId = new Map<string, { nodeId: string; componentLabel: string }>();

  const createsCycle = (parentId: string, childId: string): boolean => {
    let cur: string | undefined = parentId;
    const seen = new Set<string>();
    while (cur) {
      if (cur === childId) return true;
      if (seen.has(cur)) return true;
      seen.add(cur);
      cur = parentByFileId.get(cur)?.id;
    }
    return false;
  };

  // Pass 1: Parent `guide.nodes[*].childPath` links (preserves top-to-bottom visual box order + component labels)
  for (const parentFile of project.files) {
    const head = getHeadVersion(parentFile);
    const guide = head.guide;
    if (!guide?.nodes) continue;
    let idx = 0;
    const branches: ParentComponentBranch[] = [];

    for (const [nodeId, detail] of Object.entries(guide.nodes)) {
      if (!detail.childPath) continue;
      let normChild: string;
      try {
        normChild = normalizeRelativeGraphPath(detail.childPath);
      } catch {
        continue;
      }
      const childFile = byPath.get(normChild);
      if (!childFile || childFile.id === parentFile.id) continue;

      const componentLabel =
        detail.label?.trim() || extractNodeLabelFromMermaid(head.code, nodeId);

      branches.push({
        nodeId,
        componentLabel,
        childFile,
      });

      if (!parentByFileId.has(childFile.id) && !createsCycle(parentFile.id, childFile.id)) {
        parentByFileId.set(childFile.id, parentFile);
        childOrderHint.set(`${parentFile.id}::${childFile.id}`, idx++);
        linkViaByChildId.set(childFile.id, { nodeId, componentLabel });
      }
    }

    if (branches.length > 0) {
      branchesByParentId.set(parentFile.id, branches);
    }
  }

  // Pass 2: Child `guide.parentPath` links (works even if parent has not listed childPath yet)
  for (const childFile of project.files) {
    if (parentByFileId.has(childFile.id)) continue;
    const rawParent = getHeadVersion(childFile).guide?.parentPath;
    if (!rawParent) continue;
    let normParent: string;
    try {
      normParent = normalizeRelativeGraphPath(rawParent);
    } catch {
      continue;
    }
    const parentFile = byPath.get(normParent);
    if (!parentFile || parentFile.id === childFile.id) continue;
    if (!createsCycle(parentFile.id, childFile.id)) {
      parentByFileId.set(childFile.id, parentFile);
    }
  }

  const childrenByFileId = new Map<string, VfsGraphFile[]>();
  for (const [childId, parentFile] of parentByFileId.entries()) {
    const childFile = byId.get(childId);
    if (!childFile) continue;
    const list = childrenByFileId.get(parentFile.id) ?? [];
    list.push(childFile);
    childrenByFileId.set(parentFile.id, list);
  }

  for (const [parentId, list] of childrenByFileId.entries()) {
    list.sort((a, b) => {
      const oa = childOrderHint.get(`${parentId}::${a.id}`) ?? 9999;
      const ob = childOrderHint.get(`${parentId}::${b.id}`) ?? 9999;
      if (oa !== ob) return oa - ob;
      return fileBaseName(a.path).localeCompare(fileBaseName(b.path));
    });
  }

  const getAncestors = (fileId: string): VfsGraphFile[] => {
    const chain: VfsGraphFile[] = [];
    const seen = new Set<string>([fileId]);
    let cur = parentByFileId.get(fileId);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.unshift(cur);
      cur = parentByFileId.get(cur.id);
    }
    return chain;
  };

  const getBreadcrumbHops = (fileId: string): GraphBreadcrumbHop[] => {
    const ancestors = getAncestors(fileId);
    const self = byId.get(fileId);
    if (!self || ancestors.length === 0) return [];

    const fullPath = [...ancestors, self];
    const hops: GraphBreadcrumbHop[] = [];
    for (let i = 0; i < fullPath.length - 1; i++) {
      const pFile = fullPath[i]!;
      const cFile = fullPath[i + 1]!;
      const via = linkViaByChildId.get(cFile.id) ?? null;
      const siblingBranches = branchesByParentId.get(pFile.id) ?? [];
      hops.push({
        parentFile: pFile,
        viaNodeId: via?.nodeId ?? null,
        viaComponentLabel: via?.componentLabel ?? null,
        siblingBranches,
        childFile: cFile,
      });
    }
    return hops;
  };

  const getRootForFile = (fileId: string): VfsGraphFile | null => {
    const self = byId.get(fileId);
    if (!self) return null;
    const ancestors = getAncestors(fileId);
    return ancestors[0] ?? self;
  };

  return {
    parentByFileId,
    childrenByFileId,
    getAncestors,
    getBreadcrumbHops,
    getRootForFile,
  };
}

export function buildExplorerSubtree(
  project: VfsProjectRoot,
  baseDir = ''
): ExplorerFolderNode {
  const hierarchy = resolveProjectGraphHierarchy(project);

  const root: ExplorerFolderNode = {
    kind: 'folder',
    name: fileBaseName(baseDir) || project.projectLabel,
    path: baseDir,
    folders: [],
    files: [],
    fileTree: [],
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
          fileTree: [],
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

  const buildFileTreeNode = (
    file: VfsGraphFile,
    seen = new Set<string>()
  ): ExplorerFileTreeNode => {
    const nextSeen = new Set(seen);
    nextSeen.add(file.id);
    const rawChildren = hierarchy.childrenByFileId.get(file.id) ?? [];
    const childNodes = rawChildren
      .filter((c) => !nextSeen.has(c.id))
      .map((c) => buildFileTreeNode(c, nextSeen));
    const parent = hierarchy.parentByFileId.get(file.id) ?? null;

    return {
      file,
      children: childNodes,
      isRootOverview: parent === null && childNodes.length > 0,
      parentFileId: parent?.id ?? null,
    };
  };

  for (const file of project.files) {
    if (baseDir && !file.path.startsWith(prefix)) continue;

    const parentGraph = hierarchy.parentByFileId.get(file.id);
    const parentInSubtree = parentGraph && (!baseDir || parentGraph.path.startsWith(prefix));
    if (parentInSubtree) {
      continue;
    }

    const parentDir = parentDirOfPath(file.path);
    const folderNode = ensureFolderChain(parentDir);
    folderNode.files.push(file);
    folderNode.fileTree.push(buildFileTreeNode(file));
  }

  const sortRecursive = (node: ExplorerFolderNode) => {
    node.folders.sort((a, b) => a.name.localeCompare(b.name));
    node.files.sort((a, b) => fileBaseName(a.path).localeCompare(fileBaseName(b.path)));
    node.fileTree.sort((a, b) => {
      const aHasChildren = a.children.length > 0 ? 0 : 1;
      const bHasChildren = b.children.length > 0 ? 0 : 1;
      if (aHasChildren !== bHasChildren) return aHasChildren - bHasChildren;
      return fileBaseName(a.file.path).localeCompare(fileBaseName(b.file.path));
    });
    for (const sub of node.folders) {
      sortRecursive(sub);
    }
  };

  sortRecursive(root);
  return root;
}
