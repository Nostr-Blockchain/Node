"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventRepository = exports.BlockRepository = exports.UtxoRepository = exports.MetaRepository = void 0;
const primitives_1 = require("../consensus/primitives");
const block_index_1 = require("../chain/block-index");
const utxo_view_1 = require("../state/utxo-view");
class MetaRepository {
    database;
    constructor(database) {
        this.database = database;
    }
    getText(key) {
        const row = this.database.prepare('SELECT value FROM meta WHERE key = ?').get(key);
        if (row === undefined) {
            return null;
        }
        return Buffer.isBuffer(row.value) ? row.value.toString('utf8') : String(row.value);
    }
    setText(key, value) {
        this.database.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
    }
    getBigInt(key) {
        const text = this.getText(key);
        return text === null ? 0n : BigInt(text);
    }
    setBigInt(key, value) {
        this.setText(key, value.toString(10));
    }
}
exports.MetaRepository = MetaRepository;
class UtxoRepository {
    database;
    constructor(database) {
        this.database = database;
    }
    loadView() {
        const rows = this.database.prepare('SELECT source_id, source_index, owner, amount_be16, created_height, is_reward FROM utxos').all();
        return new utxo_view_1.MemoryUtxoView(rows.map((row) => ({
            sourceId: row.source_id,
            outputIndex: row.source_index,
            owner: row.owner,
            amount: (0, primitives_1.decodeU128)(row.amount_be16, 0),
            createdHeight: BigInt(row.created_height),
            isReward: Number(row.is_reward) === 1
        })));
    }
    replaceAll(utxos) {
        const clear = this.database.prepare('DELETE FROM utxos');
        const insert = this.database.prepare('INSERT INTO utxos(source_id, source_index, owner, amount_be16, created_height, is_reward) VALUES (?, ?, ?, ?, ?, ?)');
        const transaction = this.database.transaction(() => {
            clear.run();
            for (const utxo of utxos) {
                insert.run(utxo.sourceId, utxo.outputIndex, utxo.owner, (0, primitives_1.encodeU128)(utxo.amount), Number(utxo.createdHeight), utxo.isReward ? 1 : 0);
            }
        });
        transaction();
    }
}
exports.UtxoRepository = UtxoRepository;
class BlockRepository {
    database;
    constructor(database) {
        this.database = database;
    }
    loadIndex() {
        const index = new block_index_1.BlockIndex();
        const rows = this.database.prepare('SELECT block_id, parent_id, height, cumulative_work_be32, validation_state, active, invalid_code FROM blocks').all();
        for (const row of rows) {
            const height = row.height === null ? null : BigInt(row.height);
            index.upsert({
                blockId: row.block_id.toString('hex'),
                parentId: row.parent_id === null ? null : row.parent_id.toString('hex'),
                height,
                cumulativeWork: row.cumulative_work_be32 === null ? height : (0, primitives_1.decodeU256)(row.cumulative_work_be32),
                validationState: row.validation_state,
                active: Number(row.active) === 1,
                invalidCode: row.invalid_code === null ? null : String(row.invalid_code)
            });
        }
        return index;
    }
}
exports.BlockRepository = BlockRepository;
class EventRepository {
    database;
    constructor(database) {
        this.database = database;
    }
    insertEvent(idHex, kind, pubkeyHex, createdAt, chainScope, eventJson, objectState, invalidCode, receivedSeq) {
        this.database.prepare('INSERT OR REPLACE INTO events(id, kind, pubkey, created_at, chain_scope, event_json, object_state, invalid_code, received_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(Buffer.from(idHex, 'hex'), kind, Buffer.from(pubkeyHex, 'hex'), createdAt, chainScope, eventJson, objectState, invalidCode, Number(receivedSeq));
    }
}
exports.EventRepository = EventRepository;
