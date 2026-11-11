import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PORT = 48333;
export const DEFAULT_HOST = '0.0.0.0';
export const DEFAULT_RENDER_CONCURRENCY = 4;
export const APP_NAME = 'mfhmfa';
export const APP_TITLE = 'MFHMFA — Mermaid For Humans, Mermaid For Agents';
export const APP_VERSION = '2.0.0';
export const GITHUB_REPO_URL = 'https://github.com/kasundularaam/MFHMFA';

export function resolveProjectRoot(metaUrl: string = import.meta.url): string {
  let dir = path.dirname(fileURLToPath(metaUrl));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export const PROJECT_ROOT = resolveProjectRoot(import.meta.url);

export function resolveConfiguredPort(overridePort?: number): number {
  if (overridePort !== undefined) return overridePort;
  const parsed = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : DEFAULT_PORT;
}

export function resolveRenderConcurrency(overrideConcurrency?: number): number {
  if (overrideConcurrency !== undefined) {
    return Math.min(16, Math.max(1, Math.floor(overrideConcurrency)));
  }
  const raw = process.env.MERMAID_RENDER_CONCURRENCY;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (Number.isFinite(parsed) && parsed >= 1) {
    return Math.min(16, parsed);
  }
  return DEFAULT_RENDER_CONCURRENCY;
}

export function resolveBaseUrl(overrideUrl?: string, port?: number): string {
  if (overrideUrl) return overrideUrl;
  if (process.env.MERMAID_STUDIO_URL) return process.env.MERMAID_STUDIO_URL;
  return `http://localhost:${port ?? resolveConfiguredPort()}`;
}

export function resolveVisibleProjectRoot(): string {
  return process.env.HOST_PROJECT_ROOT || PROJECT_ROOT;
}
