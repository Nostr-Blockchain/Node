import Database from 'better-sqlite3';

import { REWARD_OUTPUT_INDEX } from '../consensus/constants';
import { encodeU64, encodeU128, encodeU136, decodeU136, decodeU128, decodeU256, decodeU64, UtxoRecord } from '../consensus/primitives';
import { BlockIndex, BlockIndexEntry } from '../chain/block-index';
import { MemoryUtxoView } from '../state/utxo-view';

export class MetaRepository {
  private readonly database: Database.Database;

  public constructor(database: Database.Database) {
    this.database = database;
  }

  public getText(key: string): string | null {
    const row = this.database.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: Buffer | string } | undefined;
    if (row === undefined) {
      return null;
    }
    return Buffer.isBuffer(row.value) ? row.value.toString('utf8') : String(row.value);
  }

  public setText(key: string, value: string): void {
    this.database.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  public getBigInt(key: string): bigint {
    const text = this.getText(key);
    return text === null ? 0n : BigInt(text);
  }

  public setBigInt(key: string, value: bigint): void {
    this.setText(key, value.toString(10));
  }
}

export class UtxoRepository {
  private readonly database: Database.Database;

  public constructor(database: Database.Database) {
    this.database = database;
  }

  public loadView(): MemoryUtxoView {
    const rows = this.database.prepare('SELECT source_id, source_index, owner, amount_be16, created_height, is_reward FROM utxos').all() as Array<Record<string, Buffer | number>>;
    return new MemoryUtxoView(rows.map((row) => ({
      sourceId: row.source_id as Buffer,
      outputIndex: row.source_index as number,
      owner: row.owner as Buffer,
      amount: decodeU128(row.amount_be16 as Buffer, 0),
      createdHeight: BigInt(row.created_height as number),
      isReward: Number(row.is_reward) === 1
    })));
  }

  public replaceAll(utxos: readonly UtxoRecord[]): void {
    const clear = this.database.prepare('DELETE FROM utxos');
    const insert = this.database.prepare('INSERT INTO utxos(source_id, source_index, owner, amount_be16, created_height, is_reward) VALUES (?, ?, ?, ?, ?, ?)');
    const transaction = this.database.transaction(() => {
      clear.run();
      for (const utxo of utxos) {
        insert.run(utxo.sourceId, utxo.outputIndex, utxo.owner, encodeU128(utxo.amount), Number(utxo.createdHeight), utxo.isReward ? 1 : 0);
      }
    });
    transaction();
  }
}

export class BlockRepository {
  private readonly database: Database.Database;

  public constructor(database: Database.Database) {
    this.database = database;
  }

  public loadIndex(): BlockIndex {
    const index = new BlockIndex();
    const rows = this.database.prepare('SELECT block_id, parent_id, height, cumulative_work_be32, validation_state, active, invalid_code FROM blocks').all() as Array<Record<string, Buffer | number | string | null>>;
    for (const row of rows) {
      const height = row.height === null ? null : BigInt(row.height as number);
      index.upsert({
        blockId: (row.block_id as Buffer).toString('hex'),
        parentId: row.parent_id === null ? null : (row.parent_id as Buffer).toString('hex'),
        height,
        cumulativeWork: row.cumulative_work_be32 === null ? height : decodeU256(row.cumulative_work_be32 as Buffer),
        validationState: row.validation_state as BlockIndexEntry['validationState'],
        active: Number(row.active) === 1,
        invalidCode: row.invalid_code === null ? null : String(row.invalid_code)
      });
    }
    return index;
  }
}

export class EventRepository {
  private readonly database: Database.Database;

  public constructor(database: Database.Database) {
    this.database = database;
  }

  public insertEvent(idHex: string, kind: number, pubkeyHex: string, createdAt: number, chainScope: string, eventJson: string, objectState: string, invalidCode: string | null, receivedSeq: bigint): void {
    this.database.prepare(
      'INSERT OR REPLACE INTO events(id, kind, pubkey, created_at, chain_scope, event_json, object_state, invalid_code, received_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(Buffer.from(idHex, 'hex'), kind, Buffer.from(pubkeyHex, 'hex'), createdAt, chainScope, eventJson, objectState, invalidCode, Number(receivedSeq));
  }
}
