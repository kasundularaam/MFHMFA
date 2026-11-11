import fs from 'node:fs';
import { StudioService, type ExportFormat } from '../../application/studioService.js';
import { SqliteChartRepository } from '../../infrastructure/persistence/sqliteRepository.js';
import { getSharedRenderEngine } from '../../infrastructure/renderer/chromiumEngine.js';
import type { MermaidLook, MermaidTheme } from '../../shared/types.js';

interface ParsedCliArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[key] = next;
          i += 1;
        } else {
          flags[key] = true;
        }
      }
    } else if (arg === '-f' || arg === '-o' || arg === '-c' || arg === '-t') {
      const shortMap: Record<string, string> = {
        '-f': 'file',
        '-o': 'out',
        '-c': 'code',
        '-t': 'title',
      };
      flags[shortMap[arg]] = argv[++i] ?? '';
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags };
}

async function readCodeInput(flags: Record<string, string | boolean>): Promise<string> {
  if (typeof flags.code === 'string') {
    return flags.code.includes('\n') ? flags.code : flags.code.replace(/\\n/g, '\n');
  }
  if (typeof flags.file === 'string') {
    return fs.readFileSync(flags.file, 'utf8');
  }
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  return '';
}

function printHelp(): void {
  console.log(`Mermaid Agent Studio CLI

Usage:
  mermaid-studio <command> [options]

Commands:
  serve [--port 48333]                       Start Web Studio + REST API + HTTP MCP server
  mcp                                        Start Stdio MCP server for AI agents
  validate [--code "..." | --file a.mmd]     Validate Mermaid syntax & return diagnostics
  render [--code "..." | --file a.mmd]       Validate, render PNG+SVG, return paths & metrics
         [--out chart.png] [--theme dark] [--look handDrawn] [--scale 2]
  create --title "..." [--code "..." | --file a.mmd] [--tags a,b] [--theme default]
  update <id> [--code "..." | --file a.mmd] [--title "..."] [--note "..."]
  see <id> [--version N]                     Inspect chart code, metrics, & rendered PNG path
  list [--search "..."] [--tag "..."]        List saved workspace charts
  delete <id>                                Delete a chart by ID
  export <id> --out <path.png|svg|mmd|md>    Export saved chart to file
  guide [pitfalls|flowchart|sequence|er|all] Print Mermaid syntax & escaping guide
  templates                                  List built-in starter templates
`);
}

