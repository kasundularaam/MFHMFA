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
        'MFHMFA (Mermaid For Humans, Mermaid For Agents) is a stateless Mermaid validation, rendering, and visual inspection engine.',
        'Workflow tip: Call `mermaid_render` to validate syntax AND receive a 2x Retina PNG image (`image/png`) + layout diagnostics so you can visually inspect and refine your diagram.',
        'All tools are stateless and safe to invoke in parallel.',
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

  // Stateless Resources
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
    'templates-catalog',
    'mermaid://templates',
    {
      title: 'Starter Mermaid Templates Catalog',
      description: 'JSON catalog of curated starter Mermaid templates across diagram types.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(service.listTemplates(), null, 2),
        },
      ],
    })
  );

  server.registerResource(
    'template-source',
    new ResourceTemplate('mermaid://templates/{id}', {
      list: async () => ({
        resources: service.listTemplates().map((tpl) => ({
          uri: `mermaid://templates/${tpl.id}`,
          name: tpl.name,
          description: `${tpl.category} (${tpl.diagramType})`,
          mimeType: 'text/plain',
        })),
      }),
    }),
    {
      title: 'Starter Mermaid Template Source (.mmd)',
      description: 'Raw Mermaid source code for a starter template ID.',
      mimeType: 'text/plain',
    },
    async (uri, variables) => {
      const id = String(variables.id);
      const tpl = service.getTemplate(id);
      if (!tpl) {
        throw new Error(`Template not found: ${id}`);
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/plain',
            text: tpl.code,
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
        'Structured stateless workflow for crafting a clean Mermaid chart, rendering it, inspecting the PNG visually, and refining layout.',
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
              'Follow this stateless workflow:',
              '1. Call `mermaid_syntax_guide` if unsure about syntax rules.',
              '2. Call `mermaid_render` with double-quoted node labels (`Node["Label (detail)"]`).',
              '3. Visually inspect the returned 2x Retina PNG image and `layoutDiagnostics`.',
              '4. Re-run `mermaid_render` with refined layout if aspect ratio or legibility can be improved, and optionally export with `mermaid_export`.',
            ].join('\n'),
          },
        },
      ],
    })
  );

  return server;
}
