import { sanitizeComprehensionGuide } from './comprehension.js';
import type { DiagramComprehensionGuide } from './types.js';

const MAX_DECOMPRESSED_BYTES = 256 * 1024;

export interface PermalinkTabItem {
  code: string;
  title?: string;
  path?: string;
  project?: string;
  agent?: string;
  guide?: DiagramComprehensionGuide;
}

export interface PermalinkPayload {
  code: string;
  title?: string;
  path?: string;
  project?: string;
  agent?: string;
  guide?: DiagramComprehensionGuide;
  tabs?: PermalinkTabItem[];
  activeIndex?: number;
}

interface WireTabItem {
  c: string;
  t?: string;
  pa?: string;
  p?: string;
  ag?: string;
  g?: DiagramComprehensionGuide;
}

interface WirePermalinkPayload {
  c: string;
  t?: string;
  pa?: string;
  p?: string;
  ag?: string;
  g?: DiagramComprehensionGuide;
  tabs?: WireTabItem[];
  a?: number;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const clean = b64url.trim().replace(/-/g, '+').replace(/_/g, '/');
  if (!clean || /[^A-Za-z0-9+/=]/.test(clean)) {
    throw new Error('Invalid base64url token');
  }
  const padLen = (4 - (clean.length % 4)) % 4;
  const padded = clean + '='.repeat(padLen);
  const binary = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export async function encodePermalinkPayload(payload: PermalinkPayload): Promise<string> {
  const wire: WirePermalinkPayload = { c: payload.code };
  if (payload.title?.trim()) wire.t = payload.title.trim();
  if (payload.path?.trim()) wire.pa = payload.path.trim();
  if (payload.project?.trim()) wire.p = payload.project.trim();
  if (payload.agent?.trim()) wire.ag = payload.agent.trim();
  const cleanTopGuide = sanitizeComprehensionGuide(payload.guide);
  if (cleanTopGuide) wire.g = cleanTopGuide;

  if (payload.tabs && payload.tabs.length > 1) {
    wire.tabs = payload.tabs.map((tab) => {
      const item: WireTabItem = { c: tab.code };
      if (tab.title?.trim()) item.t = tab.title.trim();
      if (tab.path?.trim()) item.pa = tab.path.trim();
      if (tab.project?.trim()) item.p = tab.project.trim();
      if (tab.agent?.trim()) item.ag = tab.agent.trim();
      const cleanTabGuide = sanitizeComprehensionGuide(tab.guide);
      if (cleanTabGuide) item.g = cleanTabGuide;
      return item;
    });
    if (typeof payload.activeIndex === 'number' && payload.activeIndex >= 0) {
      wire.a = payload.activeIndex;
    }
  }

  const rawBytes = new TextEncoder().encode(JSON.stringify(wire));
  const stream = new Blob([rawBytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  return bytesToBase64Url(compressed);
}

export async function decodePermalinkPayload(
  token: string,
  maxBytes = MAX_DECOMPRESSED_BYTES
): Promise<PermalinkPayload> {
  const compressed = base64UrlToBytes(token);
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new Error(`Compressed permalink exceeds ${maxBytes} byte safety limit`);
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const json = new TextDecoder('utf-8', { fatal: true }).decode(merged);
  const parsed = JSON.parse(json) as Partial<WirePermalinkPayload>;
  if (typeof parsed?.c !== 'string') {
    throw new Error('Invalid permalink payload structure');
  }

  const tabs: PermalinkTabItem[] | undefined = Array.isArray(parsed.tabs)
    ? parsed.tabs
        .filter((item): item is WireTabItem => Boolean(item && typeof item.c === 'string'))
        .map((item) => {
          let itemGuide: DiagramComprehensionGuide | undefined;
          try {
            itemGuide = sanitizeComprehensionGuide(item.g);
          } catch {
            itemGuide = undefined;
          }
          return {
            code: item.c,
            ...(typeof item.t === 'string' && item.t.trim() ? { title: item.t.trim() } : {}),
            ...(typeof item.pa === 'string' && item.pa.trim() ? { path: item.pa.trim() } : {}),
            ...(typeof item.p === 'string' && item.p.trim() ? { project: item.p.trim() } : {}),
            ...(typeof item.ag === 'string' && item.ag.trim() ? { agent: item.ag.trim() } : {}),
            ...(itemGuide ? { guide: itemGuide } : {}),
          };
        })
    : undefined;

  let topGuide: DiagramComprehensionGuide | undefined;
  try {
    topGuide = sanitizeComprehensionGuide(parsed.g);
  } catch {
    topGuide = undefined;
  }

  return {
    code: parsed.c,
    ...(typeof parsed.t === 'string' && parsed.t.trim() ? { title: parsed.t.trim() } : {}),
    ...(typeof parsed.pa === 'string' && parsed.pa.trim() ? { path: parsed.pa.trim() } : {}),
    ...(typeof parsed.p === 'string' && parsed.p.trim() ? { project: parsed.p.trim() } : {}),
    ...(typeof parsed.ag === 'string' && parsed.ag.trim() ? { agent: parsed.ag.trim() } : {}),
    ...(topGuide ? { guide: topGuide } : {}),
    ...(tabs && tabs.length > 0 ? { tabs } : {}),
    ...(typeof parsed.a === 'number' ? { activeIndex: parsed.a } : {}),
  };
}

export async function buildPermalinkUrl(
  baseUrl: string,
  payload: PermalinkPayload
): Promise<string> {
  const token = await encodePermalinkPayload(payload);
  const cleanBase = baseUrl.replace(/\/+$/, '');
  return `${cleanBase}/#z=${token}`;
}

export function extractHashToken(hashOrUrl: string): string | null {
  const hashIdx = hashOrUrl.indexOf('#');
  const rawHash = (hashIdx >= 0 ? hashOrUrl.slice(hashIdx + 1) : hashOrUrl).replace(/^#/, '');
  if (!rawHash) return null;
  if (rawHash.startsWith('z=')) {
    const val = rawHash.slice(2).trim();
    return val.length > 0 ? val : null;
  }
  const params = new URLSearchParams(rawHash);
  const z = params.get('z');
  return z && z.trim().length > 0 ? z.trim() : null;
}
