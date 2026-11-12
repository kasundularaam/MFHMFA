import { slugify } from './svg.js';

function sanitizeSegment(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) continue;
    const ch = raw[i]!;
    if ('<>:"|?*'.includes(ch)) continue;
    out += ch;
  }
  return out.trim();
}

/**
 * Resolves and jails a relative directory path inside a project's working directory.
 * Rejects any `..` traversal that attempts to escape the project root.
 * Returns `""` for the project root, or `"folder/subfolder"` (no leading/trailing slashes).
 */
export function normalizeRelativeDirPath(rawPath?: string | null): string {
  if (!rawPath) return '';
  const trimmed = rawPath.trim().replace(/\\/g, '/');
  if (!trimmed || trimmed === '/' || trimmed === '.') return '';

  const rawSegments = trimmed.split('/');
  const resolved: string[] = [];

  for (const rawSeg of rawSegments) {
    const seg = rawSeg.trim();
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (resolved.length === 0) {
        throw new Error(
          'Invalid path: cannot traverse above project working directory (".." rejected).'
        );
      }
      resolved.pop();
      continue;
    }
    const clean = sanitizeSegment(seg);
    if (!clean) continue;
    resolved.push(clean.slice(0, 64));
  }

  return resolved.join('/');
}

/**
 * Resolves and jails a relative diagram file path inside a project's working directory.
 * Ensures a `.mmd` extension (e.g. `"auth/oauth-flow"` -> `"auth/oauth-flow.mmd"`).
 */
export function normalizeRelativeGraphPath(rawPath: string): string {
  const trimmed = rawPath.trim().replace(/\\/g, '/');
  if (!trimmed || trimmed === '/' || trimmed === '.') {
    throw new Error('A non-empty diagram file path is required (e.g. "auth/oauth-flow.mmd").');
  }

  const rawSegments = trimmed.split('/');
  const resolved: string[] = [];

  for (const rawSeg of rawSegments) {
    const seg = rawSeg.trim();
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (resolved.length === 0) {
        throw new Error(
          'Invalid path: cannot traverse above project working directory (".." rejected).'
        );
      }
      resolved.pop();
      continue;
    }
    const clean = sanitizeSegment(seg);
    if (!clean) continue;
    resolved.push(clean.slice(0, 64));
  }

  if (resolved.length === 0) {
    throw new Error('A valid diagram file name is required (e.g. "overview.mmd").');
  }

  const lastIdx = resolved.length - 1;
  let fileName = resolved[lastIdx]!;
  fileName = fileName.replace(/\.(mmd|mermaid)$/i, '').trim();
  if (!fileName) {
    throw new Error('Diagram file name cannot be empty.');
  }
  resolved[lastIdx] = `${fileName}.mmd`;

  return resolved.join('/');
}

/**
 * Normalizes a move path (could be either a `.mmd` file or a folder path depending on source).
 */
export function normalizeRelativeAnyPath(rawPath: string, treatAsFile: boolean): string {
  return treatAsFile ? normalizeRelativeGraphPath(rawPath) : normalizeRelativeDirPath(rawPath);
}

export function graphTitleFromPath(relFilePath: string): string {
  const segments = relFilePath.replace(/\\/g, '/').split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? 'diagram.mmd';
  return last.replace(/\.(mmd|mermaid)$/i, '') || 'diagram';
}

export function parentDirOfPath(relFilePath: string): string {
  const idx = relFilePath.lastIndexOf('/');
  return idx > 0 ? relFilePath.slice(0, idx) : '';
}

export function inferPathFromTitle(title: string, parentDir = ''): string {
  const base = `${slugify(title, 'diagram')}.mmd`;
  const cleanParent = normalizeRelativeDirPath(parentDir);
  return cleanParent ? `${cleanParent}/${base}` : base;
}
