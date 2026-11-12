import { z } from 'zod';
import { sanitizeComprehensionGuide } from './comprehension.js';
import type {
  AgentSessionInfo,
  DiagramRelayPayload,
  VfsRpcQuery,
  VfsRpcReply,
  VfsRpcRequest,
} from './types.js';

export const MAX_RELAY_CODE_CHARS = 256_000;

export const MermaidThemeSchema = z.enum(['default', 'neutral', 'dark', 'forest', 'base']);

export const MermaidLookSchema = z.enum(['classic', 'handDrawn']);

export const LearningModeSchema = z.enum(['concept', 'paper', 'codebase', 'bug', 'tradeoff']);

export const CallerSourceSchema = z.enum(['mcp-stdio', 'mcp-http', 'rest-tool', 'web']);

export const AgentStatusKindSchema = z.enum(['connected', 'active', 'disconnected']);

export const WorkspaceTokenSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{4,64}$/);

export function parseWorkspaceToken(raw: unknown): string | null {
  const res = WorkspaceTokenSchema.safeParse(raw);
  return res.success ? res.data : null;
}

export const AgentSessionInfoSchema: z.ZodType<AgentSessionInfo> = z.object({
  sessionId: z.string().min(1).max(128),
  agentSlug: z.string().min(1).max(64),
  agentLabel: z.string().min(1).max(80),
  agentShortLabel: z.string().min(1).max(40),
  clientVersion: z.string().max(64).nullable(),
  project: z.string().max(80).nullable(),
  source: CallerSourceSchema,
  status: AgentStatusKindSchema,
  connectedAt: z.number(),
  lastActiveAt: z.number(),
});

export const DiagramRelayPayloadSchema: z.ZodType<DiagramRelayPayload, z.ZodTypeDef, unknown> =
  z.object({
    renderId: z.string().min(1).max(128),
    path: z.string().min(1).max(260),
    title: z.string().min(1).max(160),
    code: z.string().max(MAX_RELAY_CODE_CHARS),
    guide: z
      .unknown()
      .optional()
      .transform((val) => sanitizeComprehensionGuide(val)),
    diagramType: z.string().max(64).nullable(),
    theme: MermaidThemeSchema,
    look: MermaidLookSchema,
    project: z.string().min(1).max(80),
    agentSessionId: z.string().max(128).nullable(),
    agentSlug: z.string().min(1).max(64),
    agentLabel: z.string().min(1).max(80),
    agentShortLabel: z.string().min(1).max(40),
    timestamp: z.number(),
  });

export const VfsRpcQuerySchema: z.ZodType<VfsRpcQuery> = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('ls'),
    project: z.string().min(1).max(80),
    dirPath: z.string().max(260),
  }),
  z.object({
    op: z.literal('read'),
    project: z.string().min(1).max(80),
    filePath: z.string().min(1).max(260),
    version: z.number().int().min(1).optional(),
  }),
  z.object({
    op: z.literal('mv'),
    project: z.string().min(1).max(80),
    fromPath: z.string().min(1).max(260),
    toPath: z.string().min(1).max(260),
  }),
]);

export const VfsRpcRequestSchema: z.ZodType<VfsRpcRequest> = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('ls'),
    project: z.string().min(1).max(80),
    dirPath: z.string().max(260),
    requestId: z.string().min(1).max(128),
  }),
  z.object({
    op: z.literal('read'),
    project: z.string().min(1).max(80),
    filePath: z.string().min(1).max(260),
    version: z.number().int().min(1).optional(),
    requestId: z.string().min(1).max(128),
  }),
  z.object({
    op: z.literal('mv'),
    project: z.string().min(1).max(80),
    fromPath: z.string().min(1).max(260),
    toPath: z.string().min(1).max(260),
    requestId: z.string().min(1).max(128),
  }),
]);

const ViewerFocusContextSchema = z.object({
  activePath: z.string(),
  viewingVersion: z.number(),
  activeFlowId: z.string().nullable().optional(),
  activeFlowLabel: z.string().nullable().optional(),
  activeStepIndex: z.number().nullable().optional(),
  activeStepTitle: z.string().nullable().optional(),
  selectedNodeId: z.string().nullable().optional(),
});

const VfsLsEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  kind: z.enum(['dir', 'file']),
  diagramType: z.string().nullable().optional(),
  currentVersion: z.number().optional(),
  author: z.string().optional(),
  updatedAt: z.number().optional(),
  flowCount: z.number().optional(),
  stepCount: z.number().optional(),
  nodeNoteCount: z.number().optional(),
});

const VfsLsResultSchema = z.object({
  project: z.string(),
  cwd: z.string(),
  entries: z.array(VfsLsEntrySchema),
  treeText: z.string(),
  viewerFocus: ViewerFocusContextSchema.nullable().optional(),
});

const VfsReadResultSchema = z.object({
  project: z.string(),
  path: z.string(),
  title: z.string(),
  diagramType: z.string().nullable(),
  requestedVersion: z.number(),
  currentVersion: z.number(),
  code: z.string(),
  guide: z
    .unknown()
    .optional()
    .transform((val) => sanitizeComprehensionGuide(val)),
  author: z.string(),
  updatedAt: z.number(),
  versions: z.array(
    z.object({
      version: z.number(),
      author: z.string(),
      authorLabel: z.string(),
      createdAt: z.number(),
    })
  ),
});

const VfsMoveResultSchema = z.object({
  project: z.string(),
  fromPath: z.string(),
  toPath: z.string(),
  movedFiles: z.number(),
});

export const VfsRpcReplySchema: z.ZodType<VfsRpcReply, z.ZodTypeDef, unknown> = z.object({
  requestId: z.string().min(1).max(128),
  ok: z.boolean(),
  result: z.union([VfsLsResultSchema, VfsReadResultSchema, VfsMoveResultSchema]).optional(),
  error: z.string().max(2000).optional(),
});

export const ConnectedAgentsEventSchema = z.object({
  agents: z.array(AgentSessionInfoSchema),
});

export const ValidateHttpBodySchema = z.object({
  code: z.string().default(''),
});

export const RenderHttpBodySchema = z.object({
  code: z.string().default(''),
  path: z.string().optional(),
  title: z.string().optional(),
  guide: z.unknown().optional(),
  project: z.string().optional(),
  agent: z.string().optional(),
  theme: MermaidThemeSchema.optional(),
  look: MermaidLookSchema.optional(),
  background: z.string().max(64).optional(),
  scale: z.number().min(1).max(4).optional(),
  outputPath: z.string().optional(),
  includePngBase64: z.boolean().default(true),
});

export const ExportHttpBodySchema = z.object({
  code: z.string().default(''),
  outputPath: z.string().min(1, '`outputPath` is required.'),
  title: z.string().optional(),
  format: z.enum(['png', 'svg', 'mmd', 'md']).optional(),
  theme: MermaidThemeSchema.optional(),
  look: MermaidLookSchema.optional(),
  background: z.string().max(64).optional(),
  scale: z.number().min(1).max(4).optional(),
});

export const ToolCallHttpBodySchema = z.object({
  name: z.string().min(1, 'Tool `name` is required.'),
  arguments: z.unknown().default({}),
});
