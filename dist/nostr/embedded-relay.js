"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmbeddedRelay = void 0;
const node_http_1 = require("node:http");
const ws_1 = require("ws");
const strict_json_1 = require("./strict-json");
class EmbeddedRelay {
    webSocketServer;
    server = (0, node_http_1.createServer)();
    store;
    constructor(store) {
        this.store = store;
        this.webSocketServer = new ws_1.WebSocketServer({ noServer: true });
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
        socket.on('message', (raw) => {
            const parsed = (0, strict_json_1.parseStrictJson)(String(raw));
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
                const filters = parsed.slice(2).filter((filter) => typeof filter === 'object' && filter !== null);
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
exports.EmbeddedRelay = EmbeddedRelay;
