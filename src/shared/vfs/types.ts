import { z } from 'zod';
import { sanitizeComprehensionGuide } from '../comprehension.js';
import type { DiagramComprehensionGuide } from '../types.js';

export const SCRATCHPAD_PROJECT_KEY = 'scratchpad';
export const GENERAL_PROJECT_KEY = 'general';
export const MAX_GRAPH_VERSIONS = 5;
export const HUMAN_EDIT_COALESCE_MS = 45_000;
export const AGENT_ITERATION_COALESCE_MS = 90_000;

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

export interface ExplorerFileTreeNode {
  file: VfsGraphFile;
  children: ExplorerFileTreeNode[];
  isRootOverview: boolean;
  parentFileId: string | null;
}

export interface ExplorerFolderNode {
  kind: 'folder';
  name: string;
  path: string;
  folders: ExplorerFolderNode[];
  files: VfsGraphFile[];
  fileTree: ExplorerFileTreeNode[];
}

export interface ParentComponentBranch {
  nodeId: string;
  componentLabel: string;
  childFile: VfsGraphFile;
}

export interface GraphBreadcrumbHop {
  parentFile: VfsGraphFile;
  viaNodeId: string | null;
  viaComponentLabel: string | null;
  siblingBranches: ParentComponentBranch[];
  childFile: VfsGraphFile;
}

export interface ProjectGraphHierarchy {
  parentByFileId: Map<string, VfsGraphFile>;
  childrenByFileId: Map<string, VfsGraphFile[]>;
  getAncestors: (fileId: string) => VfsGraphFile[];
  getBreadcrumbHops: (fileId: string) => GraphBreadcrumbHop[];
  getRootForFile: (fileId: string) => VfsGraphFile | null;
}

export const PersistedGraphVersionSchema = z.object({
  version: z.number().int().min(1),
  code: z.string(),
  guide: z
    .unknown()
    .optional()
    .transform((val) => {
      try {
        return sanitizeComprehensionGuide(val);
      } catch {
        return undefined;
      }
    }),
  authorSlug: z.string().default('user'),
  authorLabel: z.string().default('You'),
  authorBadge: z.string().default('you'),
  agentSessionId: z.string().nullable().optional(),
  createdAt: z.number(),
});

export const PersistedGraphFileV4Schema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  title: z.string().optional(),
  diagramType: z.string().nullable().default(null),
  isWelcome: z.boolean().optional(),
  currentVersion: z.number().int().min(1).optional(),
  versions: z.array(PersistedGraphVersionSchema).min(1),
});

export const PersistedProjectV4Schema = z.object({
  projectKey: z.string().min(1),
  projectLabel: z.string().optional(),
  isScratchpad: z.boolean().optional(),
  expanded: z.boolean().default(true),
  folders: z.array(z.string()).default([]),
  files: z.array(PersistedGraphFileV4Schema).default([]),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});

export const PersistedWorkspaceV4Schema = z.object({
  version: z.literal(4),
  workspaceId: z.string().optional(),
  sidebarOpen: z.boolean().default(true),
  sidebarWidth: z.number().default(268),
  openTabIds: z.array(z.string()).default([]),
  activeFileId: z.string().nullable().default(null),
  projects: z.array(PersistedProjectV4Schema).min(1),
});

export type PersistedWorkspaceV4 = z.input<typeof PersistedWorkspaceV4Schema>;
