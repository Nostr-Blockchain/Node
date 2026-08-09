# Nostr Blockchain v0
## SCP-0003 — Reference Node Architecture Specification
### Development Architecture for the Minimal Nostr-Native Full Node

## 1. Purpose

This document specifies the architecture of the first Nostr Blockchain v0 reference node.

Its purpose is not maximum throughput, maximum decentralization, or production-scale mining.

Its purpose is to provide the smallest implementation that can correctly demonstrate the complete protocol:

```text
Nostr-native transactions
+
Nostr-native blocks
+
BIP340 ownership
+
proof-of-work ordering
+
UTXO state
+
perpetual mining rewards
+
transaction-fee burning
+
forks and reorganizations
+
Nostr-only blockchain networking
```

The reference implementation should optimize for correctness, auditability, determinism, crash safety, implementation clarity, and protocol experimentation before optimization.

## 2. Recommended implementation language

The first reference node SHOULD be implemented in TypeScript running on Node.js.

This is not a consensus requirement. It is an engineering choice.

The main reasons are that Nostr Blockchainex is already JavaScript-oriented; Nostr events map naturally onto JS/TS structures; browser and wallet code can share codecs and test vectors; BigInt provides exact integer arithmetic; WebSocket support is straightforward; developer iteration is fast; and a later Rust/C++ implementation can serve as an independent consensus implementation.

CPU-intensive proof-of-work should not run on the Node.js event loop. The resulting architecture is:

```text
TypeScript control plane
native/high-assurance cryptographic primitive
worker-thread mining
SQLite persistent state
WebSocket Nostr networking
```

## 3. Reference-node philosophy

The node should be built according to six rules.

### Rule 1 — Consensus is pure

Consensus functions do not open sockets, read relay configuration, read wall-clock time, write databases, generate UI, manage wallet seeds, or make logging decisions.

Given the same events and the same previous state, they must produce the same result.

### Rule 2 — Networking is untrusted input

Receiving an event through Nostr establishes only that someone sent the event. It does not establish that the transaction is valid, the block is valid, the block is canonical, or the transaction is confirmed.

### Rule 3 — One component owns active chainstate

Only the `ChainExecutor` may modify the active tip, active-chain mapping, UTXO set, undo journal, or cumulative burns.

### Rule 4 — Everything derived can be rebuilt

The authoritative persistent information is genesis plus authenticated Nostr events.

Indexes, balances, block status, the UTXO table and the active-chain table must be reconstructable.

### Rule 5 — The node never needs wallet spending keys

A validating node needs no user private keys.

A mining node optionally needs one dedicated block-signing key.

### Rule 6 — No hidden consensus configuration

Consensus parameters come from the selected genesis event.

They are never overridden with command-line switches.

## 4. Node roles

The same executable can perform several roles:

```text
VALIDATOR
    verifies blocks and transactions
    maintains chainstate

NOSTR CLIENT
    connects to remote chain relays

CHAIN RELAY
    optionally exposes its own Nostr WebSocket relay

ARCHIVAL NODE
    retains block and transaction events

MINER
    optionally constructs and mines blocks

CLI NODE
    exposes local administrative commands
```

A minimal validating node requires only validator + Nostr client + persistent storage.

Mining and relay serving are optional.

## 5. High-level architecture

```text
REMOTE NOSTR RELAYS
        │
        ▼
RELAY MANAGER
        │
        ▼
EVENT FIREWALL
(JSON / NIP-01 ID / BIP340 / blockchain structure)
        │
   ┌────┴────┐
   ▼         ▼
MEMPOOL   BLOCK DAG
   │         │
   └────┬────┘
        ▼
CHAIN EXECUTOR
(single writer)
        │
        ▼
SQLite
(events / blocks / transactions / active chain / UTXOs / undo / mempool)
   ┌────┴────┐
   ▼         ▼
MINER    NOSTR RELAY
```

The key boundary is:

