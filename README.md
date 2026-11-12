<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./web/public/logo-dark.svg" />
  <source media="(prefers-color-scheme: light)" srcset="./web/public/logo-light.svg" />
  <img alt="MFHMFA" src="./web/public/logo.svg" height="56" />
</picture>

**Mermaid For Humans, Mermaid For Agents.**

Live Studio: **[mfhmfa.kasun.si](https://mfhmfa.kasun.si)** · Hosted MCP: `https://mfhmfa.kasun.si/mcp` · **[Read the Philosophy →](./PHILOSOPHY.md)**

MFHMFA is a **zero-server-storage Codebase Comprehension Studio** and Model Context Protocol (MCP) server. It helps humans genuinely understand unfamiliar codebases with AI coding agents—turning raw Mermaid charts into **interactive step-by-step walkthroughs**, **clickable component cards**, and **zoomable sub-graphs** stored 100% in your browser.

---

## Why MFHMFA Exists

AI coding agents can write thousands of lines of code in minutes, leaving builders with a new bottleneck: **owning systems they cannot mentally simulate.**

When you ask an AI agent to explain or diagram a codebase, raw diagrams usually fail in one of two ways:
- **Too Technical (Jargon Overload):** 15 boxes stuffed with framework buzzwords and variable names that overflow human working memory.
- **Too Abstract (Vague Metaphors):** Over-simplified boxes (*"Messenger sends to Storage"*) that strip away causality, sizes, and failure modes.

MFHMFA is built around **proven cognitive science principles of human learning** (see **[PHILOSOPHY.md](./PHILOSOPHY.md)**): keep each view within the ~4–7 chunk working-memory limit, separate clean visual topology from rich explanations on click, trace one concrete flow step-by-step, and ground every box in real examples and *"what breaks if…"* edge cases.

---

## What It Does

- **Story Mode Stepper (`◀ Step 1 / N ▶`):** Instead of staring at a frozen wall of arrows, press `Walk Through` (or `←` / `→`) to spotlight one causal step at a time while unrelated branches dim out.
- **Clickable Node Inspector:** Boxes on the canvas stay clean (2–5 plain words). Click any outlined box to inspect its **plain mechanism**, **concrete payload/timing example**, **"What Breaks If…" edge case**, and **source file paths**.
- **Google-Maps Sub-Graph Zoom:** Double-click dashed subsystem boxes (or click *Zoom into…*) to drill down into linked child `.mmd` diagrams and jump back via the top-left breadcrumb.
- **Agent Vision + Cognitive Load Linter:** When an agent calls `mermaid_render`, it receives a **2x Retina PNG** to visually check for overlaps *plus* diagnostics warning if a graph crams too many nodes or words into one view.
- **Zero Server Storage (Browser IndexedDB VFS):** All project folders, `.mmd` files, interactive guides, and 5-version immutable revision histories live asynchronously in your browser's `IndexedDB` (`0` diagrams stored on the server).

---

## How It Works

1. **Pair Your Browser Tab:** Open **[mfhmfa.kasun.si](https://mfhmfa.kasun.si)** and click **Copy MCP URL** to get your browser's private `?workspace=ws_...` link.
2. **Ask Your Coding Agent:** Ask Claude Code, Pi, Cursor, or Antigravity *"How does auth / memory / billing work in this repo?"*
3. **Self-Verified Live Sync:** Behind the scenes, the agent inspects your project VFS (`mermaid_ls` / `mermaid_read`), renders clean 4–7 box graphs with attached comprehension guides (`guide.steps`, `guide.nodes`), visually verifies the 2x Retina PNG, coalesces rapid layout retries into a single revision, and streams the result live into your open tab—without dumping raw Mermaid code or URLs into your terminal.
4. **Explore Interactively:** Step through Story Mode with `←` / `→`, click boxes to inspect concrete examples & failure modes, and zoom into child sub-graphs.

---

## Quick Start (MCP Setup)

### Hosted (Zero Install)

1. Open **[mfhmfa.kasun.si](https://mfhmfa.kasun.si)** and click **Copy MCP URL** (bottom-left of the Explorer sidebar, or under **Docs**).
2. Register the paired URL in your coding agent:

```json
{
  "mcpServers": {
    "mfhmfa": {
      "url": "https://mfhmfa.kasun.si/mcp?workspace=ws_YOUR_TOKEN"
    }
  }
}
```

Or via CLI:

```bash
# Pi Coding Agent
pi mcp add mfhmfa --url "https://mfhmfa.kasun.si/mcp?workspace=ws_YOUR_TOKEN" --exposure deferred

# Claude Code
claude mcp add --transport http mfhmfa "https://mfhmfa.kasun.si/mcp?workspace=ws_YOUR_TOKEN"
```

Keep **[mfhmfa.kasun.si](https://mfhmfa.kasun.si)** open in a browser tab while working—your browser tab *is* the storage engine.

### Local Stdio

```json
{
  "mcpServers": {
    "mfhmfa": {
      "command": "npx",
      "args": ["tsx", "/path/to/MFHMFA/src/mcp-stdio.ts"]
    }
  }
}
```

---

## MCP Tools

| Tool | Purpose |
| :--- | :--- |
| `mermaid_ls` | List folders and `.mmd` graphs inside the agent's jailed project working directory (`diagramType`, `version`, `stepCount`, `author`). |
| `mermaid_read` | Read `.mmd` source, attached comprehension `guide`, and 5-version immutable history of an existing graph. |
| `mermaid_render` | Write/update a `.mmd` graph + interactive `guide` (`gist`, `steps`, `nodes`, `childPath`), coalesce rapid retries in browser `IndexedDB`, and return a 2x Retina PNG + layout/cognitive diagnostics. |
| `mermaid_mv` | Move or rename a graph or subfolder within the working project while preserving version history and automatically updating `childPath` / `parentPath` links. |
| `mermaid_validate` | Check syntax and static lint rules (including Dual-Coding dense label checks); returns error line/column snippet and fix hints. |
| `mermaid_export` | Render and write Mermaid source to disk as `.png`, `.svg`, `.mmd`, or `.md`. |
| `mermaid_syntax_guide` | Comprehension rules (`comprehension`) plus escaping & layout guides (`pitfalls`, `flowchart`, `sequence`, `er`, `state`, `class`, `mindmap`, `gantt`). |
| `mermaid_list_templates` | Curated starter Mermaid templates across 11 diagram categories. |

- **Resources:** `mermaid://guides/pitfalls`, `mermaid://templates`, `mermaid://templates/{id}`
- **Prompt:** `design-and-verify-diagram`

---

## Self-Hosting

### Docker

Runs statelessly on port `48333` (Web Studio + Streamable HTTP MCP + Headless Chromium Pool):

```bash
docker compose up -d --build
```

- Web Studio: `http://localhost:48333`
- Streamable HTTP MCP: `http://localhost:48333/mcp` (legacy SSE: `/mcp/sse`)

### From Source (Node.js >= 20 + Chrome/Chromium)

```bash
npm install

# Dev mode (Vite HMR on :5173 + API/MCP on :48333)
npm run dev

# Production build & start on :48333
npm run build
npm start

# Typecheck & test suite (Unit + Headless Browser/MCP E2E)
npm run typecheck
npm test
```

---

## HTTP Tool API

For custom OpenAI / Anthropic / Gemini function-calling loops without an MCP client:

- `GET https://mfhmfa.kasun.si/api/tools/schemas`
- `POST https://mfhmfa.kasun.si/api/tools/call?workspace=ws_YOUR_TOKEN`

```bash
curl -X POST "https://mfhmfa.kasun.si/api/tools/call?workspace=ws_YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "mermaid_render",
    "arguments": {
      "project": "Order Service",
      "path": "checkout/order-pipeline.mmd",
      "code": "flowchart LR\n  Cart[\"Cart\"] --> Pay[\"Payment\"] --> Ship[\"Fulfillment\"]",
      "guide": {
        "gist": "Orders only enter fulfillment after payment confirmation.",
        "steps": [
          {
            "title": "1. Charge customer",
            "caption": "Cart total is sent to Payment and held until confirmed.",
            "focusNodes": ["Cart", "Pay"]
          }
        ]
      }
    }
  }'
```

---

## License

[MIT](./LICENSE)
