<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./web/public/logo-dark.svg" />
  <source media="(prefers-color-scheme: light)" srcset="./web/public/logo-light.svg" />
  <img alt="MFHMFA" src="./web/public/logo.svg" height="56" />
</picture>

**Mermaid For Humans, Mermaid For Agents.**

Live Studio: **[mfhmfa.kasun.si](https://mfhmfa.kasun.si)** · Hosted MCP: `https://mfhmfa.kasun.si/mcp`

Zero-storage Mermaid workspace and Model Context Protocol (MCP) server. Gives coding agents a jailed, project-scoped Virtual Diagram Filesystem (`mermaid_ls`, `mermaid_read`, `mermaid_render`, `mermaid_mv`) backed by your browser's `localStorage` with immutable 5-version history, VS Code Explorer tree UI, and 2x Retina PNG visual inspection — with **0 diagrams stored on the server**.

---

## MCP Setup

### Hosted (Zero Install)

1. Open **[mfhmfa.kasun.si](https://mfhmfa.kasun.si)** and click **Copy MCP URL** (bottom-left of the Explorer sidebar, or under **Docs**) to get your browser's paired `?workspace=ws_...` URL.
2. Add it to your MCP client:

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

Keep **[mfhmfa.kasun.si](https://mfhmfa.kasun.si)** open in a browser tab while working — agents validate and visually inspect diagrams via 2x Retina PNGs, coalesce rapid layout retries into a single clean revision, and stream finalized graphs straight into your browser's `localStorage` without dumping Mermaid code or URLs into your terminal.

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

| Tool | Description |
| :--- | :--- |
| `mermaid_ls` | List folders and `.mmd` graphs inside the agent's jailed project working directory (`diagramType`, `version`, `author`). |
| `mermaid_read` | Read `.mmd` source and 5-version immutable history of an existing graph in the working project. |
| `mermaid_render` | Write/update a graph at `path` (e.g. `auth/oauth-flow.mmd`), coalesce rapid agent retries into 1 clean revision in browser `localStorage`, and return 2x Retina PNG (`image/png` vision) + layout diagnostics. |
| `mermaid_mv` | Move or rename a graph or subfolder within the working project while preserving version history. |
| `mermaid_validate` | Check syntax and static lint rules; returns diagram type, error line/column snippet, and targeted fix hints. |
| `mermaid_export` | Render and write Mermaid source to `.png`, `.svg`, `.mmd`, or `.md`. |
| `mermaid_syntax_guide` | Concise escaping and layout reference (`pitfalls`, `flowchart`, `sequence`, `er`, `state`, `class`, `mindmap`, `gantt`). |
| `mermaid_list_templates` | Starter Mermaid templates across 11 diagram categories. |

- **Resources:** `mermaid://guides/pitfalls`, `mermaid://templates`, `mermaid://templates/{id}`
- **Prompt:** `design-and-verify-diagram`

---

## Self-Hosting

### Docker

Runs statelessly on port `48333`:

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

# Typecheck & test suite
npm run typecheck
npm test
```

---

## HTTP Tool API

For direct OpenAI / Anthropic / Gemini function-calling without an MCP client:

- `GET https://mfhmfa.kasun.si/api/tools/schemas`
- `POST https://mfhmfa.kasun.si/api/tools/call`

```bash
curl -X POST "https://mfhmfa.kasun.si/api/tools/call" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "mermaid_render",
    "arguments": {
      "title": "Order Pipeline",
      "code": "flowchart LR\n  Cart[\"Cart\"] --> Pay[\"Stripe\"] --> Ship[\"Fulfill\"]"
    }
  }'
```

---

## License

[MIT](./LICENSE)
