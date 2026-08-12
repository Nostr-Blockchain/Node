"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmbeddedRelay = void 0;
const node_http_1 = require("node:http");
const ws_1 = require("ws");
const strict_json_1 = require("./strict-json");
const subscriptions_1 = require("./subscriptions");
class EmbeddedRelay {
    webSocketServer;
    server = (0, node_http_1.createServer)();
    store;
    constructor(store) {
        this.store = store;
        this.webSocketServer = new ws_1.WebSocketServer({ noServer: true, maxPayload: 65_536 });
        this.server.on('request', (request, response) => this.handleHttpRequest(request, response));
        this.server.on('upgrade', (request, socket, head) => {
            this.webSocketServer.handleUpgrade(request, socket, head, (client) => {
                this.webSocketServer.emit('connection', client, request);
            });
        });
        this.webSocketServer.on('connection', (socket) => this.handleConnection(socket));
    }
    listen(port, host = '127.0.0.1') {
        return new Promise((resolve) => this.server.listen(port, host, () => resolve()));
    }
    close() {
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
                    if (closeError)
                        reject(closeError);
                    else
                        resolve();
                });
            });
        });
    }
    handleConnection(socket) {
        const subscriptions = new Set();
        socket.on('message', (raw) => {
            let parsed;
            try {
                parsed = (0, strict_json_1.parseStrictJson)(String(raw));
            }
            catch {
                socket.send(JSON.stringify(['NOTICE', 'bad-message']));
                return;
            }
            if (!Array.isArray(parsed) || parsed.length === 0 || typeof parsed[0] !== 'string') {
                socket.send(JSON.stringify(['NOTICE', 'bad-message']));
                return;
            }
            const type = parsed[0];
            if (type === 'EVENT' && parsed.length === 2 && typeof parsed[1] === 'object' && parsed[1] !== null) {
                const result = this.store.saveIncomingEvent(parsed[1]);
                socket.send(JSON.stringify(['OK', parsed[1].id, result.accepted, result.message]));
                return;
            }
            if (type === 'REQ' && parsed.length >= 2 && typeof parsed[1] === 'string') {
                const subscriptionId = parsed[1];
                if (Buffer.byteLength(subscriptionId, 'utf8') > subscriptions_1.MAX_SUBSCRIPTION_ID_BYTES) {
                    socket.send(JSON.stringify(['CLOSED', subscriptionId, 'invalid-subscription-id']));
                    return;
                }
                if (subscriptions.size >= 64 && !subscriptions.has(subscriptionId)) {
                    socket.send(JSON.stringify(['CLOSED', subscriptionId, 'too-many-subscriptions']));
                    return;
                }
                const candidateFilters = parsed.slice(2);
                if (candidateFilters.length === 0 || candidateFilters.length > subscriptions_1.MAX_RELAY_FILTERS) {
                    socket.send(JSON.stringify(['CLOSED', subscriptionId, 'invalid-filter-count']));
                    return;
                }
                const filters = candidateFilters.map((filter) => this.validateFilter(filter)).filter((filter) => filter !== null);
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
    handleHttpRequest(request, response) {
        const accept = request.headers.accept ?? '';
        if (request.method === 'GET' && typeof accept === 'string' && accept.includes('application/nostr+json')) {
            response.writeHead(200, { 'content-type': 'application/nostr+json; charset=utf-8' });
            response.end(JSON.stringify(this.store.getRelayInfo()));
            return;
        }
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('not found');
    }
    validateFilter(candidate) {
        if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
            return null;
        }
        const filter = candidate;
        if (filter.ids !== undefined && (!Array.isArray(filter.ids) || filter.ids.length > subscriptions_1.MAX_FILTER_IDS || !filter.ids.every((value) => typeof value === 'string'))) {
            return null;
        }
        if (filter.authors !== undefined && (!Array.isArray(filter.authors) || filter.authors.length > subscriptions_1.MAX_FILTER_AUTHORS || !filter.authors.every((value) => typeof value === 'string'))) {
            return null;
        }
        if (filter.kinds !== undefined && (!Array.isArray(filter.kinds) || !filter.kinds.every((value) => Number.isInteger(value)))) {
            return null;
        }
        if (filter['#t'] !== undefined && (!Array.isArray(filter['#t']) || !filter['#t'].every((value) => typeof value === 'string'))) {
            return null;
        }
        if (filter.limit !== undefined && (!Number.isInteger(filter.limit) || Number(filter.limit) < 0 || Number(filter.limit) > subscriptions_1.MAX_HISTORICAL_LIMIT)) {
            return null;
        }
        return filter;
    }
}
exports.EmbeddedRelay = EmbeddedRelay;
