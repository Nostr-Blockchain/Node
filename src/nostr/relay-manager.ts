import WebSocket from 'ws';

import { NostrEvent } from '../consensus/nip01';
import { parseStrictJson } from './strict-json';
import { buildRelayListFetch, ExactFetchRequest, NostrFilter } from './subscriptions';

export type RelayClass = 'FULL_CHAIN' | 'GOSSIP' | 'LOCAL_EMBEDDED';

export interface RelayConfig {
  url: string;
  relayClass: RelayClass;
  writable: boolean;
}

export interface RelayManagerHandlers {
  onEvent(event: NostrEvent, relayUrl: string): void;
  onNotice?(relayUrl: string, notice: string): void;
}

interface RelayPeerState {
  readonly config: RelayConfig;
  readonly normalizedUrl: string;
  socket: WebSocket | null;
  connected: boolean;
  lastConnectedMs: number | null;
  lastError: string | null;
  score: number;
  readOk: boolean;
  writeOk: boolean;
  backoffUntilMs: number;
  consecutiveFailures: number;
}

const MAX_DISCOVERED_RELAY_CANDIDATES = 128;

export class RelayManager {
  private readonly relays = new Map<string, RelayPeerState>();
  private readonly configs: RelayConfig[];
  private readonly handlers: RelayManagerHandlers;
  private readonly discoveredCandidates = new Set<string>();

  public constructor(configs: RelayConfig[], handlers: RelayManagerHandlers) {
    this.configs = deduplicateRelayConfigs(configs);
    this.handlers = handlers;
    for (const config of this.configs) {
      const normalizedUrl = normalizeRelayUrl(config.url);
      this.relays.set(normalizedUrl, {
        config: { ...config, url: normalizedUrl },
        normalizedUrl,
        socket: null,
        connected: false,
        lastConnectedMs: null,
        lastError: null,
        score: 0,
        readOk: false,
        writeOk: false,
        backoffUntilMs: 0,
        consecutiveFailures: 0
      });
    }
  }

  public async connectAll(): Promise<void> {
    await Promise.all(this.configs.map((config) => this.connectRelay(config)));
  }

  public publishEvent(event: NostrEvent, options?: { excludeRelayUrl?: string | null; relayUrls?: readonly string[] }): void {
    const message = JSON.stringify(['EVENT', event]);
    const targetRelays = this.selectTargetRelays(options?.relayUrls);
    const excludedUrl = options?.excludeRelayUrl === undefined || options.excludeRelayUrl === null ? null : normalizeRelayUrl(options.excludeRelayUrl);
    for (const relay of targetRelays) {
      if (!relay.config.writable || relay.socket === null || relay.normalizedUrl === excludedUrl) {
        continue;
      }
      try {
        relay.socket.send(message);
      } catch (error) {
        this.noteRelayFailure(relay, error);
      }
    }
  }

  public subscribe(subscriptionId: string, filters: readonly NostrFilter[], relayUrls?: readonly string[]): void {
    const message = JSON.stringify(['REQ', subscriptionId, ...filters]);
    for (const relay of this.selectTargetRelays(relayUrls)) {
      if (relay.socket === null) {
        continue;
      }
      try {
        relay.socket.send(message);
      } catch (error) {
        this.noteRelayFailure(relay, error);
      }
    }
  }

  public requestExactEventIds(request: ExactFetchRequest, relayUrls?: readonly string[]): void {
    this.subscribe(request.subscriptionId, request.filters, relayUrls);
  }

  public requestLatestRelayList(pubkey: string, relayUrls?: readonly string[]): void {
    const request = buildRelayListFetch(`relay-list-${pubkey}-${Date.now()}`, pubkey);
    this.requestExactEventIds(request, relayUrls);
  }

  public closeSubscription(subscriptionId: string, relayUrls?: readonly string[]): void {
    const message = JSON.stringify(['CLOSE', subscriptionId]);
    for (const relay of this.selectTargetRelays(relayUrls)) {
      if (relay.socket === null) {
        continue;
      }
      try {
        relay.socket.send(message);
      } catch (error) {
        this.noteRelayFailure(relay, error);
      }
    }
  }

  public getRemoteWriteRelayCount(): number {
    return [...this.relays.values()].filter((relay) => relay.connected && relay.config.writable && relay.config.relayClass !== 'LOCAL_EMBEDDED').length;
  }

  public getConnectedRelayUrls(): string[] {
    return [...this.relays.values()].filter((relay) => relay.connected).map((relay) => relay.normalizedUrl);
  }

  public getRemoteRelayUrls(): string[] {
    return [...this.relays.values()].filter((relay) => relay.connected && relay.config.relayClass !== 'LOCAL_EMBEDDED').map((relay) => relay.normalizedUrl);
  }

  public getRemoteWritableRelayUrls(excludeRelayUrl?: string | null): string[] {
    const excludedUrl = excludeRelayUrl === undefined || excludeRelayUrl === null ? null : normalizeRelayUrl(excludeRelayUrl);
    return [...this.relays.values()]
      .filter((relay) => relay.connected && relay.config.writable && relay.config.relayClass !== 'LOCAL_EMBEDDED' && relay.normalizedUrl !== excludedUrl)
      .map((relay) => relay.normalizedUrl);
  }

