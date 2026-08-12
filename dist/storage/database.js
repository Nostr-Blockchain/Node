"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodeDatabase = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const schema_1 = require("./schema");
class NodeDatabase {
    connection;
    closed = false;
    constructor(databasePath) {
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(databasePath), { recursive: true });
        let connection = null;
        try {
            connection = new better_sqlite3_1.default(databasePath);
            this.connection = connection;
            this.applyRequiredPragmas();
            this.verifyRequiredPragmas();
            this.connection.exec(schema_1.SCHEMA_SQL);
            this.connection.prepare('INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)').run('schema_version', Buffer.from(String(schema_1.SCHEMA_VERSION), 'utf8'));
        }
        catch (error) {
            if (connection !== null && connection.open) {
                connection.close();
            }
            throw error;
        }
    }
    close() {
        if (this.closed) {
            return;
        }
        this.closed = true;
        this.connection.close();
    }
    applyRequiredPragmas() {
        this.connection.pragma('journal_mode = WAL');
        this.connection.pragma('synchronous = FULL');
        this.connection.pragma('foreign_keys = ON');
        this.connection.pragma('busy_timeout = 5000');
    }
    verifyRequiredPragmas() {
        const journalMode = this.connection.pragma('journal_mode', { simple: true });
        const synchronous = this.connection.pragma('synchronous', { simple: true });
        const foreignKeys = this.connection.pragma('foreign_keys', { simple: true });
        const busyTimeout = this.connection.pragma('busy_timeout', { simple: true });
        if (String(journalMode).toLowerCase() !== 'wal') {
            throw new Error('SQLite WAL mode unavailable');
        }
        if (Number(synchronous) !== 2) {
            throw new Error(`SQLite synchronous pragma mismatch: expected FULL(2), got ${String(synchronous)}`);
        }
        if (Number(foreignKeys) !== 1) {
            throw new Error(`SQLite foreign_keys pragma mismatch: expected 1, got ${String(foreignKeys)}`);
        }
        if (Number(busyTimeout) !== 5000) {
            throw new Error(`SQLite busy_timeout pragma mismatch: expected 5000, got ${String(busyTimeout)}`);
        }
    }
}
exports.NodeDatabase = NodeDatabase;
