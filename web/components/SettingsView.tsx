import { useMemo, useState } from 'react';
import {
  Activity,
  BookOpen,
  Check,
  Copy,
  History,
  Moon,
  Sliders,
  Sun,
  Terminal,
} from 'lucide-react';
import type { AgentEventRecord, ChartVersionSummary } from '../../src/shared/types';
import type { SettingsSection, StageMode } from '../hooks/useStudioController';
import { studioApi, type ServerStatus } from '../services/studioClient';
import type { AppearanceMode } from '../theme/comfortTheme';

interface SettingsViewProps {
  section: SettingsSection;
  onChangeSection: (section: SettingsSection) => void;
  appearanceMode: AppearanceMode;
  onChangeAppearanceMode: (mode: AppearanceMode) => void;
  followAgentLive: boolean;
  onToggleFollowAgentLive: () => void;
  defaultOpenMode: StageMode;
  onChangeDefaultOpenMode: (mode: StageMode) => void;
  wsConnected: boolean;
  status: ServerStatus | null;
  events: AgentEventRecord[];
  activeChartId: string | null;
  title: string;
  version: number;
  versions: ChartVersionSummary[];
  guideText: string;
  onOpenChartInStudio: (chartId: string, version?: number) => void;
  onRestoreVersion: (ver: ChartVersionSummary) => Promise<void>;
}

const DEFAULT_PLAYGROUND_ARGS = JSON.stringify(
  {
    code: 'sequenceDiagram\n  Agent->>MCP: mermaid_render_preview\n  MCP-->>Agent: JSON + 2x Retina PNG',
  },
  null,
  2
);

