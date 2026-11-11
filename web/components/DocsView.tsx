import { useState } from 'react';
import { Check, Copy, RefreshCw } from 'lucide-react';

const DEFAULT_PUBLIC_BASE_URL = 'https://mfhmfa.kasun.si';

const TOOLS_SUMMARY = [
  {
    name: 'mermaid_render',
    desc: 'Validate & render Mermaid code into a 2x Retina PNG (ImageContent vision), layout diagnostics, and auto-synced VS Code browser tabs (grouped by `title`).',
  },
  {
    name: 'mermaid_validate',
    desc: 'Fast syntax check returning 1-indexed line/column pointers, source snippets, and fix hints.',
  },
  {
    name: 'mermaid_export',
    desc: 'Render and export raw Mermaid code to .png, .svg, .mmd, or .md.',
  },
  {
    name: 'mermaid_syntax_guide',
    desc: 'Concise escaping rules and layout best practices (pitfalls, flowchart, sequence, er, state, class, mindmap, gantt).',
  },
  {
    name: 'mermaid_list_templates',
    desc: 'Starter Mermaid templates across 11 diagram categories.',
  },
];

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

  const mcpJsonSnippet = JSON.stringify(
    {
      mcpServers: {
        mfhmfa: {
          url: pairedMcpUrl,
        },
      },
    },
    null,
    2
  );

  const piCliSnippet = `pi mcp add mfhmfa --url "${pairedMcpUrl}" --exposure deferred`;
  const claudeCliSnippet = `claude mcp add --transport http mfhmfa "${pairedMcpUrl}"`;

  const restCallSnippet = `curl -X POST "${baseUrl}/api/tools/call?workspace=${workspaceId}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "mermaid_render",
    "arguments": {
      "title": "Order Pipeline",
      "code": "flowchart LR\\n  A[\\"Agent\\"] --> B[\\"Retina PNG + Browser Tab\\"]"
    }
  }'`;

  return (
    <div className="docs-page">
      <div className="docs-container">
        <div className="docs-header">
          <h1>Connect MFHMFA via MCP</h1>
          <p>
            Give your AI coding agent stateless Mermaid validation, 2x Retina PNG vision, and
            automatic multi-tab sync into this browser — zero installation or link-pasting required.
          </p>
        </div>

        <section className="docs-section">
          <div className="docs-section-head">
            <div>
              <h2>Your Private Browser Workspace Key</h2>
              <p>
                URLs below include <code>?workspace={workspaceId}</code> stored in this
                browser&apos;s <code>localStorage</code>. Whenever an agent renders multiple
                diagrams, each distinct <code>title</code> opens automatically as a VS Code tab
                here.
              </p>
            </div>
            <button
              className="btn ghost sm"
              onClick={onRotateWorkspaceId}
              title="Generate a new private workspace token"
            >
              <RefreshCw size={12} /> Rotate Key
            </button>
          </div>
        </section>

        <section className="docs-section">
          <div className="docs-section-head">
            <div>
              <h2>1. MCP Config (Cursor, Antigravity, Windsurf, Claude Desktop)</h2>
              <p>
                Add your paired Streamable HTTP endpoint to <code>mcp.json</code>.
              </p>
            </div>
            <CopyButton text={mcpJsonSnippet} />
          </div>
          <pre className="code-block">{mcpJsonSnippet}</pre>
        </section>

        <section className="docs-section">
          <div className="docs-section-head">
            <div>
              <h2>2. Pi Coding Agent</h2>
              <p>Add globally from your terminal (run /reload inside an active session).</p>
            </div>
            <CopyButton text={piCliSnippet} />
          </div>
          <pre className="code-block">{piCliSnippet}</pre>
        </section>

        <section className="docs-section">
          <div className="docs-section-head">
            <div>
              <h2>3. Claude Code CLI</h2>
              <p>Register the paired remote HTTP MCP server in one command.</p>
            </div>
            <CopyButton text={claudeCliSnippet} />
          </div>
          <pre className="code-block">{claudeCliSnippet}</pre>
        </section>

        <section className="docs-section">
          <div className="docs-section-head">
            <div>
              <h2>4. Multi-Tab Agent ↔ Browser Bridge</h2>
              <p>
                Works seamlessly both without links (via your workspace key) and via shareable
                links:
              </p>
            </div>
          </div>
          <div className="docs-tools-list">
            <div className="docs-tool-row">
              <code className="docs-tool-name">?workspace=ws_...</code>
              <span className="docs-tool-desc">
                Zero-link auto-push: every diagram your agent renders opens as a VS Code tab in
                this browser automatically (retries of the same <code>title</code> update that tab
                in place).
              </span>
            </div>
            <div className="docs-tool-row">
              <code className="docs-tool-name">liveUrl / studioUrl</code>
              <span className="docs-tool-desc">
                1-click multi-tab session links (<code>/live/:token</code> &amp;{' '}
                <code>/p/:id</code>) that open all diagrams from an agent conversation together.
              </span>
            </div>
            <div className="docs-tool-row">
              <code className="docs-tool-name">Permalink (/#z=...)</code>
              <span className="docs-tool-desc">
                Stateless <code>deflate-raw</code> hash permalink bundling all open tabs into one
                never-expiring URL.
              </span>
            </div>
          </div>
        </section>

        <section className="docs-section">
          <div className="docs-section-head">
            <div>
              <h2>5. Available Stateless MCP Tools</h2>
              <p>All tools are stateless and safe to invoke concurrently in parallel bursts.</p>
            </div>
          </div>
          <div className="docs-tools-list">
            {TOOLS_SUMMARY.map((tool) => (
              <div key={tool.name} className="docs-tool-row">
                <code className="docs-tool-name">{tool.name}</code>
                <span className="docs-tool-desc">{tool.desc}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="docs-section">
          <div className="docs-section-head">
            <div>
              <h2>6. Direct HTTP Function-Calling API</h2>
              <p>
                Schemas at <code>GET {baseUrl}/api/tools/schemas</code> · Dispatch via{' '}
                <code>POST {baseUrl}/api/tools/call</code>.
              </p>
            </div>
            <CopyButton text={restCallSnippet} />
          </div>
          <pre className="code-block">{restCallSnippet}</pre>
        </section>
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn ghost sm"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
