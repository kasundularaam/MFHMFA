import type { DiagramComprehensionGuide } from '../types.js';

export const WELCOME_CODE = `flowchart TB
  Agents(["Coding Agents"])

  subgraph Server["MFHMFA Server"]
    Render[["Diagram Renderer"]]
    Relay["Live Sync"]
  end

  subgraph Browser["Browser Workspace"]
    Studio["Interactive Canvas"]
    VFS[("IndexedDB VFS")]
  end

  Agents -->|"1. Validate & render"| Render
  Render -.->|"2. Preview image"| Agents
  Agents -->|"3. Stream diagram"| Relay
  Relay <==>|"4. Live sync"| Studio
  Studio <-->|"Save & history"| VFS`;

export const WELCOME_GUIDE: DiagramComprehensionGuide = {
  gist: 'Coding agents validate diagrams visually and stream interactive walkthroughs directly to your browser workspace.',
  steps: [
    {
      title: '1. Validate and preview',
      caption:
        'Your coding agent sends Mermaid code to the renderer and receives a crisp preview image to check visual layout.',
      focusNodes: ['Agents', 'Render'],
    },
    {
      title: '2. Stream live to Studio',
      caption:
        'Once verified, the diagram and its walkthrough guide stream straight into your open browser tab.',
      focusNodes: ['Agents', 'Relay', 'Studio'],
    },
    {
      title: '3. Explore and save locally',
      caption:
        'Step through flows, click components for details, and browse recent file history stored in your browser IndexedDB.',
      focusNodes: ['Studio', 'VFS', 'Relay'],
    },
  ],
  nodes: {
    Agents: {
      label: 'Coding Agents',
      summary:
        'AI coding agents connect via MCP, inspect existing files, and create diagrams with walkthrough steps and component notes.',
      example: 'mermaid_render({ path: "arch/overview.mmd", code, guide })',
      whatIf: 'Each agent session stays scoped to its own project folder.',
    },
    Render: {
      label: 'Diagram Renderer',
      summary:
        'Headless Chromium workers validate syntax and render high-resolution PNG previews so agents can check layout.',
      example: '1.2 KB Mermaid source -> 2x PNG preview + layout diagnostics',
      whatIf:
        'If all workers are busy, requests queue automatically; hung renders time out after 12s.',
      files: ['src/infrastructure/renderer/chromiumEngine.ts'],
    },
    Relay: {
      label: 'Live Sync',
      summary:
        'Streams updated diagrams to open Studio tabs and forwards file list, read, and rename requests.',
      example: 'mermaid_ls -> live query to open tab -> folder tree response in ~10ms',
      whatIf:
        'If no Studio tab is open, live file queries time out after 2.5s until you open the app.',
      files: ['src/infrastructure/ephemeral/workspaceRelay.ts'],
    },
    Studio: {
      label: 'Interactive Canvas',
      summary:
        'Renders diagrams locally, highlights walkthrough steps, and opens component details when you click a box.',
      example: 'Use Left and Right arrows to step through a flow, or click any outlined box.',
      whatIf:
        'If a diagram has a syntax error while editing, a banner links straight to the line in Code view.',
      files: ['web/components/PreviewCanvas.tsx', 'web/services/mermaidRenderer.ts'],
    },
    VFS: {
      label: 'IndexedDB VFS',
      summary:
        'Saves your projects, folders, diagrams, and recent file history asynchronously in browser IndexedDB.',
      example:
        'Keeps up to 5 recent versions per file so you can compare or restore earlier edits.',
      whatIf:
        'Clearing browser site data removes local files unless you exported them as PNG/SVG.',
      files: ['src/shared/vfs/operations.ts', 'web/services/workspacePersistence.ts'],
    },
  },
};

export const NEW_TAB_STARTER = `flowchart LR
  Start(["Start"]) --> Step["Process"] --> Done(["Done"])`;
