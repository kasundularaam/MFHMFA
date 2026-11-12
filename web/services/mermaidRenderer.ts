import DOMPurify from 'dompurify';
import mermaid from 'mermaid';
import { extractSvgDimensions, normalizeSvgIntrinsicDimensions } from '../../src/shared/svg';
import { getMermaidComfortConfig, type AppearanceMode } from '../theme/comfortTheme';

export interface ClientRenderSuccess {
  ok: true;
  svg: string;
  diagramType: string | null;
  dimensions: { width: number; height: number } | null;
}

export interface ClientRenderFailure {
  ok: false;
  error: unknown;
}

export type ClientRenderOutcome = ClientRenderSuccess | ClientRenderFailure;

const svgCache = new Map<string, ClientRenderSuccess>();
const MAX_CACHE_ENTRIES = 80;

let renderSeq = 0;
let scratchEl: HTMLDivElement | null = null;
let renderChain: Promise<unknown> = Promise.resolve();

function getScratchContainer(): HTMLDivElement {
  if (!scratchEl || !document.body.contains(scratchEl)) {
    scratchEl = document.createElement('div');
    scratchEl.setAttribute('aria-hidden', 'true');
    scratchEl.style.cssText =
      'position:fixed;left:-10000px;top:-10000px;width:2400px;height:1800px;visibility:hidden;pointer-events:none;overflow:hidden;z-index:-1;';
    document.body.appendChild(scratchEl);
  }
  return scratchEl;
}

function sanitizeMermaidSvg(rawSvg: string): string {
  return DOMPurify.sanitize(rawSvg, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ['foreignObject'],
    ADD_ATTR: [
      'xmlns',
      'xmlns:xlink',
      'dominant-baseline',
      'alignment-baseline',
      'text-anchor',
      'marker-end',
      'marker-start',
      'marker-mid',
      'transform-origin',
    ],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
  });
}

export function getCachedClientRender(
  code: string,
  mode: AppearanceMode
): ClientRenderSuccess | null {
  return svgCache.get(`${mode}::${code}`) ?? null;
}

export function renderMermaidClient(
  code: string,
  mode: AppearanceMode
): Promise<ClientRenderOutcome> {
  const key = `${mode}::${code}`;
  const cached = svgCache.get(key);
  if (cached) {
    return Promise.resolve(cached);
  }

  // Serialize mermaid.initialize + mermaid.render calls so concurrent renders never collide
  const job = renderChain.then(async (): Promise<ClientRenderOutcome> => {
    const again = svgCache.get(key);
    if (again) return again;

    try {
      const container = getScratchContainer();
      container.innerHTML = '';

      mermaid.initialize(getMermaidComfortConfig(mode));
      const parsed = await mermaid.parse(code);

      const uid = `mfhmfa_svg_${++renderSeq}`;
      const out = await mermaid.render(uid, code, container);
      container.innerHTML = '';

      const normalized = normalizeSvgIntrinsicDimensions(out.svg);
      const svg = sanitizeMermaidSvg(normalized);
      const dimensions = extractSvgDimensions(svg);
      const result: ClientRenderSuccess = {
        ok: true,
        svg,
        diagramType: parsed?.diagramType || out.diagramType || null,
        dimensions,
      };

      if (svgCache.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = svgCache.keys().next().value;
        if (oldestKey !== undefined) svgCache.delete(oldestKey);
      }
      svgCache.set(key, result);

      return result;
    } catch (error: unknown) {
      return { ok: false, error };
    }
  });

  renderChain = job.catch(() => {});
  return job;
}
