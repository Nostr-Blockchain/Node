"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEGACY_PROTOTYPE_TABLE_NAMES = exports.PRODUCTION_TABLE_NAMES = exports.REQUIRED_META_KEYS = exports.SCHEMA_SQL = exports.SCHEMA_VERSION = void 0;
exports.SCHEMA_VERSION = 1;
exports.SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value BLOB NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS events (
  id            BLOB PRIMARY KEY CHECK(length(id)=32),
  kind          INTEGER NOT NULL,
  pubkey        BLOB NOT NULL CHECK(length(pubkey)=32),
  created_at    INTEGER NOT NULL CHECK(created_at>=0),
  chain_scope   TEXT NOT NULL,
  event_json    TEXT NOT NULL,
  object_state  TEXT NOT NULL,
  invalid_code  TEXT,
  received_seq  INTEGER NOT NULL UNIQUE
) STRICT;

CREATE TABLE IF NOT EXISTS transactions (
  tx_id         BLOB PRIMARY KEY REFERENCES events(id),
  author        BLOB NOT NULL CHECK(length(author)=32),
  input_count   INTEGER NOT NULL,
  output_count  INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS tx_inputs (
  tx_id         BLOB NOT NULL REFERENCES transactions(tx_id),
  input_pos     INTEGER NOT NULL,
  source_id     BLOB NOT NULL CHECK(length(source_id)=32),
  source_index  INTEGER NOT NULL CHECK(source_index BETWEEN 0 AND 65535),
  PRIMARY KEY(tx_id, input_pos),
  UNIQUE(tx_id, source_id, source_index)
) STRICT;
CREATE INDEX IF NOT EXISTS tx_inputs_outpoint ON tx_inputs(source_id, source_index);

CREATE TABLE IF NOT EXISTS tx_outputs (
  tx_id         BLOB NOT NULL REFERENCES transactions(tx_id),
  output_index  INTEGER NOT NULL CHECK(output_index BETWEEN 0 AND 65534),
  owner         BLOB NOT NULL CHECK(length(owner)=32),
  amount_be16   BLOB NOT NULL CHECK(length(amount_be16)=16),
  PRIMARY KEY(tx_id, output_index)
) STRICT;
CREATE INDEX IF NOT EXISTS tx_outputs_owner ON tx_outputs(owner);

CREATE TABLE IF NOT EXISTS blocks (
  block_id          BLOB PRIMARY KEY REFERENCES events(id),
  parent_id         BLOB CHECK(parent_id IS NULL OR length(parent_id)=32),
  miner_pubkey      BLOB NOT NULL CHECK(length(miner_pubkey)=32),
  height            INTEGER,
  nonce_be8         BLOB NOT NULL CHECK(length(nonce_be8)=8),
  work_difficulty   INTEGER,
  median_time_past  INTEGER,
  credited_work_be32 BLOB CHECK(credited_work_be32 IS NULL OR length(credited_work_be32)=32),
  cumulative_work_be32 BLOB CHECK(cumulative_work_be32 IS NULL OR length(cumulative_work_be32)=32),
  total_burn_be16   BLOB CHECK(total_burn_be16 IS NULL OR length(total_burn_be16)=16),
  total_priority_be16 BLOB CHECK(total_priority_be16 IS NULL OR length(total_priority_be16)=16),
  reward_amount_be16 BLOB CHECK(reward_amount_be16 IS NULL OR length(reward_amount_be16)=16),
  supply_after_be16 BLOB CHECK(supply_after_be16 IS NULL OR length(supply_after_be16)=16),
  validation_state  TEXT NOT NULL,
  invalid_code      TEXT,
  active            INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1))
) STRICT;
CREATE INDEX IF NOT EXISTS blocks_parent ON blocks(parent_id);
CREATE INDEX IF NOT EXISTS blocks_height ON blocks(height);

CREATE TABLE IF NOT EXISTS block_transactions (
  block_id      BLOB NOT NULL REFERENCES blocks(block_id),
  tx_pos        INTEGER NOT NULL,
  tx_id         BLOB NOT NULL CHECK(length(tx_id)=32),
  PRIMARY KEY(block_id, tx_pos),
  UNIQUE(block_id, tx_id)
) STRICT;
CREATE INDEX IF NOT EXISTS block_transactions_tx ON block_transactions(tx_id);

