"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodeStore = void 0;
const primitives_1 = require("../consensus/primitives");
const database_1 = require("./database");
class NodeStore {
    database;
    connection;
    constructor(databasePath) {
        this.database = new database_1.NodeDatabase(databasePath);
        this.connection = this.database.connection;
    }
    close() {
        this.database.close();
    }
    getMetaText(key) {
        const row = this.connection.prepare('SELECT value FROM meta WHERE key = ?').get(key);
        if (row === undefined) {
            return null;
        }
        return Buffer.isBuffer(row.value) ? row.value.toString('utf8') : String(row.value);
    }
    setMetaText(key, value) {
        this.connection.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, Buffer.from(value, 'utf8'));
    }
    nextReceivedSeq() {
        const current = this.getMetaText('next_received_seq');
        const value = current === null ? 1n : BigInt(current);
        this.setMetaText('next_received_seq', (value + 1n).toString(10));
        return value;
    }
    initializeChain(chainIdHex, protocolVersion) {
        this.setMetaText('chain_id', chainIdHex);
        this.setMetaText('protocol_version', String(protocolVersion));
        this.setMetaText('active_tip', chainIdHex);
        this.setMetaText('active_height', '0');
        this.setMetaText('cumulative_fixed_rewards', '0');
        this.setMetaText('cumulative_minimum_burns', '0');
        this.setMetaText('cumulative_priority_fees', '0');
        if (this.getMetaText('next_received_seq') === null) {
            this.setMetaText('next_received_seq', '1');
        }
    }
    persistEvent(event, chainScope, objectState, invalidCode, receivedSeq) {
        this.connection.prepare('INSERT OR REPLACE INTO events(id, kind, pubkey, created_at, chain_scope, event_json, object_state, invalid_code, received_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(Buffer.from(event.id, 'hex'), event.kind, Buffer.from(event.pubkey, 'hex'), event.created_at, chainScope, JSON.stringify(event), objectState, invalidCode, Number(receivedSeq));
    }
    persistTransaction(parsed) {
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
                insertOutput.run(txId, index, Buffer.from(output.ownerPubkey), (0, primitives_1.encodeU128)(output.amount));
            });
        });
        transaction();
    }
    persistBlockStructure(parsed, validationState, height, invalidCode) {
        this.connection.prepare('INSERT OR REPLACE INTO blocks(block_id, parent_id, miner_pubkey, height, nonce_be8, difficulty, validation_state, invalid_code, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT active FROM blocks WHERE block_id = ?), 0))').run(Buffer.from(parsed.event.id, 'hex'), parsed.parentId === null ? null : Buffer.from(parsed.parentId), Buffer.from(parsed.event.pubkey, 'hex'), height === null ? null : Number(height), (0, primitives_1.encodeU64)(parsed.nonce), 6, validationState, invalidCode, Buffer.from(parsed.event.id, 'hex'));
        const deleteRefs = this.connection.prepare('DELETE FROM block_transactions WHERE block_id = ?');
        const insertRef = this.connection.prepare('INSERT INTO block_transactions(block_id, tx_pos, tx_id) VALUES (?, ?, ?)');
        const blockId = Buffer.from(parsed.event.id, 'hex');
        const transaction = this.connection.transaction(() => {
            deleteRefs.run(blockId);
            parsed.txIds.forEach((txId, index) => insertRef.run(blockId, index, Buffer.from(txId)));
        });
        transaction();
    }
    persistUndo(block) {
        const blockId = Buffer.from(block.blockId, 'hex');
        const deleteSpent = this.connection.prepare('DELETE FROM undo_spent WHERE block_id = ?');
        const deleteCreated = this.connection.prepare('DELETE FROM undo_created WHERE block_id = ?');
        const insertSpent = this.connection.prepare('INSERT INTO undo_spent(block_id, seq, source_id, source_index, owner, amount_be16, created_height, is_reward) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        const insertCreated = this.connection.prepare('INSERT INTO undo_created(block_id, source_id, source_index) VALUES (?, ?, ?)');
        const transaction = this.connection.transaction(() => {
            deleteSpent.run(blockId);
            deleteCreated.run(blockId);
            block.evaluation.consumedOutpoints.forEach((utxo, index) => {
                insertSpent.run(blockId, index, Buffer.from(utxo.sourceId), utxo.outputIndex, Buffer.from(utxo.owner), (0, primitives_1.encodeU128)(utxo.amount), Number(utxo.createdHeight), utxo.isReward ? 1 : 0);
            });
            block.evaluation.createdTxOutputs.forEach((utxo) => {
                insertCreated.run(blockId, Buffer.from(utxo.sourceId), utxo.outputIndex);
            });
            if (block.evaluation.rewardOutput !== null) {
                insertCreated.run(blockId, Buffer.from(block.evaluation.rewardOutput.sourceId), block.evaluation.rewardOutput.outputIndex);
            }
        });
        transaction();
    }
    persistDerivedState(snapshot, activeChainIds) {
        const clearActiveChain = this.connection.prepare('DELETE FROM active_chain');
        const clearUtxos = this.connection.prepare('DELETE FROM utxos');
        const deactivateBlocks = this.connection.prepare('UPDATE blocks SET active = 0');
        const activateBlock = this.connection.prepare('UPDATE blocks SET active = 1 WHERE block_id = ?');
        const insertActiveChain = this.connection.prepare('INSERT INTO active_chain(height, block_id) VALUES (?, ?)');
        const insertUtxo = this.connection.prepare('INSERT INTO utxos(source_id, source_index, owner, amount_be16, created_height, is_reward) VALUES (?, ?, ?, ?, ?, ?)');
        const transaction = this.connection.transaction(() => {
            clearActiveChain.run();
            clearUtxos.run();
            deactivateBlocks.run();
            activeChainIds.forEach((blockId, height) => {
                const id = Buffer.from(blockId, 'hex');
                activateBlock.run(id);
                insertActiveChain.run(height, id);
            });
            snapshot.utxos.forEach((utxo) => {
                insertUtxo.run(Buffer.from(utxo.sourceId), utxo.outputIndex, Buffer.from(utxo.owner), (0, primitives_1.encodeU128)(utxo.amount), Number(utxo.createdHeight), utxo.isReward ? 1 : 0);
            });
            this.setMetaText('active_tip', snapshot.activeTip ?? '');
            this.setMetaText('active_height', snapshot.activeHeight.toString(10));
            this.setMetaText('cumulative_fixed_rewards', snapshot.cumulativeFixedRewards.toString(10));
            this.setMetaText('cumulative_minimum_burns', snapshot.cumulativeMinimumBurns.toString(10));
            this.setMetaText('cumulative_priority_fees', snapshot.cumulativePriorityFees.toString(10));
        });
        transaction();
    }
    persistMempool(entries) {
        const clearInputs = this.connection.prepare('DELETE FROM mempool_inputs');
        const clearMempool = this.connection.prepare('DELETE FROM mempool');
        const insertMempool = this.connection.prepare('INSERT INTO mempool(tx_id, actual_fee_be17, min_burn_be17, priority_fee_be17, received_seq) VALUES (?, ?, ?, ?, ?)');
        const insertInput = this.connection.prepare('INSERT INTO mempool_inputs(tx_id, source_id, source_index) VALUES (?, ?, ?)');
        const transaction = this.connection.transaction(() => {
            clearInputs.run();
            clearMempool.run();
            for (const entry of entries) {
                const txId = Buffer.from(entry.txId, 'hex');
                insertMempool.run(txId, (0, primitives_1.encodeU136)(entry.actualFee), (0, primitives_1.encodeU136)(entry.minimumBurn), (0, primitives_1.encodeU136)(entry.priorityFee), Number(entry.receivedSeq));
                entry.inputs.forEach((input) => insertInput.run(txId, Buffer.from(input.sourceId), input.outputIndex));
            }
        });
        transaction();
    }
    loadStoredEvents() {
        const rows = this.connection.prepare('SELECT event_json, received_seq FROM events ORDER BY received_seq ASC').all();
        return rows.map((row) => ({ event: JSON.parse(row.event_json), receivedSeq: BigInt(row.received_seq) }));
    }
    clearDerivedState() {
        this.connection.exec('DELETE FROM active_chain; DELETE FROM utxos; DELETE FROM undo_spent; DELETE FROM undo_created; DELETE FROM mempool_inputs; DELETE FROM mempool;');
        this.setMetaText('active_tip', '');
        this.setMetaText('active_height', '0');
        this.setMetaText('cumulative_fixed_rewards', '0');
        this.setMetaText('cumulative_minimum_burns', '0');
        this.setMetaText('cumulative_priority_fees', '0');
    }
    verifyIntegrity() {
        const row = this.connection.prepare('PRAGMA integrity_check').get();
        return Object.values(row)[0] ?? 'unknown';
    }
}
exports.NodeStore = NodeStore;