```text
networking does not mutate chainstate
mining does not mutate chainstate
mempool does not mutate chainstate
only ChainExecutor connects/disconnects blocks
```

## 6. Process architecture

The first implementation should remain one operating-system process.

Do not begin with microservices.

Conceptually:

```text
nostr-chain-node process
│
├─ main event loop
├─ Nostr connections
├─ SQLite
├─ consensus engine
├─ chain executor
├─ mempool
├─ optional relay server
└─ mining worker pool
```

This removes distributed service coordination, cross-process database ownership, internal authentication, internal network protocols, and service discovery from the reference implementation.

## 7. Proposed source-tree architecture

```text
src/
├─ consensus/
│  ├─ types.ts
│  ├─ params.ts
│  ├─ transaction-codec.ts
│  ├─ transaction-validation.ts
│  ├─ block-codec.ts
│  ├─ block-validation.ts
│  ├─ fees.ts
│  ├─ maturity.ts
│  ├─ pow.ts
│  └─ errors.ts
├─ crypto/
│  ├─ nip01.ts
│  ├─ schnorr.ts
│  └─ sha256.ts
├─ state/
│  ├─ utxo.ts
│  ├─ state-view.ts
│  ├─ state-overlay.ts
│  ├─ state-digest.ts
│  └─ monetary-invariants.ts
├─ chain/
│  ├─ block-index.ts
│  ├─ block-dag.ts
│  ├─ chain-executor.ts
│  ├─ fork-choice.ts
│  ├─ branch-validator.ts
│  ├─ reorg.ts
│  └─ undo.ts
├─ storage/
│  ├─ schema.ts
│  ├─ sqlite.ts
│  ├─ event-store.ts
│  ├─ chain-store.ts
│  └─ migrations.ts
├─ mempool/
│  ├─ mempool.ts
│  ├─ admission.ts
│  └─ conflicts.ts
├─ nostr/
│  ├─ relay-manager.ts
│  ├─ relay-connection.ts
│  ├─ subscriptions.ts
│  ├─ event-fetcher.ts
│  ├─ sync.ts
│  ├─ negentropy.ts
│  └─ embedded-relay.ts
├─ mining/
│  ├─ candidate-builder.ts
│  ├─ miner.ts
│  ├─ worker.ts
│  └─ signer.ts
├─ node/
│  ├─ node.ts
│  ├─ lifecycle.ts
│  ├─ config.ts
│  ├─ readiness.ts
│  └─ commands.ts
├─ cli/
│  └─ main.ts
└─ tests/
   ├─ conformance/
   ├─ consensus/
   ├─ state/
   ├─ reorg/
   ├─ networking/
   └─ fuzz/
```

Dependency direction should be enforced:

```text
consensus
    imports nothing from chain/storage/network/mining

state
    may import consensus types

chain
    may import consensus + state + storage

network
    may call chain/mempool APIs

mining
    may read chain/mempool
    but may not write chainstate
```

## 8. Consensus core API

The consensus engine should be close to a pure library.

```ts
parseTransaction(event, context)
validateTransaction(transaction, inputCoins, candidateHeight, params)

parseBlock(event, context)
validateBlockStructure(block, params)
validateBlockTransactions(block, transactions, resolvedInputs, candidateHeight, params)
```

The core should not retrieve UTXOs itself. The state layer supplies resolved UTXOs to consensus validation.

## 9. Consensus data structures

```ts
type Hash32 = Uint8Array;
type PubKey32 = Uint8Array;

interface Outpoint {
    sourceId: Hash32;
    index: number;
}

interface Utxo {
    outpoint: Outpoint;
    owner: PubKey32;
    amount: bigint;
    createdHeight: bigint;
    reward: boolean;
}

interface ParsedTransaction {
    id: Hash32;
    author: PubKey32;
    inputs: Outpoint[];
    outputs: TxOutput[];
}

interface TxOutput {
    owner: PubKey32;
    amount: bigint;
}

interface TxTransition {
    txid: Hash32;
    consumed: Utxo[];
    created: Utxo[];
    burned: bigint;
}

interface ParsedBlock {
    id: Hash32;
    parent: Hash32;
    miner: PubKey32;
    transactionIds: Hash32[];
    difficulty: number;
    nonce: bigint;
}
```

