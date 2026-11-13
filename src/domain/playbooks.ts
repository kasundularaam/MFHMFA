import type { LearningMode, VfsLsResult } from '../shared/types.js';
import { SYNTAX_GUIDES } from './catalog.js';

export const LEARNING_MODES: readonly LearningMode[] = [
  'concept',
  'paper',
  'codebase',
  'bug',
  'tradeoff',
];

const CORE_COMPREHENSION_CONTRACT = `## Universal Comprehension Rules (Cognitive Load, Dual Coding & Plain Human Writing)
1. **4–7 Boxes Per View, 2–5 Plain Words Per Box**:
   - Humans hold ~4–6 novel items in working memory at once. Keep each \`.mmd\` view to **4–7 core boxes** with short, everyday role labels.
   - Never cram sentences, raw variable names, or equations inside box labels. Put technical names in \`guide.nodes[nodeId].term\` and full explanations in \`guide.nodes[nodeId]\`.
   - For deeper internals, create separate child \`.mmd\` views linked via \`guide.nodes[nodeId].childPath\` (and set \`guide.parentPath\` on each child view).
2. **Write Like a Human, Not an LLM**:
   - Write \`gist\`, \`caption\`, \`summary\`, and \`whatIf\` like a clear-headed engineer talking at a whiteboard.
   - Choose simple, direct words and concrete verbs (\`sends\`, \`waits 2s\`, \`drops\`, \`retries\`). Keep sentences short.
   - Cut AI filler: no em-dashes, no coined slogans, no dramatic intros, no \`"not just X, it's Y"\` phrasing, no buzzword padding, and no forced metaphors. Every word should earn its spot.
3. **Self-Verify Visually**:
   - Inspect the 2x PNG and \`layoutDiagnostics\` returned by \`render_view\`. Fix overlaps, wide ribbons, or awkward wrapping by re-rendering the same \`path\` (rapid retries merge into 1 version).
4. **Stay Quiet in Chat**:
   - When \`syncedToBrowser\` is \`true\`, **do NOT paste raw \`\`\`mermaid\`\`\` blocks or URLs in chat** unless the user asks. Give a brief, plain reply and let them explore the view in MFHMFA Studio.`;

const MERMAID_ESCAPING_ESSENTIALS = `## Mermaid Syntax Essentials (Prevents 95% of Parse Errors)
- **Quote labels with punctuation**: \`Node["Fetch data (JSON)"]\`, \`Check{"Is x > 0?"}\` (unquoted \`()\`, \`{}\`, \`[]\`, \`:\` break parsing).
- **Never use lowercase \`end\` as a bare node ID**: use \`End\` or \`doneNode["end"]\`.
- **Line breaks & inner quotes**: use \`<br/>\` for multi-line labels and \`#quot;\` for inner quotes inside \`["..."]\`.
- **Raw Mermaid only**: never wrap \`code\` in \`\`\`mermaid fences; prefer \`flowchart TB\` over \`LR\` when > 5 sequential hops.`;

