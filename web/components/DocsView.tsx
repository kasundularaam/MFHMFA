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
      "project": "Order Service",
      "path": "checkout/order-pipeline.mmd",
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
            zero-storage Mermaid workspace, headless Chromium validator/renderer, and Model Context
            Protocol (MCP) server. The server stores <strong>zero diagrams</strong> in memory or on
            disk — all workspace state lives locally in your browser&apos;s{' '}
            <code>localStorage</code>.
          </p>
          <p>
            When an AI coding agent connects over MCP, MFHMFA identifies the agent (e.g.{' '}
            <strong>Claude Code</strong>, <strong>Pi</strong>, <strong>Cursor</strong>,{' '}
            <strong>Antigravity</strong>) and the project workspace, allocates a dedicated space in
            your browser&apos;s <code>localStorage</code>, and streams rendered diagrams straight
            into Chrome-style Project &amp; Agent tab groups.
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

          <h2 id="doc-sync">3. VS Code Explorer, VFS &amp; Immutable History</h2>
          <p>
            Visiting the Studio initializes a Virtual Diagram Filesystem (
            <code>mfhmfa-workspace-v4</code>) in your browser <code>localStorage</code> while the
            server acts strictly as a zero-storage 2-way SSE bridge:
          </p>
          <ul>
            <li>
              <strong>Jailed Project Working Directory</strong> — Each MCP session is bound to its
              working project (resolved via MCP <code>roots/list</code>, Stdio <code>cwd</code>, or{' '}
              <code>?project=...</code>). Agents can only list, read, render, and move paths inside
              their own working project, while you see all projects side-by-side in the Left
              Explorer.
            </li>
            <li>
              <strong>Cross-Agent Collaboration (<code>ls</code> &amp; <code>read</code>)</strong>{' '}
              — Multiple agents (e.g. <em>Claude Code</em> and <em>Pi</em>) working in the same
              project share subfolders (<code>architecture/</code>, <code>auth/</code>,{' '}
              <code>db/</code>), inspect each other&apos;s graphs via <code>mermaid_ls</code> and{' '}
              <code>mermaid_read</code>, and display author badges (<code>claude</code>,{' '}
              <code>pi</code>, <code>you</code>) in the Explorer tree.
            </li>
            <li>
              <strong>Last-5 Immutable Revisions</strong> — Every graph maintains an immutable ring
              buffer of its last 5 versions. Use the <code>vN</code> history menu on the right side
              of the tab bar to inspect or restore earlier revisions. Only humans can delete graphs
              or folders.
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
                  <code>mermaid_ls</code>
                </td>
                <td>
                  <code>path?</code>, <code>project?</code>
                </td>
                <td>
                  Lists subfolders and <code>.mmd</code> graphs inside the agent&apos;s jailed
                  project working directory with diagram type, version, and author badge.
                </td>
              </tr>
              <tr>
                <td>
                  <code>mermaid_read</code>
                </td>
                <td>
                  <code>path</code>, <code>version?</code>
                </td>
                <td>
                  Reads the <code>.mmd</code> source of an existing graph (latest head or any of
                  the last 5 immutable revisions) + revision history.
                </td>
              </tr>
              <tr>
                <td>
                  <code>mermaid_render</code>
                </td>
                <td>
                  <code>code</code>, <code>path?</code>, <code>title?</code>,{' '}
                  <code>project?</code>, <code>theme?</code>, <code>look?</code>,{' '}
                  <code>scale?</code>, <code>outputPath?</code>
                </td>
                <td>
                  Creates parent folders, appends a new immutable revision in browser{' '}
                  <code>localStorage</code>, validates syntax, and returns a 2x Retina PNG +
                  layout diagnostics + <code>#z=</code> <code>studioUrl</code>.
                </td>
              </tr>
              <tr>
                <td>
                  <code>mermaid_mv</code>
                </td>
                <td>
                  <code>from</code>, <code>to</code>
                </td>
                <td>
                  Moves or renames a graph or subfolder inside the working project while preserving
                  its 5-version history. (No <code>rm</code> tool is exposed to agents.)
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
              <code>Ctrl/Cmd + B</code> — Toggle Left Explorer sidebar
            </li>
            <li>
              <code>Ctrl/Cmd + E</code> — Toggle between Preview and Code view (or click the icon
              at the right edge of the tab bar)
            </li>
            <li>
              <code>Alt + 1..9</code> — Switch to open tab 1–9
            </li>
            <li>Double-click item in Explorer — Rename graph</li>
            <li>Middle-click open tab — Close tab (keeps graph in Explorer)</li>
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