No floating-point monetary values should ever cross these APIs.

## 10. Cryptographic adapter

The node should not implement production elliptic-curve arithmetic itself.

```ts
interface Schnorr {
    verify(
        signature: Uint8Array,
        message32: Uint8Array,
        pubkey32: Uint8Array
    ): boolean;

    sign?(
        message32: Uint8Array,
        secretKey32: Uint8Array
    ): Uint8Array;
}
```

The node only needs signing when mining is enabled.

A non-mining full node needs verification only.

## 11. NIP-01 event validator

Before a blockchain object exists, the Nostr envelope must pass field-presence checks, exact lowercase ID/public-key encoding, valid tag-array shape, valid content and signature encoding, recomputed NIP-01 ID validation, and BIP340 signature verification.

The reference node should have exactly one implementation of NIP-01 ID calculation.

Wallet, transaction validation, block validation and mining should all call it.

## 12. Event firewall

All inbound Nostr events should pass through a cheap-to-expensive validation pipeline:

```text
WebSocket frame
↓ hard byte-size limit
JSON parse
↓ required Nostr shape
kind/scope prefilter
↓ duplicate-ID lookup
NIP-01 ID calculation
↓ Nostr Blockchain structural parsing
PoW check for blocks
↓ BIP340 verification
semantic routing
```

The network firewall may reject obviously useless input earlier for denial-of-service protection, but it must never accept an object the consensus validator would reject.

## 13. Event classification

Internal event states may include:

```text
RAW
ENVELOPE_VALID
STRUCTURAL_VALID
PENDING_DEPENDENCY
MEMPOOL_VALID
BLOCK_REFERENCED
CONFIRMED
INVALID
```

These are implementation states, not consensus fields.

## 14. Single physical database

The reference implementation should use one SQLite database:

```text
nostr-blockchain.sqlite
```

containing logical tables for each subsystem.

This is primarily a crash-consistency decision.

## 15. SQLite durability configuration

Recommended configuration:

```text
journal_mode = WAL
synchronous = FULL
foreign_keys = ON
busy_timeout configured
automatic schema migrations
```

Performance tuning should happen later.

## 16. Logical database schema

Initial logical tables:

```text
node_meta
events
event_tags
transactions
tx_inputs
tx_outputs
blocks
block_transactions
active_chain
utxos
undo_spent
undo_created
mempool
mempool_inputs
relay_state
```

### `events`

```text
id                  BLOB(32) PRIMARY KEY
pubkey              BLOB(32)
created_at          INTEGER
kind                INTEGER
tags_json           TEXT
content             TEXT
sig                 BLOB(64)
classification      INTEGER
received_seq        INTEGER
```

### `event_tags`

```text
event_id
position
name
value
```

### `transactions`

```text
txid                BLOB(32) PRIMARY KEY
author              BLOB(32)
input_count
output_count
```

### `tx_inputs`

```text
txid
ordinal
source_id
source_index
```

### `tx_outputs`

```text
txid
output_index
owner
amount_be16
```

### `blocks`

```text
block_id            BLOB(32) PRIMARY KEY
parent_id           BLOB(32)
miner_pubkey        BLOB(32)
difficulty
nonce
height_be8
chainwork
status
active
```

### `block_transactions`

```text
block_id
position
txid
```

### `active_chain`

```text
height
block_id
```

### `utxos`

```text
source_id
source_index
owner
amount_be16
created_height
reward
```

Primary key:

```text
(source_id, source_index)
```

### `undo_spent`

Contains complete copies of UTXOs removed while connecting an active block.

### `undo_created`

Contains outpoints created by that block.

### `mempool`

Stores accepted unconfirmed transaction metadata.

