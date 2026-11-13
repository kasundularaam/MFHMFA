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
      title: '3. Step through, click boxes, and save locally',
      caption:
        'Press Left or Right arrows to follow each step, click any box for examples and edge cases, and keep recent versions in your browser.',
      focusNodes: ['Canvas', 'Storage', 'Sync'],
      check: {
        question: 'What happens to your diagrams if the MFHMFA server restarts?',
        answer:
          'Nothing is lost. Your projects, diagrams, and the last 5 versions per file live in your browser IndexedDB.',
      },
    },
  ],
  nodes: {
    Agent: {
      label: 'Your AI Agent',
      term: 'MCP Client (Claude Code, Pi, Cursor, etc.)',
      summary:
        'Connects using your workspace URL, checks existing files in the current project, and creates small diagrams with walkthrough steps.',
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
        'Streams updated diagrams to your open tab and forwards file list, read, and rename requests back to your browser.',
      example: 'list_views -> asks open browser tab -> folder tree in ~10ms',
      whatIf:
        'If you close all MFHMFA tabs, live file queries time out after 2.5 seconds until you reopen the page.',
      refs: ['src/infrastructure/ephemeral/workspaceRelay.ts'],
    },
    Canvas: {
      label: 'Studio Canvas',
      summary:
        'Draws the diagram locally, dims unrelated branches while you step through a flow, and opens notes when you click a box.',
      example: 'Press Right arrow to step forward, or click any outlined box.',
      whatIf:
        'If a manual edit in Code view has a syntax error, a banner jumps straight to the broken line.',
      refs: ['web/components/PreviewCanvas.tsx'],
    },
    Storage: {
      label: 'Browser Storage',
      term: 'Browser IndexedDB (mfhmfa-db)',
      summary:
        'Saves your projects, folders, diagrams, and up to 5 recent versions per file directly in your browser.',
      example:
        'Keeps v1..v5 locally so you can preview or restore earlier versions from the tab bar.',
      whatIf:
        'Clearing browser site data removes local diagrams unless you exported them as PNG or SVG.',
      refs: ['web/services/workspacePersistence.ts'],
    },
  },
};

export const NEW_TAB_STARTER = `flowchart LR
  Start(["Start"]) --> Step["Process"] --> Done(["Done"])`;
