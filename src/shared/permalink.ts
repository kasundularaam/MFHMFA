const MAX_DECOMPRESSED_BYTES = 256 * 1024;

export interface PermalinkTabItem {
  code: string;
  title?: string;
}

export interface PermalinkPayload {
  code: string;
  title?: string;
  tabs?: PermalinkTabItem[];
  activeIndex?: number;
}

interface WireTabItem {
  c: string;
  t?: string;
}

interface WirePermalinkPayload {
  c: string;
  t?: string;
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
  const wire: WirePermalinkPayload = payload.title?.trim()
    ? { c: payload.code, t: payload.title.trim() }
    : { c: payload.code };

  if (payload.tabs && payload.tabs.length > 1) {
    wire.tabs = payload.tabs.map((tab) =>
      tab.title?.trim() ? { c: tab.code, t: tab.title.trim() } : { c: tab.code }
    );
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
        .map((item) => ({
          code: item.c,
          ...(typeof item.t === 'string' && item.t.trim() ? { title: item.t.trim() } : {}),
        }))
    : undefined;

  return {
    code: parsed.c,
    ...(typeof parsed.t === 'string' && parsed.t.trim() ? { title: parsed.t.trim() } : {}),
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