export async function runCli(argv: string[]): Promise<void> {
  const { positional, flags } = parseCliArgs(argv);
  const cmd = positional[0] || 'help';

  if (cmd === 'help' || flags.help) {
    printHelp();
    return;
  }

  if (cmd === 'mcp') {
    const { runStdioMcpServer } = await import('../../mcp-stdio.js');
    await runStdioMcpServer();
    return;
  }

  if (cmd === 'serve') {
    const { startStudioServer } = await import('../../server.js');
    const port = typeof flags.port === 'string' ? Number(flags.port) : undefined;
    const started = await startStudioServer({ port });
    console.log(`Mermaid Agent Studio listening at ${started.baseUrl}`);
    console.log(`MCP Streamable HTTP: ${started.baseUrl}/mcp`);

    const shutdown = async () => {
      await started.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  const repo = new SqliteChartRepository(
    typeof flags['data-dir'] === 'string' ? flags['data-dir'] : undefined
  );
  const engine = getSharedRenderEngine();
  const service = new StudioService({ repo, engine });

  try {
    switch (cmd) {
      case 'validate': {
        const code = await readCodeInput(flags);
        const res = await service.validate(code, 'cli');
        console.log(JSON.stringify(res, null, 2));
        process.exitCode = res.valid ? 0 : 1;
        break;
      }

      case 'render': {
        const code = await readCodeInput(flags);
        const out = await service.renderPreview(code, {
          theme: (flags.theme as MermaidTheme) || undefined,
          look: (flags.look as MermaidLook) || undefined,
          background: typeof flags.background === 'string' ? flags.background : undefined,
          scale: typeof flags.scale === 'string' ? Number(flags.scale) : 2,
          outputPath: typeof flags.out === 'string' ? flags.out : undefined,
          source: 'cli',
        });
        console.log(
          JSON.stringify(
            {
              valid: out.valid,
              diagramType: out.diagramType,
              dimensions: out.dimensions,
              metrics: out.metrics,
              layoutDiagnostics: out.layoutDiagnostics,
              warnings: out.warnings,
              error: out.error,
              pngPath: out.outputPath ?? out.pngPath,
              svgPath: out.svgPath,
              durationMs: out.durationMs,
            },
            null,
            2
          )
        );
        process.exitCode = out.valid ? 0 : 1;
        break;
      }

      case 'create': {
        const code = await readCodeInput(flags);
        const title = typeof flags.title === 'string' ? flags.title : 'CLI Diagram';
        const tags =
          typeof flags.tags === 'string'
            ? flags.tags.split(',').map((s) => s.trim())
            : undefined;
        const res = await service.createChart({
          id: typeof flags.id === 'string' ? flags.id : undefined,
          title,
          description: typeof flags.description === 'string' ? flags.description : undefined,
          code,
          theme: (flags.theme as MermaidTheme) || undefined,
          look: (flags.look as MermaidLook) || undefined,
          background: typeof flags.background === 'string' ? flags.background : undefined,
          tags,
          author: typeof flags.author === 'string' ? flags.author : 'cli-agent',
          source: 'cli',
        });
        console.log(
          JSON.stringify(
            {
              chart: res.chart,
              studioUrl: res.studioUrl,
              pngUrl: res.pngUrl,
              svgUrl: res.svgUrl,
              durationMs: res.durationMs,
            },
            null,
            2
          )
        );
        process.exitCode = res.chart.valid ? 0 : 1;
        break;
      }

      case 'update': {
        const id = positional[1] || (typeof flags.id === 'string' ? flags.id : '');
        if (!id) throw new Error('Chart ID required: mermaid-studio update <id> ...');
        const maybeCode =
          flags.code !== undefined || flags.file !== undefined || !process.stdin.isTTY
            ? await readCodeInput(flags)
            : undefined;
        const tags =
          typeof flags.tags === 'string'
            ? flags.tags.split(',').map((s) => s.trim())
            : undefined;
        const res = await service.updateChart(id, {
          title: typeof flags.title === 'string' ? flags.title : undefined,
          description: typeof flags.description === 'string' ? flags.description : undefined,
          code: maybeCode,
          theme: (flags.theme as MermaidTheme) || undefined,
          look: (flags.look as MermaidLook) || undefined,
          background: typeof flags.background === 'string' ? flags.background : undefined,
          tags,
          changeNote: typeof flags.note === 'string' ? flags.note : undefined,
          source: 'cli',
        });
        console.log(
          JSON.stringify(
            {
              chart: res.chart,
              studioUrl: res.studioUrl,
              pngUrl: res.pngUrl,
              svgUrl: res.svgUrl,
              durationMs: res.durationMs,
            },
            null,
            2
          )
        );
        process.exitCode = res.chart.valid ? 0 : 1;
        break;
      }

      case 'see':
      case 'inspect':
      case 'get': {
        const id = positional[1] || (typeof flags.id === 'string' ? flags.id : '');
        if (!id) throw new Error('Chart ID required: mermaid-studio see <id>');
        const version = typeof flags.version === 'string' ? Number(flags.version) : undefined;
        const res = await service.getChartWithVisuals(id, { version, source: 'cli' });
        console.log(
          JSON.stringify(
            {
              chart: res.chart,
              selectedVersion: res.selectedVersion,
              code: res.code,
              versions: res.versions,
              studioUrl: res.studioUrl,
              pngUrl: res.pngUrl,
              svgUrl: res.svgUrl,
            },
            null,
            2
          )
        );
        break;
      }

      case 'list': {
        const charts = service.listCharts(
          {
            search: typeof flags.search === 'string' ? flags.search : undefined,
            tag: typeof flags.tag === 'string' ? flags.tag : undefined,
            diagramType: typeof flags.type === 'string' ? flags.type : undefined,
            limit: typeof flags.limit === 'string' ? Number(flags.limit) : 50,
          },
          'cli'
        );
        console.log(JSON.stringify({ count: charts.length, charts }, null, 2));
        break;
      }

      case 'delete': {
        const id = positional[1] || (typeof flags.id === 'string' ? flags.id : '');
        if (!id) throw new Error('Chart ID required: mermaid-studio delete <id>');
        const deleted = service.deleteChart(id, 'cli');
        console.log(JSON.stringify({ id, deleted }, null, 2));
        process.exitCode = deleted ? 0 : 1;
        break;
      }

      case 'export': {
        const id = positional[1] || (typeof flags.id === 'string' ? flags.id : undefined);
        const outPath = typeof flags.out === 'string' ? flags.out : '';
        if (!outPath) throw new Error('--out <path> is required for export');
        const code = !id ? await readCodeInput(flags) : undefined;
        const res = await service.exportChart({
          id,
          code,
          outputPath: outPath,
          format:
            typeof flags.format === 'string' ? (flags.format as ExportFormat) : undefined,
          theme: (flags.theme as MermaidTheme) || undefined,
          look: (flags.look as MermaidLook) || undefined,
          background: typeof flags.background === 'string' ? flags.background : undefined,
          scale: typeof flags.scale === 'string' ? Number(flags.scale) : 2,
          source: 'cli',
        });
        console.log(JSON.stringify(res, null, 2));
        break;
      }

      case 'guide': {
        const topic = positional[1] || (typeof flags.topic === 'string' ? flags.topic : 'all');
        console.log(service.syntaxGuide(topic, 'cli'));
        break;
      }

      case 'templates': {
        console.log(JSON.stringify({ templates: service.listTemplates() }, null, 2));
        break;
      }

      default:
        console.error(`Unknown command: ${cmd}`);
        printHelp();
        process.exitCode = 1;
    }
  } finally {
    repo.close();
    await engine.dispose();
  }
}
