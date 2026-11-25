import { produce } from 'immer';
import { z } from 'zod';
import { rewriteGuidePaths, sanitizeComprehensionGuide } from '../comprehension.js';
import { randomToken, slugify } from '../strings.js';
import type { DiagramComprehensionGuide } from '../types.js';
import {
  graphTitleFromPath,
  normalizeRelativeDirPath,
  normalizeRelativeGraphPath,
  parentDirOfPath,
} from '../vfsPath.js';
import { collectGraphTreeFiles } from './hierarchy.js';
import {
  findFileWithProject,
  getHeadVersion,
  normalizeWorkspaceConsistency,
} from './operations.js';
import type { VfsGraphFile, WorkspaceState } from './types.js';

export const GRAPH_BUNDLE_FORMAT = 'mfhmfa-graph' as const;
export const GRAPH_BUNDLE_VERSION = 1 as const;
export const GRAPH_BUNDLE_EXTENSION = '.mfhmfa.json';

const MAX_BUNDLE_FILES = 100;
const MAX_BUNDLE_CODE_CHARS = 500_000;

export interface ExportedGraphFile {
  path: string;
  title: string;
  diagramType: string | null;
  code: string;
  guide?: DiagramComprehensionGuide;
}

export interface GraphExportBundleV1 {
  format: typeof GRAPH_BUNDLE_FORMAT;
  version: typeof GRAPH_BUNDLE_VERSION;
  exportedAt: string;
  title: string;
  rootPath: string;
  files: ExportedGraphFile[];
}

export interface BuiltGraphExport {
  bundle: GraphExportBundleV1;
  filename: string;
  json: string;
}

export interface ImportGraphBundleOptions {
  targetProjectKey: string;
  targetFolder?: string | null;
  now?: number;
}

export interface ImportGraphBundleResult {
  nextState: WorkspaceState;
  projectKey: string;
  projectLabel: string;
  rootFile: VfsGraphFile;
  importedCount: number;
}

const RawExportedGraphFileSchema = z.object({
  path: z.string().min(1, 'Each graph file must have a non-empty `path`.'),
  title: z.string().trim().max(160).optional(),
  diagramType: z.string().max(64).nullable().optional(),
  code: z
    .string()
    .min(1, 'Each graph file must include Mermaid `code`.')
    .max(MAX_BUNDLE_CODE_CHARS, 'Mermaid diagram source exceeds maximum allowed size.'),
  guide: z.unknown().optional(),
});

const RawGraphBundleEnvelopeSchema = z.object({
  format: z.literal(GRAPH_BUNDLE_FORMAT),
  version: z.literal(GRAPH_BUNDLE_VERSION),
  exportedAt: z.string().optional(),
  title: z.string().trim().max(160).optional(),
  rootPath: z.string().min(1).optional(),
  files: z
    .array(RawExportedGraphFileSchema)
    .min(1, 'Bundle must contain at least one graph file.')
    .max(MAX_BUNDLE_FILES, `Bundle cannot contain more than ${MAX_BUNDLE_FILES} files.`),
});

export function serializeGraphExportBundle(bundle: GraphExportBundleV1): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

function allocateUniqueGraphPath(candidate: string, takenPaths: Set<string>): string {
  if (!takenPaths.has(candidate)) {
    takenPaths.add(candidate);
    return candidate;
  }

  const dir = parentDirOfPath(candidate);
  const stem = graphTitleFromPath(candidate);
  let suffix = 2;
  while (true) {
    const nextPath = dir ? `${dir}/${stem}-${suffix}.mmd` : `${stem}-${suffix}.mmd`;
    if (!takenPaths.has(nextPath)) {
      takenPaths.add(nextPath);
      return nextPath;
    }
    suffix += 1;
  }
}

/**
 * Strips all parent folder prefixes from a graph tree so exported/imported bundles
 * are strictly graph-level (bare `.mmd` filenames with internal links rewritten cleanly).
 */
function toBareFileName(normalizedPath: string): string {
  return `${graphTitleFromPath(normalizedPath)}.mmd`;
}

/**
 * Exports a full graph tree (root overview + every nested child/descendant sub-diagram)
 * as a clean, graph-level `.mfhmfa.json` bundle with zero project or parent folder metadata.
 */
