import type { LearningMode, VfsLsResult } from '../shared/types.js';
import { SYNTAX_GUIDES } from './catalog.js';

export const LEARNING_MODES: readonly LearningMode[] = [
  'concept',
  'paper',
  'codebase',
  'bug',
  'tradeoff',
];

const CORE_COMPREHENSION_CONTRACT = `## Universal Comprehension Rules (Cognitive Load, Visual Clarity & Plain Human Writing)
1. **4–7 Boxes Per View, 2–5 Plain Words Per Box**:
   - Humans hold ~4–6 novel items in working memory at once. Keep each \`.mmd\` view to **4–7 core boxes** with short, everyday role labels.
   - Never cram sentences, raw variable names, or equations inside box labels. Put technical names in \`guide.nodes[nodeId].term\` and full explanations in \`guide.nodes[nodeId]\`.
   - For deeper internals, create separate child \`.mmd\` views linked via \`guide.nodes[nodeId].childPath\` (and set \`guide.parentPath\` on each child view).
2. **Make Every Box's Kind Unmistakable (Shape + \`node.kind\`)**:
   - Never draw everything as plain rectangles when boxes represent different kinds of things (tables vs. services vs. cron jobs vs. users). Match each Mermaid shape to \`guide.nodes[id].kind\` so Studio's auto-legend makes the map readable at a glance:
     - \`(["..."])\` stadium -> \`kind: "actor"\` (user, browser, external client, webhook)
     - \`["..."]\` rectangle -> \`kind: "service"\` (API, service, class, function) or \`"concept"\`
     - \`[("...")]\` cylinder -> \`kind: "store"\` (database table, cache, Redis, S3, file)
     - \`{{"..."}}\` hexagon -> \`kind: "job"\` (cron job, scheduled refresh, background worker/consumer)
     - \`[/"..."/]\` parallelogram -> \`kind: "queue"\` (Kafka topic, message queue, event stream)
     - \`{"..."}\` diamond -> \`kind: "decision"\` (rule check, branch, gate)
     - \`[["..."]]\` subroutine -> \`kind: "subsystem"\` (zoomed-out multi-part area that links to \`childPath\`)
   - **One kind per leaf box**: On detailed views, do not mash a service + two tables into one box. Split them or mark an overview box as \`kind: "subsystem"\` with \`[["..."]]\` and \`childPath\`.
3. **Make Every Arrow Unambiguous**:
   - **Label every arrow with a short verb + noun** (\`reads profile\`, \`writes exposure\`, \`publishes click\`, \`updates weights\`). Avoid unlabeled \`A --> B\` edges.
   - **Solid (\`-->\`)** = direct call, immediate write/read, or synchronous step. **Dashed (\`-.->\`)** = async event, background job, or indirect/delayed read.
   - **Avoid \`<-->\` bidirectional arrows** when two different actions happen in opposite directions; draw two separate one-way labeled arrows instead.
   - Optional: add \`guide.legend\` only if you want domain-specific wording beyond Studio's automatic shape/edge legend.
4. **One Concrete Human Example Throughout (\`guide.scenario\`, \`node.example\`, \`step.trace\`)**:
   - Set \`guide.scenario\` to **one simple, real-world example** (one person, one order, one request — e.g. *"Maya visits the homepage while a hero banner test compares Banner A vs. Banner B."*) and reuse that exact example across every step and box card. Do not invent disconnected opaque IDs (\`ex_88\`, \`ent_42\`, \`v_918\`) at every hop.
   - Write \`node.example\` as **1–2 plain English sentences** showing what happens to that real example here. **NEVER write cryptic arrow shorthand or raw column dumps** (bad: \`"/decide -> exposure(arm='b', bucket='personalized')"\` or \`"REVENUE cap=$100: $40 -> 0.40 mass"\`; good: *"Maya visits the homepage. In under 5ms, this service checks her running-shoe history and picks Banner B without creating a journey run."*).
   - Keep \`step.trace\` short, readable, and anchored to the same scenario (e.g. \`"Maya -> shown Banner B (logged as exposure)"\`), skipping unexplained internal column soup.
5. **Write Like a Human, Not an LLM**:
   - Write \`gist\`, \`scenario\`, \`caption\`, \`summary\`, \`example\`, and \`whatIf\` like a clear-headed engineer talking at a whiteboard.
   - Choose simple, direct words and concrete verbs (\`sends\`, \`waits 2s\`, \`drops\`, \`retries\`). Keep sentences short.
   - Cut AI filler: no em-dashes, no coined slogans, no dramatic intros, no \`"not just X, it's Y"\` phrasing, no buzzword padding, and no forced metaphors. Every word should earn its spot.
6. **Self-Verify Visually**:
   - Inspect the 2x PNG, \`warnings\`, and \`layoutDiagnostics\` returned by \`render_view\`. Fix overlaps, unlabeled edges, uniform mystery rectangles, or awkward wrapping by re-rendering the same \`path\` (rapid retries merge into 1 version).
7. **Stay Quiet in Chat**:
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
   - Label boxes with 2–4 plain action words (e.g. \`"Append Log"\`, \`"Election Timer"\`), using the matching Mermaid shape and \`kind\`.
   - Put the official technical name in \`nodes[id].term\` (\`"Write-Ahead Log (WAL)"\`, \`"Randomized Election Timeout"\`) so the user connects the plain idea to the real term.
   - Keep \`summary\` (what happens here), \`example\` (1–2 plain English sentences walking \`guide.scenario\` through this box), and \`whatIf\` (what breaks at the edges) concrete and easy to read.
3. **Follow One Concrete Item (\`guide.scenario\`, \`guide.steps\` or \`guide.flows\`)**:
   - Set \`guide.scenario\` to **one small real-world example** (e.g. *3 database servers running a $20 transfer*) and follow that same item hop-by-hop in \`step.trace\` (e.g. \`"Term 2: Node B gets 2 of 3 votes -> becomes leader"\`).
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
2. **Concrete Shapes & Tiny Numbers in Plain English**:
   - Keep box labels in plain English (\`"Tile Into Fast SRAM"\`, \`"Group Relative Advantage"\`) with matching shapes and \`kind\`.
   - Set \`guide.scenario\` to one tiny concrete input (e.g. *4 words of 64 numbers each*) and explain what happens to it in plain English inside \`node.example\`, keeping \`step.trace\` short and readable (e.g. \`"4 tokens x 64 dims -> 4x4 score tile kept in SRAM"\`).
   - Put formal notation or equations in \`node.term\` (\`"Eq. 4: Softmax(QK^T / sqrt(d))V"\`) and cite exact sections/figures in \`node.refs\` (\`["§3.2", "Algorithm 1", "Fig. 2"]\`).
3. **Zoom Into Sub-Blocks (\`childPath\`)**:
   - Keep the top view to 4–6 main stages; link detailed blocks (custom kernels, loss steps, training loops) via \`node.childPath\`.
4. **Limits & Tradeoffs (\`node.whatIf\` & \`step.check\`)**:
   - Note assumptions or where the method struggles in \`node.whatIf\`, and add 1 \`step.check\` on the main insight.`,

  codebase: `# Learning Playbook: \`codebase\` (How Code Actually Works)

## Goal
Explain this code the way a sharp, honest teammate would at a whiteboard: cut through wrapper layers, show where the real work and state live, and tell a clear story that is genuinely interesting to read.

## 1. Cut Through Over-Engineering & Vibe-Coded Mess First
Real repos are rarely clean textbook diagrams. Before drawing:
- **Trace real calls, never trust names**: Follow actual imports, call sites, and state writes. A file named \`helper.ts\` may hold the core logic, while a fancy \`Manager\` class may be dead code.
- **Collapse pass-through wrappers**: If \`Route -> Controller -> Service -> Helper\` just forwards arguments unchanged, do **not** draw 4 boxes. Draw **1 box** for the real job and note in \`summary\` which wrapper files just pass it through.
- **Skip dead code, flag traps**: Only put code that actually runs on the map. If leftover files or duplicate state stores sit nearby, warn the reader in \`summary\` or \`whatIf\` so they don't waste time reading dead paths.
- **Be candid, never flattering (and never snarky)**: Don't dress up accidental complexity as "clean modular orchestration." If one 500-line component fetches data, mutates global state, and renders UI all at once, say that plainly.

## 2. Write a Connected Story, Not Log Lines (\`guide.gist\` & \`guide.steps\`)
In Studio, \`gist\` and \`steps\` read top-to-bottom as a short article beside the diagram:
- **Lead with the hook (\`gist\`)**: In 1–2 plain sentences, state what user action or job this code handles and the **one key thing to know** about how it is wired (including any twist or shortcut).
- **Follow one real trigger end-to-end (\`steps\`)**: Pick a concrete action (clicking "Save", opening a page, receiving a webhook) and connect each step with cause and effect (*"Before touching the database, it checks…", "Here is the catch…"*). Do not write robotic fragments (*"Validates input. Calls service. Updates store."*).
- **Keep code symbols out of prose**: \`CamelCaseNames\` and \`file/paths.ts\` mid-sentence make text uncomfortable to read. Write sentences in plain English, and keep exact identifiers in \`node.term\`, data shapes in \`step.trace\`, and file paths in \`node.refs\`.

### Tone Check
- **Stiff AI prose**: *"The SyncOrchestrator seamlessly coordinates state hydration with the PersistenceAdapter to ensure consistency."*
- **Natural human prose**: *"When you open the page, it loads your saved diagrams from IndexedDB before opening the live stream, so incoming updates never overwrite local history."*

## 3. Put Clear Types, Real Code Anchors & Plain Examples on Box Cards (\`guide.nodes\`)
- **Box label + Mermaid shape + \`kind\`**: 2–5 plain words for the real job, using the matching Mermaid shape and \`kind\` (\`store\` cylinder for tables/caches, \`service\` rectangle for endpoints/classes, \`job\` hexagon for cron/consumers, \`queue\` parallelogram for Kafka/queues, \`actor\` stadium for users/browsers, \`subsystem\` subroutine for zoomed-out drillable areas).
- **\`term\`**: Exact table name, function, class, hook, or store name (\`"loadWorkspaceFromIndexedDb()"\` or \`"content_slot_events table"\`). Avoid listing 4 unrelated classes/tables on one leaf box.
- **\`summary\`**: 1–2 natural sentences on what actually happens here (note collapsed wrappers if any).
- **\`example\`**: 1–2 plain English sentences showing what happens to your \`guide.scenario\` subject at this exact box. Do **not** write cryptic \`a -> b; c -> d\` shorthand or unexplained column names.
- **\`whatIf\`**: **Real fragility in *this* code**: swallowed errors, race windows, duplicate state that can drift, or hidden side effects. Skip generic filler like *"fails if the network is down."*
- **\`refs\`**: Exact repo file paths (\`"web/services/workspacePersistence.ts"\`) so the reader can open the source.

## 4. Structure Views Cleanly (\`flows\`, \`check\`, \`childPath\`)
- **\`flows\`**: Add a second scenario tab when contrasting two paths makes the code click faster (e.g. \`"Normal Save"\` vs. \`"Double-Click / Stale State"\`).
- **\`check\`**: Add 1 quick prediction question on the trickiest or most surprising step.
- **\`childPath\` / \`parentPath\`**: Keep \`overview.mmd\` to 4–6 boxes showing the true runtime backbone; move genuinely complex subsystems into linked child \`.mmd\` views (setting \`guide.parentPath\` on each child).`,

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