  public ingestRelayListUrls(candidateUrls: readonly string[]): string[] {
    const accepted: string[] = [];
    for (const candidateUrl of candidateUrls) {
      try {
        const normalizedUrl = normalizeRelayUrl(candidateUrl);
        if (this.relays.has(normalizedUrl) || this.discoveredCandidates.has(normalizedUrl)) {
          continue;
        }
        if (this.discoveredCandidates.size >= MAX_DISCOVERED_RELAY_CANDIDATES) {
          break;
        }
        this.discoveredCandidates.add(normalizedUrl);
        accepted.push(normalizedUrl);
      } catch {
        continue;
      }
    }
    return accepted;
  }

  public async closeAll(): Promise<void> {
    await Promise.all([...this.relays.values()].map((relay) => new Promise<void>((resolve) => {
      if (relay.socket === null) {
        resolve();
        return;
      }
      if (relay.socket.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      relay.socket.once('close', () => resolve());
      if (relay.socket.readyState === WebSocket.CLOSING) {
        return;
      }
      relay.socket.close();
    })));
    for (const relay of this.relays.values()) {
      relay.socket = null;
      relay.connected = false;
    }
  }

  private connectRelay(config: RelayConfig): Promise<void> {
    return new Promise((resolve) => {
      const normalizedUrl = normalizeRelayUrl(config.url);
      const relay = this.relays.get(normalizedUrl);
      if (relay === undefined) {
        resolve();
        return;
      }
      if (relay.connected || relay.backoffUntilMs > Date.now()) {
        resolve();
        return;
      }
      const socket = new WebSocket(normalizedUrl);
      socket.once('open', () => {
        relay.socket = socket;
        relay.connected = true;
        relay.lastConnectedMs = Date.now();
        relay.consecutiveFailures = 0;
        relay.backoffUntilMs = 0;
        resolve();
      });
      socket.once('error', (error) => {
        this.noteRelayFailure(relay, error);
        resolve();
      });
      socket.on('message', (data) => this.handleMessage(normalizedUrl, String(data)));
      socket.on('close', () => {
        relay.connected = false;
        relay.socket = null;
      });
    });
  }

  private handleMessage(relayUrl: string, rawMessage: string): void {
    let parsed: unknown;
    try {
      parsed = parseStrictJson(rawMessage);
    } catch {
      return;
    }
    if (!Array.isArray(parsed) || parsed.length < 1 || typeof parsed[0] !== 'string') {
      return;
    }
    const type = parsed[0];
    if (type === 'EVENT' && parsed.length >= 3 && typeof parsed[1] === 'string' && typeof parsed[2] === 'object' && parsed[2] !== null) {
      const relay = this.relays.get(relayUrl);
      if (relay !== undefined) {
        relay.score = Math.min(relay.score + 1, 100);
        relay.readOk = true;
      }
      this.handlers.onEvent(parsed[2] as NostrEvent, relayUrl);
      return;
    }
    if (type === 'NOTICE' && parsed.length >= 2 && typeof parsed[1] === 'string') {
      this.handlers.onNotice?.(relayUrl, parsed[1]);
      return;
    }
    if (type === 'OK' && parsed.length >= 4 && typeof parsed[2] === 'boolean') {
      const relay = this.relays.get(relayUrl);
      if (relay !== undefined && parsed[2] === true) {
        relay.writeOk = true;
      }
    }
  }

  private noteRelayFailure(relay: RelayPeerState, error: unknown): void {
    relay.connected = false;
    relay.socket = null;
    relay.lastError = error instanceof Error ? error.message : String(error);
    relay.consecutiveFailures += 1;
    relay.score = Math.max(relay.score - 5, -100);
    relay.backoffUntilMs = Date.now() + Math.min(60_000, 1_000 * (2 ** Math.min(relay.consecutiveFailures, 6)));
  }

  private selectTargetRelays(relayUrls?: readonly string[]): RelayPeerState[] {
    if (relayUrls === undefined) {
      return [...this.relays.values()];
    }
    const normalizedTargets = new Set(relayUrls.map((relayUrl) => normalizeRelayUrl(relayUrl)));
    return [...this.relays.values()].filter((relay) => normalizedTargets.has(relay.normalizedUrl));
  }
}

export function normalizeRelayUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    throw new Error(`unsupported relay protocol: ${parsed.protocol}`);
  }
  parsed.hash = '';
  parsed.search = '';
  if (parsed.pathname === '') {
    parsed.pathname = '/';
  }
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  return parsed.toString();
}

function deduplicateRelayConfigs(configs: readonly RelayConfig[]): RelayConfig[] {
  const deduplicated = new Map<string, RelayConfig>();
  for (const config of configs) {
    const normalizedUrl = normalizeRelayUrl(config.url);
    deduplicated.set(normalizedUrl, { ...config, url: normalizedUrl });
  }
  return [...deduplicated.values()];
}
