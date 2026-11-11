import puppeteer, { type Browser, type BrowserContext, type Page } from 'puppeteer-core';
import { resolveRenderConcurrency } from '../../config/env.js';
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
  RenderEngineStats,
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

interface ViewportState {
  width: number;
  height: number;
  scale: number;
}

interface PageSlot {
  context: BrowserContext;
  page: Page;
  busy: boolean;
  broken: boolean;
  renderSeq: number;
  viewport: ViewportState;
}

interface SlotWaiter {
  resolve: (slot: PageSlot) => void;
  reject: (err: Error) => void;
}

const DEFAULT_VIEWPORT_W = 2400;
const DEFAULT_VIEWPORT_H = 1800;
const DEFAULT_SCALE = 2;
const MAX_OPS_PER_SLOT = 150;
const SLOT_OP_TIMEOUT_MS = 12_000;
const PROTOCOL_TIMEOUT_MS = 15_000;

const CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-first-run',
  '--no-zygote',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--font-render-hinting=none',
];

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    timer.unref?.();

    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export class ChromiumRenderEngine implements RenderEnginePort {
  private browser: Browser | null = null;
  private browserPromise: Promise<Browser> | null = null;
  private slots: PageSlot[] = [];
  private creatingSlots = 0;
  private waitQueue: SlotWaiter[] = [];
  private disposed = false;
  private totalRenders = 0;
  private totalValidations = 0;
  private readonly maxConcurrency: number;

  constructor(maxConcurrency?: number) {
    this.maxConcurrency = resolveRenderConcurrency(maxConcurrency);
  }

  getStats(): RenderEngineStats {
    this.pruneClosedSlots();
    return {
      maxConcurrency: this.maxConcurrency,
      activeSlots: this.slots.length,
      busySlots: this.slots.filter((s) => s.busy).length,
      creatingSlots: this.creatingSlots,
      queuedRequests: this.waitQueue.length,
      totalRenders: this.totalRenders,
      totalValidations: this.totalValidations,
    };
  }

  private pruneClosedSlots(): void {
    this.slots = this.slots.filter((s) => !s.broken && !s.page.isClosed());
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.disposed) {
      throw new Error('Render engine has been disposed');
    }
    if (this.browser?.connected) {
      return this.browser;
    }
    if (this.browserPromise) {
      return this.browserPromise;
    }

    this.browserPromise = (async () => {
      try {
        const browser = await puppeteer.launch({
          executablePath: resolveChromePath(),
          headless: true,
          protocolTimeout: PROTOCOL_TIMEOUT_MS,
          args: CHROMIUM_ARGS,
        });
        browser.on('disconnected', () => {
          if (this.browser === browser) {
            this.browser = null;
            this.browserPromise = null;
            this.slots = [];
          }
        });
        this.browser = browser;
        return browser;
      } catch (err) {
        this.browserPromise = null;
        throw err;
      }
    })();

    return this.browserPromise;
  }

  private async createSlot(): Promise<PageSlot> {
    const browser = await this.ensureBrowser();
    // Each slot gets its own isolated BrowserContext (and top-level window) so
    // `document.visibilityState` stays "visible" across all concurrent slots —
    // preventing Chromium `--headless=new` from freezing screenshots on background tabs.
    const context = await browser.createBrowserContext();
    try {
      const page = await context.newPage();
      const viewport: ViewportState = {
        width: DEFAULT_VIEWPORT_W,
        height: DEFAULT_VIEWPORT_H,
        scale: DEFAULT_SCALE,
      };
      await page.setViewport({
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.scale,
      });
      await page.setContent(RENDER_HARNESS_HTML, { waitUntil: 'domcontentloaded' });
      await page.addScriptTag({ path: resolveMermaidBundlePath() });
      return {
        context,
        page,
        busy: false,
        broken: false,
        renderSeq: 0,
        viewport,
      };
    } catch (err) {
      await context.close().catch(() => {});
      throw err;
    }
  }

  private async acquireSlot(): Promise<PageSlot> {
    if (this.disposed) {
      throw new Error('Render engine has been disposed');
    }

    this.pruneClosedSlots();

    const free = this.slots.find((s) => !s.busy);
    if (free) {
      free.busy = true;
      return free;
    }

    if (this.slots.length + this.creatingSlots < this.maxConcurrency) {
      this.creatingSlots += 1;
      try {
        const slot = await withTimeout(this.createSlot(), SLOT_OP_TIMEOUT_MS, 'Chromium slot init');
        slot.busy = true;
        this.slots.push(slot);
        return slot;
      } finally {
        this.creatingSlots -= 1;
        this.pumpQueue();
      }
    }

    return new Promise<PageSlot>((resolve, reject) => {
      this.waitQueue.push({ resolve, reject });
    });
  }

  private pumpQueue(): void {
    if (this.disposed) return;
    this.pruneClosedSlots();

    while (this.waitQueue.length > 0) {
      const free = this.slots.find((s) => !s.busy);
      if (free) {
        free.busy = true;
        const waiter = this.waitQueue.shift()!;
        waiter.resolve(free);
        continue;
      }

      if (this.slots.length + this.creatingSlots < this.maxConcurrency) {
        const waiter = this.waitQueue.shift()!;
        this.creatingSlots += 1;
        withTimeout(this.createSlot(), SLOT_OP_TIMEOUT_MS, 'Chromium slot init')
          .then((fresh) => {
            if (this.disposed) {
              fresh.context.close().catch(() => {});
              waiter.reject(new Error('Render engine disposed'));
              return;
            }
            fresh.busy = true;
            this.slots.push(fresh);
            waiter.resolve(fresh);
          })
          .catch((err: unknown) => {
            waiter.reject(err instanceof Error ? err : new Error(String(err)));
          })
          .finally(() => {
            this.creatingSlots -= 1;
            this.pumpQueue();
          });
        continue;
      }

      break;
    }
  }

  private releaseSlot(slot: PageSlot, forceEvict = false): void {
    const shouldEvict =
      forceEvict ||
      slot.broken ||
      slot.page.isClosed() ||
      slot.renderSeq >= MAX_OPS_PER_SLOT;

    if (shouldEvict) {
      slot.broken = true;
      slot.busy = false;
      this.slots = this.slots.filter((s) => s !== slot);
      slot.context.close().catch(() => {});
      this.pumpQueue();
      return;
    }

    const waiter = this.waitQueue.shift();
    if (waiter) {
      waiter.resolve(slot);
    } else {
      slot.busy = false;
    }
  }

  private async ensureViewport(
    slot: PageSlot,
    width: number,
    height: number,
    scale: number
  ): Promise<void> {
    if (
      slot.viewport.width === width &&
      slot.viewport.height === height &&
      slot.viewport.scale === scale
    ) {
      return;
    }
    await slot.page.setViewport({ width, height, deviceScaleFactor: scale });
    slot.viewport = { width, height, scale };
  }

  private async runOnSlot<T>(
    label: string,
    fn: (slot: PageSlot) => Promise<{ value: T; recycle?: boolean }>
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt++) {
      const slot = await this.acquireSlot();
      let failed = false;
      let recycle = false;

      try {
        slot.renderSeq += 1;
        const out = await withTimeout(fn(slot), SLOT_OP_TIMEOUT_MS, label);
        recycle = Boolean(out.recycle);
        return out.value;
      } catch (err: unknown) {
        failed = true;
        slot.broken = true;
        lastError = err;
        if (attempt === 1) {
          throw err;
        }
      } finally {
        this.releaseSlot(slot, failed || recycle);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
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

    this.totalValidations += 1;

    return this.runOnSlot<ValidationResult>('Mermaid validate', async (slot) => {
      const evalRes = await slot.page.evaluate(async (diagramCode: string) => {
        const m = (window as unknown as MermaidWindow).mermaid;
        m.initialize({ startOnLoad: false, theme: 'default', look: 'classic', securityLevel: 'antiscript' });
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
          value: {
            valid: false,
            diagramType: null,
            error: parseMermaidError(code, evalRes.err),
            warnings,
            durationMs,
          },
        };
      }

      return {
        value: {
          valid: true,
          diagramType: evalRes.diagramType,
          error: null,
          warnings,
          durationMs,
        },
      };
    });
  }

  async render(code: string, options: RenderOptions = {}): Promise<RenderedDiagram> {
    const started = performance.now();
    const theme: MermaidTheme = options.theme ?? 'default';
    const look: MermaidLook = options.look ?? 'classic';
    const defaultBg = theme === 'dark' ? '#191918' : '#ffffff';
    const background = options.background ?? defaultBg;
    const scale = Math.min(4, Math.max(1, options.scale ?? DEFAULT_SCALE));
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

    this.totalRenders += 1;

    return this.runOnSlot<RenderedDiagram>('Mermaid render', async (slot) => {
      const renderId = `mmd_render_${slot.renderSeq}_${Date.now()}`;

      await this.ensureViewport(slot, DEFAULT_VIEWPORT_W, DEFAULT_VIEWPORT_H, scale);

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
          value: {
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
          },
        };
      }

      const targetW = Math.min(7200, Math.max(800, pageRes.stageWidth + 64));
      const targetH = Math.min(7200, Math.max(600, pageRes.stageHeight + 64));
      if (targetW > DEFAULT_VIEWPORT_W || targetH > DEFAULT_VIEWPORT_H) {
        await this.ensureViewport(slot, targetW, targetH, scale);
      }

      const stageHandle = await slot.page.$('#capture-stage');
      if (!stageHandle) {
        throw new Error('Missing #capture-stage handle during screenshot');
      }

      let pngBytes: Uint8Array;
      try {
        const rawScreenshot = await stageHandle.screenshot({
          type: 'png',
          omitBackground: background === 'transparent',
        });
        pngBytes = new Uint8Array(rawScreenshot);
      } finally {
        await stageHandle.dispose().catch(() => {});
      }

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
        value: {
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
        },
      };
    });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    while (this.waitQueue.length > 0) {
      const waiter = this.waitQueue.shift()!;
      waiter.reject(new Error('Render engine disposed'));
    }
    const activeSlots = [...this.slots];
    this.slots = [];
    await Promise.all(activeSlots.map((s) => s.context.close().catch(() => {})));

    if (this.browser) {
      const activeBrowser = this.browser;
      this.browser = null;
      this.browserPromise = null;
      await activeBrowser.close().catch(() => {});
    }
  }
}

let sharedEngine: ChromiumRenderEngine | null = null;

export function getSharedRenderEngine(): ChromiumRenderEngine {
  if (!sharedEngine) {
    sharedEngine = new ChromiumRenderEngine();
  }
  return sharedEngine;
}