CREATE TABLE IF NOT EXISTS active_chain (
  height        INTEGER PRIMARY KEY,
  block_id      BLOB NOT NULL UNIQUE REFERENCES blocks(block_id)
) STRICT;

CREATE TABLE IF NOT EXISTS utxos (
  source_id       BLOB NOT NULL CHECK(length(source_id)=32),
  source_index    INTEGER NOT NULL CHECK(source_index BETWEEN 0 AND 65535),
  owner           BLOB NOT NULL CHECK(length(owner)=32),
  amount_be16     BLOB NOT NULL CHECK(length(amount_be16)=16),
  created_height  INTEGER NOT NULL CHECK(created_height>=0),
  is_reward       INTEGER NOT NULL CHECK(is_reward IN (0,1)),
  PRIMARY KEY(source_id, source_index)
) STRICT;
CREATE INDEX IF NOT EXISTS utxos_owner ON utxos(owner);

CREATE TABLE IF NOT EXISTS undo_spent (
  block_id         BLOB NOT NULL REFERENCES blocks(block_id),
  seq              INTEGER NOT NULL,
  source_id        BLOB NOT NULL CHECK(length(source_id)=32),
  source_index     INTEGER NOT NULL,
  owner            BLOB NOT NULL CHECK(length(owner)=32),
  amount_be16      BLOB NOT NULL CHECK(length(amount_be16)=16),
  created_height   INTEGER NOT NULL,
  is_reward        INTEGER NOT NULL,
  PRIMARY KEY(block_id, seq)
) STRICT;

CREATE TABLE IF NOT EXISTS undo_created (
  block_id       BLOB NOT NULL REFERENCES blocks(block_id),
  source_id      BLOB NOT NULL CHECK(length(source_id)=32),
  source_index   INTEGER NOT NULL,
  PRIMARY KEY(block_id, source_id, source_index)
) STRICT;

CREATE TABLE IF NOT EXISTS undo_state (
  block_id            BLOB PRIMARY KEY REFERENCES blocks(block_id),
  supply_before_be16  BLOB NOT NULL CHECK(length(supply_before_be16)=16),
  previous_tip_id     BLOB NOT NULL CHECK(length(previous_tip_id)=32),
  previous_height     INTEGER NOT NULL CHECK(previous_height>=0)
) STRICT;

CREATE TABLE IF NOT EXISTS mempool (
  tx_id             BLOB PRIMARY KEY REFERENCES transactions(tx_id),
  actual_fee_be17   BLOB NOT NULL CHECK(length(actual_fee_be17)=17),
  min_burn_be17     BLOB NOT NULL CHECK(length(min_burn_be17)=17),
  priority_fee_be17 BLOB NOT NULL CHECK(length(priority_fee_be17)=17),
  received_seq      INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS mempool_inputs (
  tx_id         BLOB NOT NULL REFERENCES mempool(tx_id),
  source_id     BLOB NOT NULL CHECK(length(source_id)=32),
  source_index  INTEGER NOT NULL,
  PRIMARY KEY(tx_id, source_id, source_index)
) STRICT;
CREATE INDEX IF NOT EXISTS mempool_inputs_outpoint ON mempool_inputs(source_id, source_index);

CREATE TABLE IF NOT EXISTS missing_objects (
  object_id       BLOB PRIMARY KEY CHECK(length(object_id)=32),
  object_type     TEXT NOT NULL,
  first_seen_seq  INTEGER NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_retry_ms   INTEGER
) STRICT;

CREATE TABLE IF NOT EXISTS relay_state (
  url               TEXT PRIMARY KEY,
  relay_class       TEXT NOT NULL,
  last_connected_ms INTEGER,
  last_error        TEXT
) STRICT;
`;
exports.REQUIRED_META_KEYS = [
    'schema_version',
    'network',
    'chain_id',
    'protocol_version',
    'active_tip',
    'active_height',
    'supply',
    'next_received_seq'
];
exports.PRODUCTION_TABLE_NAMES = [
    'meta',
    'events',
    'transactions',
    'tx_inputs',
    'tx_outputs',
    'blocks',
    'block_transactions',
    'active_chain',
    'utxos',
    'undo_spent',
    'undo_created',
    'undo_state',
    'mempool',
    'mempool_inputs',
    'missing_objects',
    'relay_state'
];
exports.LEGACY_PROTOTYPE_TABLE_NAMES = [
    'node_announcements'
];
