import { z } from 'zod';
import { slugify } from './strings.js';
import type {
  DiagramComprehensionGuide,
  DiagramNodeDetail,
  DiagramStepCheck,
  DiagramWalkthroughFlow,
  DiagramWalkthroughStep,
} from './types.js';
import { normalizeRelativeGraphPath } from './vfsPath.js';

const MAX_GIST_CHARS = 360;
const MAX_FLOWS = 6;
const MAX_FLOW_LABEL_CHARS = 64;
const MAX_STEPS = 20;
const MAX_STEP_TITLE_CHARS = 120;
const MAX_STEP_CAPTION_CHARS = 500;
const MAX_STEP_TRACE_CHARS = 320;
const MAX_CHECK_CHARS = 360;
const MAX_FOCUS_NODES = 16;
const MAX_NODE_ENTRIES = 64;
const MAX_NODE_TERM_CHARS = 160;
const MAX_NODE_SUMMARY_CHARS = 600;
const MAX_NODE_FIELD_CHARS = 500;
const MAX_NODE_REFS = 12;

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

const OptionalStringList = (maxItems: number, maxItemLen: number) =>
  z
    .preprocess(
      (val) => (Array.isArray(val) ? val : undefined),
      z.array(z.unknown()).optional()
    )
    .transform((arr) => {
      if (!arr) return undefined;
      const deduped = Array.from(
        new Set(
          arr
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter((item) => item.length > 0 && item.length <= maxItemLen)
        )
      ).slice(0, maxItems);
      return deduped.length > 0 ? deduped : undefined;
    });

const RawCheckSanitizer = z
  .object({
    question: OptionalShortString(MAX_CHECK_CHARS),
    answer: OptionalShortString(MAX_CHECK_CHARS),
  })
  .passthrough();