### `mempool_inputs`

Maps outpoint to current mempool spender.

## 17. Event store versus chainstate

The event store answers:

```text
"What authenticated objects do I know?"
```

The chainstate answers:

```text
"What monetary state follows from the active valid chain?"
```

A transaction may remain in the event store forever while being spent, stale, conflicted, disconnected, or not currently mempool-valid.

## 18. Block index and DAG

Every structurally valid PoW block is represented in a block DAG.

Each block-index entry contains block ID, parent, derived height, required work, cumulative work, transaction IDs, data availability, validation level, active status, and invalid-ancestor status.

The block index should distinguish at least:

```text
STRUCTURAL_VALID
PARENT_MISSING
TX_DATA_MISSING
STATE_VALID
INVALID
ACTIVE
VALID_SIDECHAIN
```

## 19. Staged block validation

Validation occurs in stages:

1. Envelope validation.
2. Block structure.
3. Proof of work.
4. Dependency availability.
5. State validation.
6. Chain activation.

Only a fully valid greater-work branch may replace the active chain.

## 20. Sidechain-state problem

The node maintains one active UTXO database.

A forked branch needs the UTXO state that existed at its own parent.

Maintaining one complete UTXO database per fork is unnecessary.

Instead The node should use a `StateOverlay`.

## 21. State overlay

Example:

```text
active:
A → B → C → D

candidate:
A → B → X → Y → Z
```

To validate candidate Z:

```text
1. start with active UTXO state at D
2. create an in-memory overlay
3. logically undo D
4. logically undo C
5. overlay now represents state at B
6. validate/apply X
7. validate/apply Y
8. validate/apply Z
9. active SQLite state remains untouched
```

The overlay contains removed outpoints, restored UTXOs, new UTXOs, and burn deltas.

If the branch is invalid, discard it.

If valid but not greater-work, keep the active chain.

If fully valid and greater-work, perform the actual reorg atomically.

## 22. Chain Executor

`ChainExecutor` is the most privileged component in the node.

It is the sole authority for:

```text
connectBlock()
disconnectBlock()
activateBestChain()
performReorg()
```

Calls are serialized through one queue.

## 23. Connecting a block

Connecting a block occurs inside one SQLite transaction:

```text
BEGIN
verify parent == current active tip
copy every consumed UTXO to undo_spent
delete consumed UTXOs
insert created TX outputs
record created outputs in undo_created
create mining reward UTXO
record reward in undo_created
insert active_chain entry
mark block ACTIVE
update active tip
update burn statistics
COMMIT
```

If anything fails:

```text
ROLLBACK
```

No partially connected block exists.

## 24. Undo design

Every active block needs enough information to restore its parent without consulting historical assumptions.

For every consumed UTXO, persist source, index, owner, amount, created height, and reward flag.

For every created UTXO, persist its outpoint.

Disconnecting a block deletes created outputs, restores consumed outputs, removes the active-chain mapping, reverses burn statistics, and restores the parent tip.

## 25. Reorganization transaction

For v0, the complete reorganization should occur in one SQLite transaction.

```text
BEGIN
disconnect old branch
connect candidate branch
set new tip
COMMIT
```

There should be no database state where half the fork belongs to one chain and half to another.

## 26. Fork-choice implementation

The v0 rule is:

```text
fully validated candidate chainwork > active chainwork
```

before reorganization.

Equal work keeps the current active chain.

A high-work block referencing missing data is interesting but not activatable.

## 27. Invalid ancestors

If block X is proven invalid, every descendant is also permanently invalid for that network.

Do not repeatedly revalidate such branches.

## 28. Mempool architecture

Because v0 prohibits unconfirmed child spending, the mempool has no ancestor graph, descendant graph, package validation, CPFP, or topological ordering.

A mempool entry contains:

```text
txid
parsed transaction
burned fee
arrival sequence
input outpoints
```

## 29. Mempool admission

A transaction is admitted when:

