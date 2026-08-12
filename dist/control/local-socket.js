"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalControlSocket = void 0;
exports.getControlSocketPath = getControlSocketPath;
exports.hasControlSocket = hasControlSocket;
exports.sendLocalControlRequest = sendLocalControlRequest;
exports.readControlMetadata = readControlMetadata;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_net_1 = __importDefault(require("node:net"));
const node_path_1 = __importDefault(require("node:path"));
class LocalControlSocket {
    metadataPath;
    handlers;
    host = '127.0.0.1';
    token = node_crypto_1.default.randomBytes(32).toString('hex');
    server = node_net_1.default.createServer((socket) => this.handleSocket(socket));
    constructor(dataDir, handlers) {
        this.metadataPath = getControlSocketPath(dataDir);
        this.handlers = handlers;
    }
    async listen() {
        await new Promise((resolve, reject) => {
            this.server.once('error', reject);
            this.server.listen(0, this.host, () => {
                this.server.off('error', reject);
                resolve();
            });
        });
        const address = this.server.address();
        if (address === null || typeof address === 'string') {
            throw new Error('control socket failed to bind a local TCP address');
        }
        writeControlMetadata(this.metadataPath, {
            host: this.host,
            port: address.port,
            token: this.token,
            pid: process.pid,
            createdAt: new Date().toISOString()
        });
    }
    async close() {
        node_fs_1.default.rmSync(this.metadataPath, { force: true });
        if (!this.server.listening) {
            return;
        }
        await new Promise((resolve, reject) => {
            this.server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });
    }
    handleSocket(socket) {
        let rawMessage = '';
        socket.setEncoding('utf8');
        socket.on('data', (chunk) => {
            rawMessage += chunk;
        });
        socket.on('end', () => {
            const response = this.dispatch(rawMessage);
            socket.end(`${JSON.stringify(response, jsonBigIntReplacer)}\n`);
        });
        socket.on('error', () => undefined);
    }
    dispatch(rawMessage) {
        try {
            let parsed;
            try {
                parsed = JSON.parse(rawMessage.trim());
            }
            catch {
                return { ok: false, code: 'CONTROL_BAD_REQUEST' };
            }
            if (parsed.token !== this.token) {
                return { ok: false, code: 'CONTROL_UNAUTHORIZED' };
            }
            if (parsed.command === 'status') {
                return { ok: true, code: 'OK', payload: this.handlers.onStatus() };
            }
            if (parsed.command === 'stop') {
                this.handlers.onStop();
                return { ok: true, code: 'STOPPING' };
            }
            if (parsed.command === 'signer_unlock') {
                if (typeof parsed.password !== 'string' || parsed.password.length === 0) {
                    return { ok: false, code: 'CONTROL_BAD_REQUEST' };
                }
                if (this.handlers.onSignerUnlock === undefined) {
                    return { ok: false, code: 'BOOT_SIGNER_UNAVAILABLE' };
                }
                return { ok: true, code: 'OK', payload: this.handlers.onSignerUnlock(parsed.password) };
            }
            if (parsed.command === 'signer_lock') {
                if (this.handlers.onSignerLock === undefined) {
                    return { ok: false, code: 'BOOT_SIGNER_UNAVAILABLE' };
                }
                return { ok: true, code: 'OK', payload: this.handlers.onSignerLock() };
            }
            if (parsed.command === 'wallet_address') {
                if (this.handlers.onWalletAddress === undefined) {
                    return { ok: false, code: 'CONTROL_UNKNOWN_COMMAND' };
                }
                return { ok: true, code: 'OK', payload: this.handlers.onWalletAddress() };
            }
            if (parsed.command === 'wallet_balance') {
                if (this.handlers.onWalletBalance === undefined) {
                    return { ok: false, code: 'CONTROL_UNKNOWN_COMMAND' };
                }
                return { ok: true, code: 'OK', payload: this.handlers.onWalletBalance() };
            }
            if (parsed.command === 'wallet_utxos') {
                if (this.handlers.onWalletUtxos === undefined) {
                    return { ok: false, code: 'CONTROL_UNKNOWN_COMMAND' };
                }
                return { ok: true, code: 'OK', payload: this.handlers.onWalletUtxos() };
            }
            if (parsed.command === 'wallet_send') {
                if (this.handlers.onWalletSend === undefined || typeof parsed.to !== 'string' || typeof parsed.amount !== 'string' || typeof parsed.priorityFee !== 'string') {
                    return { ok: false, code: 'CONTROL_BAD_REQUEST' };
                }
                return { ok: true, code: 'OK', payload: this.handlers.onWalletSend({ to: parsed.to, amount: parsed.amount, priorityFee: parsed.priorityFee }) };
            }
            return { ok: false, code: 'CONTROL_UNKNOWN_COMMAND' };
        }
        catch (error) {
            return { ok: false, code: error instanceof Error ? error.message : 'CONTROL_INTERNAL_ERROR' };
        }
    }
}
exports.LocalControlSocket = LocalControlSocket;
function getControlSocketPath(dataDir) {
    return node_path_1.default.join(dataDir, 'control.sock');
}
function hasControlSocket(dataDir) {
    return node_fs_1.default.existsSync(getControlSocketPath(dataDir));
}
async function sendLocalControlRequest(dataDir, command, payload) {
    const metadata = readControlMetadata(dataDir);
    return await new Promise((resolve, reject) => {
        const socket = node_net_1.default.createConnection(metadata.port, metadata.host);
        let rawResponse = '';
        socket.setEncoding('utf8');
        socket.once('connect', () => {
            socket.end(`${JSON.stringify({ token: metadata.token, command, ...(payload ?? {}) })}\n`);
        });
        socket.on('data', (chunk) => {
            rawResponse += chunk;
        });
        socket.once('end', () => {
            try {
                resolve(JSON.parse(rawResponse.trim()));
            }
            catch (error) {
                reject(error);
            }
        });
        socket.once('error', reject);
    });
}
function readControlMetadata(dataDir) {
    const metadataPath = getControlSocketPath(dataDir);
    if (!node_fs_1.default.existsSync(metadataPath)) {
        throw new Error('CONTROL_UNAVAILABLE');
    }
    const parsedMetadata = JSON.parse(node_fs_1.default.readFileSync(metadataPath, 'utf8'));
    validateControlMetadata(parsedMetadata);
    return parsedMetadata;
}
function writeControlMetadata(metadataPath, metadata) {
    node_fs_1.default.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    if (process.platform !== 'win32') {
        node_fs_1.default.chmodSync(metadataPath, 0o600);
    }
}
function jsonBigIntReplacer(_key, value) {
    return typeof value === 'bigint' ? value.toString(10) : value;
}
function validateControlMetadata(metadata) {
    if (metadata.host !== '127.0.0.1') {
        throw new Error('CONTROL_UNAVAILABLE');
    }
    if (!Number.isInteger(metadata.port) || metadata.port === undefined || metadata.port < 1 || metadata.port > 65_535) {
        throw new Error('CONTROL_UNAVAILABLE');
    }
    if (typeof metadata.token !== 'string' || !/^[0-9a-f]{64}$/u.test(metadata.token)) {
        throw new Error('CONTROL_UNAVAILABLE');
    }
    if (!Number.isInteger(metadata.pid) || metadata.pid === undefined || metadata.pid < 1) {
        throw new Error('CONTROL_UNAVAILABLE');
    }
    if (typeof metadata.createdAt !== 'string' || Number.isNaN(Date.parse(metadata.createdAt))) {
        throw new Error('CONTROL_UNAVAILABLE');
    }
}
