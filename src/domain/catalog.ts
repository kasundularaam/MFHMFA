import type { MermaidTemplate } from '../shared/types.js';

export const MERMAID_TEMPLATES: MermaidTemplate[] = [
  {
    id: 'ai-agent-architecture',
    name: 'AI Agent & MCP Architecture',
    category: 'Architecture',
    diagramType: 'flowchart-v2',
    description: 'Multi-agent system connecting through MCP tools, validation engine, and live workspace.',
    theme: 'default',
    look: 'classic',
    code: `flowchart TB
    subgraph Agents["AI Coding Agents"]
        A1["Claude / Pi Agent"]
        A2["Cursor / Antigravity"]
        A3["Custom REST Tool Agent"]
    end

    subgraph Studio["MFHMFA Stateless Engine"]
        MCP["MCP Server<br/>(Stdio + Streamable HTTP)"]
        API["REST & Tool API"]
        ENG["Parallel Chromium Pool<br/>(Parse + SVG + Retina PNG)"]
        HUB["Bounded Ephemeral Hub<br/>(/p/:id LRU + /live/:token SSE)"]
    end

    UI["Interactive Browser Studio<br/>(Pan / Zoom / Edit / #z= Permalink)"]

    A1 & A2 <-->|"validate / render / PNG vision"| MCP
    A3 <-->|"JSON + PNG"| API
    MCP & API --> ENG & HUB
    HUB ==>|"studioUrl & liveUrl"| UI`,

  },
  {
    id: 'sequence-oauth',
    name: 'OAuth 2.0 + PKCE Sequence',
    category: 'Sequence',
    diagramType: 'sequence',
    description: 'End-to-end authentication handshake with activation bars, alt blocks, and notes.',
    theme: 'default',
    code: `sequenceDiagram
    autonumber
    actor User
    participant App as Web Client
    participant Auth as Auth Server
    participant API as Resource API

    User->>App: Click "Sign In"
    activate App
    App->>App: Generate code_verifier & code_challenge
    App->>Auth: GET /authorize (code_challenge, S256)
    activate Auth
    Auth-->>User: Prompt login & consent
    User->>Auth: Submit credentials
    Auth-->>App: Redirect with authorization code
    deactivate Auth

    App->>Auth: POST /token (code, code_verifier)
    activate Auth
    alt Valid verifier
        Auth-->>App: 200 OK (access_token, refresh_token)
    else Invalid verifier
        Auth-->>App: 401 Unauthorized
    end
    deactivate Auth

    App->>API: GET /v1/profile (Bearer access_token)
    activate API
    API-->>App: 200 JSON Payload
    deactivate API
    App-->>User: Render authenticated dashboard
    deactivate App`,
  },
  {
    id: 'er-saas-schema',
    name: 'SaaS Multi-Tenant ER Schema',
    category: 'Database',
    diagramType: 'er',
    description: 'Entity-Relationship diagram showing primary/foreign keys and cardinality.',
    theme: 'neutral',
    code: `erDiagram
    ORGANIZATION ||--o{ MEMBERSHIP : has
    USER ||--o{ MEMBERSHIP : joins
    ORGANIZATION ||--o{ PROJECT : owns
    PROJECT ||--o{ CHART : contains
    CHART ||--o{ CHART_VERSION : snapshots

    ORGANIZATION {
        uuid id PK
        string slug UK
        string plan
        timestamp created_at
    }
    USER {
        uuid id PK
        string email UK
        string display_name
    }
    MEMBERSHIP {
        uuid org_id FK
        uuid user_id FK
        string role
    }
    PROJECT {
        uuid id PK
        uuid org_id FK
        string name
    }
    CHART {
        string id PK
        uuid project_id FK
        string title
        int current_version
    }
    CHART_VERSION {
        int id PK
        string chart_id FK
        int version
        text mermaid_code
    }`,
  },
  {
    id: 'state-order-lifecycle',
    name: 'Order Fulfillment State Machine',
    category: 'State',
    diagramType: 'stateDiagram-v2',
    description: 'Hierarchical state machine with composite states and guard conditions.',
    theme: 'default',
    code: `stateDiagram-v2
    [*] --> Draft
    Draft --> PaymentPending : checkout()
    PaymentPending --> Paid : payment_succeeded
    PaymentPending --> PaymentFailed : payment_declined
    PaymentFailed --> PaymentPending : retry_payment()
    PaymentFailed --> Cancelled : timeout_24h

    state Paid {
        [*] --> AllocatingInventory
        AllocatingInventory --> Packing : stock_reserved
        Packing --> Shipped : carrier_pickup
    }

    Paid --> Delivered : delivery_confirmed
    Delivered --> RefundRequested : request_return()
    RefundRequested --> Refunded : item_inspected
    Delivered --> [*]
    Cancelled --> [*]
    Refunded --> [*]`,
  },
  {
    id: 'class-domain-model',
    name: 'Plugin Engine Class Diagram',
    category: 'Object Model',
    diagramType: 'class',
    description: 'Interfaces, classes, generics, and composition relationships.',
    theme: 'default',
    code: `classDiagram
    class RenderEnginePort {
        <<interface>>
        +validate(code: string) Promise~ValidationResult~
        +render(code: string, opts: RenderOptions) Promise~RenderedDiagram~
        +dispose() Promise~void~
    }

    class ChromiumRenderEngine {
        -browser: Browser
        -concurrency: number
        +validate(code: string) Promise~ValidationResult~
        +render(code: string, opts: RenderOptions) Promise~RenderedDiagram~
        +dispose() Promise~void~
    }

    class StudioService {
        +engine: RenderEnginePort
        +previewHub: PreviewHubPort
        +validate(code: string) Promise~ValidationResult~
        +render(code: string, opts: StatelessRenderInput) Promise~StatelessRenderResult~
    }

    RenderEnginePort <|.. ChromiumRenderEngine : implements
    StudioService o-- RenderEnginePort : delegates`,

  },
  {
    id: 'mindmap-product-strategy',
    name: 'Product Launch Mindmap',
    category: 'Brainstorming',
    diagramType: 'mindmap',
    description: 'Radial mindmap with rounded, cloud, and hexagon node shapes.',
    theme: 'forest',
    code: `mindmap
  root((Mermaid Studio))
    Engine
      Headless Chrome
      Instant Validation
      2x Retina PNG
      Layout Diagnostics
    AI Agent Access
      MCP Server
        Stdio Transport
        Streamable HTTP
        ImageContent Vision
      REST Tool Schemas
      OpenAI Tool Schema
    Web Workspace
      CodeMirror 6 Editor
      Live WebSocket Sync
      Pan and Zoom Canvas
      Version Snapshots`,
  },
  {
    id: 'gantt-release-plan',
    name: 'Q2 Engineering Roadmap (Gantt)',
    category: 'Planning',
    diagramType: 'gantt',
    description: 'Project timeline with milestones, critical path tasks, and parallel tracks.',
    theme: 'default',
    code: `gantt
    title Platform v2.0 Launch Schedule
    dateFormat YYYY-MM-DD
    axisFormat %b %d

    section Core Engine
    Parser & Lint Diagnostics   :done,    eng1, 2026-05-01, 5d
    Retina Screenshot Pipeline  :done,    eng2, after eng1, 4d
    Versioned SQLite Store      :active,  eng3, after eng2, 4d

    section Agent Ecosystem
    MCP Stdio + HTTP Server     :crit,    mcp1, 2026-05-08, 6d
    Vision Loop Prompt Pack     :         mcp2, after mcp1, 3d
    REST Tool Schemas           :         mcp3, after mcp1, 4d

    section Web Studio
    Eye-Comfort Studio Canvas   :         ui1,  2026-05-10, 6d
    Live Agent Activity Stream  :         ui2,  after ui1, 4d
    GA Release Milestone        :milestone, m1, after ui2, 0d`,
  },
  {
    id: 'gitgraph-release-flow',
    name: 'Git Branching & Hotfix Flow',
    category: 'DevOps',
    diagramType: 'gitGraph',
    description: 'Visual commit history across main, feature, and hotfix branches.',
    theme: 'default',
    code: `gitGraph
    commit id: "init-repo"
    commit id: "core-parser"
    branch feat/mcp-vision
    checkout feat/mcp-vision
    commit id: "add-stdio-mcp"
    commit id: "png-image-content"
    checkout main
    branch hotfix/quote-escape
    checkout hotfix/quote-escape
    commit id: "fix-paren-hint" tag: "v1.0.1"
    checkout main
    merge hotfix/quote-escape
    checkout feat/mcp-vision
    merge main
    commit id: "http-streamable"
    checkout main
    merge feat/mcp-vision tag: "v1.1.0"`,
  },
  {
    id: 'quadrant-prioritization',
    name: 'Feature Prioritization Matrix',
    category: 'Strategy',
    diagramType: 'quadrantChart',
    description: '2x2 impact vs effort quadrant chart for product planning.',
    theme: 'default',
    code: `quadrantChart
    title AI Feature Impact vs Implementation Effort
    x-axis Low Effort --> High Effort
    y-axis Low Impact --> High Impact
    quadrant-1 Strategic Bets
    quadrant-2 Quick Wins
    quadrant-3 Low Priority
    quadrant-4 Complex Utilities
    Vision PNG Inspection: [0.28, 0.92]
    Syntax Fix Hints: [0.22, 0.84]
    Live WebSocket Sync: [0.42, 0.86]
    Version History Diff: [0.58, 0.72]
    Hand-Drawn Sketch Mode: [0.18, 0.64]
    Multi-Page PDF Deck: [0.82, 0.44]`,
  },
  {
    id: 'xychart-latency',
    name: 'Throughput & P95 Latency (XY Chart)',
    category: 'Metrics',
    diagramType: 'xychart-beta',
    description: 'Combined bar and line chart showing requests/sec vs latency.',
    theme: 'default',
    code: `xychart-beta
    title "Warm Browser Pool: Throughput vs P95 Render Time (ms)"
    x-axis ["v0 Cold Spawn", "v1 Single Tab", "v2 Warm Pool", "v3 Cached SVG", "v4 Batch"]
    y-axis "Latency (ms) / RPS" 0 --> 1800
    bar [1650, 95, 48, 18, 35]
    line [12, 140, 310, 680, 520]`,
  },
  {
    id: 'sankey-token-budget',
    name: 'LLM Context Token Flow (Sankey)',
    category: 'Metrics',
    diagramType: 'sankey-beta',
    description: 'Proportional flow diagram visualizing token allocation.',
    theme: 'default',
    code: `sankey-beta

Context Window,System Prompt,4200
Context Window,Codebase Files,18500
Context Window,MCP Tool Outputs,7400
Context Window,Reasoning & Output,6900
MCP Tool Outputs,Chart Metadata,1900
MCP Tool Outputs,Vision PNG Inspection,4100
MCP Tool Outputs,Syntax Guides,1400`,
  },
];