const RawStepSanitizer = z
  .object({
    title: OptionalShortString(MAX_STEP_TITLE_CHARS),
    caption: OptionalShortString(MAX_STEP_CAPTION_CHARS),
    trace: OptionalShortString(MAX_STEP_TRACE_CHARS),
    check: z.unknown().optional(),
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

const RawFlowSanitizer = z
  .object({
    id: OptionalShortString(48),
    label: OptionalShortString(MAX_FLOW_LABEL_CHARS),
    steps: z.unknown().optional(),
  })
  .passthrough();

const RawNodeSanitizer = z
  .object({
    label: OptionalShortString(100),
    term: OptionalShortString(MAX_NODE_TERM_CHARS),
    summary: OptionalShortString(MAX_NODE_SUMMARY_CHARS),
    example: OptionalShortString(MAX_NODE_FIELD_CHARS),
    whatIf: OptionalShortString(MAX_NODE_FIELD_CHARS),
    childPath: OptionalGraphLink,
    refs: OptionalStringList(MAX_NODE_REFS, 180),
    files: OptionalStringList(MAX_NODE_REFS, 180),
  })
  .passthrough();

const RawGuideSanitizer = z
  .object({
    gist: OptionalShortString(MAX_GIST_CHARS),
    parentPath: OptionalGraphLink,
    steps: z.unknown().optional(),
    flows: z.unknown().optional(),
    nodes: z.unknown().optional(),
  })
  .passthrough();

function sanitizeStepCheck(raw: unknown): DiagramStepCheck | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const parsed = RawCheckSanitizer.parse(raw);
  if (!parsed.question || !parsed.answer) return undefined;
  return {
    question: parsed.question,
    answer: parsed.answer,
  };
}

function sanitizeStepArray(rawSteps: unknown): DiagramWalkthroughStep[] | undefined {
  if (!Array.isArray(rawSteps)) return undefined;
  const parsedSteps: DiagramWalkthroughStep[] = [];
  for (const item of rawSteps.slice(0, MAX_STEPS)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const step = RawStepSanitizer.parse(item);
    if (!step.title && !step.caption) continue;
    const check = sanitizeStepCheck(step.check);
    parsedSteps.push({
      title: step.title || `Step ${parsedSteps.length + 1}`,
      caption: step.caption || step.title || '',
      focusNodes: step.focusNodes,
      ...(step.trace ? { trace: step.trace } : {}),
      ...(check ? { check } : {}),
    });
  }
  return parsedSteps.length > 0 ? parsedSteps : undefined;
}

/**
 * Tool-facing JSON-Schema-compatible Zod schemas (used by MCP & OpenAI `zodToJsonSchema`).
 */
export const StepCheckToolSchema = z.object({
  question: z
    .string()
    .describe(
      'Short prediction prompt before revealing what happens (e.g. "If Worker A crashes here, is the job lost?").'
    ),
  answer: z.string().describe('1–2 sentence answer revealed on click.'),
});

export const WalkthroughStepToolSchema = z.object({
  title: z.string().describe('Short step headline (e.g. "1. Append to log").'),
  caption: z
    .string()
    .describe(
      '1–2 short, natural sentences explaining what happens here in plain everyday words (no AI filler or buzzwords).'
    ),
  focusNodes: z
    .array(z.string())
    .describe('Exact Mermaid node or participant IDs spotlighted at this step.'),
  trace: z
    .string()
    .optional()
    .describe(
      'Concrete data/payload/state value at this hop (e.g. "tokens: [15496, 995] -> shape (2, 768)" or "userId: undefined -> 0 rows").'
    ),
  check: StepCheckToolSchema.optional().describe(
    'Optional micro-prediction checkpoint on a pivotal step to verify understanding.'
  ),
});

export const WalkthroughFlowToolSchema = z.object({
  id: z
    .string()
    .optional()
    .describe('Short scenario slug (e.g. "happy-path" or "crash-retry").'),
  label: z
    .string()
    .describe(
      'Scenario pill title (e.g. "Normal Flow", "Crash & Retry", "Baseline Bottleneck").'
    ),
  steps: z
    .array(WalkthroughStepToolSchema)
    .describe('Ordered walkthrough steps for this scenario.'),
});

export const NodeDetailToolSchema = z.object({
  label: z.string().optional().describe('Optional card heading override.'),
  term: z
    .string()
    .optional()
    .describe(
      'Official technical term, class name, or equation bridged from the plain box label (e.g. "Write-Ahead Log (WAL)" or "Eq. 4: Softmax(QK^T / sqrt(d))V").'
    ),
  summary: z
    .string()
    .describe(
      '1–2 short, direct sentences explaining what happens at this box in plain human words.'
    ),
  example: z
    .string()
    .optional()
    .describe('Concrete input -> output example with real numbers, sizes, shapes, or timings.'),
  whatIf: z
    .string()
    .optional()
    .describe('What breaks, degrades, or happens at boundary/failure conditions.'),
  refs: z
    .array(z.string())
    .optional()
    .describe(
      'Source anchors: repo file paths ("src/relay.ts"), paper sections ("§3.2", "Fig. 2"), or specs ("RFC 9000").'
    ),
  childPath: z
    .string()
    .optional()
    .describe('Relative `.mmd` path in this workspace to zoom into when drilling down.'),
});

export const ComprehensionGuideToolSchema = z
  .object({
    gist: z
      .string()
      .optional()
      .describe(
        '1–2 plain sentences stating what problem this solves and how it works (direct human tone, no slogans).'
      ),
    parentPath: z
      .string()
      .optional()
      .describe('Parent `.mmd` path when this view is a zoomed-in sub-diagram.'),
    steps: z
      .array(WalkthroughStepToolSchema)
      .optional()
      .describe('Ordered walkthrough steps when a single trace is enough.'),
    flows: z
      .array(WalkthroughFlowToolSchema)
      .optional()
      .describe(
        '2–4 contrasting scenarios on the same map (e.g. Happy Path vs. Failure, Baseline vs. Paper Breakthrough, Expected vs. Bug).'
      ),
    nodes: z
      .record(z.string(), NodeDetailToolSchema)
      .optional()
      .describe('Map of Mermaid node ID -> clickable inspector card details.'),
  })
  .describe(
    'Interactive comprehension layer rendered alongside the clean 4–7 node Mermaid map.'
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

  const steps = sanitizeStepArray(top.steps);

  let flows: DiagramWalkthroughFlow[] | undefined;
  if (Array.isArray(top.flows)) {
    const parsedFlows: DiagramWalkthroughFlow[] = [];
    const usedIds = new Set<string>();

    for (const item of top.flows.slice(0, MAX_FLOWS)) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const rawFlow = RawFlowSanitizer.parse(item);
      const flowSteps = sanitizeStepArray(rawFlow.steps);
      if (!flowSteps) continue;

      const label = rawFlow.label || `Flow ${parsedFlows.length + 1}`;
      const baseId = slugify(rawFlow.id || label, `flow-${parsedFlows.length + 1}`, 40);
      let uniqueId = baseId;
      let suffix = 2;
      while (usedIds.has(uniqueId)) {
        uniqueId = `${baseId}-${suffix++}`;
      }
      usedIds.add(uniqueId);

      parsedFlows.push({
        id: uniqueId,
        label,
        steps: flowSteps,
      });
    }

    if (parsedFlows.length > 0) {
      flows = parsedFlows;
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
        !parsed.term &&
        !parsed.example &&
        !parsed.whatIf &&
        !parsed.childPath &&
        !parsed.refs &&
        !parsed.files
      ) {
        continue;
      }
      parsedNodes[nodeId] = {
        ...(parsed.label ? { label: parsed.label } : {}),
        ...(parsed.term ? { term: parsed.term } : {}),
        summary:
          parsed.summary ||
          (parsed.childPath ? `Zoom into ${parsed.childPath}` : parsed.term || nodeId),
        ...(parsed.example ? { example: parsed.example } : {}),
        ...(parsed.whatIf ? { whatIf: parsed.whatIf } : {}),
        ...(parsed.refs ? { refs: parsed.refs } : {}),
        ...(parsed.files ? { files: parsed.files } : {}),
        ...(parsed.childPath ? { childPath: parsed.childPath } : {}),
      };
    }

    if (Object.keys(parsedNodes).length > 0) {
      nodes = parsedNodes;
    }
  }

  if (!top.gist && !top.parentPath && !steps && !flows && !nodes) {
    return undefined;
  }

  return {
    ...(top.gist ? { gist: top.gist } : {}),
    ...(top.parentPath ? { parentPath: top.parentPath } : {}),
    ...(steps ? { steps } : {}),
    ...(flows ? { flows } : {}),
    ...(nodes ? { nodes } : {}),
  };
}