```text
NIP-01 valid
blockchain structure valid
all inputs exist in active UTXO state
all inputs belong to author
reward maturity satisfied for next candidate block
fee sufficient
no current mempool input conflict
```

Candidate spend height is:

```text
activeHeight + 1
```

## 30. Mempool conflict policy

The reference mempool should initially use:

```text
first accepted spender wins
```

Later conflicting events can remain in the raw event store but are not inserted into the active mempool.

Return `POLICY_CONFLICT`, not a consensus-invalid error.

## 31. Mempool after block connection

When a block becomes active:

```text
remove confirmed transactions
remove transactions conflicting with newly spent UTXOs
revalidate surviving mempool transactions
```

## 32. Mempool after reorganization

Transactions disconnected from the old branch are reconsidered against the new active chain.

If valid, return them to the mempool.

The immutable event remains in the event store regardless.

## 33. Nostr Relay Manager

The relay manager owns all outbound Nostr connections.

Each connection maintains connection state, subscriptions, publish queue, retry/backoff, relay acceptance results, last activity, and sync capability.

## 34. Relay classes

The node should distinguish:

```text
BOOTSTRAP RELAY
ARCHIVAL CHAIN RELAY
PUBLIC GOSSIP RELAY
LOCAL NODE RELAY
```

Relay URLs are configuration, never consensus.

## 35. Live subscriptions

After synchronization, maintain live subscriptions for:

```text
BLOCK_KIND + chain #t
TX_KIND + chain #t
```

Duplicate delivery is expected and deduplicated by event ID.

## 36. Block-first synchronization

The node should not synchronize every historical transaction event.

Instead:

```text
SYNC BLOCKS FIRST
then
FETCH ONLY TRANSACTIONS REFERENCED BY THOSE BLOCKS
```

Initial synchronization becomes:

```text
reconcile block events
↓
construct block DAG
↓
identify relevant branches
↓
read block TX IDs
↓
fetch exact TX events
↓
validate blockchain
```

This avoids downloading old rejected/conflicting/unconfirmed gossip.

## 37. NIP-77 block synchronization

Preferred archival synchronization uses NIP-77 Negentropy.

The node should reconcile only block events during initial chain synchronization.

After block IDs are known, exact transaction dependencies are fetched.

## 38. Sync-capable versus gossip-only relay

A relay supporting complete archival reconciliation is `SYNC_CAPABLE`.

A generic public relay without reliable complete history is `GOSSIP_ONLY`.

A node should not declare itself fully synced merely because one generic relay produced end-of-stored-events.

## 39. Object fetcher

Missing referenced objects go into an explicit fetch queue:

```text
MissingObject {
    id
    type
    firstRequested
    lastRequested
    attempts
    requestingRelays
}
```

Missing transactions are requested by exact event ID from several relays.

## 40. Block received before transaction

This is normal.

A block with missing referenced transactions becomes `PENDING_TRANSACTIONS`.

It is stored, its PoW can be checked, and missing IDs are fetched.

It cannot become active until dependencies are available and valid.

## 41. Embedded chain relay

A full node SHOULD optionally expose a small restricted Nostr relay.

Minimum message support:

```text
EVENT
REQ
CLOSE
EOSE
OK
CLOSED
```

Preferably also NIP-77 messages for synchronization.

## 42. Restricted relay writes

The embedded relay accepts only `TX_KIND` and `BLOCK_KIND` for the configured chain.

Blocks require valid envelope, signature, canonical structure, correct scope, and valid PoW before archival storage.

Transactions require valid envelope, signature, canonical structure, and correct scope.

## 43. No dependency on social relays

The architecture's claim is:

```text
The blockchain uses the Nostr protocol
```

not:

```text
The blockchain depends on existing social-media relays
```

A network can consist entirely of Nostr Blockchain full-node relays.

## 44. Relay metadata

NIP-11 support should be optional.

The core chain must not require HTTP relay metadata.

## 45. Mining architecture

