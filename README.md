<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./web/public/logo-dark.svg" />
  <source media="(prefers-color-scheme: light)" srcset="./web/public/logo-light.svg" />
  <img alt="MFHMFA" src="./web/public/logo.svg" height="56" />
</picture>

**Mermaid For Humans, Mermaid For Agents.**

Live Studio: **[mfhmfa.kasun.si](https://mfhmfa.kasun.si)** · Hosted MCP: `https://mfhmfa.kasun.si/mcp`

Stateless Mermaid workspace and Model Context Protocol (MCP) server. Validates diagram syntax with 1-indexed line/column hints, renders 2x Retina PNGs via a pooled headless Chromium engine so agents can inspect layouts visually, and syncs diagrams straight into browser tabs without a database.

---

## MCP Setup

### Hosted (Zero Install)

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
pi mcp add mfhmfa --url "https://mfhmfa.kasun.si/mcp" --exposure deferred

# Claude Code
claude mcp add --transport http mfhmfa "https://mfhmfa.kasun.si/mcp"
```

To have agent-rendered diagrams open automatically as tabs in your browser without pasting links, open **[mfhmfa.kasun.si](https://mfhmfa.kasun.si)** → **Docs** and copy your paired `?workspace=ws_...` MCP URL.

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
| `mermaid_render` | Validate syntax, render a 2x Retina PNG (`image/png` vision), return layout diagnostics, and publish to browser tabs (`studioUrl` & `liveUrl`). |
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
