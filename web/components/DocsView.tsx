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
              <a href="#doc-why">1. Why MFHMFA Exists</a>
            </li>
            <li>
              <a href="#doc-how">2. How Comprehension Works</a>
            </li>
            <li>
              <a href="#doc-mcp">3. MCP Setup</a>
            </li>
            <li>
              <a href="#doc-vfs">4. Zero-Storage Browser VFS</a>
            </li>
            <li>
              <a href="#doc-tools">5. MCP Tools &amp; Guide Schema</a>
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
          <h1 id="doc-why">MFHMFA — Why, What &amp; How</h1>
          <p>
            <strong>MFHMFA</strong> (<em>Mermaid For Humans, Mermaid For Agents</em>) is a
            zero-server-storage <strong>Codebase Comprehension Studio</strong> and Model Context
            Protocol (MCP) server.
          </p>
          <p>
            AI coding agents can write thousands of lines of code in minutes, creating a new
            bottleneck: <strong>builders often own systems they cannot mentally simulate.</strong>{' '}
            Standard static diagrams fail at comprehension in two predictable ways:
          </p>
          <ul>
            <li>
              <strong>Too Technical (Jargon Overload):</strong> 15 boxes stuffed with framework
              buzzwords and variable names that exceed human working memory (~4–7 novel items).
            </li>
            <li>
              <strong>Too Abstract (Toy Metaphors):</strong> Vague simplified boxes that hide
              causality, data sizes, and what breaks when a component fails.
            </li>
          </ul>
          <p>
            MFHMFA pairs Mermaid&apos;s clean visual layout with interactive comprehension layers
            grounded in cognitive science—while storing <strong>zero diagrams on the server</strong>{' '}
            (everything lives in your browser&apos;s <code>localStorage</code>).
          </p>

          <h2 id="doc-how">2. How Comprehension Works in Studio</h2>
          <ul>
            <li>
              <strong>4–7 Boxes per View + Sub-Graph Zoom (Working Memory Law):</strong> Agents keep
              each diagram concise (2–5 plain words per box) and link deeper subsystems via{' '}
              <code>childPath</code>. Double-click any dashed box (or click{' '}
              <em>Zoom into&hellip;</em>) to drill into its child <code>.mmd</code> graph, and use
              the top-left breadcrumb to zoom back out.
            </li>
            <li>
              <strong>Story Mode Stepper (Segmenting &amp; Signaling):</strong> Click{' '}
              <strong>Walk Through</strong> (or press <code>&larr;</code> / <code>&rarr;</code>) to
              follow one concrete flow step-by-step while inactive nodes and arrows dim out.
            </li>
            <li>
              <strong>Clickable Node Inspector (Dual Coding &amp; Counterfactuals):</strong> Click
              any outlined box to inspect its plain mechanism, a{' '}
              <strong>Concrete Example</strong> (real sizes, counts, or timings),{' '}
              <strong>What Breaks If&hellip;</strong> failure behavior, and repository{' '}
              <strong>Source Files</strong>.
            </li>
            <li>
              <strong>2x Retina Agent Vision + Cognitive Linter:</strong> Every{' '}
              <code>mermaid_render</code> call validates syntax, renders a 2x Retina PNG for the
              agent to inspect visually, checks layout &amp; cognitive load diagnostics, coalesces
              rapid retries into one clean revision, and streams the finished graph live to this
              browser tab.
            </li>
          </ul>

          <h2 id="doc-mcp">3. MCP Setup</h2>
          <p>
            This browser holds a private workspace token in <code>localStorage</code>:{' '}
            <code>{workspaceId}</code>{' '}
            <button
              type="button"
              className="plain-link-btn"
              onClick={onRotateWorkspaceId}
              title="Generate a new workspace key"
            >
              [rotate]
            </button>
            . Pairing your coding agent with <code>?workspace={workspaceId}</code> connects it to
            this browser&apos;s live stream (keep a Studio tab open while your agent works—the
            server stores nothing).
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

          <h2 id="doc-vfs">4. Zero-Storage Browser VFS &amp; History</h2>
          <p>
            All project trees, <code>.mmd</code> files, and comprehension guides live locally under{' '}
            <code>mfhmfa-workspace-v4</code> in your browser&apos;s <code>localStorage</code>:
          </p>
          <ul>
            <li>
              <strong>Jailed Project Working Directory:</strong> Each MCP session is locked to its
              own project root (discovered via MCP <code>roots/list</code>, Stdio <code>cwd</code>,
              or <code>?project=...</code>). Agents cannot read or overwrite other projects.
            </li>
            <li>
              <strong>Multi-Agent Collaboration:</strong> Multiple agents (e.g.{' '}
              <em>Claude Code</em> and <em>Pi</em>) working on the same repo share subfolders, read
              each other&apos;s graphs via <code>mermaid_ls</code> and <code>mermaid_read</code>,
              and show author badges in the Explorer.
            </li>
            <li>
              <strong>Smart Coalescing &amp; Last-5 Ring Buffer:</strong> Rapid retries by the same
              agent within 90s merge into the head revision so layout fixes never clutter history.
              Distinct updates keep an immutable 5-version ring buffer (inspect or restore from the{' '}
              <code>vN</code> menu). Only humans can delete files or folders.
            </li>
            <li>
              <strong>Stateless Permalinks (<code>#z=...</code>):</strong> Share a deflate-compressed
              snapshot—including Story Mode steps and Node Inspector cards—directly in a URL hash
              with zero server database.
            </li>
          </ul>

          <h2 id="doc-tools">5. MCP Tools &amp; Guide Schema</h2>
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
                  Lists subfolders and <code>.mmd</code> files in the jailed project directory with
                  diagram type, version, step count, and author badge.
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
                  Reads the <code>.mmd</code> source, attached comprehension <code>guide</code>, and
                  5-version history of an existing graph.
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
                  Validates syntax, streams Mermaid + optional <code>guide</code> (<code>gist</code>
                  , <code>steps</code>, <code>nodes</code>, <code>parentPath</code>) into browser{' '}
                  <code>localStorage</code>, and returns a 2x Retina PNG + layout/cognitive
                  diagnostics.
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
                  Moves or renames a graph or folder while preserving history and rewriting any{' '}
                  <code>childPath</code> / <code>parentPath</code> links.
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
                  Checks syntax and static lint rules (including dense box label warnings); returns
                  line/column snippets and targeted fix hints.
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
                  Comprehension rules (<code>comprehension</code>) plus escaping and layout guides (
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
                <td>Returns curated starter Mermaid templates across 11 diagram categories.</td>
              </tr>
            </tbody>
          </table>

          <p>
            <strong>Source &amp; Philosophy:</strong>{' '}
            <a
              href="https://github.com/kasundularaam/MFHMFA"
              target="_blank"
              rel="noopener noreferrer"
            >
              github.com/kasundularaam/MFHMFA
            </a>{' '}
            (see <code>PHILOSOPHY.md</code>).
          </p>

          <h2 id="doc-http">6. HTTP Tool API</h2>
          <p>
            For direct OpenAI / Anthropic / Gemini function-calling without an MCP client, fetch
            schemas from <code>GET {baseUrl}/api/tools/schemas</code> and invoke tools via{' '}
            <code>POST {baseUrl}/api/tools/call</code>:
          </p>
          <PlainPre code={restCallSnippet} />

          <p>Additional direct HTTP endpoints:</p>
          <ul>
            <li>
              <code>POST /api/validate</code> — JSON body{' '}
              <code>&#123; &quot;code&quot;: &quot;...&quot; &#125;</code>
            </li>
            <li>
              <code>POST /api/render</code> — Stateless SVG + base64 PNG render
            </li>
            <li>
              <code>GET /api/status</code> — Server health, Chromium pool telemetry, and active MCP
              session counts
            </li>
          </ul>

          <h2 id="doc-selfhost">7. Self-Hosting</h2>
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

          <h2 id="doc-keys">8. Shortcuts</h2>
          <ul>
            <li>
              <code>Ctrl/Cmd + B</code> — Toggle Left Explorer sidebar
            </li>
            <li>
              <code>Ctrl/Cmd + E</code> — Toggle between Preview and Code view
            </li>
            <li>
              <code>&larr;</code> / <code>&rarr;</code> (in Preview) — Step backward / forward
              through Story Mode (<code>Esc</code> closes Inspector or returns to Overview)
            </li>
            <li>
              Click / Double-click outlined box — Open Node Inspector card / Zoom into linked child
              sub-graph
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
