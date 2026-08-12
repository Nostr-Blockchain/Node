import { createServer, IncomingMessage } from 'node:http';

import WebSocket, { WebSocketServer } from 'ws';

import { NostrEvent } from '../consensus/nip01';
import { parseStrictJson } from './strict-json';
import {
  MAX_FILTER_AUTHORS,
  MAX_FILTER_IDS,
  MAX_HISTORICAL_LIMIT,
  MAX_RELAY_FILTERS,
  MAX_SUBSCRIPTION_ID_BYTES,
  NostrFilter
} from './subscriptions';

export interface EmbeddedRelayStore {
  saveIncomingEvent(event: NostrEvent): { accepted: boolean; message: string };
  query(filters: readonly NostrFilter[]): NostrEvent[];
  getRelayInfo(): Record<string, unknown>;
}

export class EmbeddedRelay {
  private readonly webSocketServer: WebSocketServer;
  private readonly server = createServer();
  private readonly store: EmbeddedRelayStore;

  public constructor(store: EmbeddedRelayStore) {
    this.store = store;
    this.webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 65_536 });
    this.server.on('request', (request, response) => this.handleHttpRequest(request, response));
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
      for (const client of this.webSocketServer.clients) {
        client.terminate();
      }
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
    const subscriptions = new Set<string>();
    socket.on('message', (raw) => {
      let parsed: unknown;
      try {
        parsed = parseStrictJson(String(raw));
      } catch {
        socket.send(JSON.stringify(['NOTICE', 'bad-message']));
        return;
      }
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
        if (Buffer.byteLength(subscriptionId, 'utf8') > MAX_SUBSCRIPTION_ID_BYTES) {
          socket.send(JSON.stringify(['CLOSED', subscriptionId, 'invalid-subscription-id']));
          return;
        }
        if (subscriptions.size >= 64 && !subscriptions.has(subscriptionId)) {
          socket.send(JSON.stringify(['CLOSED', subscriptionId, 'too-many-subscriptions']));
          return;
        }
        const candidateFilters = parsed.slice(2);
        if (candidateFilters.length === 0 || candidateFilters.length > MAX_RELAY_FILTERS) {
          socket.send(JSON.stringify(['CLOSED', subscriptionId, 'invalid-filter-count']));
          return;
        }
        const filters = candidateFilters.map((filter) => this.validateFilter(filter)).filter((filter): filter is NostrFilter => filter !== null);
        if (filters.length !== candidateFilters.length) {
          socket.send(JSON.stringify(['CLOSED', subscriptionId, 'invalid-filter']));
          return;
        }
        subscriptions.add(subscriptionId);
        for (const event of this.store.query(filters)) {
          socket.send(JSON.stringify(['EVENT', subscriptionId, event]));
        }
        socket.send(JSON.stringify(['EOSE', subscriptionId]));
        return;
      }
      if (type === 'CLOSE' && parsed.length === 2 && typeof parsed[1] === 'string') {
        subscriptions.delete(parsed[1]);
        socket.send(JSON.stringify(['CLOSED', parsed[1], 'closed']));
        return;
      }
      socket.send(JSON.stringify(['NOTICE', 'unsupported']));
    });

    socket.on('error', () => undefined);
  }

  private handleHttpRequest(request: IncomingMessage, response: import('node:http').ServerResponse): void {
    const accept = request.headers.accept ?? '';
    if (request.method === 'GET' && typeof accept === 'string' && accept.includes('application/nostr+json')) {
      response.writeHead(200, { 'content-type': 'application/nostr+json; charset=utf-8' });
      response.end(JSON.stringify(this.store.getRelayInfo()));
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found');
  }

  private validateFilter(candidate: unknown): NostrFilter | null {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
      return null;
    }
    const filter = candidate as Record<string, unknown>;
    if (filter.ids !== undefined && (!Array.isArray(filter.ids) || filter.ids.length > MAX_FILTER_IDS || !filter.ids.every((value) => typeof value === 'string'))) {
      return null;
    }
    if (filter.authors !== undefined && (!Array.isArray(filter.authors) || filter.authors.length > MAX_FILTER_AUTHORS || !filter.authors.every((value) => typeof value === 'string'))) {
      return null;
    }
    if (filter.kinds !== undefined && (!Array.isArray(filter.kinds) || !filter.kinds.every((value) => Number.isInteger(value)))) {
      return null;
    }
    if (filter['#t'] !== undefined && (!Array.isArray(filter['#t']) || !filter['#t'].every((value) => typeof value === 'string'))) {
      return null;
    }
    if (filter.limit !== undefined && (!Number.isInteger(filter.limit) || Number(filter.limit) < 0 || Number(filter.limit) > MAX_HISTORICAL_LIMIT)) {
      return null;
    }
    return filter as NostrFilter;
  }
}
