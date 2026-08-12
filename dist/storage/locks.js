"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataDirLock = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
class DataDirLock {
    lockFilePath;
    released = false;
    constructor(dataDir) {
        this.lockFilePath = node_path_1.default.join(dataDir, 'nostr-blockchain.lock');
        node_fs_1.default.mkdirSync(dataDir, { recursive: true });
        this.acquire();
    }
    close() {
        if (this.released) {
            return;
        }
        this.released = true;
        try {
            node_fs_1.default.rmSync(this.lockFilePath, { force: true });
        }
        catch {
            return;
        }
    }
    acquire() {
        const payload = JSON.stringify({
            pid: process.pid,
            createdAt: new Date().toISOString(),
            platform: process.platform
        });
        try {
            const fileDescriptor = node_fs_1.default.openSync(this.lockFilePath, 'wx');
            node_fs_1.default.writeFileSync(fileDescriptor, payload, 'utf8');
            node_fs_1.default.closeSync(fileDescriptor);
            return;
        }
        catch (error) {
            if (!isAlreadyExistsError(error)) {
                throw error;
            }
        }
        throw new Error(`network data dir already locked: ${this.lockFilePath}`);
    }
}
exports.DataDirLock = DataDirLock;
function isAlreadyExistsError(error) {
    return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}