export const SYNTAX_GUIDES: Record<string, string> = {
  pitfalls: `# Mermaid Syntax & Visual Quality Guide for AI Agents

## 1. Golden Escaping Rules (Avoids 90% of Parse Errors)
- **Always wrap labels with punctuation in double quotes**:
  - BAD:  \`A[Call fetch(url)]\`  (parentheses trigger stadium/cylinder shape!)
  - GOOD: \`A["Call fetch(url)"]\`
  - BAD:  \`B{Is a[0] > 1?}\`
  - GOOD: \`B{"Is a[0] > 1?"}\`
- **Never use lowercase \`end\` as a bare node ID**:
  - BAD:  \`start --> end\` (\`end\` closes subgraphs/loops!)
  - GOOD: \`Start --> End\` or \`startNode["start"] --> endNode["end"]\`
- **Escape inner double quotes with \`#quot;\`**:
  - GOOD: \`A["Click #quot;Submit#quot; button"]\`
- **Multi-line labels**: Use \`<br/>\` inside quoted labels: \`A["Line 1<br/>Line 2"]\`.
- **Do NOT include Markdown fences** (\`\`\`mermaid ... \`\`\`) in tool \`code\` inputs.

## 2. Visual Layout Best Practices (Inspect the Returned PNG!)
- **Prefer \`flowchart TB\` over \`LR\` when > 6 sequential steps**: Long \`LR\` chains produce wide, tiny-text ribbons.
- **Group 4+ related components with \`subgraph ID["Readable Title"] ... end\`**.
- **Keep node labels concise** (2–6 words per line; use \`<br/>\` if longer).`,

  flowchart: `# Flowchart (\`flowchart TB\` / \`flowchart LR\`)
\`\`\`
flowchart TB
    Start(["Start"]) --> Parse["Parse Input (JSON)"]
    Parse --> Valid{"Schema Valid?"}
    Valid -->|"Yes"| DB[("SQLite DB")]
    Valid -->|"No"| Err["Return 400 Error"]
    subgraph Workers["Async Pipeline"]
        DB --> Job[["Queue Worker"]]
    end
\`\`\`
- Shapes: \`["Rect"]\`, \`("Rounded")\`, \`(["Stadium"])\`, \`[["Subroutine"]]\`, \`[("Database")]\`, \`(("Circle"))\`, \`{"Diamond"}\`, \`{{"Hexagon"}}\`
- Edges: \`-->\` solid arrow, \`---\` solid line, \`-.->\` dotted arrow, \`==>\` thick arrow, \`-->|"label"|\` labeled edge.`,

  sequence: `# Sequence Diagram (\`sequenceDiagram\`)
\`\`\`
sequenceDiagram
    autonumber
    actor U as User
    participant C as Client
    participant S as Server
    U->>C: Click Save
    activate C
    C->>S: POST /items
    alt Success
        S-->>C: 201 Created
    else Validation Error
        S-->>C: 422 Unprocessable
    end
    deactivate C
\`\`\`
- Arrows: \`->>\` solid arrow, \`-->>\` dashed reply, \`-x\` failed/async X, \`-)\` async open arrow.
- Blocks: \`alt ... else ... end\`, \`opt ... end\`, \`loop ... end\`, \`par ... and ... end\`.`,

  er: `# Entity Relationship (\`erDiagram\`)
\`\`\`
erDiagram
    USER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains
    USER {
        uuid id PK
        string email UK
        string name
    }
\`\`\`
- Cardinality left/right: \`||\` (one), \`|o\` / \`o|\` (zero or one), \`}| \` / \`|{\` (one or more), \`}o\` / \`o{\` (zero or more).
- Attribute types must be single tokens (use \`varchar_255\`, not \`varchar(255)\`).`,

  state: `# State Diagram (\`stateDiagram-v2\`)
\`\`\`
stateDiagram-v2
    [*] --> Idle
    state "Validating Input" as Validating
    Idle --> Validating : submit
    Validating --> Ready : valid
    Validating --> Failed : invalid
    Ready --> [*]
\`\`\`
- Use \`state "Human Title" as SafeId\` whenever state names have spaces or punctuation.`,

  class: `# Class Diagram (\`classDiagram\`)
\`\`\`
classDiagram
    class Repository~T~ {
        <<interface>>
        +findById(id: string) T
        +save(entity: T) void
    }
    Repository~T~ <|.. SqlRepository : implements
\`\`\`
- Use \`~T~\` instead of \`<T>\` for generics.`,

  mindmap: `# Mindmap (\`mindmap\`)
\`\`\`
mindmap
  root((System Design))
    Frontend
      React Studio
      Pan & Zoom
    Backend
      Headless Chrome
      SQLite WAL
\`\`\`
- Hierarchy is strictly controlled by consistent 2-space indentation.`,

  gantt: `# Gantt (\`gantt\`)
\`\`\`
gantt
    title Sprint Schedule
    dateFormat YYYY-MM-DD
    section Backend
    Engine Setup :done, t1, 2026-05-01, 3d
    MCP Tools    :active, t2, after t1, 4d
\`\`\``,
};

export function getSyntaxGuide(topic?: string): string {
  if (!topic || topic === 'all' || topic === 'all-pitfalls') {
    return [
      SYNTAX_GUIDES.pitfalls,
      SYNTAX_GUIDES.flowchart,
      SYNTAX_GUIDES.sequence,
      SYNTAX_GUIDES.er,
      SYNTAX_GUIDES.state,
      SYNTAX_GUIDES.class,
    ].join('\n\n---\n\n');
  }
  const key = topic.toLowerCase().replace(/diagram|-v2|-beta/g, '').trim();
  if (SYNTAX_GUIDES[key]) {
    return `${SYNTAX_GUIDES[key]}\n\n---\n\n${SYNTAX_GUIDES.pitfalls}`;
  }
  return `Available guide topics: ${Object.keys(SYNTAX_GUIDES).join(', ')}, all.\n\n${SYNTAX_GUIDES.pitfalls}`;
}
