# MFHMFA

**Mermaid For Humans, Mermaid For Agents**

A calm, eye-comfortable **Mermaid Diagram Studio + Headless Validation & Rendering Engine + Dual-Transport MCP Server + CLI** built so both **humans and AI coding agents** can create, validate, refine, and **visually inspect** the charts they build.

---

## Why MFHMFA?

Most AI agents generate Mermaid diagrams blind — emitting raw text without knowing whether it parses or renders as an unreadable spaghetti layout.

**MFHMFA** closes that loop:

1. **Agents *See* What They Build**: `mermaid_render_preview`, `mermaid_create_chart`, `mermaid_update_chart`, and `mermaid_see_chart` return **2x Retina PNG images** (`MCP ImageContent` + local file paths) alongside structural layout diagnostics (dimensions, aspect-ratio warnings, node/edge counts, contrast checks).
2. **Actionable Parse Diagnostics**: Syntax errors return 1-indexed line/column pointers, source snippets, and targeted fix hints (unquoted `()`/`[]`/`{}` inside labels, reserved lowercase `end` node IDs, unmatched `subgraph` blocks).
3. **Calm, Eye-Comfortable Human Workspace**:
   - Unified low-glare **Warm Graphite (Dark)** and **Warm Paper (Light)** modes across interface, CodeMirror 6 editor, and rendered diagrams.
   - Distraction-free single-stage **`Preview ↔ Code`** flip view with a collapsible sidebar.
   - Real-time WebSocket sync (`/ws`) that automatically displays charts as AI agents create or update them.
   - Automatic version history (`v1`, `v2`, ...) with one-click restore.

---

## Quick Start (Docker — Recommended)

Runs on port **`48333`** with `restart: unless-stopped` so it starts automatically on system boot and stays ready for coding agents:

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

## Local Development (Node.js 24+)

Requires **Node.js >= 24** (uses built-in `node:sqlite`) and a local Chrome or Chromium installation.

```bash
npm install

# Build & start unified Web Studio + REST API + HTTP MCP server on :48333
npm run build
npm start

# Development mode (Vite HMR on :5173 + API/MCP on :48333)
npm run dev

# Typecheck & run unit + integration tests
npm run typecheck
npm test
```

### Studio Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + S` | Save chart & snapshot new version |
| `Ctrl/Cmd + B` | Collapse / expand left panel |
| `Ctrl/Cmd + E` | Flip between **Preview** and **Code** |

---

## Connecting AI Agents

### 1. MCP via Streamable HTTP (Cursor, Claude Code, Antigravity, Windsurf, Mastra)

```json
{
  "mcpServers": {
    "mfhmfa": {
      "type": "streamable-http",
      "url": "http://localhost:48333/mcp"
    }
  }
}
```
*(Legacy SSE clients can also connect at `http://localhost:48333/mcp/sse`.)*

### 2. MCP via Stdio (Claude Desktop & Local Process Clients)

Using the running Docker container:
```json
{
  "mcpServers": {
    "mfhmfa": {
      "command": "docker",
      "args": ["exec", "-i", "mfhmfa", "node", "dist/server/mcp-stdio.js"]
    }
  }
}
```

Or directly via local Node/tsx:
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

### 3. CLI for Bash Coding Agents (Pi, Claude Code, Codex, OpenHands)

```bash
# Validate syntax & get line-level fix suggestions
./bin/mfhmfa validate --code 'flowchart TD\n  A["Start"] --> B["Process (v2)"]'

# Render stateless preview to PNG + SVG
./bin/mfhmfa render --code 'sequenceDiagram\n  Agent->>API: POST /charts' --out /tmp/preview.png

# Create & persist chart in the live Studio workspace
./bin/mfhmfa create --title "Auth Flow" --file auth.mmd

# Update chart (creates new version snapshot)
./bin/mfhmfa update <chart-id> --file auth-v2.mmd --note "Switch LR to TB"

# Inspect chart metadata, history & rendered PNG path
./bin/mfhmfa see <chart-id>

# Export chart to .png, .svg, .mmd, or .md
./bin/mfhmfa export <chart-id> --out ./docs/architecture.svg

# Print Mermaid syntax & escaping guide
./bin/mfhmfa guide pitfalls
```

### 4. Function-Calling HTTP API (OpenAI / Anthropic / Gemini)

- **Tool JSON Schemas**: `GET http://localhost:48333/api/tools/schemas`
- **Dispatch Tool Call**: `POST http://localhost:48333/api/tools/call`
  ```json
  {
    "name": "mermaid_create_chart",
    "arguments": {
      "title": "Order Pipeline",
      "code": "flowchart LR\n  Cart[\"Cart\"] --> Pay[\"Stripe\"] --> Ship[\"Fulfill\"]",
      "returnImage": true
    }
  }
  ```

---

## Exposed MCP Tools, Resources & Prompts

| Tool | Purpose | Returns PNG Vision? |
|---|---|---|
| `mermaid_validate` | Fast syntax check, line/column snippet, lint warnings, fix suggestions | — |
| `mermaid_render_preview` | Stateless render + layout diagnostics + optional file export | Yes (`image/png`) |
| `mermaid_create_chart` | Save new chart in Studio, sync live to Web UI, validate & render | Yes (`image/png`) |
| `mermaid_update_chart` | Versioned chart update + live Web UI sync + re-render | Yes (`image/png`) |
| `mermaid_see_chart` | Inspect saved chart (latest or any historical `version`) + code + metrics | Yes (`image/png`) |
| `mermaid_list_charts` | Search/filter workspace charts by text, tag, or diagram type | — |
| `mermaid_delete_chart` | Delete chart & artifacts by ID | — |
| `mermaid_export_chart` | Export chart or raw code to `.png`, `.svg`, `.mmd`, or `.md` | — |
| `mermaid_syntax_guide` | Curated syntax & escaping reference (`pitfalls`, `flowchart`, `sequence`, `er`, `state`, `class`, `mindmap`, `gantt`) | — |
| `mermaid_list_templates` | List starter Mermaid templates | — |

- **MCP Resources**: `mermaid://charts`, `mermaid://guides/pitfalls`, `mermaid://charts/{id}`, `mermaid://charts/{id}/png`
- **MCP Prompt**: `design-and-verify-diagram`

---

## Project Structure

```text
src/
├── shared/          # Pure types & SVG helpers shared between server & web
├── config/          # Environment, port, and container/host path helpers
├── domain/          # Diagnostics, templates/guides catalog, and port interfaces
├── application/     # StudioService business use-cases
├── infrastructure/  # Chromium renderer pool, SQLite WAL repository, WebSocket hub
└── interfaces/      # Unified tool registry, Express routers, MCP servers, CLI
web/
├── components/      # TopBar, Sidebar, PreviewCanvas, CodeEditorStage, SettingsView
├── hooks/           # Workspace state, live WebSocket sync & debounced renderer
├── services/        # Typed API & WebSocket client
└── theme/           # Warm Graphite (Dark) & Warm Paper (Light) comfort palette
tests/
├── unit/            # Fast domain & utility unit tests
└── integration/     # Full E2E tests (Chromium, REST, WebSocket, HTTP & Stdio MCP)
```

---

## License

Released under the [MIT License](./LICENSE).