export const LEARNING_MODE_PLAYBOOKS: Record<LearningMode, string> = {
  concept: `# Learning Playbook: \`concept\` (Technology, Algorithm, Protocol, or Mental Model)

## Goal
Help the learner trace how the mechanism actually works in their head, without drowning them in jargon or hiding the real mechanics.

## Teaching Steps
1. **State the Problem First (\`guide.gist\`)**:
   - Say what goes wrong without this idea first, then state how it solves that problem in one plain sentence.
2. **Plain Role on the Box, Real Term on the Card (\`guide.nodes\`)**:
   - Label boxes with 2–4 plain action words (e.g. \`"Append Log"\`, \`"Election Timer"\`), not unexplained acronyms.
   - Put the official technical name in \`nodes[id].term\` (\`"Write-Ahead Log (WAL)"\`, \`"Randomized Election Timeout"\`) so the user connects the plain idea to the real term.
   - Keep \`summary\` (what happens here), \`example\` (real input -> output numbers), and \`whatIf\` (what breaks at the edges) short and concrete.
3. **Follow One Concrete Item (\`guide.steps\` or \`guide.flows\`)**:
   - Pick **one small example with real numbers** (e.g. \`3 nodes\`, \`$20 transfer\`, \`key="u42"\`) and follow that same item hop-by-hop in \`step.trace\` (e.g. \`"term=2, votes=2/3 -> Leader elected"\`).
   - Use \`flows\` when comparing *Normal Path* vs. *Failure / Edge Case* makes the idea click faster.
4. **Add One Quick Check (\`step.check\`)**:
   - Add 1 \`check: { question, answer }\` on the key step to test a common misunderstanding before showing the answer.`,

  paper: `# Learning Playbook: \`paper\` (Research Paper, ML Architecture, or Mathematical Method)

## Goal
Turn dense paper notation into a clear visual flow grounded in real tensor/data shapes, tiny numbers, and exact paper sections.

## Teaching Steps
1. **Old Bottleneck vs. Core Idea (\`guide.gist\` & \`guide.flows\`)**:
   - Do not draw a 15-box architecture poster first. State the **prior bottleneck** and the paper's **main idea** plainly in \`gist\`.
   - When helpful, include 2 \`flows\` on the same map: \`"1. Baseline Bottleneck"\` vs. \`"2. Paper's Method"\` so the user sees why the change matters.
2. **Concrete Shapes & Tiny Numbers Over Raw Symbols**:
   - Keep box labels in plain English (\`"Tile Into Fast SRAM"\`, \`"Group Relative Advantage"\`).
   - Show concrete shapes or small numbers in \`step.trace\` and \`node.example\` (e.g. \`"[4 tokens x 64d] -> 4x4 score tile, 0 HBM writes"\`).
   - Put formal notation or equations in \`node.term\` (\`"Eq. 4: Softmax(QK^T / sqrt(d))V"\`) and cite exact sections/figures in \`node.refs\` (\`["§3.2", "Algorithm 1", "Fig. 2"]\`).
3. **Zoom Into Sub-Blocks (\`childPath\`)**:
   - Keep the top view to 4–6 main stages; link detailed blocks (custom kernels, loss steps, training loops) via \`node.childPath\`.
4. **Limits & Tradeoffs (\`node.whatIf\` & \`step.check\`)**:
   - Note assumptions or where the method struggles in \`node.whatIf\`, and add 1 \`step.check\` on the main insight.`,

  codebase: `# Learning Playbook: \`codebase\` (Repository Architecture, Execution Flow, or PR)

## Goal
Help a developer who didn't write this code trace a real request, state update, and failure case through the repo.

## Teaching Steps
1. **Follow One Action, Not a Folder List**:
   - Show how **one real request or action** enters the code, changes data, updates state, and triggers side effects.
2. **Plain Roles on Boxes, Code Paths on Cards (\`guide.nodes\`)**:
   - Keep box labels to 2–5 plain words (\`"SSE Relay"\`, \`"5-Version History"\`).
   - Put the real class or function name in \`node.term\` (\`"StatelessWorkspaceRelay"\`), exact repo paths in \`node.refs\` (\`["src/infrastructure/ephemeral/workspaceRelay.ts"]\`), real payload sizes/timings in \`node.example\`, and timeout/crash behavior in \`node.whatIf\`.
3. **Overview First, Details in Sub-Views (\`childPath\` / \`parentPath\`)**:
   - Start with a 4–6 box \`overview.mmd\`. Put subsystem details into child \`.mmd\` views linked via \`node.childPath\` (and set \`guide.parentPath\` on children).
4. **Real Runtime Values (\`guide.steps\` / \`guide.flows\`)**:
   - Show the actual runtime payload or state at each hop in \`step.trace\`. Add a second flow in \`guide.flows\` when comparing *Normal Path* vs. *Error / Retry Path*.`,

  bug: `# Learning Playbook: \`bug\` (Root-Cause Analysis, Race Condition, or Incident)

## Goal
Show clearly **what the code assumed would happen** versus **the exact hop where state or timing went wrong**.

## Teaching Steps
1. **Name What Broke (\`guide.gist\`)**:
   - State what rule or assumption broke, and what triggered it, in one plain sentence.
2. **Compare Expected vs. Bug on One Map (\`guide.flows\`)**:
   - Attach **2 flows** in \`guide.flows\`:
     1. \`"Expected Path"\`: how the code works normally.
     2. \`"Bug Trace"\`: the bad input, race interleaving, or missing check that causes the bug.
3. **Show the Bad State Hop-by-Hop (\`step.trace\`)**:
   - Show the concrete variable, payload, or lock state at each step in \`step.trace\` (e.g. \`"req.tenantId = undefined -> WHERE tenant_id IS NULL -> 0 rows"\`) up to the failure.
   - Optional: add a \`step.check\` right before the broken step (*"What value arrives here when two retries overlap?"*).
4. **Point to the Fix (\`guide.nodes\`)**:
   - On the broken component's card, use \`whatIf\` for the failure case, \`example\` for *Before vs. After Fix*, and \`refs\` for exact \`file:line\` locations.`,

  tradeoff: `# Learning Playbook: \`tradeoff\` (Solution Design, Architecture Decision, or Option A vs. B)

## Goal
Test design options against the user's real constraints using concrete numbers instead of vague pros/cons lists.

## Teaching Steps
1. **Lead With the Main Constraint (\`guide.gist\`)**:
   - Name the constraint that decides the choice (latency, consistency, memory limit, cost, or simplicity) and why one option fits better.
2. **Run the Same Workload Through Both Scenarios (\`guide.flows\`)**:
   - Trace **the same workload** across flows in \`guide.flows\` (e.g. \`"1. Normal Load"\` vs. \`"2. 10x Spike / Node Crash"\`, or \`"Option A"\` vs. \`"Option B"\`) with real numbers in \`step.trace\` (ms, round-trips, KB, RPS).
3. **State Where It Stops Working (\`guide.nodes\`)**:
   - Put concrete latency/throughput/cost numbers in \`node.example\`, and use \`node.whatIf\` to state **exact breakpoints** where you would switch designs.
   - Add 1 \`step.check\` asking which limit hits first under load.`,
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
      `**User's Current Studio Focus:** ${focusParts.join(' · ')}. If the user says "this box", "this step", or "dig deeper here", they are referring to this selection.`
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
