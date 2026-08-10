import WebSocket from 'ws';

import { NostrEvent } from '../consensus/nip01';
import { parseStrictJson } from './strict-json';
import { NostrFilter, NostrSubscription } from './subscriptions';

export type RelayClass = 'FULL_CHAIN' | 'GOSSIP' | 'LOCAL_EMBEDDED';

export interface RelayConfig {
  url: string;
  relayClass: RelayClass;
  writable: boolean;
}

export interface RelayManagerHandlers {
  onEvent(event: NostrEvent): void;
  onNotice?(relayUrl: string, notice: string): void;
}

export class RelayManager {
  private readonly relays = new Map<string, WebSocket>();
  private readonly configs: RelayConfig[];
  private readonly handlers: RelayManagerHandlers;

  public constructor(configs: RelayConfig[], handlers: RelayManagerHandlers) {
    this.configs = configs;
    this.handlers = handlers;
  }

  public async connectAll(): Promise<void> {
    await Promise.all(this.configs.map((config) => this.connectRelay(config)));
  }

  public publishEvent(event: NostrEvent): void {
    const message = JSON.stringify(['EVENT', event]);
    for (const config of this.configs) {
      if (!config.writable) {
        continue;
      }
      this.relays.get(config.url)?.send(message);
    }
  }

  public subscribe(subscriptionId: string, filters: NostrFilter[]): void {
    const message = JSON.stringify(['REQ', subscriptionId, ...filters]);
    for (const socket of this.relays.values()) {
      socket.send(message);
    }
  }

  public closeSubscription(subscriptionId: string): void {
    const message = JSON.stringify(['CLOSE', subscriptionId]);
    for (const socket of this.relays.values()) {
      socket.send(message);
    }
  }

  public async closeAll(): Promise<void> {
    await Promise.all([...this.relays.values()].map((socket) => new Promise<void>((resolve) => {
      socket.once('close', () => resolve());
      socket.close();
    })));
    this.relays.clear();
  }

  private connectRelay(config: RelayConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(config.url);
      socket.once('open', () => {
        this.relays.set(config.url, socket);
        resolve();
      });
      socket.once('error', (error) => reject(error));
      socket.on('message', (data) => this.handleMessage(config.url, String(data)));
      socket.on('close', () => {
        this.relays.delete(config.url);
      });
    });
  }

  private handleMessage(relayUrl: string, rawMessage: string): void {
    const parsed = parseStrictJson(rawMessage);
    if (!Array.isArray(parsed) || parsed.length < 1 || typeof parsed[0] !== 'string') {
      return;
    }
    const type = parsed[0];
    if (type === 'EVENT' && parsed.length >= 3 && typeof parsed[1] === 'string' && typeof parsed[2] === 'object' && parsed[2] !== null) {
      this.handlers.onEvent(parsed[2] as NostrEvent);
      return;
    }
    if (type === 'NOTICE' && parsed.length >= 2 && typeof parsed[1] === 'string') {
      this.handlers.onNotice?.(relayUrl, parsed[1]);
    }
  }
}
