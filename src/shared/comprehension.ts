import { z } from 'zod';
import type {
  DiagramComprehensionGuide,
  DiagramNodeDetail,
  DiagramWalkthroughStep,
} from './types.js';
import { normalizeRelativeGraphPath } from './vfsPath.js';

const MAX_GIST_CHARS = 360;
const MAX_STEPS = 20;
const MAX_STEP_TITLE_CHARS = 120;
const MAX_STEP_CAPTION_CHARS = 500;
const MAX_FOCUS_NODES = 16;
const MAX_NODE_ENTRIES = 64;
const MAX_NODE_SUMMARY_CHARS = 600;
const MAX_NODE_FIELD_CHARS = 500;
const MAX_NODE_FILES = 12;

function clampText(raw: string, maxChars: number): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars - 1)}…` : trimmed;
}

const OptionalShortString = (maxChars: number) =>
  z.preprocess(
    (val) => (typeof val === 'string' ? clampText(val, maxChars) : undefined),
    z.string().optional()
  );

const OptionalGraphLink = z.preprocess((val) => {
  if (typeof val !== 'string' || !val.trim()) return undefined;
  return normalizeRelativeGraphPath(val);
}, z.string().optional());

const RawStepSanitizer = z
  .object({
    title: OptionalShortString(MAX_STEP_TITLE_CHARS),
    caption: OptionalShortString(MAX_STEP_CAPTION_CHARS),
    focusNodes: z
      .preprocess((val) => (Array.isArray(val) ? val : []), z.array(z.unknown()))
      .transform((arr) =>
        Array.from(
          new Set(
            arr
              .filter((id): id is string => typeof id === 'string')
              .map((id) => id.trim())
              .filter((id) => id.length > 0 && id.length <= 80)
          )
        ).slice(0, MAX_FOCUS_NODES)
      ),
  })
  .passthrough();

const RawNodeSanitizer = z
  .object({
    label: OptionalShortString(100),
    summary: OptionalShortString(MAX_NODE_SUMMARY_CHARS),
    example: OptionalShortString(MAX_NODE_FIELD_CHARS),
    whatIf: OptionalShortString(MAX_NODE_FIELD_CHARS),
    childPath: OptionalGraphLink,
    files: z
      .preprocess(
        (val) => (Array.isArray(val) ? val : undefined),
        z.array(z.unknown()).optional()
      )
      .transform((arr) => {
        if (!arr) return undefined;
        const deduped = Array.from(
          new Set(
            arr
              .filter((f): f is string => typeof f === 'string')
              .map((f) => f.trim())
              .filter((f) => f.length > 0 && f.length <= 180)
          )
        ).slice(0, MAX_NODE_FILES);
        return deduped.length > 0 ? deduped : undefined;
      }),
  })
  .passthrough();

const RawGuideSanitizer = z
  .object({
    gist: OptionalShortString(MAX_GIST_CHARS),
    parentPath: OptionalGraphLink,
    steps: z.unknown().optional(),
    nodes: z.unknown().optional(),
  })
  .passthrough();

/**
 * Tool-facing JSON-Schema-compatible Zod schema (used by MCP & OpenAI `zodToJsonSchema`).
 */
export const NodeDetailToolSchema = z.object({
  label: z
    .string()
    .optional()
    .describe('Optional display heading for the node inspector card.'),
  summary: z
    .string()
    .describe(
      '1–2 plain-English sentences describing what physically happens at this component (avoid raw code identifiers and forced domain metaphors).'
    ),
  example: z
    .string()
    .optional()
    .describe(
      'Concrete input -> output example with real sizes, counts, or timings (e.g. "1 KB Mermaid text -> 180 KB PNG -> deleted immediately").'
    ),
  whatIf: z
    .string()
    .optional()
    .describe(
      'Counterfactual boundary test: what happens when this component closes, fills up, or fails?'
    ),
  files: z
    .array(z.string())
    .optional()
    .describe(
      'Relevant repository file paths (e.g. ["src/infrastructure/ephemeral/workspaceRelay.ts"]).'
    ),
  childPath: z
    .string()
    .optional()
    .describe(
      'Optional relative `.mmd` path in this project VFS to zoom into when the user drills down into this subsystem.'
    ),
});

export const WalkthroughStepToolSchema = z.object({
  title: z.string().describe('Short step headline (e.g. "1. AI requests file list").'),
  caption: z
    .string()
    .describe('1–2 plain-English sentences narrating what happens at this exact step.'),
  focusNodes: z
    .array(z.string())
    .describe(
      'Exact Mermaid node IDs (or sequence participant IDs) to spotlight during this step.'
    ),
});

export const ComprehensionGuideToolSchema = z
  .object({
    gist: z
      .string()
      .optional()
      .describe('1-sentence plain-English core takeaway for the diagram.'),
    parentPath: z
      .string()
      .optional()
      .describe('Optional parent `.mmd` path when this diagram is a zoomed-in subsystem view.'),
    steps: z
      .array(WalkthroughStepToolSchema)
      .optional()
      .describe(
        'Ordered Story Mode walkthrough steps (`◀ 1 / N ▶`) tracing one concrete action from start to finish.'
      ),
    nodes: z
      .record(z.string(), NodeDetailToolSchema)
      .optional()
      .describe(
        'Map of Mermaid node ID -> clickable inspector details (summary, concrete example, whatIf counterfactual, source files, optional childPath drill-down).'
      ),
  })
  .describe(
    'Interactive human comprehension layer saved alongside the `.mmd` in browser IndexedDB: Story Stepper (`steps`), Clickable Node Inspector (`nodes`), and Sub-Graph Zoom (`childPath` / `parentPath`). Keep box labels in `code` short (2–5 plain words, 4–7 boxes per view) and put rich details here.'
  );

/**
 * Validates and normalizes an optional `DiagramComprehensionGuide` via Zod.
 * Throws if `childPath` or `parentPath` attempts `..` directory traversal,
 * and returns `undefined` when no meaningful comprehension fields are present.
 */
export function sanitizeComprehensionGuide(
  raw: unknown
): DiagramComprehensionGuide | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;

  const top = RawGuideSanitizer.parse(raw);

  let steps: DiagramWalkthroughStep[] | undefined;
  if (Array.isArray(top.steps)) {
    const parsedSteps: DiagramWalkthroughStep[] = [];
    for (const item of top.steps.slice(0, MAX_STEPS)) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const step = RawStepSanitizer.parse(item);
      if (!step.title && !step.caption) continue;
      parsedSteps.push({
        title: step.title || `Step ${parsedSteps.length + 1}`,
        caption: step.caption || step.title || '',
        focusNodes: step.focusNodes,
      });
    }
    if (parsedSteps.length > 0) {
      steps = parsedSteps;
    }
  }

  let nodes: Record<string, DiagramNodeDetail> | undefined;
  if (top.nodes && typeof top.nodes === 'object' && !Array.isArray(top.nodes)) {
    const entries = Object.entries(top.nodes as Record<string, unknown>).slice(
      0,
      MAX_NODE_ENTRIES
    );
    const parsedNodes: Record<string, DiagramNodeDetail> = {};

    for (const [rawKey, rawVal] of entries) {
      const nodeId = rawKey.trim();
      if (
        !nodeId ||
        nodeId.length > 80 ||
        !rawVal ||
        typeof rawVal !== 'object' ||
        Array.isArray(rawVal)
      ) {
        continue;
      }
      const parsed = RawNodeSanitizer.parse(rawVal);
      if (
        !parsed.summary &&
        !parsed.example &&
        !parsed.whatIf &&
        !parsed.childPath &&
        !parsed.files
      ) {
        continue;
      }
      parsedNodes[nodeId] = {
        ...(parsed.label ? { label: parsed.label } : {}),
        summary:
          parsed.summary || (parsed.childPath ? `Zoom into ${parsed.childPath}` : nodeId),
        ...(parsed.example ? { example: parsed.example } : {}),
        ...(parsed.whatIf ? { whatIf: parsed.whatIf } : {}),
        ...(parsed.files ? { files: parsed.files } : {}),
        ...(parsed.childPath ? { childPath: parsed.childPath } : {}),
      };
    }

    if (Object.keys(parsedNodes).length > 0) {
      nodes = parsedNodes;
    }
  }

  if (!top.gist && !top.parentPath && !steps && !nodes) {
    return undefined;
  }

  return {
    ...(top.gist ? { gist: top.gist } : {}),
    ...(top.parentPath ? { parentPath: top.parentPath } : {}),
    ...(steps ? { steps } : {}),
    ...(nodes ? { nodes } : {}),
  };
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) {
        sorted[key] = sortKeysDeep(v);
      }
    }
    return sorted;
  }
  return value;
}

export function serializeGuideCanonical(guide: DiagramComprehensionGuide | undefined): string {
  if (!guide) return '';
  return JSON.stringify(sortKeysDeep(guide));
}

export function summarizeComprehensionGuide(guide: DiagramComprehensionGuide | undefined): {
  hasGuide: boolean;
  hasGist: boolean;
  stepCount: number;
  documentedNodeCount: number;
  drilldownPaths: string[];
  parentPath: string | null;
} {
  if (!guide) {
    return {
      hasGuide: false,
      hasGist: false,
      stepCount: 0,
      documentedNodeCount: 0,
      drilldownPaths: [],
      parentPath: null,
    };
  }

  const nodeEntries = guide.nodes ? Object.values(guide.nodes) : [];
  const drilldownPaths = Array.from(
    new Set(
      nodeEntries
        .map((n) => n.childPath)
        .filter((p): p is string => typeof p === 'string' && p.length > 0)
    )
  );

  return {
    hasGuide: true,
    hasGist: Boolean(guide.gist),
    stepCount: guide.steps?.length ?? 0,
    documentedNodeCount: nodeEntries.length,
    drilldownPaths,
    parentPath: guide.parentPath ?? null,
  };
}

export function rewriteGuidePaths(
  guide: DiagramComprehensionGuide | undefined,
  rewritePath: (oldPath: string) => string
): DiagramComprehensionGuide | undefined {
  if (!guide) return undefined;

  let changed = false;
  let nextParent = guide.parentPath;
  if (guide.parentPath) {
    const updated = rewritePath(guide.parentPath);
    if (updated !== guide.parentPath) {
      nextParent = updated;
      changed = true;
    }
  }

  let nextNodes = guide.nodes;
  if (guide.nodes) {
    const copy: Record<string, DiagramNodeDetail> = {};
    let nodesChanged = false;
    for (const [id, detail] of Object.entries(guide.nodes)) {
      if (detail.childPath) {
        const updated = rewritePath(detail.childPath);
        if (updated !== detail.childPath) {
          copy[id] = { ...detail, childPath: updated };
          nodesChanged = true;
          continue;
        }
      }
      copy[id] = detail;
    }
    if (nodesChanged) {
      nextNodes = copy;
      changed = true;
    }
  }

  if (!changed) return guide;
  return {
    ...guide,
    ...(nextParent ? { parentPath: nextParent } : {}),
    ...(nextNodes ? { nodes: nextNodes } : {}),
  };
}
