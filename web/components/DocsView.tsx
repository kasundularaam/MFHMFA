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
    "name": "render_view",
    "arguments": {
      "project": "Order Service",
      "path": "checkout/order-pipeline.mmd",
      "code": "flowchart LR\\n  Cart[\\"Cart\\"] --> Pay[\\"Payment\\"] --> Ship[\\"Fulfill\\"]",
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
              <a href="#doc-mcp">2. MCP Setup</a>
            </li>
            <li>
              <a href="#doc-how">3. How Views Work</a>
            </li>
            <li>
              <a href="#doc-storage">4. Projects &amp; Storage</a>
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
          <h1 id="doc-overview">MFHMFA Overview</h1>
          <p>
            <strong>MFHMFA</strong> is an interactive visual learning workspace and MCP server
            you pair with your AI agent. Use it when you want to understand a{' '}
            <strong>concept</strong>, <strong>research paper</strong>, <strong>codebase</strong>
            , <strong>bug</strong>, or <strong>design tradeoff</strong>.
          </p>
          <p>
            Instead of pasting a giant diagram into chat, your agent checks the layout visually
            and streams a small 4–7 box diagram to this tab, complete with step-by-step
            walkthroughs, clickable box notes, and linked sub-diagrams.
          </p>

          <h2 id="doc-mcp">2. MCP Setup</h2>
          <p>
            Your workspace key for this browser is <code>{workspaceId}</code>{' '}
            <button
              type="button"
              className="plain-link-btn"
              onClick={onRotateWorkspaceId}
              title="Generate new workspace key"
            >
              [Generate new key]
            </button>
            . Add <code>?workspace={workspaceId}</code> to your MCP client and keep this tab
            open while working so new views stream straight into your browser.
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

          <h2 id="doc-how">3. How Views Work</h2>
          <ul>
            <li>
              <strong>Teaching Modes:</strong> Agents call <code>get_playbook</code> first with{' '}
              <code>concept</code>, <code>paper</code>, <code>codebase</code>, <code>bug</code>,
              or <code>tradeoff</code> so the diagram structure matches what you are learning.
            </li>
            <li>
              <strong>Side-by-Side Story Guide:</strong> Read the big-picture intro and all
              walkthrough steps top-to-bottom right alongside the diagram. Click any step (or
              press <code>&uarr;</code> / <code>&darr;</code>) to spotlight that hop, switch
              between contrasting scenarios, inspect runtime traces, and tap inline quick
              checks.
            </li>
            <li>
              <strong>In-Place Box Cards:</strong> Labels on boxes stay short (2–5 plain words).
              Click any outlined box to open a popover right beside it with its plain
              explanation, official technical term or equation, concrete example, edge cases,
              and source references.
            </li>
            <li>
              <strong>Sub-Diagram Zoom:</strong> Deeper subsystems live in child sub-diagrams
              linked via <code>childPath</code>. Double-click any dashed box (or click{' '}
              <em>Explore&hellip;</em>) to zoom inside, and use the breadcrumb trail to jump
              back.
            </li>
            <li>
              <strong>Live Selection Context:</strong> When you select a box or focus a step,
              your agent can see what you are looking at via <code>list_views</code> or{' '}
              <code>get_playbook</code> when you ask follow-up questions like{' '}
              <em>&ldquo;explain this box deeper&rdquo;</em>.
            </li>
          </ul>

          <h2 id="doc-storage">4. Projects &amp; Storage</h2>
          <p>
            Nothing is saved on the server. All projects, folders, graphs, and interactive
            guides stay in your browser&apos;s IndexedDB:
          </p>
          <ul>
            <li>
              <strong>Per-Project Folders:</strong> Each MCP session is scoped to its own
              project folder (detected from MCP workspace roots, local folder name, or{' '}
              <code>?project=...</code>). You can organize topics into folders inside any
              project.
            </li>
            <li>
              <strong>Clean Root Topics:</strong> Sub-diagrams stay nested inside their parent
              topic rather than cluttering the sidebar. Deleting a graph removes the root view
              and all of its nested sub-diagrams together.
            </li>
            <li>
              <strong>You Control Deletion:</strong> Agents can list, read, create, update, and
              move views inside their project, while only you can delete graphs, folders, or
              projects from the Explorer menu.
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
                  <code>get_playbook</code>
                </td>
                <td>
                  <code>mode</code>, <code>syntax?</code>, <code>project?</code>
                </td>
                <td>
                  Loads the guide for <code>concept</code>, <code>paper</code>,{' '}
                  <code>codebase</code>, <code>bug</code>, or <code>tradeoff</code>, plus
                  current project files and your active Studio selection.
                </td>
              </tr>
              <tr>
                <td>
                  <code>render_view</code>
                </td>
                <td>
                  <code>code</code>, <code>path?</code>, <code>title?</code>,{' '}
                  <code>guide?</code>, <code>theme?</code>, <code>look?</code>,{' '}
                  <code>scale?</code>, <code>outputPath?</code>
                </td>
                <td>
                  Validates Mermaid syntax, returns a 2x PNG preview + layout warnings to the
                  agent, and streams the view and <code>guide</code> live to your open tab.
                </td>
              </tr>
              <tr>
                <td>
                  <code>list_views</code>
                </td>
                <td>
                  <code>path?</code>, <code>project?</code>
                </td>
                <td>
                  Lists folders and <code>.mmd</code> files in the current project, along with
                  which view, step, or box you currently have selected.
                </td>
              </tr>
              <tr>
                <td>
                  <code>read_view</code>
                </td>
                <td>
                  <code>path</code>, <code>version?</code>, <code>project?</code>
                </td>
                <td>
                  Reads the <code>.mmd</code> source, attached <code>guide</code>, and 5-version
                  history of an existing view.
                </td>
              </tr>
              <tr>
                <td>
                  <code>move_view</code>
                </td>
                <td>
                  <code>from</code>, <code>to</code>, <code>project?</code>
                </td>
                <td>
                  Moves or renames a file or folder while keeping version history and updating
                  linked <code>childPath</code> / <code>parentPath</code> paths.
                </td>
              </tr>
              <tr>
                <td>
                  <code>export_view</code>
                </td>
                <td>
                  <code>code</code>, <code>outputPath</code>, <code>format?</code>
                </td>
                <td>
                  Renders and saves output to local disk (stdio / local dev) as{' '}
                  <code>.png</code>, <code>.svg</code>, <code>.mmd</code>, or <code>.md</code>.
                </td>
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
            For custom tool-calling integrations without an MCP client, fetch schemas from{' '}
            <code>GET {baseUrl}/api/tools/schemas</code> and call tools via{' '}
            <code>POST {baseUrl}/api/tools/call</code>:
          </p>
          <PlainPre code={restCallSnippet} />

          <p>Additional HTTP endpoints:</p>
          <ul>
            <li>
              <code>POST /api/validate</code>: JSON body{' '}
              <code>&#123; &quot;code&quot;: &quot;...&quot; &#125;</code>
            </li>
            <li>
              <code>POST /api/render</code>: Stateless SVG and base64 PNG render
            </li>
            <li>
              <code>GET /api/status</code>: Server health and worker pool status
            </li>
          </ul>

          <h2 id="doc-selfhost">7. Self-Hosting</h2>
          <p>Run in Docker on port 48333:</p>
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
              Click the top-left <strong>MFHMFA</strong> logo: Return from Docs to the studio
            </li>
            <li>
              <code>Ctrl/Cmd + B</code>: Show or hide Explorer sidebar
            </li>
            <li>
              <code>&uarr;</code> / <code>&darr;</code> or <code>&larr;</code> /{' '}
              <code>&rarr;</code>: Step through walkthrough cards (<code>Esc</code> closes an
              open box card or resets spotlighting to the full map)
            </li>
            <li>
              Click / Double-click outlined box: Open anchored box card / Zoom into linked child
              view
            </li>
            <li>
              <code>Alt + &larr;</code>: Return to parent diagram when zoomed into a sub-view
            </li>
            <li>Double-click folder in Explorer: Rename folder</li>
            <li>Mouse wheel / drag on canvas: Zoom around cursor and pan</li>
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
