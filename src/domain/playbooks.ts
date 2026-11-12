import type { LearningMode, VfsLsResult } from '../shared/types.js';
import { SYNTAX_GUIDES } from './catalog.js';

export const LEARNING_MODES: readonly LearningMode[] = [
  'concept',
  'paper',
  'codebase',
  'bug',
  'tradeoff',
];

const CORE_COMPREHENSION_CONTRACT = `## Universal Comprehension Rules (Cognitive Load & Dual Coding)
1. **4–7 Boxes Per View, 2–5 Plain Words Per Box**:
   - Humans hold ~4–6 novel interacting items in working memory at once. Keep each \`.mmd\` view to **4–7 core boxes** with short plain-English role labels.
   - Never cram sentences, raw variable names, or equations inside box labels. Put rich explanations into \`guide.nodes[nodeId]\`.
   - For deeper internals, render clean child \`.mmd\` views and link them via \`guide.nodes[nodeId].childPath\` (setting \`guide.parentPath\` on each child view).
2. **Self-Verify Visually**:
   - Inspect the 2x PNG returned by \`render_view\` and \`layoutDiagnostics\`. Fix overlaps, cramped ribbons, or truncation by re-rendering the same \`path\` (rapid retries coalesce automatically into 1 revision).
3. **Silent Delivery in Chat**:
   - When \`syncedToBrowser\` is \`true\`, **do NOT paste raw \`\`\`mermaid\`\`\` blocks or URLs in chat** unless the user explicitly asks. Give a clear, concise summary and invite the user to step through the view in MFHMFA Studio.`;

const MERMAID_ESCAPING_ESSENTIALS = `## Mermaid Syntax Essentials (Prevents 95% of Parse Errors)
- **Quote labels with punctuation**: \`Node["Fetch data (JSON)"]\`, \`Check{"Is x > 0?"}\` (unquoted \`()\`, \`{}\`, \`[]\`, \`:\` break parsing).
- **Never use lowercase \`end\` as a bare node ID**: use \`End\` or \`doneNode["end"]\`.
- **Line breaks & inner quotes**: use \`<br/>\` for multi-line labels and \`#quot;\` for inner quotes inside \`["..."]\`.
- **Raw Mermaid only**: never wrap \`code\` in \`\`\`mermaid fences; prefer \`flowchart TB\` over \`LR\` when > 5 sequential hops.`;

