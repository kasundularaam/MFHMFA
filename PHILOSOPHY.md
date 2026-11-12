# MFHMFA Philosophy

**Mermaid For Humans, Mermaid For Agents.**

MFHMFA is not a box-drawing utility. It is a **codebase comprehension instrument** designed around how the human brain actually builds mental models of complex software systems with the help of AI coding agents.

---

## 1. The Real Bottleneck: Code Is Cheap, Understanding Is Expensive

AI coding agents can generate thousands of lines of working software across unfamiliar stacks in minutes. That created a new, quiet crisis: **builders increasingly own systems they cannot mentally simulate.**

When you ask an AI agent *"How does this system work?"* or *"Draw me a diagram of how memory is managed"*, standard tools fail in one of two predictable ways:

1. **The Jargon Dump (Too Technical)**
   The agent mirrors the codebase's implementation vocabulary—15 boxes packed with variable names, framework primitives, and 20-word labels. If you do not already know that domain stack, every unfamiliar term consumes a slot of working memory until your brain bounces off the diagram completely.
2. **The Toy Metaphor (Too Abstract)**
   When asked to "simplify", the agent strips away the actual mechanism and leaves vague marketing boxes (*"Live Messenger passes data to Smart Storage"*). The words are easy, **but causality disappears**. You still cannot answer basic questions like *"Where is the bytes buffer right now?"* or *"What breaks if I close my browser tab?"*

**Understanding is neither memorizing variable names nor reading simplified summaries.**
Understanding means **holding a runnable simulation in your head**: *Given input X, what moves where, how big is it, when is it freed, and what breaks when component Y fails?*

---

## 2. Our Benchmark: The Dogfood Comprehension Test

We measure MFHMFA by a single rule:

> **If a builder who does not specialize in a codebase's tech stack can open MFHMFA with an AI agent and genuinely understand how the system works—including its failure modes—then MFHMFA succeeds. If the diagram looks pretty but the human still feels foggy, MFHMFA failed.**

Mermaid syntax alone cannot pass this test, because a single static diagram forces every reader onto one flat altitude with all time steps frozen at once. MFHMFA pairs Mermaid's clean declarative layout with **interactive comprehension layers** grounded in cognitive science.

---

## 3. Five Cognitive Science Pillars

Every feature and agent instruction in MFHMFA maps directly to replicated research on human learning and visual cognition:

### Pillar 1 — Working Memory Limits (~4–7 Chunks per View)
*Basis: Cognitive Load Theory (John Sweller, 1988); Working Memory Capacity (Nelson Cowan, 2001); Visual Information-Seeking Mantra (Ben Shneiderman, 1996).*

Humans can hold roughly **4 to 6 novel interacting elements** in working memory at once. Putting 14 subsystems onto one canvas guarantees overload.
- **In MFHMFA:** Our diagnostics nudge agents to keep each graph to **4–7 core boxes**. Deeper subsystems live in linked child `.mmd` files (`childPath` / `parentPath`), giving you **Google-Maps style zoom-in and zoom-out** instead of one giant poster.

### Pillar 2 — Dual Coding (Separate Shapes from Explanations)
*Basis: Dual Coding Theory (Allan Paivio, 1971).*

The brain processes **spatial topology** (boxes, positions, flow direction) and **verbal prose** through two separate cognitive channels. Cramming 20 words inside a box jams both channels simultaneously—turning a map into a cramped paragraph.
- **In MFHMFA:** Visual boxes stay ultra-short (**2–5 plain words**). Rich verbal details move into **Clickable Node Inspector Cards** that open on demand without cluttering the canvas.

### Pillar 3 — Segmenting & Signaling (Stories Before Maps)
*Basis: Multimedia Learning Principles (Richard Mayer, 2001–2009).*

Controlled studies consistently show that learners understand complex mechanisms far better when a diagram is revealed in **user-paced causal steps** (`Next →`) with visual spotlighting, rather than presented as a static wall of arrows where the eye must hunt for where to start.
- **In MFHMFA:** Agents attach **Story Mode (`steps`)** to diagrams. Stepping forward dims unrelated branches and spotlights *only* the active components and connecting arrows while narrating one concrete flow from start to finish.

### Pillar 4 — Concrete Traces & Counterfactuals ("What Breaks If…")
*Basis: Concreteness Fading (Jerome Bruner, 1966); Mental Models & Causal Interventions (Philip Johnson-Laird, 1983; Judea Pearl).*

Engineers habitually explain systems backwards: *abstract architecture first, concrete example never*. Humans learn in the opposite direction: **watch one concrete item with real numbers move through the system first**, then test boundaries via **counterfactuals** (*"What happens if X closes, fills up, or times out?"*).
- **In MFHMFA:** Every Node Inspector card focuses on three universal anchors:
  1. **Plain Mechanism** — What physically happens here (inputs, outputs, lifetimes).
  2. **Concrete Example** — Real payload shapes, KB/MB sizes, counts, or millisecond timings.
  3. **What Breaks If…** — Exact behavior when a tab closes, a queue fills, or a worker crashes.

### Pillar 5 — Universal Mechanics Over Forced Personalization
*Basis: Avoiding the LLM "Forced-Analogy Trap" (Feynman / 3Blue1Brown Principle).*

When AI tools try to personalize explanations based on a user's job title (e.g. *"User works in AI/ML"*), they routinely caricature the learner—inventing convoluted domain metaphors (*"Imagine browser storage as ring-sharded KV-cache attention..."*) for simple concepts while assuming zero knowledge everywhere else.
- **In MFHMFA:** We deliberately avoid persona-guessing in core explanations. Like 3Blue1Brown or Richard Feynman, agents are instructed to use **universal physical verbs** (*sends, holds for 20m, overwrites, deletes*), **concrete quantities**, and **step-by-step traces** that click for *any* curious human regardless of background.

---

## 4. Architectural Principles

1. **Zero Server Storage (100% Browser `localStorage`)**
   Your architecture maps belong on your machine, not in someone else's database. The MFHMFA server is a pure pass-through SSE bridge + ephemeral PNG renderer (`0` stored diagrams). Your Virtual Diagram Filesystem (`mfhmfa-workspace-v4`), 5-version immutable ring buffer, and comprehension guides live entirely in your browser.
2. **Vision-Closed Loop for Agents**
   Agents should never dump broken Mermaid code or raw URLs into chat. Every `mermaid_render` call validates syntax, renders a **2x Retina PNG** in an isolated headless Chromium slot for the agent's own vision model to inspect, checks layout + cognitive load diagnostics, coalesces rapid layout retries into one clean revision, and streams the finished interactive diagram straight to your open Studio tab.
3. **Human Sovereignty Over the Workspace**
   Multiple coding agents (`Claude Code`, `Pi`, `Cursor`, `Antigravity`) collaborate inside jailed per-project directories (`mermaid_ls`, `mermaid_read`, `mermaid_render`, `mermaid_mv`), but **only humans can delete** diagrams, folders, or projects.
