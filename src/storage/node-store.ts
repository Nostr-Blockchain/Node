import Database from 'better-sqlite3';
import path from 'node:path';

import { ConnectedBlock, ChainStateSnapshot } from '../chain/chain-executor';
import { ParsedBlock } from '../consensus/block-codec';
import { MempoolEntry } from '../mempool/mempool';
import { ParsedTransaction } from '../consensus/transaction-codec';
import { NostrEvent } from '../consensus/nip01';
import { NetworkName } from '../networks/params';
import { encodeU128, encodeU136, encodeU256, encodeU64 } from '../consensus/primitives';
import { NodeDatabase } from './database';
import { DataDirLock } from './locks';
import { LEGACY_PROTOTYPE_TABLE_NAMES, PRODUCTION_TABLE_NAMES, REQUIRED_META_KEYS, SCHEMA_VERSION } from './schema';

export interface StoredEventRecord {
  event: NostrEvent;
  receivedSeq: bigint;
}

export class NodeStore {
  private readonly database: NodeDatabase;
  private readonly connection: Database.Database;
  private readonly writableLock: DataDirLock;
  private readonly expectedNetwork: NetworkName;

  public constructor(databasePath: string, expectedNetwork: NetworkName) {
    this.expectedNetwork = expectedNetwork;
    this.writableLock = new DataDirLock(path.dirname(databasePath));
    this.database = new NodeDatabase(databasePath);
    this.connection = this.database.connection;
    try {
      this.assertProductionSchemaCompatibility();
      this.assertMetadataEnvelope();
    } catch (error) {
      this.database.close();
      this.writableLock.close();
      throw error;
    }
  }

  public close(): void {
    try {
      this.database.close();
    } finally {
      this.writableLock.close();
    }
  }

