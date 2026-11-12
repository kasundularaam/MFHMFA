import type { DiagramMetrics } from '../../shared/types.js';

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

export interface PageErrorPayload {
  message: string;
  str: unknown;
  hash: unknown;
}

export type PageValidateResult =
  | { ok: true; diagramType: string | null }
  | { ok: false; err: PageErrorPayload };

export type PageRenderResult =
  | {
      ok: true;
      diagramType: string | null;
      svg: string;
      stageWidth: number;
      stageHeight: number;
      metrics: DiagramMetrics;
    }
  | { ok: false; err: PageErrorPayload };

export interface PageRenderParams {
  code: string;
  renderId: string;
  theme: string;
  look: string;
  background: string;
  padding: number;
}

export async function evaluateMermaidValidateInPage(
  diagramCode: string
): Promise<PageValidateResult> {
  const m = (window as unknown as MermaidWindow).mermaid;
  m.initialize({
    startOnLoad: false,
    theme: 'default',
    look: 'classic',
    securityLevel: 'antiscript',
  });
  try {
    const parsed = await m.parse(diagramCode);
    return { ok: true, diagramType: parsed?.diagramType ?? null };
  } catch (err: unknown) {
    const e = err as Record<string, unknown>;
    return {
      ok: false,
      err: {
        message: typeof e?.message === 'string' ? e.message : String(err),
        str: e?.str,
        hash: e?.hash,
      },
    };
  }
}

export async function evaluateMermaidRenderInPage(
  params: PageRenderParams
): Promise<PageRenderResult> {
  const stage = document.getElementById('capture-stage')!;
  stage.innerHTML = '';
  stage.style.padding = `${params.padding}px`;
  stage.style.background =
    params.background === 'transparent' ? 'transparent' : params.background;

  document.querySelectorAll('[id^="dmmd_render_"], [id^="mmd_render_"]').forEach((el) => {
    el.remove();
  });

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
      ok: false,
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
      const parts = vb
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (parts.length === 4 && parts[2]! > 0 && parts[3]! > 0) {
        const vbW = Math.ceil(parts[2]!);
        const vbH = Math.ceil(parts[3]!);
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
      ok: true,
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
      ok: false,
      err: {
        message: typeof e?.message === 'string' ? e.message : String(err),
        str: e?.str,
        hash: e?.hash,
      },
    };
  }
}
