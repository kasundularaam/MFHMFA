import type { DiagramComprehensionGuide, DiagramWalkthroughStep } from '../../src/shared/types';

const GENERATED_PREFIX_RE = /^(?:mfhmfa_svg_\d+|mmd_render_\d+_\d+)-/;

export function extractRawMermaidNodeId(el: Element): string | null {
  const tag = el.tagName.toLowerCase();

  if (el.getAttribute('data-type') === 'participant') {
    const pid = el.getAttribute('data-id');
    if (pid) return pid;
  }

  if (tag === 'rect' && el.classList.contains('actor')) {
    const actorName = el.getAttribute('name');
    if (actorName) return actorName;
  }

  const rawId = el.getAttribute('id') || '';
  if (rawId) {
    const stripped = rawId.replace(GENERATED_PREFIX_RE, '');
    const flowMatch = stripped.match(/^flowchart-(.+)-\d+$/);
    if (flowMatch?.[1]) return flowMatch[1];

    const stateMatch = stripped.match(/^state-(.+)-\d+$/);
    if (stateMatch?.[1]) return stateMatch[1];

    const classMatch = stripped.match(/^classId-(.+)-\d+$/);
    if (classMatch?.[1]) return classMatch[1];

    const entityMatch = stripped.match(/^entity-(.+)-\d+$/);
    if (entityMatch?.[1]) return entityMatch[1];

    if (el.classList.contains('cluster') && stripped) {
      return stripped;
    }
  }

  const dataId = el.getAttribute('data-id');
  if (
    dataId &&
    !dataId.startsWith('L_') &&
    el.getAttribute('data-edge') !== 'true' &&
    el.getAttribute('data-et') !== 'message' &&
    el.getAttribute('data-et') !== 'life-line'
  ) {
    return dataId;
  }

  return null;
}

function isEdgeBetweenFocusedNodes(edgeKey: string, focusedIds: Set<string>): boolean {
  const stripped = edgeKey.replace(GENERATED_PREFIX_RE, '');
  const match = stripped.match(/^L_(.+)_\d+$/);
  if (!match?.[1]) return false;
  const body = match[1];

  for (const fromId of focusedIds) {
    if (!body.startsWith(`${fromId}_`)) continue;
    const rest = body.slice(fromId.length + 1);
    if (focusedIds.has(rest)) {
      return true;
    }
  }
  return false;
}

export interface SvgComprehensionBindResult {
  nodeDisplayLabels: Map<string, string>;
}

/**
 * Decorates a rendered Mermaid SVG container with:
 * 1. Clickable / drillable node affordances (`data-mfhmfa-node`, `.mfhmfa-node-interactive`, `.mfhmfa-node-drillable`)
 * 2. Active selected node highlight (`.mfhmfa-node-selected`)
 * 3. Story Stepper spotlighting (`.mfhmfa-story-active`, `.mfhmfa-focus`, `.mfhmfa-dim`)
 */
