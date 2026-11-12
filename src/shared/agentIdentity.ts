import type { CallerSource } from './types.js';

export interface NormalizedAgentIdentity {
  slug: string;
  label: string;
  shortLabel: string;
}

interface KnownAgentRule {
  match: RegExp;
  slug: string;
  label: string;
  shortLabel: string;
}

const KNOWN_AGENTS: readonly KnownAgentRule[] = [
  {
    match: /claude[-_\s]?code/i,
    slug: 'claude-code',
    label: 'Claude Code',
    shortLabel: 'Claude',
  },
  {
    match: /(?:^|\/|@)pi(?:[-_\s]coding[-_\s]agent|[-_\s]agent|[-_\s]cli)?$/i,
    slug: 'pi',
    label: 'Pi',
    shortLabel: 'Pi',
  },
  {
    match: /\bpi[-_\s]coding[-_\s]agent\b/i,
    slug: 'pi',
    label: 'Pi',
    shortLabel: 'Pi',
  },
  {
    match: /antigravity/i,
    slug: 'antigravity',
    label: 'Antigravity',
    shortLabel: 'Antigravity',
  },
  {
    match: /cursor/i,
    slug: 'cursor',
    label: 'Cursor',
    shortLabel: 'Cursor',
  },
  {
    match: /windsurf|codeium/i,
    slug: 'windsurf',
    label: 'Windsurf',
    shortLabel: 'Windsurf',
  },
  {
    match: /codex/i,
    slug: 'codex',
    label: 'Codex',
    shortLabel: 'Codex',
  },
  {
    match: /opencode/i,
    slug: 'opencode',
    label: 'OpenCode',
    shortLabel: 'OpenCode',
  },
  {
    match: /roo[-_\s]?code/i,
    slug: 'roo-code',
    label: 'Roo Code',
    shortLabel: 'Roo',
  },
  {
    match: /\bcline\b/i,
    slug: 'cline',
    label: 'Cline',
    shortLabel: 'Cline',
  },
  {
    match: /copilot|visual\s*studio\s*code|\bvscode\b/i,
    slug: 'vscode',
    label: 'VS Code',
    shortLabel: 'VS Code',
  },
  {
    match: /\bzed\b/i,
    slug: 'zed',
    label: 'Zed',
    shortLabel: 'Zed',
  },
  {
    match: /\bamp\b/i,
    slug: 'amp',
    label: 'Amp',
    shortLabel: 'Amp',
  },
  {
    match: /goose/i,
    slug: 'goose',
    label: 'Goose',
    shortLabel: 'Goose',
  },
  {
    match: /claude/i,
    slug: 'claude',
    label: 'Claude',
    shortLabel: 'Claude',
  },
];

function slugifyToken(input: string, fallback = 'agent'): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned || fallback;
}

function humanizeAgentName(raw: string): string {
  const withoutScope = raw.trim().replace(/^@[^/]+\//, '');
  const stripped = withoutScope
    .replace(/[-_]?mcp[-_]?client$/i, '')
    .replace(/[-_]?client$/i, '')
    .trim();
  const target = stripped || withoutScope;
  if (!target) return 'MCP Agent';

  if (/[A-Z]/.test(target) && !target.includes('-') && !target.includes('_')) {
    return target.slice(0, 40);
  }

  return target
    .split(/[-_\s/]+/)
    .filter(Boolean)
    .map((word) => {
      if (word.length <= 2 && /^[a-z]+$/i.test(word)) {
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ')
    .slice(0, 40);
}

export function normalizeAgentIdentity(
  rawName?: string | null,
  fallbackSource?: CallerSource
): NormalizedAgentIdentity {
  const trimmed = rawName?.trim() ?? '';

  if (trimmed) {
    for (const rule of KNOWN_AGENTS) {
      if (rule.match.test(trimmed)) {
        return {
          slug: rule.slug,
          label: rule.label,
          shortLabel: rule.shortLabel,
        };
      }
    }

    const label = humanizeAgentName(trimmed);
    const shortLabel = label.length > 16 ? label.split(/\s+/)[0] || label.slice(0, 14) : label;
    return {
      slug: slugifyToken(label, 'mcp-agent'),
      label,
      shortLabel,
    };
  }

  if (fallbackSource === 'rest-tool') {
    return { slug: 'rest-agent', label: 'HTTP Agent', shortLabel: 'HTTP' };
  }
  if (fallbackSource === 'mcp-stdio') {
    return { slug: 'stdio-agent', label: 'Stdio Agent', shortLabel: 'Stdio' };
  }
  return { slug: 'mcp-agent', label: 'MCP Agent', shortLabel: 'Agent' };
}

export function normalizeProjectName(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  let cleaned = raw.trim();
  if (!cleaned) return null;

  // Handle file:// URIs or filesystem paths by taking the folder basename
  if (cleaned.startsWith('file://')) {
    try {
      const parsed = new URL(cleaned);
      cleaned = decodeURIComponent(parsed.pathname);
    } catch {
      cleaned = cleaned.replace(/^file:\/\//, '');
    }
  }

  if (cleaned.includes('/') || cleaned.includes('\\')) {
    const segments = cleaned
      .replace(/\\/g, '/')
      .replace(/\/+$/, '')
      .split('/')
      .filter(Boolean);
    cleaned = segments[segments.length - 1] ?? '';
  }

  cleaned = cleaned.replace(/\.git$/i, '').trim();
  if (!cleaned || cleaned === '.' || cleaned === '..' || cleaned === '~') {
    return null;
  }

  return cleaned.slice(0, 56);
}

export function extractProjectFromRoots(
  roots: ReadonlyArray<{ uri?: string | null; name?: string | null }> | null | undefined
): string | null {
  if (!Array.isArray(roots) || roots.length === 0) return null;

  for (const root of roots) {
    const fromName = normalizeProjectName(root?.name);
    if (fromName) return fromName;
    const fromUri = normalizeProjectName(root?.uri);
    if (fromUri) return fromUri;
  }
  return null;
}
