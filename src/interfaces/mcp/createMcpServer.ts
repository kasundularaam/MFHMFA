import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { StudioService } from '../../application/studioService.js';
import { APP_NAME, APP_VERSION } from '../../config/env.js';
import type { CallerSource } from '../../shared/types.js';
import { AGENT_TOOLS } from '../tools/toolRegistry.js';

export function createMermaidMcpServer(
  service: StudioService,
  source: CallerSource = 'mcp-stdio'
): McpServer {
  const server = new McpServer(
    {
      name: APP_NAME,
      version: APP_VERSION,
    },
    {
      instructions: [
        'Mermaid Agent Studio lets you create, validate, render, export, and visually inspect (via PNG images) Mermaid diagrams.',
        'Workflow tip: Use `mermaid_create_chart` (or `mermaid_render_preview` for drafts). Both validate syntax AND return the rendered PNG image so you can visually inspect your diagram.',
        'If validation fails, check `error.line`, `error.snippet`, and `error.suggestion` (wrap labels containing (), [], or {} in double quotes ["..."], and avoid lowercase `end` as a node ID).',
      ].join(' '),
    }
  );

  for (const tool of AGENT_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.zodShape,
        annotations: tool.annotations,
      },
      async (args: Record<string, unknown>): Promise<CallToolResult> => {
        try {
          const out = await tool.execute(args, service, source);
          const content: CallToolResult['content'] = [
            {
              type: 'text',
              text: out.textOverride ?? JSON.stringify(out.payload, null, 2),
            },
          ];

          if (out.pngBase64) {
            content.push({
              type: 'image',
              data: out.pngBase64,
              mimeType: 'image/png',
            });
          }

          return {
            isError: !out.ok,
            content,
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
          };
        }
      }
    );
  }

  // Resources
  server.registerResource(
    'charts-catalog',
    'mermaid://charts',
    {
      title: 'Mermaid Studio Charts Catalog',
      description: 'JSON list of all Mermaid charts saved in the workspace.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(service.listCharts({ limit: 200 }), null, 2),
        },
      ],
    })
  );

  server.registerResource(
    'syntax-pitfalls-guide',
    'mermaid://guides/pitfalls',
    {
      title: 'Mermaid Syntax & Layout Pitfalls Guide',
      description: 'Essential escaping rules and visual quality guidelines for AI agents.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: service.syntaxGuide('all'),
        },
      ],
    })
  );

  server.registerResource(
    'chart-source',
    new ResourceTemplate('mermaid://charts/{id}', {
      list: async () => ({
        resources: service.listCharts({ limit: 100 }).map((c) => ({
          uri: `mermaid://charts/${c.id}`,
          name: c.title,
          description: `${c.diagramType ?? 'mermaid'} (v${c.version})`,
          mimeType: 'text/plain',
        })),
      }),
    }),
    {
      title: 'Mermaid Chart Source (.mmd)',
      description: 'Raw Mermaid diagram source code for a specific chart ID.',
      mimeType: 'text/plain',
    },
    async (uri, variables) => {
      const res = await service.getChartWithVisuals(String(variables.id));
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/plain',
            text: res.code,
          },
        ],
      };
    }
  );

  server.registerResource(
    'chart-png',
    new ResourceTemplate('mermaid://charts/{id}/png', { list: undefined }),
    {
      title: 'Mermaid Chart Rendered PNG',
      description: 'Rendered Retina PNG image for a chart ID.',
      mimeType: 'image/png',
    },
    async (uri, variables) => {
      const id = String(variables.id);
      const res = await service.getChartWithVisuals(id);
      if (!res.pngBytes) {
        throw new Error(`No valid PNG available for chart ${id}`);
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'image/png',
            blob: Buffer.from(res.pngBytes).toString('base64'),
          },
        ],
      };
    }
  );

  // Guided Prompt
  server.registerPrompt(
    'design-and-verify-diagram',
    {
      title: 'Design, Validate & Visually Verify a Mermaid Diagram',
      description:
        'Structured workflow for crafting a clean Mermaid chart, rendering it, inspecting the PNG visually, and refining layout.',
      argsSchema: {
        goal: z.string().describe('What system, workflow, or concept to diagram.'),
        diagramType: z.string().optional().describe('Preferred diagram type.'),
      },
    },
    async ({ goal, diagramType }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Create a clear, publication-grade Mermaid diagram${diagramType ? ` (${diagramType})` : ''} for:`,
              goal,
              '',
              'Follow this workflow:',
              '1. Call `mermaid_syntax_guide` if unsure about syntax rules.',
              '2. Call `mermaid_create_chart` with double-quoted node labels (`Node["Label (detail)"]`).',
              '3. Visually inspect the returned PNG image and `layoutDiagnostics`.',
              '4. Refine via `mermaid_update_chart` if layout or legibility can be improved.',
            ].join('\n'),
          },
        },
      ],
    })
  );

  return server;
}