export function SettingsView({
  section,
  onChangeSection,
  appearanceMode,
  onChangeAppearanceMode,
  followAgentLive,
  onToggleFollowAgentLive,
  defaultOpenMode,
  onChangeDefaultOpenMode,
  wsConnected,
  status,
  events,
  activeChartId,
  title,
  version,
  versions,
  guideText,
  onOpenChartInStudio,
  onRestoreVersion,
}: SettingsViewProps) {
  const [testToolName, setTestToolName] = useState('mermaid_render_preview');
  const [testToolArgs, setTestToolArgs] = useState(DEFAULT_PLAYGROUND_ARGS);
  const [testToolOutput, setTestToolOutput] = useState('');
  const [testToolImage, setTestToolImage] = useState<string | null>(null);
  const [testRunning, setTestRunning] = useState(false);

  const mcpSnippets = useMemo(() => {
    const httpUrl = status?.connections.mcpStreamableHttp || `${window.location.origin}/mcp`;
    const stdioArgs = status?.connections.mcpStdioArgs || ['tsx', 'src/mcp-stdio.ts'];
    return {
      httpSnippet: JSON.stringify(
        {
          mcpServers: {
            mfhmfa: {
              type: 'streamable-http',
              url: httpUrl,
            },
          },
        },
        null,
        2
      ),
      stdioSnippet: JSON.stringify(
        {
          mcpServers: {
            mfhmfa: {
              command: status?.connections.mcpStdioCommand || 'npx',
              args: stdioArgs,
            },
          },
        },
        null,
        2
      ),
      cliSnippet: `${status?.connections.cliExecutable || './bin/mfhmfa'} create --title "Service Flow" --code 'flowchart LR\\n  A["Gateway"] --> B["Worker"]'`,
    };
  }, [status]);

  const handleRunPlayground = async () => {
    setTestRunning(true);
    setTestToolImage(null);
    try {
      const parsedArgs = JSON.parse(testToolArgs) as Record<string, unknown>;
      const out = await studioApi.callAgentTool(testToolName, parsedArgs);
      setTestToolOutput(JSON.stringify(out.result, null, 2));
      if (out.image?.base64) {
        setTestToolImage(`data:${out.image.mimeType};base64,${out.image.base64}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setTestToolOutput(`Error: ${message}`);
    } finally {
      setTestRunning(false);
    }
  };

  return (
    <div className="settings-page">
      <div className="settings-layout">
        <nav className="settings-nav">
          <button
            className={`settings-nav-btn ${section === 'general' ? 'active' : ''}`}
            onClick={() => onChangeSection('general')}
          >
            <Sliders size={14} /> General
          </button>
          <button
            className={`settings-nav-btn ${section === 'mcp' ? 'active' : ''}`}
            onClick={() => onChangeSection('mcp')}
          >
            <Terminal size={14} /> MCP & Agents
          </button>
          <button
            className={`settings-nav-btn ${section === 'activity' ? 'active' : ''}`}
            onClick={() => onChangeSection('activity')}
          >
            <Activity size={14} /> AI Activity
          </button>
          <button
            className={`settings-nav-btn ${section === 'history' ? 'active' : ''}`}
            onClick={() => onChangeSection('history')}
          >
            <History size={14} /> Versions & Syntax
          </button>
        </nav>

        <div className="settings-content">
          {section === 'general' && (
            <div className="settings-container">
              <div className="settings-header">
                <h2>General</h2>
                <p>Display mode and workspace preferences.</p>
              </div>

              <div className="settings-list">
                <div className="setting-row">
                  <div>
                    <div className="setting-label">Appearance</div>
                    <div className="setting-desc">
                      Low-glare warm palette across interface, editor, and diagrams.
                    </div>
                  </div>
                  <div className="mode-choice-group">
                    <button
                      className={`mode-choice-btn ${appearanceMode === 'dark' ? 'active' : ''}`}
                      onClick={() => onChangeAppearanceMode('dark')}
                    >
                      <Moon size={13} /> Dark
                    </button>
                    <button
                      className={`mode-choice-btn ${appearanceMode === 'light' ? 'active' : ''}`}
                      onClick={() => onChangeAppearanceMode('light')}
                    >
                      <Sun size={13} /> Light
                    </button>
                  </div>
                </div>

                <div className="setting-row">
                  <div>
                    <div className="setting-label">Follow AI Agents Live</div>
                    <div className="setting-desc">
                      Automatically display charts created or updated by connected agents.
                    </div>
                  </div>
                  <button
                    className={`switch ${followAgentLive ? 'on' : ''}`}
                    onClick={onToggleFollowAgentLive}
                  >
                    <span className="switch-thumb" />
                  </button>
                </div>

                <div className="setting-row">
                  <div>
                    <div className="setting-label">Default View on Open</div>
                    <div className="setting-desc">
                      Initial view shown when selecting a saved chart.
                    </div>
                  </div>
                  <select
                    className="select-input"
                    value={defaultOpenMode}
                    onChange={(e) => onChangeDefaultOpenMode(e.target.value as StageMode)}
                  >
                    <option value="preview">Preview</option>
                    <option value="code">Code</option>
                  </select>
                </div>

                <div className="setting-row">
                  <div>
                    <div className="setting-label">Live Sync</div>
                    <div className="setting-desc">{status?.baseUrl || window.location.origin}</div>
                  </div>
                  <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                    {wsConnected ? 'Connected' : 'Offline'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {section === 'mcp' && (
            <div className="settings-container">
              <div className="settings-header">
                <h2>MCP & Agents</h2>
                <p>Connect AI agents to create, validate, and visually inspect rendered charts.</p>
              </div>

              <div className="settings-list">
                <div className="settings-block">
                  <div className="settings-block-head">
                    <div>
                      <div className="setting-label">MCP Streamable HTTP</div>
                      <div className="setting-desc">
                        For Antigravity, Cursor, Claude Code, and HTTP MCP clients.
                      </div>
                    </div>
                    <CopyButton text={mcpSnippets.httpSnippet} />
                  </div>
                  <pre className="code-block">{mcpSnippets.httpSnippet}</pre>
                </div>

                <div className="settings-block">
                  <div className="settings-block-head">
                    <div>
                      <div className="setting-label">MCP Stdio</div>
                      <div className="setting-desc">
                        For Claude Desktop and local process-spawned MCP clients.
                      </div>
                    </div>
                    <CopyButton text={mcpSnippets.stdioSnippet} />
                  </div>
                  <pre className="code-block">{mcpSnippets.stdioSnippet}</pre>
                </div>

                <div className="settings-block">
                  <div className="settings-block-head">
                    <div>
                      <div className="setting-label">CLI Command</div>
                      <div className="setting-desc">
                        For bash coding agents such as Pi, Codex, and OpenHands.
                      </div>
                    </div>
                    <CopyButton text={mcpSnippets.cliSnippet} />
                  </div>
                  <pre className="code-block">{mcpSnippets.cliSnippet}</pre>
                </div>

                <div className="settings-block">
                  <div>
                    <div className="setting-label">Tool Playground</div>
                    <div className="setting-desc">
                      Simulate an agent tool call and inspect the returned JSON and PNG output.
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select
                      className="select-input"
                      value={testToolName}
                      onChange={(e) => {
                        const next = e.target.value;
                        setTestToolName(next);
                        if (next === 'mermaid_validate') {
                          setTestToolArgs(
                            JSON.stringify({ code: 'flowchart TD\n  A[bad(paren)] --> B' }, null, 2)
                          );
                        } else if (next === 'mermaid_create_chart') {
                          setTestToolArgs(
                            JSON.stringify(
                              {
                                title: 'Service Mesh',
                                code: 'flowchart LR\n  GW["Gateway"] --> Auth["Auth"]\n  GW --> Billing["Billing"]',
                              },
                              null,
                              2
                            )
                          );
                        } else if (next === 'mermaid_render_preview') {
                          setTestToolArgs(DEFAULT_PLAYGROUND_ARGS);
                        } else if (next === 'mermaid_syntax_guide') {
                          setTestToolArgs(JSON.stringify({ topic: 'pitfalls' }, null, 2));
                        }
                      }}
                    >
                      <option value="mermaid_render_preview">mermaid_render_preview</option>
                      <option value="mermaid_validate">mermaid_validate</option>
                      <option value="mermaid_create_chart">mermaid_create_chart</option>
                      <option value="mermaid_syntax_guide">mermaid_syntax_guide</option>
                      <option value="mermaid_list_charts">mermaid_list_charts</option>
                    </select>

                    <button
                      className="btn primary"
                      onClick={handleRunPlayground}
                      disabled={testRunning}
                    >
                      {testRunning ? 'Running...' : 'Run'}
                    </button>
                  </div>

                  <textarea
                    value={testToolArgs}
                    onChange={(e) => setTestToolArgs(e.target.value)}
                    rows={5}
                    style={{
                      width: '100%',
                      background: 'var(--bg-bar)',
                      border: '1px solid var(--border-line)',
                      borderRadius: 5,
                      padding: 12,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                      fontSize: 12,
                    }}
                  />

                  {testToolImage && (
                    <div>
                      <div className="setting-desc" style={{ marginBottom: 6 }}>
                        Returned PNG ImageContent:
                      </div>
                      <img
                        src={testToolImage}
                        alt="Agent tool output"
                        style={{
                          maxWidth: '100%',
                          maxHeight: 220,
                          borderRadius: 4,
                          border: '1px solid var(--border-line)',
                        }}
                      />
                    </div>
                  )}

                  {testToolOutput && <pre className="code-block">{testToolOutput}</pre>}
                </div>
              </div>
            </div>
          )}

          {section === 'activity' && (
            <div className="settings-container">
              <div className="settings-header">
                <h2>AI Activity</h2>
                <p>Recent MCP, CLI, and API tool invocations ({events.length}).</p>
              </div>

              <div className="settings-list">
                {events.length === 0 ? (
                  <div className="setting-row">
                    <div className="setting-desc">No agent calls recorded yet.</div>
                  </div>
                ) : (
                  events.map((ev) => (
                    <div key={ev.id} className="setting-row">
                      <div>
                        <div
                          className="setting-label"
                          style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}
                        >
                          <span>{ev.toolName}</span>
                          <span
                            style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 400 }}
                          >
                            {ev.source} · {ev.durationMs}ms
                          </span>
                        </div>
                        <div className="setting-desc">{ev.summary}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                          {new Date(ev.createdAt).toLocaleTimeString()}
                        </span>
                        {ev.chartId && (
                          <button
                            className="btn ghost sm"
                            onClick={() => onOpenChartInStudio(ev.chartId!)}
                          >
                            Open
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {section === 'history' && (
            <div className="settings-container">
              <div className="settings-header">
                <h2>Versions & Syntax</h2>
                <p>
                  Snapshots for "{title}" (v{version}) and Mermaid syntax reference.
                </p>
              </div>

              <div className="settings-list">
                {versions.length === 0 ? (
                  <div className="setting-row">
                    <div className="setting-desc">Save this chart to record version snapshots.</div>
                  </div>
                ) : (
                  versions.map((v) => (
                    <div key={v.version} className="setting-row">
                      <div>
                        <div className="setting-label">
                          v{v.version} · {v.author}
                        </div>
                        <div className="setting-desc">
                          {v.changeNote || 'Snapshot'} · {new Date(v.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="btn ghost sm"
                          onClick={() => {
                            if (activeChartId) {
                              onOpenChartInStudio(activeChartId, v.version);
                            }
                          }}
                        >
                          View
                        </button>
                        <button className="btn sm" onClick={() => onRestoreVersion(v)}>
                          Restore
                        </button>
                      </div>
                    </div>
                  ))
                )}

                <div className="settings-block">
                  <div
                    className="setting-label"
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <BookOpen size={14} /> Syntax Reference
                  </div>
                  <pre className="code-block" style={{ whiteSpace: 'pre-wrap' }}>
                    {guideText}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
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
