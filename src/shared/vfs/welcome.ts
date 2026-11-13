import type { DiagramComprehensionGuide } from '../types.js';

export const WELCOME_CODE = `flowchart TB
  Agent(["Your AI Agent"])

  subgraph Server["MFHMFA Server"]
    Check["Layout Check"]
    Sync["Live Sync"]
  end

  subgraph Browser["Your Browser"]
    Canvas["Studio Canvas"]
    Storage[("Browser Storage")]
  end

  Agent -->|"1. Check layout"| Check
  Check -.->|"2. PNG preview"| Agent
  Agent -->|"3. Send view"| Sync
  Sync <==>|"4. Live updates"| Canvas
  Canvas <-->|"Save & history"| Storage`;

export const WELCOME_GUIDE: DiagramComprehensionGuide = {
  gist: 'Ask your AI agent to explain a concept, paper, codebase, bug, or design tradeoff. It checks the diagram layout first, then streams an interactive view straight to this tab.',
  steps: [
    {
      title: '1. Pick a mode and check layout',
      caption:
        'Your agent loads the right teaching playbook, renders the diagram, and checks a PNG preview so boxes stay short and readable.',
      focusNodes: ['Agent', 'Check'],
      trace: 'get_playbook -> render_view -> 2x PNG preview',
    },
    {
      title: '2. Stream straight to your open tab',
      caption:
        'Once the layout looks clean, the server passes the diagram and walkthrough steps directly to this browser tab without saving a copy.',
      focusNodes: ['Agent', 'Sync', 'Canvas'],
      trace: '0 diagrams stored on server -> live SSE push',
    },
    {
      title: '3. Read alongside the map and click any box',
      caption:
        'Follow each step down the page while the diagram highlights the active path, and click any box to open its explanation right beside it.',
      focusNodes: ['Canvas', 'Storage', 'Sync'],
      check: {
        question: 'What happens to your diagrams if the MFHMFA server restarts?',
        answer:
          'Nothing is lost. Your projects, folders, and interactive guides live locally in your browser IndexedDB.',
      },
    },
  ],
  nodes: {
    Agent: {
      label: 'Your AI Agent',
      term: 'MCP Client (Claude Code, Pi, Cursor, etc.)',
      summary:
        'Connects using your workspace URL, checks existing views in the current project, and streams small 4–7 box diagrams with step-by-step guides.',
      example:
        'get_playbook({ mode: "concept" }) -> render_view({ path: "overview.mmd", code, guide })',
      whatIf:
        'Each agent session stays locked to its own project folder and cannot delete your files.',
    },
    Check: {
      label: 'Layout Check',
      term: 'Headless Chromium Pool',
      summary:
        'Validates Mermaid syntax and renders a temporary 2x PNG so the agent can spot overlapping or wordy boxes before stopping.',
      example: 'Mermaid source -> temporary 2x PNG + layout warnings',
      whatIf:
        'If all browser workers are busy, new renders wait in queue and time out cleanly after 12 seconds.',
      refs: ['src/infrastructure/renderer/chromiumEngine.ts'],
    },
    Sync: {
      label: 'Live Sync',
      term: 'Pass-Through SSE Relay',
      summary:
        'Streams updated diagrams to your open tab and forwards file list, read, and move requests back to your browser.',
      example: 'list_views -> asks open browser tab -> folder tree in ~10ms',
      whatIf:
        'If you close all MFHMFA tabs, live file queries time out after 2.5 seconds until you reopen the page.',
      refs: ['src/infrastructure/ephemeral/workspaceRelay.ts'],
    },
    Canvas: {
      label: 'Studio Canvas',
      summary:
        'Pairs a side-by-side story guide with the interactive diagram, dimming unrelated branches per step and opening notes right beside any clicked box.',
      example: 'Click a step on the left or press Down arrow, then click any box on the map.',
      whatIf:
        'Dashed boxes contain deeper sub-diagrams—click "Explore" on the popover or double-click the box to zoom inside.',
      refs: ['web/components/PreviewCanvas.tsx'],
    },
    Storage: {
      label: 'Browser Storage',
      term: 'Browser IndexedDB (mfhmfa-db)',
      summary:
        'Saves your projects, folders, and interactive diagrams directly in your browser with zero server-side storage.',
      example: 'Persists automatically in IndexedDB across browser restarts.',
      whatIf:
        'Clearing browser site data removes local diagrams unless you exported them as PNG or SVG.',
      refs: ['web/services/workspacePersistence.ts'],
    },
  },
};
