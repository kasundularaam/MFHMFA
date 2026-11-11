import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import {
  analyzeStaticWarnings,
  computeLayoutDiagnostics,
  parseMermaidError,
} from '../../domain/diagnostics.js';
import type { RenderEnginePort } from '../../domain/ports.js';
import type {
  DiagramDimensions,
  MermaidLook,
  MermaidTheme,
  RenderOptions,
  RenderedDiagram,
  ValidationResult,
} from '../../shared/types.js';
import {
  RENDER_HARNESS_HTML,
  resolveChromePath,
  resolveMermaidBundlePath,
} from './browserDiscovery.js';

interface BrowserMermaidApi {
  initialize(config: Record<string, unknown>): void;
  parse(code: string): Promise<{ diagramType?: string }>;
  render(
    id: string,
    code: string
  ): Promise<{
    svg: string;
    diagramType?: string;
    bindFunctions?: (el: Element) => void;
  }>;
}

interface MermaidWindow extends Window {
  mermaid: BrowserMermaidApi;
}

interface PageSlot {
  page: Page;
  busy: boolean;
  renderSeq: number;
}

const CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-first-run',
  '--no-zygote',
  '--font-render-hinting=none',
];

export class ChromiumRenderEngine implements RenderEnginePort {
  private browser: Browser | null = null;
  private browserPromise: Promise<Browser> | null = null;
  private slots: PageSlot[] = [];
  private waitQueue: Array<(slot: PageSlot) => void> = [];
  private readonly maxConcurrency: number;

  constructor(maxConcurrency = 2) {
    this.maxConcurrency = maxConcurrency;
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser?.connected) {
      return this.browser;
    }
    if (this.browserPromise) {
      return this.browserPromise;
    }

    this.browserPromise = (async () => {
      const browser = await puppeteer.launch({
        executablePath: resolveChromePath(),
        headless: true,
        args: CHROMIUM_ARGS,
      });
      browser.on('disconnected', () => {
        this.browser = null;
        this.browserPromise = null;
        this.slots = [];
      });
      this.browser = browser;
      return browser;
    })();