export const LEARNING_MODE_PLAYBOOKS: Record<LearningMode, string> = {
  concept: `# Learning Playbook: \`concept\` (Technology, Algorithm, Protocol, or Mental Model)

## Goal
Bridge the gap between "too jargon-heavy" and "uselessly vague" so the learner can **mentally simulate** how the mechanism actually works and where it breaks.

## Step-by-Step Teaching Blueprint
1. **Problem Before Mechanism (\`guide.gist\`)**:
   - State *what fails or hurts without this concept* first, then state the core mechanism in 1 plain sentence.
2. **Intuition on Canvas, Jargon on Cards (\`guide.nodes\`)**:
   - Label boxes by **physical role/action** in 2–4 plain words (e.g. \`"Append Log"\`, \`"Vote Timer"\`), NOT unexplained acronyms.
   - Set \`nodes[id].term\` to the real technical term (\`"Write-Ahead Log (WAL)"\`, \`"Randomized Election Timeout"\`) so the user connects plain intuition to real vocabulary.
   - Fill \`summary\` (concrete mechanism), \`example\` (input -> output with real numbers), and \`whatIf\` (what breaks at boundaries).
3. **One Concrete Toy Run (\`guide.steps\` or \`guide.flows\`)**:
   - Pick **one tiny concrete item with real numbers** (e.g. \`3 nodes\`, \`$20 transfer\`, \`key="u42"\`) and trace that *exact same item* hop-by-hop using \`step.trace\` (e.g. \`"term=2, votes=2/3 -> Leader elected"\`).
   - Use \`flows\` if contrasting *Normal Operation* vs. *Failure / Edge Case* makes the design click faster.
4. **Beat Passive Reading (\`step.check\`)**:
   - Add 1 \`check: { question, answer }\` on the pivotal step to test a common misconception before revealing the outcome.`,

  paper: `# Learning Playbook: \`paper\` (Research Paper, ML Architecture, or Mathematical Method)

## Goal
Turn dense academic prose and equations into a **runnable visual intuition** anchored to concrete data shapes, tiny toy numbers, and exact paper sections.

## Step-by-Step Teaching Blueprint
1. **Bottleneck vs. Core Trick (\`guide.gist\` & \`guide.flows\`)**:
   - Never dump a 15-block full architecture poster first. State the **prior bottleneck** and the paper's **single core insight** in \`gist\`.
   - When helpful, provide 2 contrasting \`flows\` on the map: \`"1. Baseline Bottleneck"\` vs. \`"2. Paper's Method"\` so the learner sees *why* the new mechanism exists.
2. **Shapes & Toy Numbers Over Raw Symbols**:
   - Keep box labels in plain functional English (\`"Tile Into Fast SRAM"\`, \`"Group Relative Advantage"\`).
   - Translate equations into **concrete tensor shapes or tiny numbers** in \`step.trace\` and \`node.example\` (e.g. \`"[4 tokens x 64d] -> 4x4 score tile, 0 HBM writes"\`).
   - Anchor formal paper terminology/math in \`node.term\` (\`"Eq. 4: Softmax(QK^T / sqrt(d))V"\`) and cite sections/figures in \`node.refs\` (\`["§3.2", "Algorithm 1", "Fig. 2"]\`).
3. **Decompose Multi-Stage Architectures (\`childPath\`)**:
   - Keep the top overview to 4–6 macro stages; zoom into intricate blocks (e.g. custom attention kernel, loss computation, training loop) via \`node.childPath\`.
4. **Honest Assumptions & Failure Regimes (\`node.whatIf\` & \`step.check\`)**:
   - Document assumptions, compute/memory tradeoffs, or where the method degrades in \`node.whatIf\`, and include 1 \`step.check\` on the key insight.`,

  codebase: `# Learning Playbook: \`codebase\` (Repository Architecture, Execution Flow, or PR)

## Goal
Let a builder who didn't write this code **mentally trace a live request, state change, and failure mode** across the real codebase.

## Step-by-Step Teaching Blueprint
1. **Trace Causality, Not Static Folder Trees**:
   - Diagram how **one real action/request** enters, transforms data, mutates state, and produces side effects—not a passive list of directories.
2. **Plain Roles on Canvas, Real Code Anchors on Cards (\`guide.nodes\`)**:
   - Keep box labels to 2–5 plain words (\`"Pass-Through SSE Relay"\`, \`"5-Version Ring Buffer"\`).
   - Set \`node.term\` to the exact symbol/class/service (\`"StatelessWorkspaceRelay"\`), \`node.refs\` to exact repo file paths (\`["src/infrastructure/ephemeral/workspaceRelay.ts"]\`), \`node.example\` to real payload sizes/timings, and \`node.whatIf\` to timeout/crash/drop behavior.
3. **Google-Maps Altitudes (\`childPath\` / \`parentPath\`)**:
   - Start with a 4–6 box \`overview.mmd\`. Push subsystem internals into linked child \`.mmd\` views via \`node.childPath\` (and set \`guide.parentPath\` on children).
4. **Concrete Runtime Trace (\`guide.steps\` / \`guide.flows\`)**:
   - Populate \`step.trace\` with the actual runtime payload/state at each hop. Add a second flow in \`guide.flows\` when contrasting *Happy Path* vs. *Error / Retry / Offline Path*.`,

  bug: `# Learning Playbook: \`bug\` (Root-Cause Analysis, Race Condition, or Incident)

## Goal
Make the root cause unmistakable by contrasting **what the system assumed would happen** against **the exact hop where state or ordering broke**.

## Step-by-Step Teaching Blueprint
1. **Pinpoint the Broken Invariant (\`guide.gist\`)**:
   - State the exact invariant that broke and under what trigger condition in 1 plain sentence.
2. **Contrasting Flows on the Same Map (\`guide.flows\`)**:
   - Attach **2 scenarios** in \`guide.flows\`:
     1. \`"Expected Path"\` — how the invariant holds normally.
     2. \`"Bug Trace"\` — the exact interleaving, bad input, or missing check that triggers failure.
3. **Hop-by-Hop State Corruption (\`step.trace\`)**:
   - Show the concrete variable/payload/lock state at every step in \`step.trace\` (e.g. \`"req.tenantId = undefined -> WHERE tenant_id IS NULL -> 0 rows"\`) right up to the failure symptom.
   - Optional: put a \`step.check\` right before the bug hop (*"What value arrives here when retries overlap?"*).
4. **Ground the Fix (\`guide.nodes\`)**:
   - On the faulty component's card, use \`whatIf\` for the broken edge case, \`example\` for *Before vs. After Fix* state, and \`refs\` for exact \`file:line\` locations.`,

  tradeoff: `# Learning Playbook: \`tradeoff\` (Solution Design, Architecture Decision, or Option A vs. B)

## Goal
Replace hand-wavy pros/cons lists with a **concrete mechanical stress-test** under the user's real constraints.

## Step-by-Step Teaching Blueprint
1. **Constraint First (\`guide.gist\`)**:
   - Anchor \`gist\` on the deciding constraint (tail latency, consistency under partition, memory ceiling, cost, or implementation complexity) and why the recommended path wins.
2. **Stress-Test Scenarios (\`guide.flows\`)**:
   - Run **the exact same workload** across scenarios in \`guide.flows\` (e.g. \`"1. Normal Load"\` vs. \`"2. 10x Spike / Node Crash"\`, or \`"Option A Flow"\` vs. \`"Option B Flow"\`) with concrete numbers in \`step.trace\` (ms, round-trips, KB, RPS).
3. **Explicit Breakpoints (\`guide.nodes\`)**:
   - Use \`node.example\` for concrete throughput/latency/cost numbers and \`node.whatIf\` to state **when this choice stops working** (the exact scale or failure condition that would flip the decision).
   - Add 1 \`step.check\` testing which constraint breaks first under stress.`,
};