Mining should be completely separated from consensus state mutation.

```text
Chain Executor
      │
      └─ active tip/state version
              │
              ▼
        Candidate Builder
              │
              ▼
        Mining Coordinator
          │   │   │
          ▼   ▼   ▼
        workers
              │
              ▼
            Signer
              │
              ▼
       local block validation
              │
              ▼
        Chain Executor
```

## 46. Candidate builder

The candidate builder takes a read-only snapshot of active tip ID, miner public key, configured difficulty, and selected mempool TX IDs.

It constructs the canonical Nostr block event candidate.

## 47. Reference transaction selection

Because miners do not receive fees, the simplest deterministic reference policy is:

```text
take lexicographically smallest
conflict-free mempool TX IDs
up to MAX_BLOCK_TRANSACTIONS
```

This is non-consensus.

## 48. Mining worker pool

Workers receive candidate event fields, miner public key, required difficulty, worker index, and worker count, but not the miner private key.

Nonce spaces are partitioned across workers.

## 49. Private-key isolation during mining

Mining workers never need the private key.

Only the signer does.

Flow:

```text
worker finds nonce + event ID
main process verifies PoW
signer signs event ID
complete block is locally revalidated
block is published
```

This leaves a future seam for hardware signers, remote signers, secure enclaves, or external mining pools.

## 50. Mining cancellation

When the active tip changes, cancel all current mining generations.

Stale worker results are ignored.

Mempool changes do not have to interrupt an already-running candidate.

## 51. Local mining modes

Support:

```text
mining disabled
continuous mining
mine one block
```

`mine one block` is useful for development.

## 52. Signer interface

```ts
interface BlockSigner {
    getPublicKey(): Promise<Uint8Array>;

    sign(
        eventId: Uint8Array
    ): Promise<Uint8Array>;
}
```

Possible implementations:

```text
LocalFileSigner
TestFixtureSigner
HardwareSigner later
RemoteSigner later
```

## 53. Node should not host user-wallet keys

The node database must contain zero ordinary wallet secret keys.

Wallets sign transactions independently and the node receives only signed Nostr events.

## 54. No RPC server initially

Do not implement a general remote RPC interface in the first reference node.

Use local CLI commands such as:

```text
nostr-chain-node status
nostr-chain-node balance <pubkey>
nostr-chain-node utxos <pubkey>
nostr-chain-node block <id>
nostr-chain-node tx <id>
nostr-chain-node mempool
nostr-chain-node mine-one
nostr-chain-node verify
nostr-chain-node reindex
```

A loopback RPC can be introduced later if Nostr Blockchainex integration needs it.

## 55. Node lifecycle

Explicit states:

```text
STARTING
RECOVERING
SYNCING
READY
DEGRADED
SHUTTING_DOWN
```

Mining is permitted only in `READY` unless explicitly overridden for development.

## 56. Startup procedure

```text
1. load configuration
2. select genesis/network profile
3. verify genesis ID
4. open SQLite
5. verify schema version
6. verify database genesis
7. inspect active tip metadata
8. verify chainstate consistency
9. load/rebuild mempool
10. start relay manager
11. connect bootstrap/archive relays
12. synchronize blocks
13. fetch missing block transactions
14. validate candidate chains
15. activate best valid chain
16. subscribe to live blocks
17. subscribe to live transactions
18. enter READY
19. start embedded relay if enabled
20. start mining if enabled
```

## 57. Crash recovery

On restart the node should trust committed database transactions, not an in-memory shutdown marker.

Recovery checks include genesis binding, active tip existence, active-chain linkage, tip height consistency, UTXO-state metadata consistency, and schema integrity.

## 58. Reindex capability

`nostr-chain-node reindex` should remove derived state while preserving authenticated event history, then reconstruct everything from genesis.

If reindex produces a different result, there is an implementation bug or database corruption.

## 59. Verify mode

`nostr-chain-node verify` should independently replay active history and compare:

