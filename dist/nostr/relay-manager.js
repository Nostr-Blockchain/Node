"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RelayManager = void 0;
const ws_1 = __importDefault(require("ws"));
const strict_json_1 = require("./strict-json");
class RelayManager {
    relays = new Map();
    configs;
    handlers;
    constructor(configs, handlers) {
        this.configs = configs;
        this.handlers = handlers;
    }
    async connectAll() {
        await Promise.all(this.configs.map((config) => this.connectRelay(config)));
    }
    publishEvent(event) {
        const message = JSON.stringify(['EVENT', event]);
        for (const config of this.configs) {
            if (!config.writable) {
                continue;
            }
            this.relays.get(config.url)?.send(message);
        }
    }
    subscribe(subscriptionId, filters) {
        const message = JSON.stringify(['REQ', subscriptionId, ...filters]);
        for (const socket of this.relays.values()) {
            socket.send(message);
        }
    }
    closeSubscription(subscriptionId) {
        const message = JSON.stringify(['CLOSE', subscriptionId]);
        for (const socket of this.relays.values()) {
            socket.send(message);
        }
    }
    async closeAll() {
        await Promise.all([...this.relays.values()].map((socket) => new Promise((resolve) => {
            socket.once('close', () => resolve());
            socket.close();
        })));
        this.relays.clear();
    }
    connectRelay(config) {
        return new Promise((resolve, reject) => {
            const socket = new ws_1.default(config.url);
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
    handleMessage(relayUrl, rawMessage) {
        const parsed = (0, strict_json_1.parseStrictJson)(rawMessage);
        if (!Array.isArray(parsed) || parsed.length < 1 || typeof parsed[0] !== 'string') {
            return;
        }
        const type = parsed[0];
        if (type === 'EVENT' && parsed.length >= 3 && typeof parsed[1] === 'string' && typeof parsed[2] === 'object' && parsed[2] !== null) {
            this.handlers.onEvent(parsed[2]);
            return;
        }
        if (type === 'NOTICE' && parsed.length >= 2 && typeof parsed[1] === 'string') {
            this.handlers.onNotice?.(relayUrl, parsed[1]);
        }
    }
}
exports.RelayManager = RelayManager;