    return this.browserPromise;
  }

  private async createSlot(): Promise<PageSlot> {
    const browser = await this.ensureBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 2000, height: 1500, deviceScaleFactor: 2 });
    await page.setContent(RENDER_HARNESS_HTML, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: resolveMermaidBundlePath() });
    return { page, busy: false, renderSeq: 0 };
  }

  private async acquireSlot(): Promise<PageSlot> {
    this.slots = this.slots.filter((s) => !s.page.isClosed());

    const free = this.slots.find((s) => !s.busy);
    if (free) {
      free.busy = true;
      return free;
    }

    if (this.slots.length < this.maxConcurrency) {
      const slot = await this.createSlot();
      slot.busy = true;
      this.slots.push(slot);
      return slot;
    }

    return new Promise<PageSlot>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  private releaseSlot(slot: PageSlot): void {
    if (slot.page.isClosed()) {
      this.slots = this.slots.filter((s) => s !== slot);
      if (this.waitQueue.length > 0) {
        const next = this.waitQueue.shift()!;
        this.createSlot()
          .then((fresh) => {
            fresh.busy = true;
            this.slots.push(fresh);
            next(fresh);
          })
          .catch(() => {});
      }
      return;
    }

    const next = this.waitQueue.shift();
    if (next) {
      next(slot);
    } else {
      slot.busy = false;
    }
  }

  async validate(code: string): Promise<ValidationResult> {
    const started = performance.now();
    const warnings = analyzeStaticWarnings(code);

    if (!code.trim()) {
      return {
        valid: false,
        diagramType: null,
        error: parseMermaidError(code, new Error('Empty Mermaid diagram code')),
        warnings,
        durationMs: Math.round(performance.now() - started),
      };
    }

    const slot = await this.acquireSlot();
    try {
      const evalRes = await slot.page.evaluate(async (diagramCode: string) => {
        const m = (window as unknown as MermaidWindow).mermaid;
        m.initialize({ startOnLoad: false, securityLevel: 'antiscript' });
        try {
          const parsed = await m.parse(diagramCode);
          return { ok: true as const, diagramType: parsed?.diagramType ?? null };
        } catch (err: unknown) {
          const e = err as Record<string, unknown>;
          return {
            ok: false as const,
            err: {
              message: typeof e?.message === 'string' ? e.message : String(err),
              str: e?.str,
              hash: e?.hash,
            },
          };
        }
      }, code);

      const durationMs = Math.round(performance.now() - started);
      if (!evalRes.ok) {
        return {
          valid: false,
          diagramType: null,
          error: parseMermaidError(code, evalRes.err),
          warnings,
          durationMs,
        };
      }

      return {
        valid: true,
        diagramType: evalRes.diagramType,
        error: null,
        warnings,
        durationMs,
      };
    } finally {
      this.releaseSlot(slot);
    }
  }

  async render(code: string, options: RenderOptions = {}): Promise<RenderedDiagram> {
    const started = performance.now();
    const theme: MermaidTheme = options.theme ?? 'default';
    const look: MermaidLook = options.look ?? 'classic';
    const defaultBg = theme === 'dark' ? '#191918' : '#ffffff';
    const background = options.background ?? defaultBg;
    const scale = Math.min(4, Math.max(1, options.scale ?? 2));
    const padding = Math.min(80, Math.max(0, options.padding ?? 24));
    const warnings = analyzeStaticWarnings(code);

    if (!code.trim()) {
      return {
        valid: false,
        diagramType: null,
        error: parseMermaidError(code, new Error('Empty Mermaid diagram code')),
        warnings,
        durationMs: Math.round(performance.now() - started),
        svg: null,
        pngBytes: null,
        dimensions: null,
        metrics: null,
        layoutDiagnostics: [],
        theme,
        look,
        background,
      };
    }

    const slot = await this.acquireSlot();
    try {
      slot.renderSeq += 1;
      const renderId = `mmd_render_${slot.renderSeq}_${Date.now()}`;

      await slot.page.setViewport({ width: 2400, height: 1800, deviceScaleFactor: scale });

      const pageRes = await slot.page.evaluate(
        async (params: {
          code: string;
          renderId: string;
          theme: string;
          look: string;
          background: string;
          padding: number;
        }) => {
          const stage = document.getElementById('capture-stage')!;
          stage.innerHTML = '';
          stage.style.padding = `${params.padding}px`;
          stage.style.background =
            params.background === 'transparent' ? 'transparent' : params.background;

          document
            .querySelectorAll('[id^="dmmd_render_"], [id^="mmd_render_"]')
            .forEach((el) => el.remove());

          const m = (window as unknown as MermaidWindow).mermaid;
          m.initialize({
            startOnLoad: false,
            theme: params.theme,
            look: params.look,
            securityLevel: 'antiscript',
            fontFamily:
              'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "DejaVu Sans", Arial, sans-serif',
            flowchart: { htmlLabels: true, curve: 'basis' },
          });

          let diagramType: string | null = null;
          try {
            const parsed = await m.parse(params.code);
            diagramType = parsed?.diagramType ?? null;
          } catch (err: unknown) {
            const e = err as Record<string, unknown>;
            return {
              ok: false as const,
              err: {
                message: typeof e?.message === 'string' ? e.message : String(err),
                str: e?.str,
                hash: e?.hash,
              },
            };
          }

          try {
            const rendered = await m.render(params.renderId, params.code);
            if (!diagramType && rendered?.diagramType) {
              diagramType = rendered.diagramType;
            }
            stage.innerHTML = rendered.svg;
            rendered.bindFunctions?.(stage);

            const svgEl = stage.querySelector('svg');
            if (!svgEl) {
              throw new Error('Mermaid render completed without producing an <svg> element.');
            }

            if (!svgEl.getAttribute('xmlns')) {
              svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            }
            const vb = svgEl.getAttribute('viewBox');
            if (vb) {
              const parts = vb.trim().split(/[\s,]+/).map(Number);
              if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
                const vbW = Math.ceil(parts[2]);
                const vbH = Math.ceil(parts[3]);
                const rawW = svgEl.getAttribute('width') || '';
                if (!rawW || rawW.includes('%')) {
                  svgEl.setAttribute('width', String(vbW));
                  svgEl.setAttribute('height', String(vbH));
                  svgEl.style.width = `${vbW}px`;
                  svgEl.style.height = `${vbH}px`;
                }
              }
            }

            const nodeEls = svgEl.querySelectorAll(
              '.node, g.nodes > g, .actor, .er.entityBox, .classGroup, .stateGroup, .mindmap-node, .task, .slice'
            );
            const edgeEls = svgEl.querySelectorAll(
              '.edgePath, .flowchart-link, .messageLine0, .messageLine1, .er.relationshipLine, .relation, .transition'
            );
            const subgraphEls = svgEl.querySelectorAll('.cluster, .subgraph');
            const labelEls = Array.from(
              svgEl.querySelectorAll(
                'text, foreignObject span, foreignObject div, .nodeLabel, .edgeLabel'
              )
            );

            const uniqueLabels: string[] = [];
            const seen = new Set<string>();
            for (const el of labelEls) {
              const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
              if (txt && !seen.has(txt)) {
                seen.add(txt);
                uniqueLabels.push(txt);
              }
            }

            const rect = stage.getBoundingClientRect();
            return {
              ok: true as const,
              diagramType,
              svg: svgEl.outerHTML,
              stageWidth: Math.ceil(rect.width),
              stageHeight: Math.ceil(rect.height),
              metrics: {
                nodeCount: nodeEls.length,
                edgeCount: edgeEls.length,
                subgraphCount: subgraphEls.length,
                textLabelCount: uniqueLabels.length,
                sampleLabels: uniqueLabels.slice(0, 15),
              },
            };
          } catch (err: unknown) {
            const e = err as Record<string, unknown>;
            return {
              ok: false as const,
              err: {
                message: typeof e?.message === 'string' ? e.message : String(err),
                str: e?.str,
                hash: e?.hash,
              },
            };
          }
        },
        { code, renderId, theme, look, background, padding }
      );

      if (!pageRes.ok) {
        return {
          valid: false,
          diagramType: null,
          error: parseMermaidError(code, pageRes.err),
          warnings,
          durationMs: Math.round(performance.now() - started),
          svg: null,
          pngBytes: null,
          dimensions: null,
          metrics: null,
          layoutDiagnostics: [],
          theme,
          look,
          background,
        };
      }

      const targetW = Math.min(7200, Math.max(800, pageRes.stageWidth + 64));
      const targetH = Math.min(7200, Math.max(600, pageRes.stageHeight + 64));
      if (targetW > 2400 || targetH > 1800) {
        await slot.page.setViewport({
          width: targetW,
          height: targetH,
          deviceScaleFactor: scale,
        });
      }

      const stageHandle = await slot.page.$('#capture-stage');
      if (!stageHandle) {
        throw new Error('Missing #capture-stage handle during screenshot');
      }

      const rawScreenshot = await stageHandle.screenshot({
        type: 'png',
        omitBackground: background === 'transparent',
      });
      const pngBytes = new Uint8Array(rawScreenshot);

      const width = Math.max(1, pageRes.stageWidth);
      const height = Math.max(1, pageRes.stageHeight);
      const dimensions: DiagramDimensions = {
        width,
        height,
        aspectRatio: Number((width / height).toFixed(2)),
        scale,
      };

      const layoutDiagnostics = computeLayoutDiagnostics(
        dimensions,
        pageRes.metrics,
        theme,
        background
      );

      return {
        valid: true,
        diagramType: pageRes.diagramType,
        error: null,
        warnings,
        durationMs: Math.round(performance.now() - started),
        svg: pageRes.svg,
        pngBytes,
        dimensions,
        metrics: pageRes.metrics,
        layoutDiagnostics,
        theme,
        look,
        background,
      };
    } finally {
      this.releaseSlot(slot);
    }
  }

  async dispose(): Promise<void> {
    if (this.browser) {
      const activeBrowser = this.browser;
      this.browser = null;
      this.browserPromise = null;
      this.slots = [];
      await activeBrowser.close().catch(() => {});
    }
  }
}

let sharedEngine: ChromiumRenderEngine | null = null;

export function getSharedRenderEngine(): ChromiumRenderEngine {
  if (!sharedEngine) {
    sharedEngine = new ChromiumRenderEngine(2);
  }
  return sharedEngine;
}