export function buildGraphExportBundle(
  state: WorkspaceState,
  fileId: string,
  now = Date.now()
): BuiltGraphExport | null {
  const found = findFileWithProject(state, fileId);
  if (!found) return null;

  const tree = collectGraphTreeFiles(found.project, found.file.id);
  if (!tree || tree.files.length === 0) return null;

  // Map every file in the graph tree to a clean flat filename (no parent folders)
  const takenNames = new Set<string>();
  const exportPathMap = new Map<string, string>();
  for (const file of tree.files) {
    const flatName = allocateUniqueGraphPath(toBareFileName(file.path), takenNames);
    exportPathMap.set(file.path, flatName);
  }

  const rewriteExportLink = (oldPath: string): string => exportPathMap.get(oldPath) ?? oldPath;

  const exportedFiles: ExportedGraphFile[] = tree.files.map((file) => {
    const head = getHeadVersion(file);
    const flatPath = exportPathMap.get(file.path)!;
    const rewrittenGuide = rewriteGuidePaths(head.guide, rewriteExportLink);
    return {
      path: flatPath,
      title: file.title?.trim() || graphTitleFromPath(file.path),
      diagramType: file.diagramType ?? null,
      code: head.code,
      ...(rewrittenGuide ? { guide: rewrittenGuide } : {}),
    };
  });

  const rootTitle = tree.rootFile.title?.trim() || graphTitleFromPath(tree.rootFile.path);
  const rootPath = exportPathMap.get(tree.rootFile.path)!;

  const bundle: GraphExportBundleV1 = {
    format: GRAPH_BUNDLE_FORMAT,
    version: GRAPH_BUNDLE_VERSION,
    exportedAt: new Date(now).toISOString(),
    title: rootTitle,
    rootPath,
    files: exportedFiles,
  };

  const filename = `${slugify(rootTitle, 'graph')}${GRAPH_BUNDLE_EXTENSION}`;
  return {
    bundle,
    filename,
    json: serializeGraphExportBundle(bundle),
  };
}

/**
 * Parses and strictly validates an imported MFHMFA graph JSON string or object.
 * Normalizes all paths to graph-level filenames, blocks `..` traversal, and sanitizes guides.
 */
export function parseGraphExportBundle(input: string | unknown): GraphExportBundleV1 {
  let raw: unknown = input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) {
      throw new Error('The selected file is empty.');
    }
    try {
      raw = JSON.parse(trimmed);
    } catch {
      throw new Error(
        'Could not parse JSON. Make sure you selected a valid .mfhmfa.json file.'
      );
    }
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid graph file: expected a JSON object.');
  }

  const envelopeCheck = raw as { format?: unknown; version?: unknown };
  if (envelopeCheck.format !== GRAPH_BUNDLE_FORMAT) {
    throw new Error(
      `Not a valid MFHMFA graph file (expected format "${GRAPH_BUNDLE_FORMAT}").`
    );
  }
  if (envelopeCheck.version !== GRAPH_BUNDLE_VERSION) {
    throw new Error(
      `Unsupported MFHMFA graph bundle version (${String(envelopeCheck.version)}).`
    );
  }

  const parsed = RawGraphBundleEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    throw new Error(firstIssue?.message || 'Invalid MFHMFA graph bundle structure.');
  }

  const data = parsed.data;
  const rawEntries: ExportedGraphFile[] = [];
  const seenOrigPaths = new Set<string>();

  for (const item of data.files) {
    const normalizedPath = normalizeRelativeGraphPath(item.path);
    if (seenOrigPaths.has(normalizedPath)) continue;
    seenOrigPaths.add(normalizedPath);

    const safeGuide = sanitizeComprehensionGuide(item.guide);
    rawEntries.push({
      path: normalizedPath,
      title: item.title?.trim() || graphTitleFromPath(normalizedPath),
      diagramType: item.diagramType ?? null,
      code: item.code,
      ...(safeGuide ? { guide: safeGuide } : {}),
    });
  }

  if (rawEntries.length === 0) {
    throw new Error('Bundle does not contain any valid graph files.');
  }

  let origRootPath = rawEntries[0]!.path;
  if (data.rootPath) {
    origRootPath = normalizeRelativeGraphPath(data.rootPath);
    if (!seenOrigPaths.has(origRootPath)) {
      throw new Error(
        `Invalid graph bundle: rootPath "${origRootPath}" was not found in files.`
      );
    }
  }

  // Ensure imported paths are flat graph-level filenames (stripping any external folder prefixes)
  const takenFlat = new Set<string>();
  const flatMap = new Map<string, string>();
  for (const entry of rawEntries) {
    const flatPath = allocateUniqueGraphPath(toBareFileName(entry.path), takenFlat);
    flatMap.set(entry.path, flatPath);
  }
  const rewriteFlat = (oldPath: string): string => flatMap.get(oldPath) ?? oldPath;

  const flatFiles: ExportedGraphFile[] = rawEntries.map((entry) => {
    const flatGuide = rewriteGuidePaths(entry.guide, rewriteFlat);
    return {
      path: flatMap.get(entry.path)!,
      title: entry.title,
      diagramType: entry.diagramType,
      code: entry.code,
      ...(flatGuide ? { guide: flatGuide } : {}),
    };
  });

  const normalizedRootPath = flatMap.get(origRootPath)!;
  const rootEntry = flatFiles.find((f) => f.path === normalizedRootPath) ?? flatFiles[0]!;

  return {
    format: GRAPH_BUNDLE_FORMAT,
    version: GRAPH_BUNDLE_VERSION,
    exportedAt: data.exportedAt || new Date().toISOString(),
    title: data.title?.trim() || rootEntry.title,
    rootPath: normalizedRootPath,
    files: flatFiles,
  };
}

