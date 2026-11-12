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

function cleanShortString(raw: unknown, maxChars: number): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars - 1)}…` : trimmed;
}

function cleanGraphLink(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  return normalizeRelativeGraphPath(raw);
}

/**
 * Validates and normalizes an optional `DiagramComprehensionGuide`.
 * Throws if `childPath` or `parentPath` attempts `..` directory traversal,
 * and returns `undefined` when no meaningful comprehension fields are present.
 */
export function sanitizeComprehensionGuide(
  raw: unknown
): DiagramComprehensionGuide | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;

  const gist = cleanShortString(obj.gist, MAX_GIST_CHARS);
  const parentPath = cleanGraphLink(obj.parentPath);

  let steps: DiagramWalkthroughStep[] | undefined;
  if (Array.isArray(obj.steps)) {
    const parsedSteps: DiagramWalkthroughStep[] = [];
    for (const item of obj.steps.slice(0, MAX_STEPS)) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const title = cleanShortString(rec.title, MAX_STEP_TITLE_CHARS);
      const caption = cleanShortString(rec.caption, MAX_STEP_CAPTION_CHARS);
      if (!title && !caption) continue;

      const focusNodes = Array.isArray(rec.focusNodes)
        ? Array.from(
            new Set(
              rec.focusNodes
                .filter((id): id is string => typeof id === 'string')
                .map((id) => id.trim())
                .filter((id) => id.length > 0 && id.length <= 80)
            )
          ).slice(0, MAX_FOCUS_NODES)
        : [];

      parsedSteps.push({
        title: title || `Step ${parsedSteps.length + 1}`,
        caption: caption || title || '',
        focusNodes,
      });
    }
    if (parsedSteps.length > 0) {
      steps = parsedSteps;
    }
  }

  let nodes: Record<string, DiagramNodeDetail> | undefined;
  if (obj.nodes && typeof obj.nodes === 'object' && !Array.isArray(obj.nodes)) {
    const entries = Object.entries(obj.nodes as Record<string, unknown>).slice(
      0,
      MAX_NODE_ENTRIES
    );
    const parsedNodes: Record<string, DiagramNodeDetail> = {};

    for (const [rawKey, rawVal] of entries) {
      const nodeId = rawKey.trim();
      if (!nodeId || nodeId.length > 80 || !rawVal || typeof rawVal !== 'object') {
        continue;
      }
      const val = rawVal as Record<string, unknown>;
      const label = cleanShortString(val.label, 100);
      const summary = cleanShortString(val.summary, MAX_NODE_SUMMARY_CHARS);
      const example = cleanShortString(val.example, MAX_NODE_FIELD_CHARS);
      const whatIf = cleanShortString(val.whatIf, MAX_NODE_FIELD_CHARS);
      const childPath = cleanGraphLink(val.childPath);
      const files = Array.isArray(val.files)
        ? Array.from(
            new Set(
              val.files
                .filter((f): f is string => typeof f === 'string')
                .map((f) => f.trim())
                .filter((f) => f.length > 0 && f.length <= 180)
            )
          ).slice(0, MAX_NODE_FILES)
        : undefined;

      if (!summary && !example && !whatIf && !childPath && (!files || files.length === 0)) {
        continue;
      }

      parsedNodes[nodeId] = {
        ...(label ? { label } : {}),
        summary: summary || (childPath ? `Zoom into ${childPath}` : nodeId),
        ...(example ? { example } : {}),
        ...(whatIf ? { whatIf } : {}),
        ...(files && files.length > 0 ? { files } : {}),
        ...(childPath ? { childPath } : {}),
      };
    }

    if (Object.keys(parsedNodes).length > 0) {
      nodes = parsedNodes;
    }
  }

  if (!gist && !parentPath && !steps && !nodes) {
    return undefined;
  }

  return {
    ...(gist ? { gist } : {}),
    ...(parentPath ? { parentPath } : {}),
    ...(steps ? { steps } : {}),
    ...(nodes ? { nodes } : {}),
  };
}

export function serializeGuideCanonical(
  guide: DiagramComprehensionGuide | undefined
): string {
  if (!guide) return '';
  return JSON.stringify(guide);
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

/**
 * Rewrites `parentPath` and `childPath` links inside a comprehension guide
 * when a `.mmd` file or folder is moved via `mermaid_mv` / Explorer rename.
 */
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
