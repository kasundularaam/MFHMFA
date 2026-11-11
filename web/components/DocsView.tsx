import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

const PUBLIC_BASE_URL = 'https://mfhmfa.kasun.si';
const PUBLIC_MCP_URL = `${PUBLIC_BASE_URL}/mcp`;

const MCP_JSON_SNIPPET = JSON.stringify(
  {
    mcpServers: {
      mfhmfa: {
        url: PUBLIC_MCP_URL,
      },
    },
  },
  null,
  2
);

const PI_CLI_SNIPPET = `pi mcp add mfhmfa --url ${PUBLIC_MCP_URL} --exposure deferred`;

const CLAUDE_CLI_SNIPPET = `claude mcp add --transport http mfhmfa ${PUBLIC_MCP_URL}`;

const REST_CALL_SNIPPET = `curl -X POST ${PUBLIC_BASE_URL}/api/tools/call \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "mermaid_render",
    "arguments": {
      "code": "flowchart LR\\n  A[\\"Agent\\"] --> B[\\"Retina PNG\\"]"
    }
  }'`;

const TOOLS_SUMMARY = [
  {
    name: 'mermaid_render',
    desc: 'Validate & render Mermaid code into a 2x Retina PNG (ImageContent vision) + optional SVG and layout diagnostics.',
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

export function DocsView() {
  return (
    <div className="docs-page">
      <div className="docs-container">
        <div className="docs-header">
          <h1>Connect MFHMFA via MCP</h1>
          <p>
            Give your AI coding agent stateless Mermaid validation, 2x Retina PNG rendering, and
            visual diagram inspection directly over HTTP — no installation required.
          </p>
        </div>

        <section className="docs-section">
          <div className="docs-section-head">
            <div>
              <h2>1. MCP Config (Cursor, Antigravity, Windsurf, Claude Desktop)</h2>
              <p>
                Add the hosted Streamable HTTP endpoint (<code>{PUBLIC_MCP_URL}</code>) to your{' '}
                <code>mcp.json</code>.
              </p>
            </div>
            <CopyButton text={MCP_JSON_SNIPPET} />
          </div>
          <pre className="code-block">{MCP_JSON_SNIPPET}</pre>
        </section>

        <section className="docs-section">
          <div className="docs-section-head">
            <div>
              <h2>2. Pi Coding Agent</h2>
              <p>Add globally from your terminal (run /reload inside an active session).</p>
            </div>
            <CopyButton text={PI_CLI_SNIPPET} />
          </div>
          <pre className="code-block">{PI_CLI_SNIPPET}</pre>
        </section>

        <section className="docs-section">
          <div className="docs-section-head">
            <div>
              <h2>3. Claude Code CLI</h2>
              <p>Register the remote HTTP MCP server in one command.</p>
            </div>
            <CopyButton text={CLAUDE_CLI_SNIPPET} />
          </div>
          <pre className="code-block">{CLAUDE_CLI_SNIPPET}</pre>
        </section>

        <section className="docs-section">
          <div className="docs-section-head">
            <div>
              <h2>4. Available Stateless MCP Tools</h2>
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
              <h2>5. Direct HTTP Function-Calling API</h2>
              <p>
                Schemas at <code>GET {PUBLIC_BASE_URL}/api/tools/schemas</code> · Dispatch via{' '}
                <code>POST {PUBLIC_BASE_URL}/api/tools/call</code>.
              </p>
            </div>
            <CopyButton text={REST_CALL_SNIPPET} />
          </div>
          <pre className="code-block">{REST_CALL_SNIPPET}</pre>
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