/**
 * Imports a validated graph-level bundle directly into a chosen project (or folder inside it)
 * without overwriting existing files, rewriting every internal `childPath` / `parentPath` link.
 */
export function importGraphBundleIntoWorkspace(
  state: WorkspaceState,
  bundle: GraphExportBundleV1,
  options: ImportGraphBundleOptions
): ImportGraphBundleResult {
  const now = options.now ?? Date.now();
  const targetFolder = normalizeRelativeDirPath(options.targetFolder);

  const targetProj = state.projects.find((p) => p.projectKey === options.targetProjectKey);
  if (!targetProj) {
    throw new Error('Target project was not found in the workspace.');
  }

  let importedRootId = '';
  let resolvedProjectLabel = targetProj.projectLabel;

  const nextDraftState = produce(state, (draft) => {
    const proj = draft.projects.find((p) => p.projectKey === options.targetProjectKey)!;
    resolvedProjectLabel = proj.projectLabel;

    const takenPaths = new Set(proj.files.map((f) => f.path));
    const pathMap = new Map<string, string>();

    for (const file of bundle.files) {
      const bareName = toBareFileName(file.path);
      const candidate = targetFolder
        ? normalizeRelativeGraphPath(`${targetFolder}/${bareName}`)
        : bareName;
      const uniquePath = allocateUniqueGraphPath(candidate, takenPaths);
      pathMap.set(file.path, uniquePath);
    }

    const rewriteLink = (oldPath: string): string => pathMap.get(oldPath) ?? oldPath;

    for (const item of bundle.files) {
      const finalPath = pathMap.get(item.path)!;
      const rewrittenGuide = rewriteGuidePaths(item.guide, rewriteLink);
      const created: VfsGraphFile = {
        id: `file-${randomToken(8)}`,
        path: finalPath,
        title: item.title || graphTitleFromPath(finalPath),
        diagramType: item.diagramType,
        unread: false,
        isWelcome: false,
        currentVersion: 1,
        versions: [
          {
            version: 1,
            code: item.code,
            ...(rewrittenGuide ? { guide: rewrittenGuide } : {}),
            authorSlug: 'imported',
            authorLabel: 'Imported',
            authorBadge: 'imported',
            createdAt: now,
          },
        ],
        zoom: null,
        pan: { x: 0, y: 0 },
      };

      proj.files.push(created);
      if (item.path === bundle.rootPath) {
        importedRootId = created.id;
      }
    }

    if (targetFolder && !proj.folders.includes(targetFolder)) {
      proj.folders.push(targetFolder);
    }

    proj.expanded = true;
    proj.updatedAt = now;

    if (importedRootId && !draft.openTabIds.includes(importedRootId)) {
      draft.openTabIds.push(importedRootId);
    }
    draft.activeFileId = importedRootId || draft.activeFileId;
  });

  const normalized = normalizeWorkspaceConsistency(nextDraftState);
  const rootFile = findFileWithProject(normalized, importedRootId)!.file;

  return {
    nextState: normalized,
    projectKey: options.targetProjectKey,
    projectLabel: resolvedProjectLabel,
    rootFile,
    importedCount: bundle.files.length,
  };
}
