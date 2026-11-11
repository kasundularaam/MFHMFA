# MFHMFA

**Mermaid For Humans, Mermaid For Agents** *(Stateless Edition)*

A calm, eye-comfortable **Stateless Mermaid Studio + Parallel Headless Validation & Rendering Engine + Dual-Transport MCP Server + REST Tool API** built so both **humans and AI coding agents** can validate, render, refine, and **visually inspect** Mermaid diagrams with zero database overhead.

---

## Why MFHMFA?

Most AI agents generate Mermaid diagrams blind — emitting raw text without knowing whether it parses or renders as an unreadable spaghetti layout.

**MFHMFA** closes that loop statelessly:

1. **Agents *See* What They Build**: `mermaid_render` validates syntax and returns **2x Retina PNG images** (`MCP ImageContent`) alongside structural layout diagnostics (dimensions, aspect-ratio warnings, node/edge counts, contrast checks).
2. **100% Stateless & Parallel-Safe**: Zero database, zero disk state, and an isolated multi-slot headless Chromium pool (`MERMAID_RENDER_CONCURRENCY=4` by default) with automatic slot health recovery so parallel agent runs never block or corrupt state.
3. **Actionable Parse Diagnostics**: Syntax errors return 1-indexed line/column pointers, source snippets, and targeted fix hints (unquoted `()`/`[]`/`{}` inside labels, reserved lowercase `end` node IDs, unmatched `subgraph` blocks).
4. **Calm, Eye-Comfortable Human Workspace**:
   - Unified low-glare **Warm Graphite (Dark)** and **Warm Paper (Light)** modes across interface, CodeMirror 6 scratchpad, and rendered diagrams.
   - Distraction-free full-bleed **`Preview ↔ Code`** flip view (`Ctrl/Cmd + E`) with 1-click theme toggle, export menu, and built-in MCP setup docs.

---

## Instant Hosted MCP (No Setup Required)

Live Studio: **`https://mfhmfa.kasun.si`**  
Hosted Streamable HTTP MCP Endpoint: **`https://mfhmfa.kasun.si/mcp`**

```json
{
  "mcpServers": {
    "mfhmfa": {
      "url": "https://mfhmfa.kasun.si/mcp"
    }
  }
}
```

Or via CLI:
```bash
# Pi Coding Agent
pi mcp add mfhmfa --url https://mfhmfa.kasun.si/mcp --exposure deferred

# Claude Code
claude mcp add --transport http mfhmfa https://mfhmfa.kasun.si/mcp
```

---

## Self-Hosting Locally (Docker — Optional)

Runs statelessly on port **`48333`** with `restart: unless-stopped`:

```bash
docker compose up -d --build
```

Open **`http://localhost:48333`** in your browser.

```bash
npm run docker:logs      # Tail logs
npm run docker:restart   # Restart container
npm run docker:down      # Stop container
```

---

## Local Development (Node.js 20+)

Requires **Node.js >= 20** and a local Chrome or Chromium installation.

```bash
npm install

# Build & start unified Web Studio + REST API + HTTP MCP server on :48333
npm run build
npm start

# Development mode (Vite HMR on :5173 + API/MCP on :48333)
npm run dev

# Typecheck & run unit + integration + parallel stress tests
npm run typecheck
npm test
```

---

## Connecting AI Agents

### 1. MCP via Streamable HTTP (Pi, Cursor, Claude Code, Antigravity, Windsurf)

```json
{
  "mcpServers": {
    "mfhmfa": {
      "url": "http://localhost:48333/mcp"
    }
  }
}
```
*(Legacy SSE clients can also connect at `http://localhost:48333/mcp/sse`.)*

### 2. MCP via Stdio (Claude Desktop & Local Process Clients)

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

### 3. Function-Calling HTTP API (OpenAI / Anthropic / Gemini)

- **Tool JSON Schemas**: `GET http://localhost:48333/api/tools/schemas`
- **Dispatch Tool Call**: `POST http://localhost:48333/api/tools/call`
  ```json
  {
    "name": "mermaid_render",
    "arguments": {
      "title": "Order Pipeline",
      "code": "flowchart LR\n  Cart[\"Cart\"] --> Pay[\"Stripe\"] --> Ship[\"Fulfill\"]",
      "returnImage": true
    }
  }
  ```

---

## Exposed Stateless MCP Tools, Resources & Prompts

| Tool | Purpose | Returns PNG Vision? |
|---|---|---|
| `mermaid_render` | Stateless validate + 2x Retina PNG render + layout diagnostics + optional SVG/file output | Yes (`image/png`) |
| `mermaid_validate` | Fast stateless syntax check, line/column snippet, lint warnings, fix suggestions | — |
| `mermaid_export` | Stateless render & export raw `code` to `.png`, `.svg`, `.mmd`, or `.md` | — |
| `mermaid_syntax_guide` | Curated syntax & escaping reference (`pitfalls`, `flowchart`, `sequence`, `er`, `state`, `class`, `mindmap`, `gantt`) | — |
| `mermaid_list_templates` | List curated starter Mermaid templates across 11 categories | — |

- **MCP Resources**: `mermaid://guides/pitfalls`, `mermaid://templates`, `mermaid://templates/{id}`
- **MCP Prompt**: `design-and-verify-diagram`

---

## License

Released under the [MIT License](./LICENSE).