```text
tip
height
UTXO count
UTXO diagnostic digest
cumulative burned amount
supply equation
```

without modifying running chainstate.

## 60. Deterministic replay mode

Support:

```text
nostr-chain-node replay <events.ndjson>
```

No Nostr, mining, relay connections, or wallet.

Output:

```text
active tip
height
UTXO digest
burn total
invalid events
pending objects
```

This enables independent implementations to compare deterministic outcomes.

## 61. Conformance corpus integration

The existing `nostr_blockchain_v0_conformance.json` should be a mandatory CI test dependency.

CI should verify frozen genesis, chain ID, common blocks, first mature reward spend, burn accounting, equal-work behavior, reorg behavior, post-reorg state digest, and all invalid vectors.

## 62. Property testing

Random valid chains should continuously assert:

```text
UTXO value + cumulative burns == cumulative block rewards
```

Also assert no duplicate UTXOs, no negative monetary values, no active spent outpoints, reward maturity correctness, deterministic replay, and correct random reorg handling.

## 63. Parser fuzzing

High-value fuzz targets:

```text
Nostr event parser
transaction hex parser
transaction binary codec
block tag parser
nonce parser
public-key parser
NIP-01 serialization
state transition
```

The result should always be deterministic acceptance or clean deterministic rejection, never crash or inconsistent state.

## 64. Network simulation tests

Simulated relays should deliberately duplicate, reorder, delay, omit, and corrupt events; deliver blocks before transactions; disconnect; reconnect; and send competing forks.

Final state must depend only on the valid event set, never delivery order.

## 65. Crash testing

Kill the node during block connection, disconnection, multi-block reorg, event insertion, mempool update, and startup recovery.

After restart, acceptable state is either before or after the atomic transaction, never intermediate.

## 66. Resource limits

Network policy should define local limits for WebSocket frame size, JSON nesting, pending orphan blocks, missing transactions, event queue size, mempool size, exact-ID fetch concurrency, relay connections, and mining workers.

These are policy, not consensus.

## 67. Orphan block handling

Unknown-parent blocks go into a bounded orphan pool indexed by parent ID.

When the parent arrives, reprocess children.

Eviction is policy and does not imply invalidity.

## 68. Missing transaction handling

Missing block-referenced TX IDs use a separate fetch system rather than the mempool.

Historical block dependencies and live unconfirmed transactions are different classes of data.

## 69. Logging

Use structured logs.

Example:

```text
component=chain
event=reorg
old_tip=...
new_tip=...
fork_height=...
disconnect=1
connect=2
```

Logs are diagnostics only.

## 70. Metrics

Minimum metrics:

```text
active height
active tip
chainwork
known blocks
valid sidechain blocks
pending-parent blocks
pending-transaction blocks
UTXO count
mempool size
total burned
relay connections
events received
events rejected
missing-object queue
mining hashes/sec
reorg count
```

## 71. Configuration

Example conceptual configuration:

```text
network = "conformance"
data_dir = "./data"

relays = [
    "wss://relay-a...",
    "wss://relay-b..."
]

embedded_relay = true
embedded_relay_port = 7777

mining = false
mining_workers = 4

miner_key_file = "./miner.key"

max_mempool = 10000
max_orphans = 2000
```

Consensus parameters must not be overridable here. They come from genesis.

## 72. Database network binding

The database permanently records genesis event ID.

On startup:

```text
configured genesis == database genesis
```

or the node refuses to start.

## 73. Read/write concurrency model

Conceptually:

```text
many readers
one logical writer
```

Validation can run concurrently, but state-changing operations go through one serialized `ChainExecutor` queue.

## 74. State versioning

Every active-tip transition increments a local `stateVersion`.

Candidate builders, miners, and long-running validation tasks record the state version they started from.

Results from older versions are stale.

## 75. Event ordering principle

The node must never rely on Nostr delivery order.

```text
relay arrival order
≠ transaction order
≠ blockchain order
```

Blockchain order comes only from genesis, parent links, and proof of work.