export function applySvgComprehensionState(
  stageEl: HTMLElement | null,
  params: {
    guide?: DiagramComprehensionGuide;
    activeStep: DiagramWalkthroughStep | null;
    selectedNodeId: string | null;
  }
): SvgComprehensionBindResult {
  const nodeDisplayLabels = new Map<string, string>();
  if (!stageEl) return { nodeDisplayLabels };

  const svg = stageEl.querySelector('svg');
  if (!svg) return { nodeDisplayLabels };

  // Reset previous comprehension classes cleanly
  svg.classList.remove('mfhmfa-story-active');
  svg
    .querySelectorAll(
      '.mfhmfa-focus, .mfhmfa-dim, .mfhmfa-cluster-soft, .mfhmfa-node-interactive, .mfhmfa-node-drillable, .mfhmfa-node-selected, [data-mfhmfa-actor-text="true"]'
    )
    .forEach((el) => {
      el.classList.remove(
        'mfhmfa-focus',
        'mfhmfa-dim',
        'mfhmfa-cluster-soft',
        'mfhmfa-node-interactive',
        'mfhmfa-node-drillable',
        'mfhmfa-node-selected'
      );
      if (el.getAttribute('data-mfhmfa-actor-text') === 'true') {
        el.removeAttribute('data-mfhmfa-node');
        el.removeAttribute('data-mfhmfa-actor-text');
      }
    });

  const guideNodes = params.guide?.nodes ?? {};
  const lowerGuideKeyMap = new Map<string, string>();
  for (const k of Object.keys(guideNodes)) {
    lowerGuideKeyMap.set(k.toLowerCase(), k);
  }

  // Collect all candidate interactive/focusable elements in the SVG
  const candidateSelectors = [
    'g.node',
    'g[data-type="participant"]',
    'rect.actor',
    'g.cluster',
  ].join(', ');

  const elementEntries: Array<{ el: Element; rawId: string; guideKey: string }> = [];
  const rawIdsInSvg = new Set<string>();
  const lowerSvgIdMap = new Map<string, string>();

  svg.querySelectorAll(candidateSelectors).forEach((el) => {
    // Skip inner rect.actor when already wrapped in <g data-type="participant">
    if (el.tagName.toLowerCase() === 'rect' && el.closest('g[data-type="participant"]')) {
      return;
    }

    const rawId = extractRawMermaidNodeId(el);
    if (!rawId) return;

    rawIdsInSvg.add(rawId);
    if (!lowerSvgIdMap.has(rawId.toLowerCase())) {
      lowerSvgIdMap.set(rawId.toLowerCase(), rawId);
    }

    const guideKey = guideNodes[rawId]
      ? rawId
      : (lowerGuideKeyMap.get(rawId.toLowerCase()) ?? rawId);

    el.setAttribute('data-mfhmfa-node', guideKey);

    const textSample = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (textSample && !nodeDisplayLabels.has(guideKey)) {
      nodeDisplayLabels.set(guideKey, textSample);
    }

    const detail = guideNodes[guideKey];
    if (detail) {
      el.classList.add('mfhmfa-node-interactive');
      if (detail.childPath) {
        el.classList.add('mfhmfa-node-drillable');
      }
    }

    if (params.selectedNodeId && params.selectedNodeId === guideKey) {
      el.classList.add('mfhmfa-node-selected');
    }

    elementEntries.push({ el, rawId, guideKey });
  });

  // Sequence diagrams often emit `<text class="actor">` as a sibling right after `<rect class="actor">`
  // rather than nested inside a group. Bind those sibling `<text>` labels so clicking text opens the card!
  svg.querySelectorAll('text.actor').forEach((textEl) => {
    if (textEl.closest('[data-mfhmfa-node]')) return;
    let sibling = textEl.previousElementSibling;
    let matchedRect: Element | null = null;
    while (sibling) {
      if (sibling.tagName.toLowerCase() === 'rect' && sibling.classList.contains('actor')) {
        matchedRect = sibling;
        break;
      }
      sibling = sibling.previousElementSibling;
    }
    if (!matchedRect) return;
    const guideKey = matchedRect.getAttribute('data-mfhmfa-node');
    const rawId = extractRawMermaidNodeId(matchedRect);
    if (!guideKey || !rawId) return;

    const labelText = (textEl.textContent || '').replace(/\s+/g, ' ').trim();
    if (labelText && !nodeDisplayLabels.has(guideKey)) {
      nodeDisplayLabels.set(guideKey, labelText);
    }

    textEl.setAttribute('data-mfhmfa-node', guideKey);
    textEl.setAttribute('data-mfhmfa-actor-text', 'true');
    if (guideNodes[guideKey]) {
      textEl.classList.add('mfhmfa-node-interactive');
    }
    elementEntries.push({ el: textEl, rawId, guideKey });
  });

  // Apply Story Stepper spotlighting when a step is active
  const step = params.activeStep;
  if (step && step.focusNodes.length > 0) {
    const focusedRawIds = new Set<string>();
    const focusedGuideKeys = new Set<string>();

    for (const token of step.focusNodes) {
      const clean = token.trim();
      if (!clean) continue;
      focusedGuideKeys.add(clean);
      if (rawIdsInSvg.has(clean)) {
        focusedRawIds.add(clean);
      } else {
        const matchedRaw = lowerSvgIdMap.get(clean.toLowerCase());
        if (matchedRaw) focusedRawIds.add(matchedRaw);
      }
      const matchedGuide = lowerGuideKeyMap.get(clean.toLowerCase());
      if (matchedGuide) focusedGuideKeys.add(matchedGuide);
    }

    if (focusedRawIds.size > 0 || focusedGuideKeys.size > 0) {
      svg.classList.add('mfhmfa-story-active');

      for (const { el, rawId, guideKey } of elementEntries) {
        const isFocused = focusedRawIds.has(rawId) || focusedGuideKeys.has(guideKey);

        if (el.classList.contains('cluster')) {
          el.classList.add(isFocused ? 'mfhmfa-focus' : 'mfhmfa-cluster-soft');
        } else {
          el.classList.add(isFocused ? 'mfhmfa-focus' : 'mfhmfa-dim');
        }
      }

      // Sequence diagram lifelines & notes
      svg.querySelectorAll('line.actor-line[data-id]').forEach((line) => {
        const aid = line.getAttribute('data-id') || '';
        const isFocused =
          focusedRawIds.has(aid) ||
          focusedGuideKeys.has(aid) ||
          Boolean(
            lowerSvgIdMap.get(aid.toLowerCase()) &&
              focusedRawIds.has(lowerSvgIdMap.get(aid.toLowerCase())!)
          );
        line.classList.add(isFocused ? 'mfhmfa-focus' : 'mfhmfa-dim');
      });

      // Flowchart / State / Class / ER edges & edge labels
      svg
        .querySelectorAll('path[data-edge="true"], g.edgePaths path, path.flowchart-link')
        .forEach((edgeEl) => {
          const edgeKey = edgeEl.getAttribute('data-id') || edgeEl.getAttribute('id') || '';
          const active = isEdgeBetweenFocusedNodes(edgeKey, focusedRawIds);
          edgeEl.classList.add(active ? 'mfhmfa-focus' : 'mfhmfa-dim');
        });

      svg.querySelectorAll('g.edgeLabel').forEach((labelGroup) => {
        const inner = labelGroup.querySelector('[data-id]');
        const edgeKey = inner?.getAttribute('data-id') || labelGroup.getAttribute('id') || '';
        const active = isEdgeBetweenFocusedNodes(edgeKey, focusedRawIds);
        labelGroup.classList.add(active ? 'mfhmfa-focus' : 'mfhmfa-dim');
      });

      // Sequence diagram messages (`data-from` / `data-to`) & preceding `.messageText`
      svg.querySelectorAll('[data-et="message"]').forEach((msgLine) => {
        const from = msgLine.getAttribute('data-from') || '';
        const to = msgLine.getAttribute('data-to') || '';
        const active = focusedRawIds.has(from) && focusedRawIds.has(to);
        msgLine.classList.add(active ? 'mfhmfa-focus' : 'mfhmfa-dim');

        const prev = msgLine.previousElementSibling;
        if (prev?.classList.contains('messageText')) {
          prev.classList.add(active ? 'mfhmfa-focus' : 'mfhmfa-dim');
        }
      });
    }
  }

  return { nodeDisplayLabels };
}
