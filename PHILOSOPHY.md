# MFHMFA Philosophy

MFHMFA is built to help people understand unfamiliar topics with AI agents, whether that is a new algorithm, a research paper, a codebase, a tricky bug, or an architecture tradeoff.

---

## 1. Why Raw AI Diagrams Often Fail

AI agents can write thousands of lines of code or summarize a dense paper in seconds. That makes it easy to read a smooth explanation, nod along, and realize ten minutes later that you still cannot picture how the thing actually works.

When you ask an AI agent for a diagram, static charts usually miss in one of two ways:

1. **Too crowded with jargon**
   The agent copies variable names, equations, or internal service names straight onto 15 boxes. If those terms are new to you, your working memory fills up just decoding the labels before you ever see how the pieces interact.
2. **Too simplified to be useful**
   When you ask the agent to simplify, it removes the actual mechanism and draws vague boxes (*"Messenger sends data to Storage"*). The words are easy, yet you still cannot answer basic questions like *"What bytes move here?"* or *"What breaks if this request times out?"*

Understanding something means being able to trace it in your head: *given one concrete input, what happens first, how does the data change at each step, and what happens when part of it fails?*

---

## 2. Five Research-Grounded Design Choices

Every feature and agent instruction in MFHMFA comes from established research on human memory and learning:

### 1. Keep each view to 4–7 boxes, and zoom in for details
*Research basis: Working Memory Capacity (Nelson Cowan, 2001); Cognitive Load Theory (John Sweller, 1988); Visual Information-Seeking Mantra: overview first, zoom and filter, then details on demand (Ben Shneiderman, 1996).*

People can hold roughly **4 to 6 new interacting items** in working memory at once. Putting 15 subsystems onto one flat canvas guarantees overload.
- **In MFHMFA:** Layout checks nudge agents to keep each view to **4–7 core boxes**. Deeper subsystems live in separate `.mmd` views linked via `childPath` and `parentPath`, so you can zoom in where you care and jump back out via the breadcrumb.

### 2. Keep box labels short; put explanations on click
*Research basis: Dual Coding Theory (Allan Paivio, 1971).*

The brain processes **spatial layout** (shapes, positions, direction of flow) and **reading prose** through two separate channels. Stuffing a 20-word sentence inside a diagram box jams both channels at once.
- **In MFHMFA:** Box labels stay short (**2–5 plain words**). Official technical terms, equations, and full explanations live inside **clickable box cards** (`term`, `summary`, `example`, `whatIf`, `refs`) that open only when you click a box.

### 3. Step through flows one hop at a time (and compare scenarios)
*Research basis: Segmenting and Signaling Principles in multimedia learning (Richard Mayer, 2001–2009); Contrasting Cases in transfer learning (John Bransford & Daniel Schwartz, 1999).*

Learners follow complex systems much faster when a diagram is revealed in **user-paced steps** (`Next →`) with visual highlighting, and when contrasting cases are shown on the same structure rather than described separately.
- **In MFHMFA:** Walkthroughs (`steps`) dim unrelated branches and highlight only the active boxes and arrows for the current step. When comparing two behaviors (like *Normal Write* vs. *Crash Recovery*, or *Baseline* vs. *Paper's Method*), agents attach multiple scenario tabs (`flows`) on the same diagram.

### 4. Trace concrete values, ask "what breaks if…", and test predictions
*Research basis: Concreteness Fading (Jerome Bruner, 1966); Mental Models & counterfactual reasoning (Philip Johnson-Laird, 1983); Testing / Retrieval Practice Effect (Henry Roediger & Jeffrey Karpicke, 2006).*

Abstract summaries rarely stick on their own. People build durable mental models by watching **one concrete example with real numbers** move through a system, checking what breaks at the boundaries, and making a quick prediction before seeing the answer.
- **In MFHMFA:** Walkthrough steps carry concrete runtime or math traces (`trace`), box cards show real input-to-output examples (`example`) and boundary failures (`whatIf`), and key steps include a click-to-reveal check question (`check`).

### 5. Write like a human, without forced analogies
*Research basis: Explaining through concrete physical mechanics rather than stretched metaphors (Richard Feynman).*

AI models often default to stiff textbook filler, buzzword slogans, or awkward job-based analogies. Humans think carefully about each word and say things plainly once they have the whole idea in mind.
- **In MFHMFA:** Playbooks instruct agents to write short, direct sentences using everyday words and concrete verbs (*sends, waits 2s, overwrites, drops*), skipping filler and forced metaphors so any curious reader can follow along.

---

## 3. Workspace Principles

1. **Zero diagrams stored on the server**
   Your notes and diagrams belong on your computer. The MFHMFA server only checks layouts in headless Chromium and relays live events over SSE (`0` stored diagrams). Your projects, `.mmd` files, guides, and 5-version history stay in your browser's `IndexedDB`.
2. **Agents check their own layout before stopping**
   Every `render_view` call validates syntax, returns a 2x PNG preview for the agent's vision model to inspect, flags crowded layouts, merges rapid retries at the same path into one clean version, and streams the result to your open tab without pasting raw Mermaid blocks into chat.
3. **Only you delete your work**
   Multiple coding agents (`Claude Code`, `Pi`, `Cursor`, `Antigravity`) can work inside their own project folders (`get_playbook`, `list_views`, `read_view`, `render_view`, `move_view`), while deleting files, folders, or projects is reserved for you in the browser UI.
