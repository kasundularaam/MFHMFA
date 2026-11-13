import { useEffect, useRef } from 'react';
import {
  AgentSessionInfoSchema,
  ConnectedAgentsEventSchema,
  DiagramRelayPayloadSchema,
  VfsRpcRequestSchema,
} from '../../src/shared/protocolSchemas';
import { BoundedIdSet } from '../../src/shared/strings';
import { flushPendingWorkspaceSave } from '../services/workspacePersistence';
import { studioApi } from '../services/studioClient';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';

const LOCAL_WORKSPACE_CHANNEL = 'local_workspace';

export function useWorkspaceRelay(enabled = true): void {
  const hydrated = useWorkspaceStore((s) => s.hydrated);
  const workspaceId = useWorkspaceStore((s) => s.workspace.workspaceId);

  const seenRenderIdsRef = useRef<BoundedIdSet | null>(null);
  const handledRpcIdsRef = useRef<BoundedIdSet | null>(null);
  const announcedSessionsRef = useRef<BoundedIdSet | null>(null);

  if (!seenRenderIdsRef.current) seenRenderIdsRef.current = new BoundedIdSet(500);
  if (!handledRpcIdsRef.current) handledRpcIdsRef.current = new BoundedIdSet(500);
  if (!announcedSessionsRef.current) announcedSessionsRef.current = new BoundedIdSet(250);

  // Sync saved theme attribute immediately on every device
  useEffect(() => {
    const mode = useUiStore.getState().appearanceMode;
    document.documentElement.dataset.mode = mode;
    document.documentElement.style.colorScheme = mode;
  }, []);

  // Hydrate IndexedDB workspace & fetch server status only when desktop Studio is active
  useEffect(() => {
    if (!enabled) return undefined;

    void useWorkspaceStore.getState().hydrate();

    studioApi
      .getStatus()
      .then((st) => useUiStore.getState().setServerStatus(st))
      .catch(() => {});

    const onPageHide = () => {
      flushPendingWorkspaceSave();
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [enabled]);

  // Reset dedupe caches when workspaceId rotates
  useEffect(() => {
    seenRenderIdsRef.current?.clear();
    handledRpcIdsRef.current?.clear();
    announcedSessionsRef.current?.clear();
  }, [workspaceId]);

  // Connect SSE stream only on desktop AFTER IndexedDB hydration completes so VFS RPCs
  // (`list_views`, `read_view`, `move_view`) always see hydrated state.
  useEffect(() => {
    if (!enabled || !hydrated) return undefined;

    const channels: string[] = [workspaceId];
    const searchParams = new URLSearchParams(window.location.search);
    const explicitUrlWs = searchParams.get('workspace') || searchParams.get('ws');
    const host = window.location.hostname;
    if (
      !explicitUrlWs &&
      (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') &&
      workspaceId !== LOCAL_WORKSPACE_CHANNEL
    ) {
      channels.push(LOCAL_WORKSPACE_CHANNEL);
    }

    const sources: EventSource[] = [];

    for (const channel of channels) {
      const es = new EventSource(`/api/workspace/${encodeURIComponent(channel)}/events`);

      es.addEventListener('connected_agents', (ev: MessageEvent) => {
        try {
          const parsed = ConnectedAgentsEventSchema.safeParse(JSON.parse(String(ev.data)));
          if (!parsed.success) return;
          for (const ag of parsed.data.agents) {
            announcedSessionsRef.current?.add(ag.sessionId);
            useWorkspaceStore.getState().applyAgentStatus(ag, {
              silent: true,
              shouldAnnounce: false,
            });
          }
        } catch {
          // ignore malformed SSE frame
        }
      });

      es.addEventListener('agent_status', (ev: MessageEvent) => {
        try {
          const parsed = AgentSessionInfoSchema.safeParse(JSON.parse(String(ev.data)));
          if (!parsed.success) return;
          const ag = parsed.data;
          if (ag.status === 'disconnected') {
            announcedSessionsRef.current?.delete(ag.sessionId);
            useWorkspaceStore.getState().applyAgentStatus(ag, {
              silent: false,
              shouldAnnounce: false,
            });
            return;
          }
          const shouldAnnounce = !announcedSessionsRef.current?.has(ag.sessionId);
          announcedSessionsRef.current?.add(ag.sessionId);
          useWorkspaceStore.getState().applyAgentStatus(ag, {
            silent: false,
            shouldAnnounce,
          });
        } catch {
          // ignore malformed SSE frame
        }
      });

      es.addEventListener('diagram', (ev: MessageEvent) => {
        try {
          const parsed = DiagramRelayPayloadSchema.safeParse(JSON.parse(String(ev.data)));
          if (!parsed.success) return;
          const diag = parsed.data;
          if (seenRenderIdsRef.current?.has(diag.renderId)) return;
          seenRenderIdsRef.current?.add(diag.renderId);
          useWorkspaceStore.getState().applyIncomingDiagram(diag);
        } catch {
          // ignore malformed SSE frame
        }
      });

      es.addEventListener('vfs_request', (ev: MessageEvent) => {
        try {
          const parsed = VfsRpcRequestSchema.safeParse(JSON.parse(String(ev.data)));
          if (!parsed.success) return;
          const req = parsed.data;
          if (handledRpcIdsRef.current?.has(req.requestId)) return;
          handledRpcIdsRef.current?.add(req.requestId);

          try {
            const result = useWorkspaceStore.getState().executeVfsRpc(req);
            studioApi
              .replyVfsRequest(channel, {
                requestId: req.requestId,
                ok: true,
                result,
              })
              .catch(() => {});
          } catch (rpcErr: unknown) {
            const message = rpcErr instanceof Error ? rpcErr.message : String(rpcErr);
            studioApi
              .replyVfsRequest(channel, {
                requestId: req.requestId,
                ok: false,
                error: message,
              })
              .catch(() => {});
          }
        } catch {
          // ignore malformed SSE frame
        }
      });

      sources.push(es);
    }

    return () => {
      for (const es of sources) {
        es.close();
      }
    };
  }, [enabled, hydrated, workspaceId]);
}
