import type { Request } from 'express';
import { LOCAL_WORKSPACE_CHANNEL, isLocalRequestHost } from '../../config/env.js';
import { sanitizeWorkspaceToken } from '../../infrastructure/ephemeral/workspaceRelay.js';
import { normalizeProjectName } from '../../shared/agentIdentity.js';

export function firstString(val: unknown): string | null {
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0];
  return null;
}

export function resolveExplicitWorkspaceToken(req: Request): string | null {
  const body =
    req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : null;
  return (
    sanitizeWorkspaceToken(body?.workspaceToken) ??
    sanitizeWorkspaceToken(body?.workspace) ??
    sanitizeWorkspaceToken(firstString(req.query.workspace)) ??
    sanitizeWorkspaceToken(firstString(req.query.ws)) ??
    sanitizeWorkspaceToken(firstString(req.headers['x-mfhmfa-workspace']))
  );
}

export function resolveRequestWorkspaceToken(
  req: Request,
  opts?: { allowLocalFallback?: boolean }
): string | null {
  const explicit = resolveExplicitWorkspaceToken(req);
  if (explicit) return explicit;
  if (opts?.allowLocalFallback !== false && isLocalRequestHost(req.headers)) {
    return LOCAL_WORKSPACE_CHANNEL;
  }
  return null;
}

export function resolveExplicitProject(req: Request): string | null {
  return (
    normalizeProjectName(firstString(req.query.project)) ??
    normalizeProjectName(firstString(req.headers['x-mfhmfa-project']))
  );
}

export function isLocalHttpCaller(req: Request): boolean {
  return isLocalRequestHost(req.headers);
}
