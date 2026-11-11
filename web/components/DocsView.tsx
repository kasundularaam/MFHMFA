import { useState } from 'react';

const DEFAULT_PUBLIC_BASE_URL = 'https://mfhmfa.kasun.si';

interface DocsViewProps {
  workspaceId: string;
  onRotateWorkspaceId: () => void;
}

export function DocsView({ workspaceId, onRotateWorkspaceId }: DocsViewProps) {
  const baseUrl =
    typeof window !== 'undefined' && window.location.protocol === 'https:'
      ? window.location.origin
      : DEFAULT_PUBLIC_BASE_URL;

  const pairedMcpUrl = `${baseUrl}/mcp?workspace=${workspaceId}`;

  const mcpJsonSnippet = `{
  "mcpServers": {
    "mfhmfa": {
      "url": "${pairedMcpUrl}"
    }
  }
}`;

  const cliSetupSnippet = `# Pi Coding Agent
pi mcp add mfhmfa --url "${pairedMcpUrl}" --exposure deferred

# Claude Code
claude mcp add --transport http mfhmfa "${pairedMcpUrl}"`;

  const stdioSetupSnippet = `{
  "mcpServers": {
    "mfhmfa": {
      "command": "npx",
      "args": ["tsx", "/path/to/MFHMFA/src/mcp-stdio.ts"]
    }
  }
}`;

  const restCallSnippet = `curl -X POST "${baseUrl}/api/tools/call?workspace=${workspaceId}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "mermaid_render",
    "arguments": {
      "title": "Order Pipeline",
      "code": "flowchart LR\\n  Cart[\\"Cart\\"] --> Pay[\\"Stripe\\"] --> Ship[\\"Fulfill\\"]"
    }
  }'`;

  const dockerSnippet = `git clone https://github.com/kasundularaam/MFHMFA.git
cd MFHMFA
docker compose up -d --build
# Studio: http://localhost:48333
# MCP:    http://localhost:48333/mcp`;

  return (
    <div className="docs-page">
      <div className="docs-layout">
        <nav className="docs-nav" aria-label="Contents">
          <div className="docs-nav-heading">Contents</div>
          <ul>
            <li>
              <a href="#doc-overview">1. Overview</a>
            </li>
            <li>
              <a href="#doc-mcp">2. MCP Configuration</a>
            </li>
            <li>
              <a href="#doc-sync">3. Browser Sync &amp; Links</a>
            </li>
            <li>
              <a href="#doc-tools">4. MCP Tools &amp; Resources</a>
            </li>
            <li>
              <a href="#doc-http">5. HTTP Tool API</a>
            </li>
            <li>
              <a href="#doc-selfhost">6. Self-Hosting</a>
            </li>
            <li>
              <a href="#doc-keys">7. Shortcuts</a>
            </li>
          </ul>
        </nav>

        <article className="docs-body">
          <h1 id="doc-overview">MFHMFA Documentation</h1>
          <p>
            <strong>MFHMFA</strong> (<em>Mermaid For Humans, Mermaid For Agents</em>) is a
            stateless Mermaid workspace, headless Chromium validator/renderer, and Model Context
            Protocol (MCP) server. There is no database and no persistent server storage.
          </p>
          <p>
            When an AI agent calls <code>mermaid_render</code>, MFHMFA parses the diagram in a
            pooled headless Chromium instance, returns 1-indexed syntax errors with fix hints if
            invalid, or returns a 2x Retina PNG image (<code>image/png</code> vision content)
            alongside layout diagnostics and live browser tabs if valid.
          </p>
          <ul>
            <li>
              Public instance:{' '}
              <a href="https://mfhmfa.kasun.si" target="_blank" rel="noopener noreferrer">
                https://mfhmfa.kasun.si
              </a>
            </li>
            <li>
              Hosted Streamable HTTP MCP: <code>https://mfhmfa.kasun.si/mcp</code>
            </li>
            <li>
              Source repository:{' '}
              <a
                href="https://github.com/kasundularaam/MFHMFA"
                target="_blank"
                rel="noopener noreferrer"
              >
                github.com/kasundularaam/MFHMFA
              </a>
            </li>
          </ul>

          <h2 id="doc-mcp">2. MCP Configuration</h2>
          <p>
            This browser has a local workspace token stored in <code>localStorage</code>:{' '}
            <code>{workspaceId}</code>{' '}
            <button
              type="button"
              className="plain-link-btn"
              onClick={onRotateWorkspaceId}
              title="Generate a new workspace key"
            >
              [rotate]
            </button>
            . Including <code>?workspace={workspaceId}</code> in your MCP URL routes diagrams
            rendered by your agent directly into tabs in this browser over Server-Sent Events
            (SSE), without needing links pasted in chat. If you omit <code>?workspace=...</code>,
            all tools still work statelessly and return shareable URLs.
          </p>

          <h3>mcp.json (Cursor, Antigravity, Windsurf, Claude Desktop)</h3>
          <PlainPre code={mcpJsonSnippet} />

          <h3>CLI Registration (Pi &amp; Claude Code)</h3>
          <PlainPre code={cliSetupSnippet} />

          <h3>Local Stdio Process</h3>
          <p>
            When running locally from source (requires Node.js &ge; 20 and local Chrome/Chromium):
          </p>
          <PlainPre code={stdioSetupSnippet} />
          <p>
            Legacy SSE MCP clients are also supported at <code>{baseUrl}/mcp/sse</code>.
          </p>

          <h2 id="doc-sync">3. Browser Sync &amp; Links</h2>
          <p>Diagrams move between agents and browsers in three ways:</p>
          <ul>
            <li>
              <strong>Workspace auto-tabs (<code>?workspace=ws_...</code>)</strong> — Each
              distinct diagram <code>title</code> rendered by the agent opens as its own tab.
              Re-rendering the same <code>title</code> (or passing a stable <code>tabId</code>)
              updates that tab in place without reordering the tab bar. On{' '}
              <code>localhost:48333</code>, local workspace sync works automatically with zero
              query parameters.
            </li>
            <li>
              <strong>Ephemeral session URLs (<code>/live/:token</code> &amp; <code>/p/:id</code>)</strong>{' '}
              — Every <code>mermaid_render</code> response includes a snapshot URL (
              <code>studioUrl</code>) and a live SSE session URL (<code>liveUrl</code>) held in a
              bounded in-memory LRU cache (TTL 12–24h). Opening either link loads all tabs from
              that agent session.
            </li>
            <li>
              <strong>Stateless permalinks (<code>/#z=...</code>)</strong> — Clicking the link
              icon in the top bar compresses all open tabs into the URL fragment using raw{' '}
              <code>deflate-raw</code> + Base64URL. Fragment payloads never touch server logs and
              never expire.
            </li>
          </ul>

          <h2 id="doc-tools">4. MCP Tools &amp; Resources</h2>
          <p>
            All tools are stateless and safe to call concurrently. Headless Chromium slots run in
            isolated browser contexts and recycle automatically.
          </p>
          <table className="plain-table">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Arguments</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>mermaid_render</code>
                </td>
                <td>
                  <code>code</code>, <code>title?</code>, <code>tabId?</code>,{' '}
                  <code>theme?</code>, <code>look?</code>, <code>background?</code>,{' '}
                  <code>scale?</code>, <code>outputPath?</code>, <code>returnImage?</code>,{' '}
                  <code>includeSvg?</code>
                </td>
                <td>
                  Validates syntax, renders a 2x Retina PNG (returned as MCP{' '}
                  <code>image/png</code> content), computes dimensions/aspect-ratio diagnostics,
                  and publishes to browser tabs.
                </td>
              </tr>
              <tr>
                <td>
                  <code>mermaid_validate</code>
                </td>
                <td>
                  <code>code</code>
                </td>
                <td>
                  Syntax check and static linting. Returns diagram type, 1-indexed line/column
                  pointer, source snippet, and targeted fix hints (unquoted brackets, lowercase{' '}
                  <code>end</code> IDs, unmatched <code>subgraph</code> blocks).
                </td>
              </tr>
              <tr>
                <td>
                  <code>mermaid_export</code>
                </td>
                <td>
                  <code>code</code>, <code>outputPath</code>, <code>format?</code>,{' '}
                  <code>title?</code>, <code>theme?</code>, <code>look?</code>,{' '}
                  <code>scale?</code>
                </td>
                <td>
                  Renders and writes diagram output to disk as <code>.png</code>,{' '}
                  <code>.svg</code>, <code>.mmd</code>, or <code>.md</code>.
                </td>
              </tr>
              <tr>
                <td>
                  <code>mermaid_syntax_guide</code>
                </td>
                <td>
                  <code>topic?</code>
                </td>
                <td>
                  Escaping and layout rules for <code>pitfalls</code>, <code>flowchart</code>,{' '}
                  <code>sequence</code>, <code>er</code>, <code>state</code>, <code>class</code>,{' '}
                  <code>mindmap</code>, <code>gantt</code>, or <code>all</code>.
                </td>
              </tr>
              <tr>
                <td>
                  <code>mermaid_list_templates</code>
                </td>
                <td>—</td>
                <td>Returns starter Mermaid templates across 11 diagram categories.</td>
              </tr>
            </tbody>
          </table>

          <p>
            <strong>MCP Resources:</strong> <code>mermaid://guides/pitfalls</code>,{' '}
            <code>mermaid://templates</code>, <code>mermaid://templates/&#123;id&#125;</code>.
            <br />
            <strong>MCP Prompt:</strong> <code>design-and-verify-diagram</code>.
          </p>

          <h2 id="doc-http">5. HTTP Tool API</h2>
          <p>
            For custom OpenAI / Anthropic / Gemini function-calling loops without an MCP client,
            fetch JSON schemas from <code>GET {baseUrl}/api/tools/schemas</code> and dispatch
            calls via <code>POST {baseUrl}/api/tools/call</code>:
          </p>
          <PlainPre code={restCallSnippet} />

          <p>Additional direct HTTP endpoints:</p>
          <ul>
            <li>
              <code>POST /api/validate</code> — JSON body <code>&#123; &quot;code&quot;: &quot;...&quot; &#125;</code>
            </li>
            <li>
              <code>POST /api/render</code> — Stateless SVG + base64 PNG render
            </li>
            <li>
              <code>GET /api/status</code> — Server health, Chromium pool telemetry, and active
              MCP session counts
            </li>
          </ul>

          <h2 id="doc-selfhost">6. Self-Hosting</h2>
          <p>Run the full stack (Web Studio + HTTP API + MCP Server + Chromium) in Docker:</p>
          <PlainPre code={dockerSnippet} />

          <table className="plain-table">
            <thead>
              <tr>
                <th>Variable</th>
                <th>Default</th>
                <th>Purpose</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>PORT</code>
                </td>
                <td>
                  <code>48333</code>
                </td>
                <td>HTTP &amp; MCP listen port</td>
              </tr>
              <tr>
                <td>
                  <code>MERMAID_RENDER_CONCURRENCY</code>
                </td>
                <td>
                  <code>4</code>
                </td>
                <td>Headless Chromium context pool size (1–16)</td>
              </tr>
              <tr>
                <td>
                  <code>CHROME_PATH</code>
                </td>
                <td>auto-detected</td>
                <td>Path to Chrome or Chromium binary when running natively</td>
              </tr>
              <tr>
                <td>
                  <code>MERMAID_PUBLIC_URL</code>
                </td>
                <td>request host</td>
                <td>Optional explicit public origin override behind proxies</td>
              </tr>
            </tbody>
          </table>

          <h2 id="doc-keys">7. Shortcuts</h2>
          <ul>
            <li>
              <code>Ctrl/Cmd + E</code> — Toggle between Preview and Code editor
            </li>
            <li>
              <code>Alt + 1..9</code> — Switch to tab 1–9
            </li>
            <li>Double-click tab — Rename diagram tab</li>
            <li>Middle-click tab — Close diagram tab</li>
            <li>Mouse wheel / drag on canvas — Zoom and pan diagram</li>
          </ul>
        </article>
      </div>
    </div>
  );
}

function PlainPre({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="plain-pre-wrap">
      <button
        type="button"
        className="plain-copy-btn"
        onClick={() => {
          navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        }}
      >
        {copied ? '[copied]' : '[copy]'}
      </button>
      <pre className="plain-pre">{code}</pre>
    </div>
  );
}