  public getMetaText(key: string): string | null {
    const row = this.connection.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: Buffer | string } | undefined;
    if (row === undefined) {
      return null;
    }
    return Buffer.isBuffer(row.value) ? row.value.toString('utf8') : String(row.value);
  }

  public setMetaText(key: string, value: string): void {
    this.connection.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, Buffer.from(value, 'utf8'));
  }

  public nextReceivedSeq(): bigint {
    const current = this.getMetaText('next_received_seq');
    const value = current === null ? 1n : BigInt(current);
    this.setMetaText('next_received_seq', (value + 1n).toString(10));
    return value;
  }

  public initializeChain(chainIdHex: string, protocolVersion: number): void {
    this.setMetaText('network', this.expectedNetwork);
    this.setMetaText('chain_id', chainIdHex);
    this.setMetaText('protocol_version', String(protocolVersion));
    this.setMetaText('active_tip', chainIdHex);
    this.setMetaText('active_height', '0');
    this.setMetaText('supply', '0');
    this.setMetaText('cumulative_fixed_rewards', '0');
    this.setMetaText('cumulative_minimum_burns', '0');
    this.setMetaText('cumulative_priority_fees', '0');
    this.setMetaText('active_cumulative_work', '0');
    if (this.getMetaText('next_received_seq') === null) {
      this.setMetaText('next_received_seq', '1');
    }
  }

  public validateChainBinding(chainIdHex: string, protocolVersion: number): void {
    this.assertMetadataEnvelope();
    this.assertRequiredMetaPresent();
    const network = this.getRequiredMetaText('network');
    if (network !== this.expectedNetwork) {
      throw new Error(`wrong network metadata: expected ${this.expectedNetwork}, got ${network}`);
    }
    const schemaVersion = Number(this.getRequiredMetaText('schema_version'));
    if (!Number.isInteger(schemaVersion) || schemaVersion !== SCHEMA_VERSION) {
      throw new Error(`wrong schema version: expected ${SCHEMA_VERSION}, got ${String(schemaVersion)}`);
    }
    const storedChainId = this.getRequiredMetaText('chain_id');
    if (storedChainId !== chainIdHex) {
      throw new Error('stored genesis binding does not match selected genesis');
    }
    const storedProtocolVersion = Number(this.getRequiredMetaText('protocol_version'));
    if (!Number.isInteger(storedProtocolVersion) || storedProtocolVersion !== protocolVersion) {
      throw new Error(`wrong protocol version: expected ${protocolVersion}, got ${String(storedProtocolVersion)}`);
    }
  }

  public persistEvent(event: NostrEvent, chainScope: string, objectState: string, invalidCode: string | null, receivedSeq: bigint): void {
    this.connection.prepare(
      'INSERT OR REPLACE INTO events(id, kind, pubkey, created_at, chain_scope, event_json, object_state, invalid_code, received_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      Buffer.from(event.id, 'hex'),
      event.kind,
      Buffer.from(event.pubkey, 'hex'),
      event.created_at,
      chainScope,
      JSON.stringify(event),
      objectState,
      invalidCode,
      Number(receivedSeq)
    );
  }

  public persistTransaction(parsed: ParsedTransaction): void {
    const insertTx = this.connection.prepare('INSERT OR REPLACE INTO transactions(tx_id, author, input_count, output_count) VALUES (?, ?, ?, ?)');
    const deleteInputs = this.connection.prepare('DELETE FROM tx_inputs WHERE tx_id = ?');
    const deleteOutputs = this.connection.prepare('DELETE FROM tx_outputs WHERE tx_id = ?');
    const insertInput = this.connection.prepare('INSERT INTO tx_inputs(tx_id, input_pos, source_id, source_index) VALUES (?, ?, ?, ?)');
    const insertOutput = this.connection.prepare('INSERT INTO tx_outputs(tx_id, output_index, owner, amount_be16) VALUES (?, ?, ?, ?)');
    const txId = Buffer.from(parsed.event.id, 'hex');

    const transaction = this.connection.transaction(() => {
      insertTx.run(txId, Buffer.from(parsed.event.pubkey, 'hex'), parsed.data.inputs.length, parsed.data.outputs.length);
      deleteInputs.run(txId);
      deleteOutputs.run(txId);
      parsed.data.inputs.forEach((input, index) => {
        insertInput.run(txId, index, Buffer.from(input.sourceId), input.outputIndex);
      });
      parsed.data.outputs.forEach((output, index) => {
        insertOutput.run(txId, index, Buffer.from(output.ownerPubkey), encodeU128(output.amount));
      });
    });

    transaction();
  }

  public persistBlockStructure(
    parsed: ParsedBlock,
    metadata: {
      height: bigint | null;
      validationState: string;
      invalidCode: string | null;
      active: boolean;
      workDifficulty: number | null;
      medianTimePast: number | null;
      creditedWork: bigint | null;
      cumulativeWork: bigint | null;
      totalBurn: bigint | null;
      totalPriority: bigint | null;
      rewardAmount: bigint | null;
      supplyAfter: bigint | null;
    }
  ): void {
    this.connection.prepare(
      'INSERT OR REPLACE INTO blocks(block_id, parent_id, miner_pubkey, height, nonce_be8, work_difficulty, median_time_past, credited_work_be32, cumulative_work_be32, total_burn_be16, total_priority_be16, reward_amount_be16, supply_after_be16, validation_state, invalid_code, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      Buffer.from(parsed.event.id, 'hex'),
      parsed.parentId === null ? null : Buffer.from(parsed.parentId),
      Buffer.from(parsed.event.pubkey, 'hex'),
      metadata.height === null ? null : Number(metadata.height),
      encodeU64(parsed.nonce),
      metadata.workDifficulty,
      metadata.medianTimePast,
      metadata.creditedWork === null ? null : encodeU256(metadata.creditedWork),
      metadata.cumulativeWork === null ? null : encodeU256(metadata.cumulativeWork),
      metadata.totalBurn === null ? null : encodeU128(metadata.totalBurn),
      metadata.totalPriority === null ? null : encodeU128(metadata.totalPriority),
      metadata.rewardAmount === null ? null : encodeU128(metadata.rewardAmount),
      metadata.supplyAfter === null ? null : encodeU128(metadata.supplyAfter),
      metadata.validationState,
      metadata.invalidCode,
      metadata.active ? 1 : 0
    );

    const deleteRefs = this.connection.prepare('DELETE FROM block_transactions WHERE block_id = ?');
    const insertRef = this.connection.prepare('INSERT INTO block_transactions(block_id, tx_pos, tx_id) VALUES (?, ?, ?)');
    const blockId = Buffer.from(parsed.event.id, 'hex');
    const transaction = this.connection.transaction(() => {
      deleteRefs.run(blockId);
      parsed.txIds.forEach((txId, index) => insertRef.run(blockId, index, Buffer.from(txId)));
    });
    transaction();
  }

  public persistUndo(block: ConnectedBlock, supplyBefore: bigint): void {
    const blockId = Buffer.from(block.blockId, 'hex');
    const deleteSpent = this.connection.prepare('DELETE FROM undo_spent WHERE block_id = ?');
    const deleteCreated = this.connection.prepare('DELETE FROM undo_created WHERE block_id = ?');
    const deleteState = this.connection.prepare('DELETE FROM undo_state WHERE block_id = ?');
    const insertSpent = this.connection.prepare(
      'INSERT INTO undo_spent(block_id, seq, source_id, source_index, owner, amount_be16, created_height, is_reward) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insertCreated = this.connection.prepare(
      'INSERT INTO undo_created(block_id, source_id, source_index) VALUES (?, ?, ?)' 
    );
    const insertState = this.connection.prepare(
      'INSERT INTO undo_state(block_id, supply_before_be16, previous_tip_id, previous_height) VALUES (?, ?, ?, ?)'
    );

    const transaction = this.connection.transaction(() => {
      deleteSpent.run(blockId);
      deleteCreated.run(blockId);
      deleteState.run(blockId);
      block.evaluation.consumedOutpoints.forEach((utxo, index) => {
        insertSpent.run(blockId, index, Buffer.from(utxo.sourceId), utxo.outputIndex, Buffer.from(utxo.owner), encodeU128(utxo.amount), Number(utxo.createdHeight), utxo.isReward ? 1 : 0);
      });
      block.evaluation.createdTxOutputs.forEach((utxo) => {
        insertCreated.run(blockId, Buffer.from(utxo.sourceId), utxo.outputIndex);
      });
      if (block.evaluation.rewardOutput !== null) {
        insertCreated.run(blockId, Buffer.from(block.evaluation.rewardOutput.sourceId), block.evaluation.rewardOutput.outputIndex);
      }
      insertState.run(blockId, encodeU128(supplyBefore), Buffer.from(block.parentId ?? block.blockId, 'hex'), Number(block.height - 1n));
    });

    transaction();
  }

  public persistRuntimeState(snapshot: ChainStateSnapshot, activeChainIds: readonly string[], mempoolEntries: readonly MempoolEntry[]): void {
    const clearActiveChain = this.connection.prepare('DELETE FROM active_chain');
    const clearUtxos = this.connection.prepare('DELETE FROM utxos');
    const clearInputs = this.connection.prepare('DELETE FROM mempool_inputs');
    const clearMempool = this.connection.prepare('DELETE FROM mempool');
    const deactivateBlocks = this.connection.prepare('UPDATE blocks SET active = 0');
    const activateBlock = this.connection.prepare('UPDATE blocks SET active = 1 WHERE block_id = ?');
    const insertActiveChain = this.connection.prepare('INSERT INTO active_chain(height, block_id) VALUES (?, ?)');
    const insertUtxo = this.connection.prepare(
      'INSERT INTO utxos(source_id, source_index, owner, amount_be16, created_height, is_reward) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const insertMempool = this.connection.prepare(
      'INSERT INTO mempool(tx_id, actual_fee_be17, min_burn_be17, priority_fee_be17, received_seq) VALUES (?, ?, ?, ?, ?)'
    );
    const insertInput = this.connection.prepare('INSERT INTO mempool_inputs(tx_id, source_id, source_index) VALUES (?, ?, ?)');

    const transaction = this.connection.transaction(() => {
      clearActiveChain.run();
      clearUtxos.run();
      clearInputs.run();
      clearMempool.run();
      deactivateBlocks.run();
      activeChainIds.forEach((blockId, height) => {
        const id = Buffer.from(blockId, 'hex');
        activateBlock.run(id);
        insertActiveChain.run(height, id);
      });
      snapshot.utxos.forEach((utxo) => {
        insertUtxo.run(Buffer.from(utxo.sourceId), utxo.outputIndex, Buffer.from(utxo.owner), encodeU128(utxo.amount), Number(utxo.createdHeight), utxo.isReward ? 1 : 0);
      });
      this.setMetaText('active_tip', snapshot.activeTip ?? '');
      this.setMetaText('active_height', snapshot.activeHeight.toString(10));
      this.setMetaText('cumulative_fixed_rewards', snapshot.cumulativeFixedRewards.toString(10));
      this.setMetaText('cumulative_minimum_burns', snapshot.cumulativeMinimumBurns.toString(10));
      this.setMetaText('cumulative_priority_fees', snapshot.cumulativePriorityFees.toString(10));
      this.setMetaText('active_cumulative_work', snapshot.activeCumulativeWork.toString(10));
      this.setMetaText('supply', snapshot.totalSupply.toString(10));
      for (const entry of mempoolEntries) {
        const txId = Buffer.from(entry.txId, 'hex');
        insertMempool.run(txId, encodeU136(entry.evaluation.actualFee), encodeU136(entry.evaluation.minimumBurn), encodeU136(entry.evaluation.priorityFee), Number(entry.receivedSeq));
        entry.evaluation.consumedOutpoints.forEach((input) => insertInput.run(txId, Buffer.from(input.sourceId), input.outputIndex));
      }
    });

    transaction();
  }

  public loadStoredEvents(): StoredEventRecord[] {
    const rows = this.connection.prepare('SELECT event_json, received_seq FROM events ORDER BY received_seq ASC').all() as Array<{ event_json: string; received_seq: number }>;
    return rows.map((row) => ({ event: JSON.parse(row.event_json) as NostrEvent, receivedSeq: BigInt(row.received_seq) }));
  }

  public clearDerivedState(): void {
    this.connection.exec('DELETE FROM active_chain; DELETE FROM utxos; DELETE FROM undo_spent; DELETE FROM undo_created; DELETE FROM undo_state; DELETE FROM mempool_inputs; DELETE FROM mempool;');
    this.setMetaText('active_tip', '');
    this.setMetaText('active_height', '0');
    this.setMetaText('supply', '0');
    this.setMetaText('cumulative_fixed_rewards', '0');
    this.setMetaText('cumulative_minimum_burns', '0');
    this.setMetaText('cumulative_priority_fees', '0');
    this.setMetaText('active_cumulative_work', '0');
  }

  public verifyIntegrity(): string {
    const row = this.connection.prepare('PRAGMA integrity_check').get() as Record<string, string>;
    return Object.values(row)[0] ?? 'unknown';
  }

  private assertProductionSchemaCompatibility(): void {
    for (const tableName of PRODUCTION_TABLE_NAMES) {
      this.connection.prepare(`SELECT 1 FROM ${tableName} LIMIT 0`).get();
    }
    this.assertTableColumns('blocks', [
      'block_id',
      'parent_id',
      'miner_pubkey',
      'height',
      'nonce_be8',
      'work_difficulty',
      'median_time_past',
      'credited_work_be32',
      'cumulative_work_be32',
      'total_burn_be16',
      'total_priority_be16',
      'reward_amount_be16',
      'supply_after_be16',
      'validation_state',
      'invalid_code',
      'active'
    ]);
    this.assertTableColumns('meta', ['key', 'value']);
    this.assertTableColumns('undo_state', ['block_id', 'supply_before_be16', 'previous_tip_id', 'previous_height']);
    for (const legacyTableName of LEGACY_PROTOTYPE_TABLE_NAMES) {
      const row = this.connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(legacyTableName) as { name: string } | undefined;
      if (row !== undefined) {
        throw new Error(`incompatible prototype database table present: ${legacyTableName}`);
      }
    }
  }

  private assertTableColumns(tableName: string, expectedColumns: readonly string[]): void {
    const rows = this.connection.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    const availableColumns = new Set(rows.map((row) => row.name));
    for (const expectedColumn of expectedColumns) {
      if (!availableColumns.has(expectedColumn)) {
        throw new Error(`incompatible ${tableName} schema: missing column ${expectedColumn}`);
      }
    }
  }

  private assertMetadataEnvelope(): void {
    const rowCount = this.connection.prepare('SELECT COUNT(*) AS count FROM meta').get() as { count: number };
    if (rowCount.count === 0) {
      throw new Error('corrupt metadata: missing schema envelope');
    }
    const schemaVersion = this.getMetaText('schema_version');
    if (schemaVersion === null) {
      throw new Error('corrupt metadata: missing schema_version');
    }
    const parsedSchemaVersion = Number(schemaVersion);
    if (!Number.isInteger(parsedSchemaVersion) || parsedSchemaVersion !== SCHEMA_VERSION) {
      throw new Error(`wrong schema version: expected ${SCHEMA_VERSION}, got ${schemaVersion}`);
    }

    const storedNetwork = this.getMetaText('network');
    if (storedNetwork !== null && storedNetwork !== this.expectedNetwork) {
      throw new Error(`wrong network metadata: expected ${this.expectedNetwork}, got ${storedNetwork}`);
    }

    const chainId = this.getMetaText('chain_id');
    if (chainId === null || chainId.length === 0) {
      const presentRequiredKeys = REQUIRED_META_KEYS.filter((key) => this.getMetaText(key) !== null);
      if (presentRequiredKeys.length > 1) {
        throw new Error('corrupt metadata: partial production metadata present before chain initialization');
      }
      return;
    }

    this.assertRequiredMetaPresent();
  }

  private assertRequiredMetaPresent(): void {
    for (const key of REQUIRED_META_KEYS) {
      if (this.getMetaText(key) === null) {
        throw new Error(`corrupt metadata: missing ${key}`);
      }
    }
  }

  private getRequiredMetaText(key: string): string {
    const value = this.getMetaText(key);
    if (value === null) {
      throw new Error(`corrupt metadata: missing ${key}`);
    }
    return value;
  }
}
