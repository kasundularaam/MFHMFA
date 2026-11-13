<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./web/public/logo-dark.svg" />
  <source media="(prefers-color-scheme: light)" srcset="./web/public/logo-light.svg" />
  <img alt="MFHMFA" src="./web/public/logo.svg" height="56" />
</picture>

Live Studio: **[mfhmfa.kasun.si](https://mfhmfa.kasun.si)** · Hosted MCP: `https://mfhmfa.kasun.si/mcp` · **[Philosophy →](./PHILOSOPHY.md)**

MFHMFA is an interactive visual learning workspace and Model Context Protocol (MCP) server you use alongside your AI agent. Use it to understand a **concept**, **research paper**, **codebase**, **bug**, or **design tradeoff** through small, step-by-step diagrams saved locally in your browser.

---

## Why MFHMFA

When you ask an AI agent to draw a diagram, raw Mermaid charts usually miss in one of two ways:
- **Too crowded:** 15 boxes stuffed with class names, equations, or long sentences that are hard to hold in your head at once.
- **Too vague:** High-level boxes (*"Service talks to Storage"*) that hide actual data shapes, order of execution, and what happens when something fails.

MFHMFA keeps the visual diagram small (4-7 boxes with short plain labels) and puts the real mechanics into interactive layers you control, grounded in cognitive science research on how people actually learn (see **[PHILOSOPHY.md](./PHILOSOPHY.md)**).

---

## What It Does

- **5 Learning Playbooks:** Agents load a mode-specific guide first (`concept`, `paper`, `codebase`, `bug`, or `tradeoff`) so a research paper walkthrough, a race-condition trace, and a repo overview are each structured the right way.
- **Step-by-Step Walkthroughs (`←` / `→`):** Step through one hop at a time while unrelated branches dim out, switch between contrasting scenarios (such as *Normal Flow* vs. *Bug Trace*), inspect concrete runtime values, and test yourself on quick check questions.
- **Clickable Box Cards:** Click any outlined box to read a plain explanation, its formal technical term or equation, a concrete input/output example, what breaks at boundary conditions, and exact file or paper references.
- **Sub-Diagram Zoom:** Keep each view focused and double-click dashed boxes (or click *Zoom into…*) to open linked child `.mmd` views, then jump back using the top breadcrumb.
- **Visual Layout Check for Agents:** Every `render_view` call gives the agent a 2x PNG preview and layout warnings so it can fix overlaps or wordy labels before stopping.
- **Saved in Your Browser:** Zero diagrams are stored on the server. All projects, `.mmd` files, walkthrough guides, and up to 5 recent versions per file live in your browser's `IndexedDB`.

---

## Quick Start (MCP Setup)

### Hosted (No Install)

1. Open **[mfhmfa.kasun.si](https://mfhmfa.kasun.si)** on your computer and click **Copy MCP URL** (under **Connected Agents** in the sidebar, or in **Docs**).
2. Add the paired URL to your coding agent:

```json
{
  "mcpServers": {
    "mfhmfa": {
      "url": "https://mfhmfa.kasun.si/mcp?workspace=ws_YOUR_TOKEN"
    }
  }
}
```

Or register via CLI:

```bash
# Pi Coding Agent
pi mcp add mfhmfa --url "https://mfhmfa.kasun.si/mcp?workspace=ws_YOUR_TOKEN" --exposure deferred

# Claude Code
claude mcp add --transport http mfhmfa "https://mfhmfa.kasun.si/mcp?workspace=ws_YOUR_TOKEN"
```

Keep **[mfhmfa.kasun.si](https://mfhmfa.kasun.si)** open in a desktop browser tab while working so your agent can read and stream views live.

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
| `get_playbook` | Load the teaching guide for `concept`, `paper`, `codebase`, `bug`, or `tradeoff`, along with current project views and what you have selected in Studio. |
| `render_view` | Create or update a `.mmd` view and interactive `guide` (`gist`, `steps` or `flows`, `nodes`, `childPath`), merge rapid retries in browser `IndexedDB`, and return a 2x PNG + layout warnings. |
| `list_views` | List folders and `.mmd` files in the current project folder, plus your active view, step, and selected box in Studio. |
| `read_view` | Read the `.mmd` source, attached `guide`, and 5-version history of an existing view. |
| `move_view` | Move or rename a file or folder within the project while keeping version history and updating `childPath` / `parentPath` links. |
| `export_view` | Render and save Mermaid source to local disk as `.png`, `.svg`, `.mmd`, or `.md` when running locally. |

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

# Lint, typecheck & test suite (Unit + Headless Browser/MCP E2E)
npm run check
npm test
```

---

## HTTP Tool API

For custom tool-calling integrations without an MCP client:

- `GET https://mfhmfa.kasun.si/api/tools/schemas`
- `POST https://mfhmfa.kasun.si/api/tools/call?workspace=ws_YOUR_TOKEN`

```bash
curl -X POST "https://mfhmfa.kasun.si/api/tools/call?workspace=ws_YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "render_view",
    "arguments": {
      "project": "Order Service",
      "path": "checkout/order-pipeline.mmd",
      "code": "flowchart LR\n  Cart[\"Cart\"] --> Pay[\"Payment\"] --> Ship[\"Fulfill\"]",
      "guide": {
        "gist": "Orders only move to fulfillment after payment is confirmed.",
        "steps": [
          {
            "title": "1. Charge customer",
            "caption": "Cart sends the order total to Payment and waits for confirmation.",
            "focusNodes": ["Cart", "Pay"],
            "trace": "orderId=ord_42 | amount=$48.00 -> 200 Authorized"
          }
        ]
      }
    }
  }'
```

---

## License

[MIT](./LICENSE)
