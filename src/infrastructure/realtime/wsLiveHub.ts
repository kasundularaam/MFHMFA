import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { RealtimeHubPort } from '../../domain/ports.js';
import type { LiveEventPayload, LiveEventType } from '../../shared/types.js';

export class WsLiveHub implements RealtimeHubPort {
  private wss: WebSocketServer | null = null;
  private readonly clients = new Set<WebSocket>();

  attach(server: HttpServer): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      this.sendTo(ws, {
        type: 'hello',
        data: { connectedClients: this.clients.size },
        timestamp: new Date().toISOString(),
      });

      ws.on('close', () => this.clients.delete(ws));
      ws.on('error', () => this.clients.delete(ws));
    });
  }

  private sendTo(ws: WebSocket, payload: LiveEventPayload): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  broadcast(type: LiveEventType, data: unknown, focusInUi = false): void {
    const payload: LiveEventPayload = {
      type,
      data,
      focusInUi,
      timestamp: new Date().toISOString(),
    };
    const serialized = JSON.stringify(payload);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(serialized);
      }
    }
  }

  clientCount(): number {
    return this.clients.size;
  }

  close(): void {
    for (const client of this.clients) {
      try {
        client.close();
      } catch {
        // Ignore socket close race
      }
    }
    this.clients.clear();
    this.wss?.close();
    this.wss = null;
  }
}
