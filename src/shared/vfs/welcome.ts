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

  Agent -->|"checks layout"| Check
  Check -.->|"returns PNG preview"| Agent
  Agent -->|"sends view"| Sync
  Sync -.->|"streams updates"| Canvas
  Canvas -->|"saves diagrams"| Storage`;

export const WELCOME_GUIDE: DiagramComprehensionGuide = {
  gist: 'Ask your AI agent to explain a concept, paper, codebase, bug, or design tradeoff. It checks the diagram layout first, then streams an interactive view straight to this tab.',
  scenario:
    'You ask your coding agent to explain how checkout payments work in your repo. It renders a 5-box map and streams it straight to this open tab.',
  steps: [
    {
      title: '1. Pick a mode and check layout',
      caption:
        'Your agent loads the right teaching playbook, renders the diagram, and checks a PNG preview so boxes stay short and readable.',
      focusNodes: ['Agent', 'Check'],
      trace: 'Agent picks codebase mode -> checks 2x PNG preview',
    },
    {
      title: '2. Stream straight to your open tab',
      caption:
        'Once the layout looks clean, the server passes the diagram and walkthrough steps directly to this browser tab without saving a copy.',
      focusNodes: ['Agent', 'Sync', 'Canvas'],
      trace: '0 files saved on server -> streamed live to open tab',
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
      kind: 'actor',
      term: 'MCP Client (Claude Code, Pi, Cursor, etc.)',
      summary:
        'Connects using your workspace URL, checks existing views in the current project, and streams small 4–7 box diagrams with step-by-step guides.',
      example:
        'When you ask how checkout works, your agent loads the codebase playbook, checks your existing views, and sends a clean 5-box overview.',
      whatIf:
        'Each agent session stays locked to its own project folder and cannot delete your files.',
    },
    Check: {
      label: 'Layout Check',
      kind: 'service',
      term: 'Headless Chromium Pool',
      summary:
        'Validates Mermaid syntax and renders a temporary 2x PNG so the agent can spot overlapping or wordy boxes before stopping.',
      example:
        'Before sending your checkout diagram, this worker renders a quick PNG and flags any unlabeled arrows or crowded boxes so the agent can fix them first.',
      whatIf:
        'If all browser workers are busy, new renders wait in queue and time out cleanly after 12 seconds.',
      refs: ['src/infrastructure/renderer/chromiumEngine.ts'],
    },
    Sync: {
      label: 'Live Sync',
      kind: 'service',
      term: 'Pass-Through SSE Relay',
      summary:
        'Streams updated diagrams to your open tab and forwards file list, read, and move requests back to your browser.',
      example:
        'When the agent calls list_views, this relay asks your open browser tab and gets your folder tree back in about 10ms without storing anything on the server.',
      whatIf:
        'If you close all MFHMFA tabs, live file queries time out after 2.5 seconds until you reopen the page.',
      refs: ['src/infrastructure/ephemeral/workspaceRelay.ts'],
    },
    Canvas: {
      label: 'Studio Canvas',
      kind: 'service',
      summary:
        'Pairs a side-by-side story guide with the interactive diagram, dimming unrelated branches per step and opening notes right beside any clicked box.',
      example:
        'Click step 2 on the left (or press the Down arrow) to spotlight only the active boxes, then click any box on the map to open its plain explanation.',
      whatIf:
        'Dashed boxes contain deeper sub-diagrams—click "Dive deeper" on the card or double-click the box to zoom inside.',
      refs: ['web/components/PreviewCanvas.tsx'],
    },
    Storage: {
      label: 'Browser Storage',
      kind: 'store',
      term: 'Browser IndexedDB (mfhmfa-db)',
      summary:
        'Saves your projects, folders, and interactive diagrams directly in your browser with zero server-side storage.',
      example:
        'Your checkout diagram and its last 5 versions stay right in your browser after you close the tab or restart the server.',
      whatIf:
        'Clearing browser site data removes local diagrams unless you exported them as .mfhmfa.json files.',
      refs: ['web/services/workspacePersistence.ts'],
    },
  },
};
