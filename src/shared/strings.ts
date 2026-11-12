export function slugify(input: string, fallback = 'diagram', maxLen = 64): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen);
  return cleaned || fallback;
}

export function slugifyStrictAlnum(input: string, fallback = 'agent', maxLen = 48): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen);
  return cleaned || fallback;
}

export function randomToken(len = 12): string {
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += alphabet[bytes[i]! & 63];
  }
  return out;
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = 'Operation'
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    (timer as { unref?: () => void }).unref?.();

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

/**
 * Bounded FIFO/LRU-style ID set so long-lived browser sessions never leak memory
 * when deduplicating SSE renderIds and RPC requestIds.
 */
export class BoundedIdSet {
  private readonly set = new Set<string>();
  private readonly maxSize: number;

  constructor(maxSize = 500) {
    this.maxSize = Math.max(16, maxSize);
  }

  has(id: string): boolean {
    return this.set.has(id);
  }

  add(id: string): void {
    if (this.set.has(id)) {
      this.set.delete(id);
    } else if (this.set.size >= this.maxSize) {
      const oldest = this.set.values().next().value;
      if (oldest !== undefined) {
        this.set.delete(oldest);
      }
    }
    this.set.add(id);
  }

  delete(id: string): boolean {
    return this.set.delete(id);
  }

  clear(): void {
    this.set.clear();
  }
}
