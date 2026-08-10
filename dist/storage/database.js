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
    constructor(databasePath) {
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(databasePath), { recursive: true });
        this.connection = new better_sqlite3_1.default(databasePath);
        this.connection.pragma('journal_mode = WAL');
        this.connection.pragma('synchronous = FULL');
        this.connection.pragma('foreign_keys = ON');
        this.connection.pragma('busy_timeout = 5000');
        const mode = this.connection.pragma('journal_mode', { simple: true });
        if (String(mode).toLowerCase() !== 'wal') {
            throw new Error('SQLite WAL mode unavailable');
        }
        this.connection.exec(schema_1.SCHEMA_SQL);
        this.connection.prepare('INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)').run('schema_version', Buffer.from(String(schema_1.SCHEMA_VERSION), 'utf8'));
    }
    close() {
        this.connection.close();
    }
}
exports.NodeDatabase = NodeDatabase;