export function formatWorkspaceSnapshotForPlaybook(
  lsResult: VfsLsResult | null,
  syncNote?: string
): string {
  if (!lsResult) {
    return [
      '## Live Workspace Context',
      syncNote ||
        'Browser workspace is not currently reachable (Studio tab closed or workspace not paired). You can still validate/render views, or ask the user to open MFHMFA Studio for live sync.',
    ].join('\n');
  }

  const lines: string[] = [
    '## Live Workspace Context',
    `Project: \`${lsResult.project}\``,
    '```text',
    lsResult.treeText,
    '```',
  ];

  if (lsResult.viewerFocus) {
    const vf = lsResult.viewerFocus;
    const focusParts: string[] = [`active view \`${vf.activePath}\` (v${vf.viewingVersion})`];
    if (vf.activeFlowLabel) {
      focusParts.push(`flow "${vf.activeFlowLabel}"`);
    }
    if (typeof vf.activeStepIndex === 'number') {
      focusParts.push(
        `step ${vf.activeStepIndex + 1}${vf.activeStepTitle ? ` ("${vf.activeStepTitle}")` : ''}`
      );
    }
    if (vf.selectedNodeId) {
      focusParts.push(`selected box \`${vf.selectedNodeId}\``);
    }
    lines.push(
      `**User's Current Studio Focus:** ${focusParts.join(' · ')} — if the user says "this box", "this step", or "dig deeper here", they are referring to this selection.`
    );
  }

  return lines.join('\n');
}

export function buildLearningPlaybookDocument(params: {
  mode: LearningMode;
  syntaxTopic?: string;
  lsResult: VfsLsResult | null;
  syncNote?: string;
}): string {
  const sections: string[] = [
    LEARNING_MODE_PLAYBOOKS[params.mode],
    CORE_COMPREHENSION_CONTRACT,
    MERMAID_ESCAPING_ESSENTIALS,
  ];

  if (params.syntaxTopic) {
    const key = params.syntaxTopic
      .toLowerCase()
      .replace(/diagram|-v2|-beta/g, '')
      .trim();
    const extra = SYNTAX_GUIDES[key];
    if (extra && key !== 'comprehension' && key !== 'pitfalls') {
      sections.push(extra);
    }
  }

  sections.push(formatWorkspaceSnapshotForPlaybook(params.lsResult, params.syncNote));
  return sections.join('\n\n---\n\n');
}
