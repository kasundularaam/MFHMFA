import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PORT = 48333;
export const DEFAULT_HOST = '0.0.0.0';
export const APP_NAME = 'mermaid-agent-studio';
export const APP_VERSION = '1.0.0';

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

export function resolveDataDir(overrideDir?: string): string {
  const dir =
    overrideDir ||
    process.env.MERMAID_STUDIO_DATA_DIR ||
    path.join(PROJECT_ROOT, 'data');
  fs.mkdirSync(path.join(dir, 'renders', 'previews'), { recursive: true });
  return dir;
}

export function resolveConfiguredPort(overridePort?: number): number {
  if (overridePort !== undefined) return overridePort;
  const parsed = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : DEFAULT_PORT;
}

export function resolveBaseUrl(overrideUrl?: string, port?: number): string {
  if (overrideUrl) return overrideUrl;
  if (process.env.MERMAID_STUDIO_URL) return process.env.MERMAID_STUDIO_URL;
  return `http://localhost:${port ?? resolveConfiguredPort()}`;
}

export function resolveVisibleProjectRoot(): string {
  return process.env.HOST_PROJECT_ROOT || PROJECT_ROOT;
}

export function toHostVisiblePath(filePath: string | null): string | null {
  if (!filePath) return null;
  const hostRoot = process.env.HOST_PROJECT_ROOT;
  if (hostRoot && filePath.startsWith('/app/data/')) {
    return path.join(hostRoot, 'data', filePath.slice('/app/data/'.length));
  }
  return filePath;
}

export function isLocalOrBridgeAddress(rawIp: string): boolean {
  const ip = rawIp.replace('::ffff:', '');
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('127.') ||
    ip.startsWith('172.') ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.')
  );
}
