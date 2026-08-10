import { createServer, IncomingMessage } from 'node:http';

import WebSocket, { WebSocketServer } from 'ws';

import { NostrEvent } from '../consensus/nip01';
import { parseStrictJson } from './strict-json';

export interface EmbeddedRelayStore {
  saveIncomingEvent(event: NostrEvent): { accepted: boolean; message: string };
  query(filters: readonly Record<string, unknown>[]): NostrEvent[];
}

export class EmbeddedRelay {
  private readonly webSocketServer: WebSocketServer;
  private readonly server = createServer();
  private readonly store: EmbeddedRelayStore;

  public constructor(store: EmbeddedRelayStore) {
    this.store = store;
    this.webSocketServer = new WebSocketServer({ noServer: true });
    this.server.on('upgrade', (request, socket, head) => {
      this.webSocketServer.handleUpgrade(request, socket, head, (client) => {
        this.webSocketServer.emit('connection', client, request);
      });
    });
    this.webSocketServer.on('connection', (socket) => this.handleConnection(socket));
  }

  public listen(port: number, host = '127.0.0.1'): Promise<void> {
    return new Promise((resolve) => this.server.listen(port, host, () => resolve()));
  }

  public close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.webSocketServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        this.server.close((closeError) => {
          if (closeError) reject(closeError);
          else resolve();
        });
      });
    });
  }

  private handleConnection(socket: WebSocket): void {
    socket.on('message', (raw) => {
      const parsed = parseStrictJson(String(raw));
      if (!Array.isArray(parsed) || parsed.length === 0 || typeof parsed[0] !== 'string') {
        socket.send(JSON.stringify(['NOTICE', 'bad-message']));
        return;
      }
      const type = parsed[0];
      if (type === 'EVENT' && parsed.length === 2 && typeof parsed[1] === 'object' && parsed[1] !== null) {
        const result = this.store.saveIncomingEvent(parsed[1] as NostrEvent);
        socket.send(JSON.stringify(['OK', (parsed[1] as NostrEvent).id, result.accepted, result.message]));
        return;
      }
      if (type === 'REQ' && parsed.length >= 2 && typeof parsed[1] === 'string') {
        const subscriptionId = parsed[1];
        const filters = parsed.slice(2).filter((filter) => typeof filter === 'object' && filter !== null) as Record<string, unknown>[];
        for (const event of this.store.query(filters)) {
          socket.send(JSON.stringify(['EVENT', subscriptionId, event]));
        }
        socket.send(JSON.stringify(['EOSE', subscriptionId]));
        return;
      }
      if (type === 'CLOSE' && parsed.length === 2 && typeof parsed[1] === 'string') {
        socket.send(JSON.stringify(['CLOSED', parsed[1], 'closed']));
        return;
      }
      socket.send(JSON.stringify(['NOTICE', 'unsupported']));
    });
  }
}