/**
 * Resolves walkthrough flows uniformly whether a guide uses `flows` or single `steps`.
 */
export function resolveGuideFlows(
  guide: DiagramComprehensionGuide | undefined
): DiagramWalkthroughFlow[] {
  if (!guide) return [];
  if (guide.flows && guide.flows.length > 0) {
    return guide.flows;
  }
  if (guide.steps && guide.steps.length > 0) {
    return [
      {
        id: 'walkthrough',
        label: 'Walkthrough',
        steps: guide.steps,
      },
    ];
  }
  return [];
}

export function countGuideSteps(guide: DiagramComprehensionGuide | undefined): number {
  if (!guide) return 0;
  if (guide.flows && guide.flows.length > 0) {
    return guide.flows.reduce((sum, f) => sum + f.steps.length, 0);
  }
  return guide.steps?.length ?? 0;
}

export function resolveNodeRefs(detail: DiagramNodeDetail | undefined): string[] {
  if (!detail) return [];
  if (detail.refs && detail.files) {
    return Array.from(new Set([...detail.refs, ...detail.files]));
  }
  return detail.refs ?? detail.files ?? [];
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
  flowCount?: number;
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
    ...(guide.flows?.length ? { flowCount: guide.flows.length } : {}),
    stepCount: countGuideSteps(guide),
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
