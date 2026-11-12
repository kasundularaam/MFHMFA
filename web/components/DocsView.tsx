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
      "code": "flowchart LR\\n  Cart[\\"Cart\\"] --> Pay[\\"Payment\\"] --> Ship[\\"Fulfill\\"]",
      "guide": {
        "gist": "Orders enter fulfillment only after payment succeeds.",
        "steps": [
          {
            "title": "1. Authorize payment",
            "caption": "Cart submits order total to Payment before fulfillment.",
            "focusNodes": ["Cart", "Pay"]
          }
        ]
      }
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
              <a href="#doc-why">1. Overview</a>
            </li>
            <li>
              <a href="#doc-how">2. Interactive Features</a>
            </li>
            <li>
              <a href="#doc-mcp">3. MCP Setup</a>
            </li>
            <li>
              <a href="#doc-vfs">4. Projects &amp; File History</a>
            </li>
            <li>
              <a href="#doc-tools">5. MCP Tools</a>
            </li>
            <li>
              <a href="#doc-http">6. HTTP Tool API</a>
            </li>
            <li>
              <a href="#doc-selfhost">7. Self-Hosting</a>
            </li>
            <li>
              <a href="#doc-keys">8. Shortcuts</a>
            </li>
          </ul>
        </nav>

        <article className="docs-body">
          <h1 id="doc-why">MFHMFA — Overview</h1>
          <p>
            <strong>MFHMFA</strong> (<em>Mermaid For Humans, Mermaid For Agents</em>) is an
            interactive diagram workspace and Model Context Protocol (MCP) server for
            understanding codebases with AI coding agents.
          </p>
          <p>
            AI coding agents can generate thousands of lines of code in minutes, leaving
            builders owning systems that are hard to picture mentally. Standard static diagrams
            usually fall into one of two traps:
          </p>
          <ul>
            <li>
              <strong>Too Technical:</strong> Crowded boxes filled with framework jargon and
              internal identifiers that overload working memory.
            </li>
            <li>
              <strong>Too Abstract:</strong> Vague high-level boxes that hide real data flow,
              payloads, and what happens when something fails.
            </li>
          </ul>
          <p>
            MFHMFA keeps visual diagrams concise while attaching interactive walkthrough steps,
            clickable component details, and linked sub-diagrams saved locally in your
            browser&apos;s IndexedDB.
          </p>

          <h2 id="doc-how">2. Interactive Features</h2>
          <ul>
            <li>
              <strong>Concise Views &amp; Sub-Diagram Zoom:</strong> Agents keep each view
              focused (4–7 boxes with short labels) and link deeper subsystems via{' '}
              <code>childPath</code>. Double-click any dashed box (or click{' '}
              <em>Zoom into&hellip;</em>) to open its child diagram, and use the top-left
              breadcrumb to navigate back.
            </li>
            <li>
              <strong>Step-by-Step Walkthroughs:</strong> Click <strong>Walkthrough</strong> (or
              press <code>&larr;</code> / <code>&rarr;</code>) to highlight one step at a time
              while unrelated branches dim out.
            </li>
            <li>
              <strong>Component Details:</strong> Click any highlighted box to view how it
              works, a concrete example, failure edge cases, and relevant source files.
            </li>
            <li>
              <strong>Visual Verification:</strong> When an agent calls{' '}
              <code>mermaid_render</code>, it receives a 2x PNG preview and layout diagnostics
              so it can fix overlaps before streaming the final diagram to your open tab.
            </li>
          </ul>

          <h2 id="doc-mcp">3. MCP Setup</h2>
          <p>
            Your workspace token for this browser is <code>{workspaceId}</code>{' '}
            <button
              type="button"
              className="plain-link-btn"
              onClick={onRotateWorkspaceId}
              title="Generate new workspace key"
            >
              [Generate new key]
            </button>
            . Connect your coding agent with <code>?workspace={workspaceId}</code> and keep this
            browser tab open while working so live updates sync straight to your workspace.
          </p>

          <h3>mcp.json (Cursor, Antigravity, Windsurf, Claude Desktop)</h3>
          <PlainPre code={mcpJsonSnippet} />

          <h3>CLI Registration (Pi &amp; Claude Code)</h3>
          <PlainPre code={cliSetupSnippet} />

          <h3>Local Stdio Process</h3>
          <p>
            When running locally from source (requires Node.js &ge; 20 and Chrome/Chromium):
          </p>
          <PlainPre code={stdioSetupSnippet} />
          <p>
            Legacy SSE MCP clients are also supported at <code>{baseUrl}/mcp/sse</code>.
          </p>

          <h2 id="doc-vfs">4. Projects &amp; File History</h2>
          <p>
            Projects, folders, <code>.mmd</code> diagrams, and walkthrough guides are saved
            locally in your browser&apos;s IndexedDB (zero diagrams stored on the server):
          </p>
          <ul>
            <li>
              <strong>Per-Project Isolation:</strong> Each MCP session is scoped to its own
              project folder (detected from MCP workspace roots, local directory, or{' '}
              <code>?project=...</code>).
            </li>
            <li>
              <strong>Multi-Agent Collaboration:</strong> Multiple agents working on the same
              repository can browse and update shared files via <code>mermaid_ls</code> and{' '}
              <code>mermaid_read</code>.
            </li>
            <li>
              <strong>File History:</strong> Rapid layout retries by the same agent merge
              cleanly, and up to 5 recent versions per file are available from the{' '}
              <code>vN</code> history menu in the tab bar. Only you can delete files, folders,
              or projects from the <code>&bull;&bull;&bull;</code> menu in the Explorer.
            </li>
          </ul>

          <h2 id="doc-tools">5. MCP Tools</h2>
          <table className="plain-table">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Arguments</th>
                <th>Purpose</th>
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
                  Lists folders and <code>.mmd</code> files in the current project.
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
                  Reads the <code>.mmd</code> source, walkthrough <code>guide</code>, and file
                  history of an existing diagram.
                </td>
              </tr>
              <tr>
                <td>
                  <code>mermaid_render</code>
                </td>
                <td>
                  <code>code</code>, <code>path?</code>, <code>title?</code>,{' '}
                  <code>guide?</code>, <code>theme?</code>, <code>look?</code>,{' '}
                  <code>scale?</code>, <code>outputPath?</code>
                </td>
                <td>
                  Validates syntax, syncs the diagram and optional <code>guide</code> to your
                  open tab, and returns a 2x PNG preview with layout diagnostics.
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
                  Moves or renames a file or folder while preserving history and updating linked{' '}
                  <code>childPath</code> / <code>parentPath</code> references.
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
                  Checks syntax and lint rules, returning line/column snippets and fix
                  suggestions.
                </td>
              </tr>
              <tr>
                <td>
                  <code>mermaid_export</code>
                </td>
                <td>
                  <code>code</code>, <code>outputPath</code>, <code>format?</code>
                </td>
                <td>
                  Renders and saves diagram output to local disk (stdio / local dev) as{' '}
                  <code>.png</code>, <code>.svg</code>, <code>.mmd</code>, or <code>.md</code>.
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
                  Returns syntax and layout reference guides (<code>comprehension</code>,{' '}
                  <code>pitfalls</code>, <code>flowchart</code>, <code>sequence</code>,{' '}
                  <code>er</code>, <code>state</code>, <code>class</code>, <code>mindmap</code>,{' '}
                  <code>gantt</code>, or <code>all</code>).
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
            <strong>Repository:</strong>{' '}
            <a
              href="https://github.com/kasundularaam/MFHMFA"
              target="_blank"
              rel="noopener noreferrer"
            >
              github.com/kasundularaam/MFHMFA
            </a>
          </p>

          <h2 id="doc-http">6. HTTP Tool API</h2>
          <p>
            For custom function-calling integrations without an MCP client, fetch schemas from{' '}
            <code>GET {baseUrl}/api/tools/schemas</code> and call tools via{' '}
            <code>POST {baseUrl}/api/tools/call</code>:
          </p>
          <PlainPre code={restCallSnippet} />

          <p>Additional HTTP endpoints:</p>
          <ul>
            <li>
              <code>POST /api/validate</code> — JSON body{' '}
              <code>&#123; &quot;code&quot;: &quot;...&quot; &#125;</code>
            </li>
            <li>
              <code>POST /api/render</code> — SVG and base64 PNG render
            </li>
            <li>
              <code>GET /api/status</code> — Server health and active session status
            </li>
          </ul>

          <h2 id="doc-selfhost">7. Self-Hosting</h2>
          <p>Run the full stack in Docker:</p>
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
                <td>Headless Chromium worker pool size (1–16)</td>
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
                <td>Optional public origin override behind reverse proxies</td>
              </tr>
            </tbody>
          </table>

          <h2 id="doc-keys">8. Shortcuts</h2>
          <ul>
            <li>
              Click the top-left <strong>MFHMFA</strong> logo — Return to the studio workspace
            </li>
            <li>
              <code>Ctrl/Cmd + B</code> — Toggle Explorer sidebar
            </li>
            <li>
              <code>Ctrl/Cmd + E</code> — Switch between Preview and Code view
            </li>
            <li>
              <code>&larr;</code> / <code>&rarr;</code> (in Preview) — Step through walkthrough
              (<code>Esc</code> closes details or exits walkthrough)
            </li>
            <li>
              Click / Double-click highlighted box — View details / Open linked child diagram
            </li>
            <li>
              <code>Alt + 1..9</code> — Switch to open tab 1–9
            </li>
            <li>Double-click file in Explorer — Rename file</li>
            <li>Middle-click open tab — Close tab</li>
            <li>Mouse wheel / drag on canvas — Cursor-centered zoom and pan</li>
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
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre className="plain-pre">{code}</pre>
    </div>
  );
}