## 76. Time principle

`created_at` is preserved and authenticated as part of the Nostr event.

The ChainExecutor does not read the system clock for consensus.

Mining software should populate sensible current timestamps for relay compatibility, but a clock does not determine Nostr Blockchain v0 validity.

## 77. Failure behavior

### Database unavailable

Stop chain activation and mining.

### Signer unavailable

Pause mining but continue validation.

### All relays unavailable

Continue local validation, enter `DEGRADED`, and disable mining by default to avoid isolated-fork mining.

### High-work branch missing transactions

Continue the current active chain, fetch missing data, and do not reorg.

### State invariant failure

Stop the ChainExecutor, mark the node unhealthy, and require verify/reindex.

Never repair monetary state heuristically.

## 78. Security boundaries

Four trust zones:

```text
UNTRUSTED
    Nostr peers, relay messages, incoming events

AUTHENTICATED BUT NOT CONSENSUS-VALID
    correctly signed events

CONSENSUS-VALID BUT NOT ACTIVE
    mempool transactions, sidechain blocks

ACTIVE CONSENSUS STATE
    active chain, UTXO database
```

Moving inward requires progressively stronger validation.

## 79. Architectural anti-patterns to avoid

Do not introduce:

```text
independent mutable account balances
one UTXO database per fork
network callbacks that directly modify UTXOs
mining workers with database write access
mining workers holding private keys
transaction verification inside relay code
relay acceptance as confirmation
a separate block hash
a separate transaction hash
a second transaction-signature format
a general smart-contract abstraction
microservices for the first node
production difficulty adjustment in the reference implementation
```

## 80. Development phases

### Phase A — Pure consensus

Implement NIP-01, BIP340 verification, transaction codec, transaction validation, block codec, PoW, and state transition. Pass conformance vectors entirely in memory.

### Phase B — Chainstate

Implement UTXO store, block DAG, active chain, undo, reorg, and state digest.

### Phase C — Persistence

Implement SQLite and prove restart, replay, reindex, and crash recovery.

### Phase D — Nostr client

Implement relay connections, EVENT, REQ, live subscriptions, and exact-ID fetch.

### Phase E — Mining

Implement candidate builder, worker pool, signer, and block publication.

### Phase F — Embedded relay

Implement restricted Nostr relay and run nodes without third-party relays.

### Phase G — NIP-77

Add block-set reconciliation and prove fresh-node synchronization using only Nostr Blockchain full-node relays.

### Phase H — Hardening

Add fuzzing, resource limits, crash tests, DB verification, structured logs, and metrics.

## 81. Minimum successful node demonstration

Run:

```text
NODE A
    miner + relay + validator

NODE B
    validator + relay

NODE C
    validator
```

Start all three from the same genesis.

Node A mines rewards.

At maturity, Wallet A creates a signed TX Nostr event and publishes it to Node B's relay.

Node A receives it through Nostr, mines a block containing it, and publishes the block.

All nodes independently derive the same block ID, active tip, UTXO set, recipient balance, burned fee, and total supply.

Then partition Node A, mine competing branches, reconnect, and verify all nodes converge to the greater-work branch and the same UTXO digest.

No blockchain-specific network message is exchanged. Only Nostr messages and synchronization events move between nodes.

## 82. Reference-node definition

> **The Nostr Blockchain v0 reference node is a deterministic UTXO state machine with a proof-of-work block DAG, wrapped in a Nostr event transport and backed by one crash-consistent local database.**

```text
NOSTR
  │
  ▼
authenticated events
  │
  ▼
deterministic consensus
  │
  ▼
block DAG
  │
  ▼
greatest-work chain
  │
  ▼
UTXO state
  ├─ balances
  └─ burns
```

The most important implementation objective is that every boundary remains strict.

Nostr moves information.

Cryptography authenticates information.

Consensus judges information.

Proof of work orders information.

Chainstate gives information monetary meaning.

SQLite makes the resulting state durable.
