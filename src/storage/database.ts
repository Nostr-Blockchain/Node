import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';

export class NodeDatabase {
  public readonly connection: Database.Database;
  private closed = false;

  public constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    let connection: Database.Database | null = null;
    try {
      connection = new Database(databasePath);
      this.connection = connection;
      this.applyRequiredPragmas();
      this.verifyRequiredPragmas();
      this.connection.exec(SCHEMA_SQL);
      this.connection.prepare('INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)').run('schema_version', Buffer.from(String(SCHEMA_VERSION), 'utf8'));
    } catch (error) {
      if (connection !== null && connection.open) {
        connection.close();
      }
      throw error;
    }
  }

  public close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.connection.close();
  }

  private applyRequiredPragmas(): void {
    this.connection.pragma('journal_mode = WAL');
    this.connection.pragma('synchronous = FULL');
    this.connection.pragma('foreign_keys = ON');
    this.connection.pragma('busy_timeout = 5000');
  }

  private verifyRequiredPragmas(): void {
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
