import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';

export class NodeDatabase {
  public readonly connection: Database.Database;

  public constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.connection = new Database(databasePath);
    this.connection.pragma('journal_mode = WAL');
    this.connection.pragma('synchronous = FULL');
    this.connection.pragma('foreign_keys = ON');
    this.connection.pragma('busy_timeout = 5000');
    const mode = this.connection.pragma('journal_mode', { simple: true });
    if (String(mode).toLowerCase() !== 'wal') {
      throw new Error('SQLite WAL mode unavailable');
    }
    this.connection.exec(SCHEMA_SQL);
    this.connection.prepare('INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)').run('schema_version', Buffer.from(String(SCHEMA_VERSION), 'utf8'));
  }

  public close(): void {
    this.connection.close();
  }
}
