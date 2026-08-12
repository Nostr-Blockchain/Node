"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RelayManager = void 0;
exports.normalizeRelayUrl = normalizeRelayUrl;
const ws_1 = __importDefault(require("ws"));
const strict_json_1 = require("./strict-json");
const subscriptions_1 = require("./subscriptions");
const MAX_DISCOVERED_RELAY_CANDIDATES = 128;
class RelayManager {
    relays = new Map();
    configs;
    handlers;
    discoveredCandidates = new Set();
    constructor(configs, handlers) {
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
    async connectAll() {
        await Promise.all(this.configs.map((config) => this.connectRelay(config)));
    }
    publishEvent(event, options) {
        const message = JSON.stringify(['EVENT', event]);
        const targetRelays = this.selectTargetRelays(options?.relayUrls);
        const excludedUrl = options?.excludeRelayUrl === undefined || options.excludeRelayUrl === null ? null : normalizeRelayUrl(options.excludeRelayUrl);
        for (const relay of targetRelays) {
            if (!relay.config.writable || relay.socket === null || relay.normalizedUrl === excludedUrl) {
                continue;
            }
            try {
                relay.socket.send(message);
            }
            catch (error) {
                this.noteRelayFailure(relay, error);
            }
        }
    }
    subscribe(subscriptionId, filters, relayUrls) {
        const message = JSON.stringify(['REQ', subscriptionId, ...filters]);
        for (const relay of this.selectTargetRelays(relayUrls)) {
            if (relay.socket === null) {
                continue;
            }
            try {
                relay.socket.send(message);
            }
            catch (error) {
                this.noteRelayFailure(relay, error);
            }
        }
    }
    requestExactEventIds(request, relayUrls) {
        this.subscribe(request.subscriptionId, request.filters, relayUrls);
    }
    requestLatestRelayList(pubkey, relayUrls) {
        const request = (0, subscriptions_1.buildRelayListFetch)(`relay-list-${pubkey}-${Date.now()}`, pubkey);
        this.requestExactEventIds(request, relayUrls);
    }
    closeSubscription(subscriptionId, relayUrls) {
        const message = JSON.stringify(['CLOSE', subscriptionId]);
        for (const relay of this.selectTargetRelays(relayUrls)) {
            if (relay.socket === null) {
                continue;
            }
            try {
                relay.socket.send(message);
            }
            catch (error) {
                this.noteRelayFailure(relay, error);
            }
        }
    }
    getRemoteWriteRelayCount() {
        return [...this.relays.values()].filter((relay) => relay.connected && relay.config.writable && relay.config.relayClass !== 'LOCAL_EMBEDDED').length;
    }
    getConnectedRelayUrls() {
        return [...this.relays.values()].filter((relay) => relay.connected).map((relay) => relay.normalizedUrl);
    }
    getRemoteRelayUrls() {
        return [...this.relays.values()].filter((relay) => relay.connected && relay.config.relayClass !== 'LOCAL_EMBEDDED').map((relay) => relay.normalizedUrl);
    }
    getRemoteWritableRelayUrls(excludeRelayUrl) {
        const excludedUrl = excludeRelayUrl === undefined || excludeRelayUrl === null ? null : normalizeRelayUrl(excludeRelayUrl);
        return [...this.relays.values()]
            .filter((relay) => relay.connected && relay.config.writable && relay.config.relayClass !== 'LOCAL_EMBEDDED' && relay.normalizedUrl !== excludedUrl)
            .map((relay) => relay.normalizedUrl);
    }
    ingestRelayListUrls(candidateUrls) {
        const accepted = [];
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
            }
            catch {
                continue;
            }
        }
        return accepted;
    }
    async closeAll() {
        await Promise.all([...this.relays.values()].map((relay) => new Promise((resolve) => {
            if (relay.socket === null) {
                resolve();
                return;
            }
            if (relay.socket.readyState === ws_1.default.CLOSED) {
                resolve();
                return;
            }
            relay.socket.once('close', () => resolve());
            if (relay.socket.readyState === ws_1.default.CLOSING) {
                return;
            }
            relay.socket.close();
        })));
        for (const relay of this.relays.values()) {
            relay.socket = null;
            relay.connected = false;
        }
    }
    connectRelay(config) {
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
            const socket = new ws_1.default(normalizedUrl);
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
    handleMessage(relayUrl, rawMessage) {
        let parsed;
        try {
            parsed = (0, strict_json_1.parseStrictJson)(rawMessage);
        }
        catch {
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
            this.handlers.onEvent(parsed[2], relayUrl);
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
    noteRelayFailure(relay, error) {
        relay.connected = false;
        relay.socket = null;
        relay.lastError = error instanceof Error ? error.message : String(error);
        relay.consecutiveFailures += 1;
        relay.score = Math.max(relay.score - 5, -100);
        relay.backoffUntilMs = Date.now() + Math.min(60_000, 1_000 * (2 ** Math.min(relay.consecutiveFailures, 6)));
    }
    selectTargetRelays(relayUrls) {
        if (relayUrls === undefined) {
            return [...this.relays.values()];
        }
        const normalizedTargets = new Set(relayUrls.map((relayUrl) => normalizeRelayUrl(relayUrl)));
        return [...this.relays.values()].filter((relay) => normalizedTargets.has(relay.normalizedUrl));
    }
}
exports.RelayManager = RelayManager;
function normalizeRelayUrl(url) {
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
function deduplicateRelayConfigs(configs) {
    const deduplicated = new Map();
    for (const config of configs) {
        const normalizedUrl = normalizeRelayUrl(config.url);
        deduplicated.set(normalizedUrl, { ...config, url: normalizedUrl });
    }
    return [...deduplicated.values()];
}
