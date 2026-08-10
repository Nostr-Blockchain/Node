# Nostr Blockchain v0 — Production Network Specification

**Status:** final normative implementation, operations, testnet, and mainnet launch specification  
**Protocol:** v0  
**Native mainnet asset:** NSR  
**Public testnet display asset:** tNSR  
**Reference implementation:** TypeScript on Node.js 24 LTS  
**Persistence:** SQLite  
**Consensus PoW:** Nostr CacheWalk R1  
**External chain transport:** Nostr events over WebSocket relays  
**Standard full node:** consensus node + miner + wallet/control + archival event store + embedded Nostr relay in one process

This document supersedes every earlier prototype/mainnet draft. An implementation that conflicts with this document is non-conforming.

The objective is production launch readiness comparable to the engineering discipline expected of a mature cryptocurrency node: deterministic consensus, explicit network selection, canonical genesis identities, multi-node synchronization, crash-safe persistence, reorg correctness, adversarial relay handling, repeatable testnet/mainnet launches, extensive automated testing, secure key handling, operational observability, and release gates.

This does **not** claim the historical security assurance, decentralization, liquidity, review depth, or years of adversarial exposure of Bitcoin. Those properties cannot be created by a specification. This document instead defines the software and operational requirements required before Nostr Blockchain should be treated as a real public network rather than a prototype.

---

## 0. Non-negotiable architecture

The following rules are frozen for v0:

1. A standard full node is **one process**.
2. That process contains:
   - consensus validation;
   - UTXO state;
   - fork/reorg logic;
   - SQLite persistence;
   - mempool;
   - continuous mining;
   - local signer/wallet support;
   - outbound Nostr relay client connections;
   - an embedded restricted archival Nostr relay.
3. Starting a full node starts the embedded relay automatically.
4. A separate relay process is **not** required for normal mainnet or testnet operation.
5. External blockchain objects are transported as ordinary signed Nostr events.
6. Relays are transport/storage, never consensus authorities.
7. Nodes independently validate every block and transaction.
8. Mainnet and testnet use the same codebase and are selected with:
   - `--network mainnet`
   - `--network testnet`
9. The chain identity is always the genesis Nostr event ID, never the string `mainnet` or `testnet`.
10. Mainnet and testnet have separate canonical genesis events and separate data directories.
11. Every suitable full node mines continuously by default once it is READY, its signer is unlocked, and at least one **remote** write-capable relay is reachable.
12. Mining workers never receive private keys.
13. No account-balance table participates in consensus. Native monetary state is UTXO state only.
14. Same-block child spends are forbidden.
15. Minimum transaction fees are burned. Priority fees are paid to the miner.
16. All active-chain state transitions and reorgs are atomic SQLite transactions.
17. CacheWalk R1 is v0 consensus and is not runtime-selectable.
18. Mainnet/testnet consensus values are selected by immutable network parameters, not operator prompts.
19. Public bootstrap URLs are replaceable operational hints. Genesis is immutable.
20. No custom node-to-node P2P protocol exists in v0.

---

## 1. Normative language

`MUST`, `MUST NOT`, `REQUIRED`, `SHALL`, and `SHALL NOT` are normative.

`SHOULD` and `SHOULD NOT` are strong reference-node requirements that may be changed only when interoperability and safety are preserved.

`MAY` is optional.

A rule is **consensus** when disagreement can cause nodes to accept different chains or monetary states.

A rule is **policy** when a node may choose differently without changing consensus validity.

A rule is **operational** when it controls deployment, process lifecycle, discovery, security, monitoring, or release procedure.

---

## 2. Network model: `--network mainnet|testnet`

The public reference binary is:

```text
nostr-blockchain
```

`npm run nb` is not part of the public protocol or user-facing contract.

Every command that reads or mutates chain state MUST require an explicit network:

```text
--network mainnet
```

or:

```text
--network testnet
```

No release build may silently guess a different network from a data directory.

The two public networks are:

| Property | mainnet | testnet |
|---|---:|---:|
| Network name | `mainnet` | `testnet` |
| Display symbol | `NSR` | `tNSR` |
| Protocol version | 0 | 0 |
| TX kind | 7342 | 7342 |
| Block kind | 7343 | 7343 |
| Decimals | 8 | 8 |
| Block reward | 50.00000000 | 50.00000000 |
| Reward maturity | 240 blocks | 240 blocks |
| Target block interval | 15 s | 15 s |
| Difficulty window | 120 blocks | 120 blocks |
| Initial CacheWalk difficulty | 10 bits | 4 bits |
| Minimum difficulty | 1 | 1 |
| Maximum difficulty | 63 | 63 |
| NIP-13 prefilter | 6 bits | 6 bits |
| Base burn fee | 1000 base units | 1000 base units |
| Per-input burn fee | 250 base units | 250 base units |
| Per-output burn fee | 500 base units | 500 base units |
| Max inputs | 32 | 32 |
| Max outputs | 32 | 32 |
| Max transactions/block | 64 | 64 |
| Default embedded relay port | 7447 | 17447 |
| Default mining | continuous | continuous |
| Default mining workers | 1 | 1 |

The testnet intentionally preserves the same transaction, fee, reward-maturity, block-time, retarget, and state semantics as mainnet. Its lower initial PoW difficulty makes public testing and isolated integration tests practical.

A transaction or block from one network MUST be rejected by the other because every normal chain event commits to the selected chain ID in its `t` tag.

### 2.1 Default data directories

Unless `--data-dir` is explicitly supplied:

```text
~/.nostr-blockchain/mainnet/
~/.nostr-blockchain/testnet/
```

The directories MUST never be shared.

Each data directory contains at minimum:

```text
node.json
chain.sqlite
miner.ncryptsec          # absent for validator-only nodes
control.sock             # while running on POSIX
logs/
```

The database metadata MUST contain both selected network name and chain ID. A mismatch is fatal.

### 2.2 Network parameters and expected genesis IDs

The implementation MUST have a `NetworkParams` definition for both public networks.

After a public genesis has been launched, the release source MUST freeze the expected genesis ID for that network. Selecting `--network mainnet` or `--network testnet` therefore selects:

```text
network name
expected genesis ID
canonical genesis event
consensus constants
default local relay port
bootstrap relay hints
display symbol
```

The software MUST refuse a descriptor whose genesis ID differs from the compiled/bundled expected genesis ID for the selected network.

Before the one-time launch of a network, a special release-candidate build may have that network's expected genesis ID unset. Once launched, official releases MUST never return to an unset state.

---

## 3. Frozen v0 consensus constants

Common constants:

```text
PROTOCOL_VERSION             = 0
TX_KIND                      = 7342
BLOCK_KIND                   = 7343
DECIMALS                     = 8
BASE_UNITS_PER_NSR           = 100000000

BLOCK_REWARD                 = 5000000000
REWARD_MATURITY              = 240

BASE_FEE                     = 1000
INPUT_FEE                    = 250
OUTPUT_FEE                   = 500

MAX_TX_INPUTS                = 32
MAX_TX_OUTPUTS               = 32
MAX_BLOCK_TRANSACTIONS       = 64

TARGET_BLOCK_SECONDS         = 15
DIFFICULTY_WINDOW_BLOCKS     = 120
DIFFICULTY_FAST_NUMERATOR    = 3
DIFFICULTY_FAST_DENOMINATOR  = 4
DIFFICULTY_SLOW_NUMERATOR    = 3
DIFFICULTY_SLOW_DENOMINATOR  = 2
MIN_POW_DIFFICULTY           = 1
MAX_POW_DIFFICULTY           = 63
FUTURE_BLOCK_DRIFT_SECONDS   = 120

NIP13_GATE_BITS              = 6

CACHEWALK_R1_BYTES           = 262144
CACHEWALK_R1_LINE_BYTES      = 64
CACHEWALK_R1_LINES           = 4096
CACHEWALK_R1_PASSES          = 2

MAX_HEIGHT                   = 9223372036854775807
```

Network-specific:

```text
mainnet.initial_pow_difficulty = 10
testnet.initial_pow_difficulty = 4
```

There are no command-line overrides for these consensus values on public networks.

---

## 4. Chain identity and event scope

The genesis Nostr event ID is the chain ID.

Genesis uses:

```text
["t", "nostr-blockchain:genesis"]
```

Every non-genesis native transaction and block contains exactly one network scope tag:

```text
["t", "nostr-blockchain:<GENESIS_EVENT_ID>"]
```

A correct event kind with the wrong chain ID is invalid for the selected network.

The words `mainnet` and `testnet` are local network selectors only. They are not part of fork choice and do not confer authority.

---

## 5. Reference environment and build contract

The reference implementation MUST target Node.js 24 LTS.

A release repository MUST contain:

```text
package.json
package-lock.json
tsconfig.json
src/
tests/
networks/
README.md
SECURITY.md
```

`package.json` MUST expose the built CLI through its `bin` mapping, logically:

```json
{
  "bin": {
    "nostr-blockchain": "./dist/cli.js"
  }
}
```

The built CLI entrypoint MUST have the appropriate Node shebang/execute permissions for packaged POSIX releases.

A clean checkout MUST support:

```bash
npm ci
npm run build
npm run lint
npm run typecheck
npm test
```

Production dependencies MUST be pinned by the lockfile.

Consensus cryptography MUST be isolated behind a `CryptoProvider` interface and have deterministic vectors.

Mining uses `node:worker_threads`; workers are CPU workers only and never sign.

SQLite uses:

```text
journal_mode = WAL
synchronous = FULL
foreign_keys = ON
busy_timeout = 5000
```

The node MUST verify the effective PRAGMA values after opening the database.

---

## 6. Mandatory CLI contract

The release MUST expose the executable:

```text
nostr-blockchain
```

Required commands:

```text
nostr-blockchain version

nostr-blockchain key generate --out <FILE>

nostr-blockchain launch --network mainnet|testnet ...
nostr-blockchain network-info --network mainnet|testnet

nostr-blockchain init --network mainnet|testnet [...]
nostr-blockchain start --network mainnet|testnet [...]
nostr-blockchain stop --network mainnet|testnet [...]
nostr-blockchain status --network mainnet|testnet [--json]
nostr-blockchain doctor --network mainnet|testnet

nostr-blockchain signer unlock --network mainnet|testnet
nostr-blockchain signer lock --network mainnet|testnet

nostr-blockchain mining --network mainnet|testnet --mode continuous|disabled|mine-one

nostr-blockchain wallet address --network mainnet|testnet
nostr-blockchain wallet balance --network mainnet|testnet
nostr-blockchain wallet utxos --network mainnet|testnet

nostr-blockchain send --network mainnet|testnet \
  --to <NPUB_OR_HEX> \
  --amount <DECIMAL_NSR> \
  [--priority-fee <DECIMAL_NSR>]

nostr-blockchain block --network mainnet|testnet --height <H>
nostr-blockchain block --network mainnet|testnet --id <BLOCK_ID>
nostr-blockchain tx --network mainnet|testnet --id <TX_ID>
nostr-blockchain mempool --network mainnet|testnet

nostr-blockchain verify --network mainnet|testnet
nostr-blockchain reindex --network mainnet|testnet
nostr-blockchain replay --network mainnet|testnet --events <NDJSON>

nostr-blockchain conformance --network mainnet|testnet
```

Unknown commands, unknown flags, missing required values, invalid network names, wrong-network data directories, and unsafe overwrites MUST exit non-zero.

Every command MUST support `--help`.

No mandatory `relay start` command exists. The embedded relay belongs to the standard full-node process.

No public `regtest` network is exposed by the release CLI. Test harnesses may instantiate internal test-only network objects, but they MUST NOT be selectable by a production CLI flag.

---

## 7. Configuration

`init` writes `<data_dir>/node.json`.

Logical structure:

```json
{
  "format": "nostr-blockchain-node-v0",
  "network": "mainnet",
  "chain_id": "<GENESIS_ID>",
  "data_dir": "/home/user/.nostr-blockchain/mainnet",
  "signer": {
    "type": "local-ncryptsec",
    "path": "miner.ncryptsec"
  },
  "embedded_relay": {
    "enabled": true,
    "listen": "127.0.0.1:7447",
    "public_url": null,
    "tls": {
      "mode": "none",
      "cert": null,
      "key": null
    }
  },
  "outbound_relays": {
    "extra": [],
    "target_active": 8,
    "max_active": 16
  },
  "mining": {
    "mode": "continuous",
    "workers": 1,
    "min_remote_write_relays": 1
  },
  "control": {
    "enabled": true
  },
  "logging": {
    "level": "info"
  }
}
```

For testnet the default embedded relay listen port is `17447`.

A validator-only node uses:

```json
"signer": {"type":"none"}
```

Relative file paths in `node.json` are resolved relative to the configuration file.

### 7.1 Public embedded relay configuration

A public full node uses either direct TLS or loopback-only non-TLS.

Direct public WSS example:

```json
"embedded_relay": {
  "enabled": true,
  "listen": "0.0.0.0:7447",
  "public_url": "wss://node1.example.com:7447",
  "tls": {
    "mode": "direct",
    "cert": "/etc/nostr-blockchain/fullchain.pem",
    "key": "/etc/nostr-blockchain/privkey.pem"
  }
}
```

Rules:

- `public_url` MUST use `wss://`.
- A non-loopback listener advertised publicly MUST NOT use plaintext `ws://`.
- TLS private-key files MUST be readable only by the node service account where the OS permits.
- If `tls.mode = none`, `listen` MUST be loopback/private unless an explicit unsafe development option is compiled into a non-release build.
- The embedded relay MUST start automatically as part of `nostr-blockchain start`.

---

## 8. Full-node process architecture

One running full-node process contains:

```text
Nostr Blockchain Full Node
|
+-- NetworkParams / selected chain
+-- Strict Nostr parser
+-- Consensus validation
+-- Block DAG / fork choice
+-- ChainExecutor
+-- UTXO state
+-- SQLite event/archive store
+-- Undo/reorg data
+-- Mempool
+-- Miner coordinator
|   +-- worker_threads
+-- Signer
+-- Wallet utility
+-- Outbound Nostr relay pool
+-- Sync/dependency fetcher
+-- Embedded restricted archival Nostr relay
+-- Local control socket
+-- Logging/status/health
```

Consensus code MUST NOT depend on relay arrival order.

Consensus modules SHOULD be pure functions wherever practical and MUST NOT perform network access.

Only one logical `ChainExecutor` may mutate active consensus state.

---

## 9. Node lifecycle

`start` follows this exact high-level lifecycle:

```text
STARTING
  -> SELECT_NETWORK
  -> RESOLVE_DATA_DIR
  -> ACQUIRE_EXCLUSIVE_LOCK
  -> LOAD_CONFIG
  -> VERIFY_NETWORK_AND_CHAIN_ID
  -> OPEN_SQLITE
  -> VERIFY_PRAGMAS
  -> VERIFY_OR_MIGRATE_SCHEMA
  -> RECOVER_DATABASE
  -> VERIFY_OR_SEED_GENESIS
  -> START_EMBEDDED_RELAY
  -> CONNECT_OUTBOUND_RELAYS
  -> START_LIVE_SUBSCRIPTIONS
  -> DISCOVER_TIP_CANDIDATES
  -> INITIAL_SYNC
  -> SYNC_STABLE
  -> READY
  -> START_OR_RESUME_MINING
```

Shutdown:

```text
STOPPING
  -> STOP_NEW_MINING_WORK
  -> STOP_ACCEPTING_NEW_LOCAL_MUTATIONS
  -> FLUSH_PENDING_EVENT_PUBLICATIONS
  -> CLOSE_OUTBOUND_SUBSCRIPTIONS
  -> STOP_EMBEDDED_RELAY
  -> COMMIT/CHECKPOINT AS APPROPRIATE
  -> CLOSE_SQLITE
  -> REMOVE_CONTROL_SOCKET
  -> RELEASE_DATA_DIR_LOCK
  -> STOPPED
```

SIGINT and SIGTERM MUST invoke graceful shutdown.

SIGKILL/crash recovery is tested separately and MUST never produce half-applied active state.

### 9.1 READY definition

A fresh node may enter `READY` only when:

1. selected network descriptor and genesis validate;
2. database and active state are internally consistent;
3. embedded relay is running;
4. at least one **remote** read-capable relay is connected;
5. live block subscription is active;
6. at least one historical/tip-probe request has completed;
7. every currently discovered better-work candidate is either:
   - fully validated;
   - waiting for a concrete missing object;
   - invalid;
8. no strictly better fully validated tip has appeared during the final 30 seconds of initial synchronization;
9. if the selected release descriptor contains a non-zero `minimum_known_chainwork`, the best fully validated chain has reached or exceeded it.

`READY` is not proof of global history completeness. It means the node has completed the defined permissionless synchronization procedure against its reachable relay set.

The node's own embedded relay does not count as a remote relay for READY or mining-connectivity policy.

---

## 10. Embedded restricted archival relay

The embedded relay is mandatory for a standard full node and starts in the same process.

It implements ordinary Nostr relay behavior for the selected network.

At minimum it supports:

```text
NIP-01 event publish / subscription / EOSE / OK / CLOSED
NIP-11 relay information
NIP-65 relay-list event storage/query
```

NIP-77 support is strongly recommended for long-history reconciliation but is not required for consensus validity.

The relay is intentionally restricted. It is not a general-purpose social relay.

It stores/serves:

```text
canonical genesis
state-valid BLOCK_KIND events for the selected chain
state-valid side-branch BLOCK_KIND events retained by the node
transactions referenced by retained state-valid blocks
currently admitted bounded mempool TX_KIND events
kind 10002 NIP-65 relay-list events under bounded replaceable-event storage
```

It MUST NOT accept chain events for another chain ID into the selected chain store.

It MUST NOT determine consensus validity by itself; submitted chain events are routed through the node validation pipeline.

A relay-level `OK true` means the event was accepted for storage/processing, not that it became active consensus state.

The relay MUST permanently retain genesis and all canonical-chain blocks/transactions in v0. v0 standard full nodes are archival; pruning is not part of this release.

### 10.1 NIP-11 metadata

The embedded relay SHOULD expose NIP-11 metadata on the same endpoint.

The same TLS/listener endpoint MUST support both:
- normal HTTP GET requests carrying `Accept: application/nostr+json` for NIP-11 metadata; and
- WebSocket upgrade for Nostr protocol traffic.

A separate HTTP API is not required.

Because NIP-11 clients must ignore unknown fields, the relay MAY include:

```json
{
  "nostr_blockchain": {
    "network": "mainnet",
    "chain_id": "<GENESIS_ID>",
    "protocol_version": 0,
    "full_history": true
  }
}
```

These fields are discovery hints only.

Blockchain blocks and transactions still travel through Nostr WebSocket messages.

### 10.2 Relay resource limits

Reference defaults:

```text
max WebSocket message bytes      65536
max subscriptions/connection     64
max filters/REQ                   4
max ids/filter                    512
max authors/filter                256
max historical limit/filter      2048
max subscription id bytes        64
idle connection timeout          implementation policy
```

The NIP-11 `limitation` object SHOULD report effective relay limits.

---

## 11. Nostr-only network transport

All external transaction/block transport is standard Nostr over WebSocket.

Public relay URLs use:

```text
wss://
```

Loopback/private tests may use:

```text
ws://
```

No direct Bitcoin-style P2P wire protocol, libp2p protocol, raw block TCP protocol, or proprietary consensus RPC is permitted in v0.

The local control socket is not external blockchain networking.

NIP-11 HTTP metadata is permitted only as relay capability metadata; consensus objects are never accepted through an HTTP REST substitute.

---

## 12. Bootstrap relay topology

Each canonical public network descriptor launches with at least three `wss://` bootstrap URLs.

For the normal architecture those URLs are the embedded relay endpoints of initial full nodes:

```text
wss://node-a.example.com:7447
wss://node-b.example.com:7447
wss://node-c.example.com:7447
```

or corresponding testnet endpoints.

They are not separate mandatory relay servers.

The initial three full nodes SHOULD run on distinct machines and SHOULD use distinct hosting regions/providers where practical.

Bootstrap relay URLs are non-consensus hints. Losing all original bootstrap nodes does not change the chain ID.

A node SHOULD target eight active outbound relay connections when available and MUST support at least one.


A node MUST normalize relay URLs and recognize its configured `embedded_relay.public_url` as self. It MAY maintain a loopback self-connection for diagnostics, but that connection MUST NOT count toward remote READY/mining connectivity and SHOULD normally be omitted from the outbound pool.

---

## 13. Synchronization and tip discovery

Synchronization has four simultaneous components:

1. live subscription;
2. recent-block tip probe;
3. exact-ID dependency walking;
4. optional NIP-77 reconciliation.

### 13.1 Live subscription

Immediately after connecting, subscribe to:

```json
{"kinds":[7343],"#t":["nostr-blockchain:<CHAIN_ID>"]}
```

Live subscription begins before historical synchronization so blocks arriving during sync are not missed.

### 13.2 Recent-block tip probe

For each suitable relay, issue a historical query equivalent to:

```json
{
  "kinds":[7343],
  "#t":["nostr-blockchain:<CHAIN_ID>"],
  "limit":256
}
```

Under NIP-01, `limit` initial results are the latest matching events by `created_at`, subject to relay behavior.

Every returned block is only a candidate hint.

### 13.3 Exact parent walk

For an unknown candidate block:

1. cheap-validate envelope/ID/kind/scope/structure/signature;
2. obtain the exact parent block ID from its parent tag;
3. request the parent by exact Nostr event ID from multiple connected relays;
4. repeat until reaching known history/genesis;
5. request every referenced transaction by exact event ID;
6. topologically validate the branch forward;
7. compute expected difficulty and cumulative work locally;
8. submit fully state-valid tips to fork choice.

A relay's claimed height, order, EOSE, or history completeness is never trusted.

### 13.4 Missing object fetch policy

For a missing block/transaction:

- query source relay first;
- if no result within bounded timeout, query up to three other active relays;
- exponentially back off repeated misses;
- persist retry state;
- keep dependency queues bounded;
- never classify "not returned by a relay" as consensus invalidity.

### 13.5 NIP-77

NIP-77 MAY reconcile block/transaction event sets when both sides support it.

NIP-77 is an optimization. A conforming node must remain correct using only NIP-01 subscriptions and exact-ID requests.

---

## 14. Relay discovery

No custom chain-specific node-announcement event kind exists in v0.

Relay candidates come from:

```text
bundled network bootstrap hints
operator --relay arguments
persisted previously successful relays
NIP-65 kind:10002 relay lists from observed valid miner pubkeys
```

When a valid block authored by miner pubkey `P` is accepted, the node MAY query connected relays for the latest NIP-65 event by `P`.

Well-formed `wss://` URLs may enter a bounded candidate pool.

A public mining full node with `embedded_relay.public_url` configured SHOULD periodically publish a normal NIP-65 kind `10002` event from its mining pubkey listing the relays it uses, including its own public relay when appropriate.

NIP-65 metadata is never consensus.

---

## 15. Event rebroadcast and network propagation

Nostr relays do not inherently provide blockchain relay-to-relay gossip. Therefore full nodes MUST participate in propagation.

When a node first fully validates a new block event or a newly admitted transaction event, it SHOULD republish the **unchanged original signed Nostr event** to all active write-capable relays except the source relay.

Rules:

- never re-sign another author's event;
- deduplicate by event ID;
- keep a bounded seen/rebroadcast cache;
- blocks have higher propagation priority than unconfirmed transactions;
- transactions referenced by a newly validated block SHOULD be published before or with the block to relays that may not have them;
- publication failure never rolls back a locally valid block;
- failed publication enters a bounded retry queue;
- repeated duplicate `OK` responses are normal.

This rebroadcast rule is essential to allow partially overlapping relay sets to propagate the chain.

---

## 16. Strict Nostr event envelope

Consensus parsing starts from raw received JSON and MUST reject duplicate object keys.

A native transaction or block object contains exactly:

```text
id
pubkey
created_at
kind
tags
content
sig
```

and no additional members.

Requirements:

```text
id         64 lowercase hex chars
pubkey     64 lowercase hex chars, valid BIP340 x-only key
created_at integer, 0 <= value <= 9007199254740991
kind       integer, 0 <= value <= 65535
tags       array of arrays of strings only
content    string
sig        128 lowercase hex chars
```

Event ID:

```text
SHA256(UTF8(JSON_SERIALIZE([0,pubkey,created_at,kind,tags,content])))
```

Serialization follows NIP-01 exactly, including its required escaping rules.

The BIP340 signature MUST verify over the 32-byte event ID.

The NIP-01 signature is not part of the event-ID preimage. Therefore two independently valid signatures over the same committed event fields still identify the same transaction/block object.

Storage identity is `event.id`.

If the same ID is received multiple times with byte-identical committed fields and different valid signatures, the node MAY retain the first valid complete representation and MUST treat later representations as the same consensus object.

If two events claim the same ID but differ in any event-ID-committed field, the node treats this as a SHA-256 collision/equivocation outside the normal v0 threat model and MUST stop automatic processing of that ID rather than guessing.

### 16.1 Invalidity caching and signature malleability boundary

A node MUST distinguish **representation-invalid** from **ID-intrinsic-invalid** observations.

Representation-invalid examples include:

```text
invalid/missing BIP340 signature
extra top-level JSON member
duplicate JSON key
non-canonical received envelope that cannot be accepted as the native event
```

These MUST NOT permanently poison the event ID globally. A later representation carrying the same committed event fields and a valid signature/envelope must still be evaluated.

ID-intrinsic failures are failures determined entirely by event-ID-committed fields plus immutable selected-network consensus context, for example:

```text
wrong native kind/scope
malformed committed transaction content/tags
block event-ID PoW gate failure
CacheWalk failure for a known parent/network
```

These MAY be cached by event ID once the committed fields have been established unambiguously.

State-dependent transaction failures such as missing/spent inputs or reward maturity MUST NOT be globally cached across all possible parent states; they are evaluated in their block/mempool state context.

The persistent `events` table MUST NOT let an invalid-signature or otherwise representation-invalid arrival claim an event ID row and prevent a later valid representation. Persist the canonical/first acceptable signed representation only after envelope/ID/signature acceptance.

For native v0 chain events, consensus tags/content are restricted enough that independent implementations MUST reproduce the same event-ID preimage byte-for-byte.

---


## 17. Genesis event

Genesis is a special `BLOCK_KIND` event at height `0`.

It has no parent and no transaction references.

Tags are exactly:

```json
[
  ["t", "nostr-blockchain:genesis"],
  ["nonce", "<NONCE>", "6"]
]
```

`NONCE` is canonical unsigned decimal `u64`.

Genesis `content` is lowercase hex encoding of exactly 76 bytes:

```text
protocol_version       u8
block_reward           u128
reward_maturity        u32
pow_difficulty         u8
base_fee               u128
input_fee              u128
output_fee             u128
max_tx_inputs          u16
max_tx_outputs         u16
max_block_transactions u16
```

All multibyte fields are unsigned big-endian.

### 17.1 Mainnet genesis profile

```text
protocol_version       0
block_reward           5000000000
reward_maturity        240
pow_difficulty         10
base_fee               1000
input_fee              250
output_fee             500
max_tx_inputs          32
max_tx_outputs         32
max_block_transactions 64
```

### 17.2 Testnet genesis profile

```text
protocol_version       0
block_reward           5000000000
reward_maturity        240
pow_difficulty         4
base_fee               1000
input_fee              250
output_fee             500
max_tx_inputs          32
max_tx_outputs         32
max_block_transactions 64
```

### 17.3 Deterministic launch construction

For one invocation of `launch --network <network>`:

1. load the selected frozen network profile;
2. load the launcher pubkey;
3. capture:

```text
T = floor(current Unix time in seconds)
```

4. fix `created_at = T` for the nonce search;
5. start `nonce = 0`;
6. increment nonce by one after every failed candidate;
7. do not change any other event field during that nonce search.

The genesis event uses:

```text
pubkey     = launcher pubkey
created_at = T
kind       = BLOCK_KIND
tags       = exact genesis tags
content    = exact 76-byte selected-network genesis payload encoded lowercase hex
```

If the entire `u64` nonce space were exhausted, increment `created_at` by one, reset nonce to zero, and continue. This is practically unreachable but removes ambiguity.

### 17.3 Genesis PoW

For genesis:

```text
E = candidate NIP-01 event ID
G = E
P = 32 zero bytes
```

Genesis is valid only if:

```text
leading_zero_bits(E) >= 6
leading_zero_bits(CacheWalkR1(G,P,E)) >= genesis.pow_difficulty
```

A winning candidate is independently recomputed before the launch signer signs `E`.

Genesis creates no reward UTXO.

Initial supply is zero.

The genesis signing key has no protocol authority after genesis.

---

## 18. Transaction event format

A native transaction:

```text
kind = 7342
```

Its transaction ID is exactly its Nostr `event.id`.

The event author controls every input.

Binary `content`:

```text
version       u8
input_count   u16
inputs        Input[input_count]
output_count  u16
outputs       Output[output_count]
```

Input:

```text
source_id     32 bytes
output_index  u16
```

Output:

```text
owner_pubkey  32 bytes
amount        u128
```

Exact decoded length:

```text
5 + 34*input_count + 48*output_count
```

`version` MUST equal `0`.

### 18.1 Canonical input order

Inputs are unique and strictly ascending by:

```text
(source_id raw bytes, output_index unsigned integer)
```

Outputs retain authored order because the output index is consensus identity.

### 18.2 Exact transaction tags

Tags are exactly:

```text
1. ["t", "nostr-blockchain:<CHAIN_ID>"]
2. ["v", "0"]
3. one ["i", "<SOURCE_ID_HEX>", "<OUTPUT_INDEX_DECIMAL>"] for each input in binary order
4. one ["p", "<OWNER_PUBKEY_HEX>"] for each output in binary order
```

No other transaction tags are permitted.

Decimal indices use canonical unsigned decimal with no leading zero except `"0"`.

### 18.3 Transaction bounds

```text
1 <= input_count  <= 32
1 <= output_count <= 32
```

Every output amount MUST be greater than zero.

All monetary arithmetic uses `bigint`/exact unsigned integer arithmetic.

Floating point MUST NOT participate in consensus or wallet amount parsing.

---

## 19. UTXO state and transaction validity

An outpoint is:

```text
(source_id, output_index)
```

Normal output `k` creates:

```text
(tx.id, k)
```

A transaction is state-valid against the candidate block's **parent UTXO state** iff:

1. every referenced outpoint exists;
2. no input is duplicated;
3. every input owner equals `tx.pubkey`;
4. every reward input is mature at candidate block height;
5. every output pubkey is a valid x-only BIP340 key;
6. every output amount is non-zero;
7. all sums fit `u128`;
8. `sum(inputs) >= sum(outputs)`;
9. the fee rule is satisfied.

There is no script VM in v0.

A transaction signature authorizes all inputs.

---

## 20. Fee model

For a valid transaction:

```text
ACTUAL_FEE = sum(input amounts) - sum(output amounts)

MINIMUM_BURN =
    1000
  + 250 * input_count
  + 500 * output_count

require ACTUAL_FEE >= MINIMUM_BURN

PRIORITY_FEE = ACTUAL_FEE - MINIMUM_BURN
```

`MINIMUM_BURN` is destroyed.

`PRIORITY_FEE` is transferred to the block miner through the implicit reward UTXO.

Priority fees are not issuance.

---

## 21. Reward UTXO and supply

Every valid non-genesis block creates exactly one implicit reward UTXO:

```text
source_id    = block.id
output_index = 65535
owner        = block.pubkey
amount       = 5000000000 + sum(PRIORITY_FEE of included txs)
```

A reward created at height `Hr` is spendable in candidate block height `Hc` iff:

```text
Hc >= Hr + 240
```

The complete reward amount, including priority fees, matures together.

Consensus supply:

```text
SUPPLY =
    cumulative fixed block rewards
  - cumulative minimum fee burns
```

Genesis contributes zero supply.

Supply is `u128`; overflow is invalid.

The sum of all active UTXO amounts MUST equal consensus supply when all UTXOs, including immature reward UTXOs, are included.

---

## 22. Block event format

A non-genesis block is:

```text
kind    = 7343
content = "00"
```

The block ID is the normal Nostr event ID.

Tags are exactly:

```text
1. ["t", "nostr-blockchain:<CHAIN_ID>"]
2. ["e", "<PARENT_BLOCK_ID>", "", "parent"]
3. ["nonce", "<NONCE>", "6"]
4+. one ["e", "<TX_ID>", "", "tx"] for every included transaction
```

Transaction IDs are unique and strictly ascending by raw 32-byte value.

```text
0 <= transaction_count <= 64
```

`NONCE` is canonical unsigned decimal `u64`.

The nonce tag third field is exactly `"6"`.

Expected CacheWalk difficulty is derived from the parent chain and is not serialized or miner-selectable.

The event ID commits to:

```text
miner pubkey
created_at
kind
chain scope
parent
nonce
transaction IDs
content
```

There is no separate Merkle root in v0.

---

## 23. Same-block spend rule

Every transaction in a block validates independently against the **parent block UTXO state**.

A transaction MUST NOT spend an output created by another transaction in the same block.

A block MUST NOT contain two transactions that spend the same parent-state outpoint.

This makes transaction validation order-independent.

---

## 24. CacheWalk R1

`block.id` remains the ordinary NIP-01 event ID.

CacheWalk produces a derived work hash and never replaces `block.id`.

Mining:

```text
vary nonce
  -> compute NIP-01 event ID E
  -> require 6 leading zero bits in E
  -> CacheWalkR1(G,P,E)
  -> require expected difficulty in cpu_work_hash
```

Inputs:

```text
G = raw 32-byte genesis/chain ID
P = raw 32-byte parent block ID
E = raw 32-byte candidate event ID
```

Genesis special case:

```text
G = E
P = 32 zero bytes
```

Constants:

```text
scratch bytes = 262144
line bytes    = 64
lines         = 4096
passes        = 2
```

### 24.1 NIP-13-compatible prefilter

Before CacheWalk:

```text
leading_zero_bits(E) >= 6
```

The prefilter is constant across all v0 blocks and contributes zero credited chainwork.

### 24.2 Seed

```text
seed = SHA256(
    ASCII("NostrCacheWalk-R1/seed")
    || G || P || E
)
```

### 24.3 Scratchpad

Generate exactly 262144 bytes using RFC 8439 ChaCha20:

```text
key       = seed
nonce96   = 12 zero bytes
counter   = 0
plaintext = 262144 zero bytes
```

Interpret output as 4096 mutable lines of 64 bytes.

### 24.4 Initial state

```text
state = SHA256(
    ASCII("NostrCacheWalk-R1/state")
    || seed || P || E
)
```

### 24.5 Mutable walk

Execute exactly:

```text
for pass in 0 .. 1:
    for i in 0 .. 4095:
        j = U32LE(state[0:4]) & 4095

        A = COPY(line[i])
        B = COPY(line[j])

        m0 = SHA256(
            ASCII("NostrCacheWalk-R1/round/0")
            || state || A || B || LE32(pass) || LE32(i)
        )

        m1 = SHA256(
            ASCII("NostrCacheWalk-R1/round/1")
            || m0 || state || B || A || LE32(pass) || LE32(i)
        )

        line[i][0:32]  ^= m0
        line[i][32:64] ^= m1
        state = m0
```

`A` and `B` MUST be copied before mutation, including `i == j`.

### 24.6 Final hash

```text
j_final = U32LE(state[4:8]) & 4095

cpu_work_hash = SHA256(
    ASCII("NostrCacheWalk-R1/final")
    || state || line[j_final] || seed || P || E
)
```

PoW-valid:

```text
leading_zero_bits(cpu_work_hash) >= ExpectedDifficulty(height,parent)
```

CacheWalk parameters, domain strings, ChaCha parameters, endian rules, walk equations, and finalization are consensus. Changing any of them requires a future protocol version.

---

## 25. Block time and MedianTimePast

Transaction `created_at` is authenticated metadata only and has no monetary ordering meaning.

Block `created_at` participates in the v0 difficulty algorithm.

For a non-genesis block:

```text
block.created_at > MedianTimePast(parent)
```

`MedianTimePast(B)` is the median of `B.created_at` and up to ten preceding ancestors, maximum 11 timestamps.

During heights where fewer than 11 timestamps exist, sort all available timestamps and choose the lower middle element for an even count.

A received block with:

```text
block.created_at > local_unix_time + 120
```

is `FUTURE_TIME_PENDING`, not permanently invalid.

It is reconsidered as local time advances.

A node whose local clock is so far behind active-chain MTP that it cannot build a candidate acceptable to itself MUST pause mining with:

```text
CLOCK_BEHIND_CHAIN
```

Operators SHOULD use reliable system time synchronization.

---

## 26. Difficulty retarget

Target interval:

```text
15 seconds
```

Window:

```text
120 blocks
```

For heights `1..120`:

```text
ExpectedDifficulty = genesis.pow_difficulty
```

For `H > 120`, let:

```text
D = parent.work_difficulty
```

If:

```text
(H - 1) mod 120 != 0
```

then:

```text
ExpectedDifficulty = D
```

At a retarget height:

```text
end   = parent
start = ancestor(end, 120)

actual_span = MedianTimePast(end) - MedianTimePast(start)
target_span = 120 * 15 = 1800
```

`actual_span <= 0` is invalid ancestor history.

Then:

```text
if actual_span * 4 < target_span * 3:
    next = D + 1
else if actual_span * 2 > target_span * 3:
    next = D - 1
else:
    next = D

ExpectedDifficulty = clamp(next, 1, 63)
```

Thus:

```text
< 75% of target span  -> +1 difficulty bit
> 150% of target span -> -1 difficulty bit
otherwise             -> unchanged
```

All comparisons use exact integers.

There is no special testnet minimum-difficulty exception in v0. Testnet instead launches with initial difficulty 4.

---

## 27. Credited work and fork choice

Each valid non-genesis block contributes:

```text
credited_work = 2^work_difficulty
```

Extra lucky zero bits do not add credited work.

The constant 6-bit prefilter adds no chainwork because it is identical for all v0 blocks.

Cumulative work:

```text
sum(credited_work of all non-genesis blocks on branch)
```

Only fully state-valid branches participate in fork choice.

The active branch changes only when another fully state-valid tip has **strictly greater cumulative work**.

Height is not a substitute for work.

### 27.1 Equal-work behavior

If a live node sees an equal-work competing branch, it stays on its current active branch.

It MUST NOT reorg solely because another tip has a smaller ID or arrived later.

A fresh database that discovers several equal-work maximum tips before any active selection chooses the lexicographically smallest raw 32-byte tip ID as its initial local choice.

Reindex MUST preserve the remembered active tip when that tip is still a valid maximum-work tip.

---

## 28. Complete block validation pipeline

For non-genesis candidate height `H = parent.height + 1`:

1. enforce WebSocket/frame/resource limits;
2. strict-parse raw JSON and reject duplicate keys;
3. validate exactly seven event members;
4. validate primitive encodings;
5. recompute NIP-01 event ID;
6. require `BLOCK_KIND`;
7. require selected chain scope;
8. validate exact block content/tag layout;
9. reject duplicate tx IDs and self-parent;
10. verify BIP340 signature;
11. if parent is missing, queue/fetch parent before CacheWalk;
12. require `created_at > MedianTimePast(parent)`;
13. classify far-future block as pending;
14. derive expected difficulty;
15. check 6-bit event-ID prefilter;
16. enforce expensive-work rate policy;
17. execute CacheWalk;
18. require parent state-valid;
19. fetch referenced transactions by exact IDs;
20. require correct transaction kind/scope;
21. validate every transaction against parent UTXO state;
22. reject cross-transaction input conflicts;
23. compute total minimum burn;
24. compute total priority fee;
25. derive implicit reward;
26. verify all arithmetic/overflow bounds;
27. compute credited and cumulative work;
28. derive resulting UTXO/supply state;
29. store valid side branch or atomically connect if fork choice wins.

Missing parent or transaction data is pending, not invalid.

Cheap validation MUST precede CacheWalk whenever possible.

---

## 29. Mempool policy

Mempool policy is not consensus.

A transaction may enter the reference mempool if it is syntactically valid and state-valid for a candidate at `active_height + 1`.

The mempool MUST permit multiple conflicting valid spends of the same outpoint.

Reference conflict cap:

```text
4 transactions/outpoint
```

There is no first-seen consensus rule.

Reference miner selection:

1. higher absolute `PRIORITY_FEE` first;
2. equal priority: ascending `SHA256(parent_block_id || txid)`;
3. skip transactions conflicting with already selected inputs;
4. after the set is selected, sort tx IDs by raw ID for block serialization.

Mempool size is bounded.

Eviction is policy and MUST NOT alter consensus.

After restart or reorg, persisted mempool entries are fully revalidated against the new active tip.

Transactions disconnected by reorg SHOULD be reconsidered if still valid.

---

## 30. Mining architecture

Continuous mining is enabled by default.

Modes:

```text
continuous
disabled
mine-one
```

`mine-one` is local operator/test tooling and returns to `disabled` after one successful block.

Mining begins/resumes when:

```text
lifecycle == READY
signer unlocked
mining.mode == continuous
remote write-capable relay count >= 1
no fatal storage/consensus error
clock acceptable
```

The node's own embedded relay does not satisfy the remote-relay requirement.

Reference default:

```text
workers = 1
```

Workers receive:

```text
chain ID
parent ID
candidate timestamp
miner pubkey
sorted tx ID set
nonce range
expected difficulty
```

Workers never receive the secret scalar.

### 30.1 Candidate timestamp construction

For every new mining generation:

```text
candidate_created_at =
    max(floor(current Unix time), MedianTimePast(parent) + 1)
```

If:

```text
candidate_created_at > floor(current Unix time) + 120
```

the node pauses mining with `CLOCK_BEHIND_CHAIN`.

The candidate timestamp is fixed while workers vary nonce.

If the `u64` nonce range is exhausted, rebuild a new candidate with a new valid timestamp.

When a worker reports a winner, the main process independently recomputes:

```text
event ID
NIP-13 gate
expected difficulty
CacheWalk hash
target result
```

Only then does it request a signature.

A tip change or expected-difficulty change invalidates the mining generation and all old worker results.

A newly arrived mempool transaction does **not** automatically invalidate the current candidate. The miner MAY rebuild periodically to improve fees.

When a block is found:

1. independently revalidate;
2. sign;
3. submit through normal block validation;
4. atomically commit locally;
5. publish included transaction events;
6. publish block event;
7. rebroadcast through active relay pool.

Publication failure never undoes the local valid block.

If all remote write relays disappear, mining pauses and automatically resumes after connectivity returns.

Mining is intentionally always-on policy for suitable full nodes, but the reference implementation SHOULD:

```text
run workers at low OS scheduling priority where practical
honor explicit operator worker limits
observe platform thermal/power signals where practical
throttle or pause before unsafe thermal conditions
report THERMAL_THROTTLE or POWER_POLICY in status
```

Thermal/power throttling is local policy and never changes block validity.

Mobile/light-client profiles are outside the standard full-node profile and do not mine by default.

---


## 31. SQLite persistence and active-state atomicity

The reference node uses one SQLite database per selected network.

Required startup PRAGMAs:

```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=FULL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
```

The node MUST verify the returned/effective settings.

Exactly one process may hold the writable network data directory.

A network-specific lock file/OS lock MUST prevent two nodes from mutating the same database.

A stale lock file may be removed only after the implementation has established that no live process owns the lock.

### 31.1 Single active-state writer

All active UTXO, active-chain, supply, undo, and mempool-confirmation mutations flow through one logical `ChainExecutor`.

No relay callback, worker thread, wallet call, or sync handler may directly mutate active consensus tables.

### 31.2 Atomic block connect

Connecting one block is one SQLite transaction containing:

```text
spend input UTXOs
create normal output UTXOs
create implicit reward UTXO
write undo records
write block-derived monetary totals
update supply
update active_chain
update active tip metadata
remove confirmed mempool transactions
commit
```

### 31.3 Atomic reorg

A reorg of any depth is one SQLite transaction:

```text
find common ancestor
disconnect old branch in reverse order
restore spent UTXOs
delete created UTXOs
restore supply
connect winning branch forward
apply spends/creates/rewards/burns
update active_chain
reconsider disconnected transactions
commit
```

On process loss, observers must see either the pre-reorg state or post-reorg state, never an intermediate state.

### 31.4 Side-branch validation

Evaluating a side branch MUST NOT mutate the active UTXO tables.

The reference implementation uses an in-memory `StateOverlay`:

```text
active state
  -> logically undo to common ancestor
  -> apply side branch in memory
  -> validate resulting state/work
```

Only a winning branch is applied to SQLite.

---

## 32. Reference schema

Implementations may add indexes or non-consensus columns, but must preserve equivalent semantics.

```sql
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value BLOB NOT NULL
);

CREATE TABLE events (
  id BLOB PRIMARY KEY,
  kind INTEGER NOT NULL,
  pubkey BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  raw_json TEXT NOT NULL
);

CREATE TABLE transactions (
  id BLOB PRIMARY KEY,
  author BLOB NOT NULL,
  input_count INTEGER NOT NULL,
  output_count INTEGER NOT NULL,
  actual_fee BLOB,
  minimum_burn BLOB,
  priority_fee BLOB,
  validation_state TEXT NOT NULL
);

CREATE TABLE tx_inputs (
  tx_id BLOB NOT NULL,
  input_pos INTEGER NOT NULL,
  source_id BLOB NOT NULL,
  output_index INTEGER NOT NULL,
  PRIMARY KEY (tx_id, input_pos),
  FOREIGN KEY (tx_id) REFERENCES transactions(id)
);

CREATE TABLE tx_outputs (
  tx_id BLOB NOT NULL,
  output_index INTEGER NOT NULL,
  owner BLOB NOT NULL,
  amount BLOB NOT NULL,
  PRIMARY KEY (tx_id, output_index),
  FOREIGN KEY (tx_id) REFERENCES transactions(id)
);

CREATE TABLE blocks (
  id BLOB PRIMARY KEY,
  parent_id BLOB,
  miner BLOB NOT NULL,
  height INTEGER,
  validation_state TEXT NOT NULL,
  work_difficulty INTEGER,
  median_time_past INTEGER,
  credited_work BLOB,
  cumulative_work BLOB,
  total_burn BLOB,
  total_priority BLOB,
  reward_amount BLOB,
  supply_after BLOB
);

CREATE TABLE block_transactions (
  block_id BLOB NOT NULL,
  tx_pos INTEGER NOT NULL,
  tx_id BLOB NOT NULL,
  PRIMARY KEY (block_id, tx_pos),
  FOREIGN KEY (block_id) REFERENCES blocks(id)
);

CREATE TABLE active_chain (
  height INTEGER PRIMARY KEY,
  block_id BLOB NOT NULL UNIQUE,
  FOREIGN KEY (block_id) REFERENCES blocks(id)
);

CREATE TABLE utxos (
  source_id BLOB NOT NULL,
  output_index INTEGER NOT NULL,
  owner BLOB NOT NULL,
  amount BLOB NOT NULL,
  created_height INTEGER NOT NULL,
  is_reward INTEGER NOT NULL,
  PRIMARY KEY (source_id, output_index)
);

CREATE TABLE undo_spent (
  block_id BLOB NOT NULL,
  source_id BLOB NOT NULL,
  output_index INTEGER NOT NULL,
  owner BLOB NOT NULL,
  amount BLOB NOT NULL,
  created_height INTEGER NOT NULL,
  is_reward INTEGER NOT NULL,
  PRIMARY KEY (block_id, source_id, output_index)
);

CREATE TABLE undo_created (
  block_id BLOB NOT NULL,
  source_id BLOB NOT NULL,
  output_index INTEGER NOT NULL,
  PRIMARY KEY (block_id, source_id, output_index)
);

CREATE TABLE undo_state (
  block_id BLOB PRIMARY KEY,
  supply_before BLOB NOT NULL,
  previous_tip_id BLOB NOT NULL,
  previous_height INTEGER NOT NULL
);

CREATE TABLE mempool (
  tx_id BLOB PRIMARY KEY,
  added_at INTEGER NOT NULL,
  priority_fee BLOB NOT NULL
);

CREATE TABLE mempool_inputs (
  tx_id BLOB NOT NULL,
  source_id BLOB NOT NULL,
  output_index INTEGER NOT NULL,
  PRIMARY KEY (tx_id, source_id, output_index)
);

CREATE TABLE missing_objects (
  id BLOB PRIMARY KEY,
  object_type TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  retry_after INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);

CREATE TABLE relay_state (
  url TEXT PRIMARY KEY,
  last_connected INTEGER,
  last_eose INTEGER,
  last_error TEXT,
  source TEXT,
  score INTEGER NOT NULL DEFAULT 0,
  read_ok INTEGER NOT NULL DEFAULT 0,
  write_ok INTEGER NOT NULL DEFAULT 0
);
```

There is intentionally no `node_announcements` table.

`block_transactions.tx_id` intentionally has no immediate foreign key to `transactions(id)` because a block may arrive before referenced transaction bodies.

All monetary/cumulative-work BLOBs are exactly 16-byte unsigned big-endian values.

Hashes and public keys are 32-byte BLOBs.

### 32.1 Schema version

`meta` MUST contain:

```text
schema_version
network
chain_id
protocol_version
active_tip
active_height
supply
```

v0 release schema version starts at `1`.

A future unknown schema version causes startup refusal rather than silent rewriting.

Schema migrations must be explicit, versioned, atomic, and tested on copies of real databases.

---

## 33. Diagnostic UTXO digest and state hash

Each active UTXO is encoded as exactly 91 bytes:

```text
source_id       32 bytes
output_index     2 bytes u16 big-endian
owner_pubkey    32 bytes
amount          16 bytes u128 big-endian
created_height   8 bytes u64 big-endian
flags            1 byte
```

Flags:

```text
bit 0 = reward UTXO
bits 1..7 = zero
```

Sort by:

```text
(source_id raw bytes, output_index)
```

Then:

```text
UTXO_DIGEST = SHA256(concat(all records))
```

For an empty UTXO set, hash the empty byte string.

Diagnostic state hash:

```text
STATE_HASH = SHA256(
    ASCII("NostrBlockchain-v0/state")
    || CHAIN_ID
    || U64BE(active_height)
    || ACTIVE_TIP_ID
    || U8(active_effective_difficulty)
    || U128BE(active_cumulative_work)
    || U128BE(supply)
    || UTXO_DIGEST
)
```

At genesis height 0:

```text
active_effective_difficulty = genesis.pow_difficulty
active_cumulative_work      = 0
```

These hashes are diagnostic/conformance values, not consensus commitments inside blocks.

---

## 34. Signer and key security

`key generate` uses the operating-system CSPRNG and generates a valid non-zero secp256k1 secret scalar.

Default local key storage is NIP-49 `ncryptsec`.

On POSIX, secret files SHOULD be mode `0600`.

The implementation MUST NOT:

```text
print secret keys
log secret keys
place key passwords in command-line arguments
send private keys to worker threads
send private keys to relays
commit keys into network descriptors
```

Supported signer types:

```text
local-ncryptsec
none
```

NIP-46 remote signing MAY be added as non-consensus functionality.

### 34.1 Unlocking

Interactive `start` may prompt to unlock the local signer.

For service/daemon environments, a secure password file descriptor or equivalent protected secret-input mechanism SHOULD be supported.

A password MUST NOT be accepted through a normal visible process argument.

Commands:

```text
nostr-blockchain signer unlock --network <network>
nostr-blockchain signer lock --network <network>
```

operate through the local control socket.

Locking the signer pauses mining and signing but does not stop validation/synchronization.

### 34.2 Network-specific keys

`init --network mainnet` and `init --network testnet` generate separate keys by default.

Reusing a key across networks is allowed cryptographically but SHOULD NOT be the default.

---

## 35. Wallet model

The reference wallet is intentionally minimal.

It controls one signer pubkey and derives balances from that pubkey's active UTXOs.

Wallet views:

```text
confirmed
spendable
immature_reward
pending
```

No account-balance table is consensus.

The CLI MUST always display selected network alongside balances and send confirmations.

On testnet it displays `tNSR`.

### 35.1 Decimal parsing

Exactly:

```text
1 NSR = 100000000 base units
```

User-entered monetary strings MUST match:

```text
^(0|[1-9][0-9]*)(\.[0-9]{1,8})?$
```

Thus exponential notation, signs, embedded whitespace, commas, empty integer/fractional components, and more than 8 decimals are rejected.

For `send`:

```text
amount > 0
priority_fee >= 0
```

All values must fit the applicable `u128` arithmetic after conversion.

Integer conversion is exact; floating point is forbidden.

### 35.2 Deterministic coin selection

For requested recipient amount `A` and requested priority fee `P`, `P` is the **minimum requested priority fee**.

1. enumerate spendable active UTXOs owned by the wallet;
2. exclude immature rewards;
3. sort by:
   - amount descending;
   - `source_id` ascending;
   - `output_index` ascending;
4. add UTXOs in that order until the selected sum `S` can fund at least a one-output payment;
5. never select more than `MAX_TX_INPUTS = 32`.

Because UTXOs are sorted amount-descending, if the largest 32 spendable UTXOs cannot fund the payment and fees, no other set of at most 32 wallet UTXOs can do so. Fail cleanly rather than constructing an invalid transaction.

For `n` selected inputs:

```text
F1 = BASE_FEE + INPUT_FEE*n + OUTPUT_FEE + P
```

Continue selecting until:

```text
S >= A + F1
```

Then:

```text
R = S - A - F1
```

Cases:

**Case A — exact one-output payment**

```text
R = 0
```

Create only recipient output. Actual priority fee is exactly `P`.

**Case B — remainder too small to justify a positive change output**

```text
0 < R <= OUTPUT_FEE
```

Create only recipient output. The remainder becomes additional priority fee:

```text
actual_priority = P + R
```

The wallet MUST display the actual fee before signing.

**Case C — positive change**

```text
R > OUTPUT_FEE
```

Creating change adds one more output fee:

```text
change = R - OUTPUT_FEE
```

Create:

```text
output 0 = recipient, A
output 1 = wallet pubkey, change
```

Actual priority fee remains exactly `P`.

This guarantees that the wallet never emits a zero/negative change output and never accidentally burns a remainder. Any small one-output remainder becomes miner priority, not minimum burn.

Input order is canonicalized by consensus outpoint order before serialization.

### 35.3 Sending

```bash
nostr-blockchain send \
  --network mainnet \
  --to <NPUB_OR_HEX> \
  --amount 10.00000000 \
  --priority-fee 0.00000000
```

The wallet:

1. resolves recipient;
2. checks selected network;
3. selects UTXOs;
4. computes exact fees;
5. builds binary content;
6. derives exact tags;
7. computes NIP-01 event ID;
8. signs;
9. verifies its own transaction from scratch;
10. admits to local mempool;
11. publishes/rebroadcasts through write relays.

---

## 36. Local control socket

The running node exposes a local-only control endpoint:

```text
<data_dir>/control.sock
```

on POSIX.

It MUST NOT bind a public TCP control port by default.

The control channel supports:

```text
status
stop
signer lock/unlock
mining mode
wallet queries
transaction submission
verify progress
test-only hooks in non-release test harnesses
```

The socket is created only after acquiring the data-directory lock.

On POSIX:

```text
data directory SHOULD be 0700
control socket MUST be owner-only (0600-equivalent access)
local secret-key files MUST be 0600
database/config SHOULD not be group/world writable
```

On platforms without POSIX modes, equivalent owner/user ACLs MUST be used.

Because the control channel can unlock signing, change mining state and submit wallet transactions, failure to establish the required access control is a startup error, not a warning.

A stale socket may be removed only after confirming no live process owns the data directory.

---

## 37. Network descriptor

Each public network ships:

```text
networks/mainnet.json
networks/testnet.json
```

Logical schema:

```json
{
  "format": "nostr-blockchain-network-v0",
  "network": "mainnet",
  "chain_id": "<64 lowercase hex genesis event ID>",
  "protocol_version": 0,
  "display_symbol": "NSR",
  "minimum_known_chainwork": "0",
  "minimum_known_height": 0,
  "minimum_known_block_id": "<GENESIS_ID>",
  "genesis_event": {
    "id": "...",
    "pubkey": "...",
    "created_at": 0,
    "kind": 7343,
    "tags": [],
    "content": "...",
    "sig": "..."
  },
  "bootstrap_relays": [
    {"url":"wss://node-a.example.com:7447"},
    {"url":"wss://node-b.example.com:7447"},
    {"url":"wss://node-c.example.com:7447"}
  ]
}
```

For testnet:

```text
network        = testnet
display_symbol = tNSR
```

The descriptor's duplicated human-readable `network`/`display_symbol` values are not consensus.

The node derives consensus monetary parameters from the selected `NetworkParams` and validates the genesis payload against them.

Rules:

```text
chain_id == genesis_event.id
genesis signature valid
genesis PoW valid
genesis payload == selected network profile
genesis ID == selected network expected genesis ID after public launch
```

Bootstrap URLs may change across software releases without changing chain identity.

### 37.1 Non-consensus minimum-known-work bootstrap floor

A release descriptor MAY be updated with a previously observed, deeply settled chainwork floor:

```text
minimum_known_chainwork
minimum_known_height
minimum_known_block_id
```

These fields are **not consensus** and never make a block valid.

A fresh node using a release with a non-zero floor MUST NOT enter `READY` or mine while its best fully validated chain has cumulative work below that floor. It continues searching other relays.

This protects a fresh node from declaring itself synchronized to an obviously stale/eclipsed history relative to the software release it installed.

The node still validates every block from genesis and still follows a valid greater-work chain even if it conflicts with the hinted block ID.

v0 does not implement `assumevalid`; signature, PoW, transaction, and state validation are never skipped because of a release hint.


A new descriptor with the same canonical genesis but updated bootstrap hints is still the same network.

A descriptor with a different genesis is a different blockchain even if its `"network"` string says `"mainnet"`.

---

## 38. One-time `launch --network`

The same generic launch command creates either public network.

Testnet:

```bash
nostr-blockchain launch \
  --network testnet \
  --launcher-key ./keys/testnet-launcher.ncryptsec \
  --bootstrap wss://testnet-node-a.example.com:17447 \
  --bootstrap wss://testnet-node-b.example.com:17447 \
  --bootstrap wss://testnet-node-c.example.com:17447
```

Mainnet:

```bash
nostr-blockchain launch \
  --network mainnet \
  --launcher-key ./keys/mainnet-launcher.ncryptsec \
  --bootstrap wss://node-a.example.com:7447 \
  --bootstrap wss://node-b.example.com:7447 \
  --bootstrap wss://node-c.example.com:7447
```

No `--out` or `--genesis-out` arguments are needed for the standard launch path.

The command writes fixed paths:

```text
networks/<network>.json
networks/<network>-genesis.json
```

For example:

```text
networks/mainnet.json
networks/mainnet-genesis.json

networks/testnet.json
networks/testnet-genesis.json
```

This removes ambiguity over where network files come from.

The command MUST require at least three syntactically valid public `wss://` bootstrap URLs.

The three URLs MUST have distinct normalized hostnames (or distinct literal IP addresses). A launch candidate that merely uses three paths/ports on one hostname MUST be refused. This is an operational failure-domain requirement, not consensus.

It MUST refuse:

```text
unknown network
existing descriptor overwrite
parameter overrides
wrong launcher-key format
bootstrap ws:// public URLs
duplicate bootstrap URLs
launch from a dirty/incompatible profile
```

It automatically:

1. selects the frozen network profile;
2. constructs genesis;
3. searches nonce;
4. performs event-ID 6-bit gate;
5. performs CacheWalk;
6. independently verifies winning candidate;
7. signs with launcher key;
8. verifies completed signed genesis from scratch;
9. sets `chain_id = genesis_event.id`;
10. initializes descriptor bootstrap floor to:
    - `minimum_known_chainwork = "0"`
    - `minimum_known_height = 0`
    - `minimum_known_block_id = genesis_event.id`;
11. writes descriptor and standalone genesis files using temp-file + flush/fsync + atomic rename where supported;
12. refuses to leave one public artifact updated while the other still describes a different genesis;
13. prints:
    - network;
    - chain ID;
    - genesis event ID;
    - genesis SHA-256 file digest;
    - descriptor SHA-256 file digest;
    - frozen profile summary.

Before returning success, the launch command reopens both files from disk and verifies them again.

Once a public descriptor is committed into an official release, `launch --network` for that network MUST refuse to create a second official chain unless the operator is using a deliberately modified/forked source tree.

---

## 39. `init --network`

Normal users do not create genesis.

Example:

```bash
nostr-blockchain init --network mainnet
```

Default data directory:

```text
~/.nostr-blockchain/mainnet/
```

`init` performs:

1. select bundled network;
2. verify canonical descriptor;
3. verify genesis from first principles;
4. create the data directory with owner-restricted permissions;
5. verify effective data-directory access control;
6. acquire temporary exclusive initialization lock;
7. create `node.json`;
8. create empty SQLite DB/schema;
9. store network name/chain ID/schema metadata;
10. seed canonical genesis;
11. create encrypted miner key unless `--validator-only`;
12. configure embedded relay enabled;
13. configure bootstrap relay hints;
14. release lock.

It MUST NOT start a second process or create a standalone relay service.

It MUST NOT regenerate genesis.

It MUST refuse an existing incompatible directory.

### 39.1 Public bootstrap node initialization

Example direct-TLS bootstrap node:

```bash
nostr-blockchain init \
  --network mainnet \
  --relay-listen 0.0.0.0:7447 \
  --relay-public-url wss://node-a.example.com:7447 \
  --relay-tls-cert /etc/nostr-blockchain/fullchain.pem \
  --relay-tls-key /etc/nostr-blockchain/privkey.pem
```

Equivalent testnet uses the testnet network and normally port `17447`.

---

## 40. `start --network`

Normal start:

```bash
nostr-blockchain start --network mainnet
```

or:

```bash
nostr-blockchain start --network testnet
```

The process starts:

```text
database
consensus engine
embedded relay
outbound relay client pool
sync engine
mempool
mining coordinator
local control socket
```

in one process.

The normal interactive start unlocks the local signer when requested.

For coordinated public-network launch:

```bash
nostr-blockchain start --network mainnet --no-unlock
```

starts the full node with signer locked, allowing operators to bring several nodes to READY before mining begins.

For unattended service-manager startup, the reference implementation MUST support:

```bash
nostr-blockchain start   --network mainnet   --signer-password-file /run/credentials/nostr-blockchain-signer
```

The argument exposes only a filesystem path, never the password. The credential file MUST be read once, MUST NOT be copied into persistent configuration/logs, and SHOULD reside on a protected runtime filesystem. The node MUST reject a credential file that is group/world readable on POSIX unless an explicit unsafe development override is used.

`--relay <WSS_URL>` may add emergency/manual bootstrap relays for that invocation.

---

## 41. Status, doctor, stop, verify, and reindex

Status:

```bash
nostr-blockchain status --network mainnet
nostr-blockchain status --network mainnet --json
```

At minimum reports:

```text
software version
protocol version
network
chain ID
lifecycle
height
tip
cumulative work
current difficulty
next difficulty
MTP
supply
UTXO count
UTXO digest
state hash
mempool count
embedded relay state/listen/public URL
remote relay count
remote read/write relay URLs
missing object count
signer state
mining mode
worker count
CacheWalk rate
pause reason
disk/database status
```

`doctor` performs non-destructive operational checks:

```bash
nostr-blockchain doctor --network mainnet
```

including:

```text
descriptor/genesis verification
data-dir permissions
database lock
SQLite integrity quick check
schema/network/chain ID
key readability without exposing secret
TLS certificate/key load
embedded relay bind availability
bootstrap URL syntax
system clock sanity relative to active MTP
free disk-space warning
```

Stop:

```bash
nostr-blockchain stop --network mainnet
```

Verify:

```bash
nostr-blockchain verify --network mainnet
```

performs full or configured-depth chain/state verification without trusting stored validity flags.

Reindex:

```bash
nostr-blockchain reindex --network mainnet
```

requires exclusive offline access and reconstructs all derived state from retained events.

Replay:

```bash
nostr-blockchain replay \
  --network mainnet \
  --events ./events.ndjson
```

builds a clean database from the event corpus and must reproduce the same state for the same selected history.

---

## 42. Recovery rules

### 42.1 Clean restart

A normal restart must preserve:

```text
network
chain ID
active tip
height
cumulative work
supply
UTXO digest
state hash
```

and then resume synchronization/mining.

### 42.2 Crash restart

After SIGKILL/power-loss simulation:

1. acquire lock;
2. open SQLite;
3. allow WAL recovery;
4. verify metadata;
5. run consistency checks;
6. resume from a completely committed state;
7. never infer a half-applied reorg.

### 42.3 Corruption

If database integrity or chain-state invariants fail:

- stop mining immediately;
- do not silently continue;
- report `STORAGE_CORRUPT`;
- offer `verify`/`reindex`;
- if retained event data is incomplete/corrupt, allow operator to move damaged DB aside and resynchronize from genesis.

### 42.4 Disk full / I/O failure

On `SQLITE_FULL`, fsync failure, disk I/O error, or equivalent:

- active transition fails atomically;
- mining pauses;
- node does not announce READY mining state;
- error is visible in status/log;
- process may remain online read-only only when consistency is known;
- operator intervention is required before normal mutation resumes.

---


## 43. Resource and DoS policy

These are reference policies unless explicitly stated otherwise.

Required protections:

```text
bounded WebSocket frame size
bounded subscriptions
bounded filter arrays
bounded historical results
bounded mempool
bounded conflicts/outpoint
bounded orphan/unknown-parent queue
bounded missing-object queue
bounded publication retry queue
bounded relay candidate pool
bounded concurrent exact-ID requests/relay
bounded CacheWalk verification work/source
bounded worker messages
```

Cheap validation MUST precede expensive CacheWalk whenever possible.

Unknown-parent blocks are queued/fetched before CacheWalk.

A source repeatedly sending expensive invalid candidates may be throttled/disconnected without blacklisting the event ID globally.

The same event arriving through another source is evaluated normally unless its ID has been cached as **ID-intrinsic-invalid** under Section 16.1. Representation-invalid or state-context-invalid observations do not globally poison that ID.

Slow connections and incomplete WebSocket frames MUST have timeouts.

The embedded relay MUST not store arbitrary unbounded generic Nostr traffic.

---

## 44. Consensus and operational error codes

Reference implementations SHOULD expose stable machine-readable codes.

Transaction:

```text
TX_BAD_JSON
TX_BAD_NIP01_ID
TX_BAD_SIGNATURE
TX_BAD_KIND
TX_BAD_SCOPE
TX_BAD_TAGS
TX_BAD_CONTENT_HEX
TX_BAD_VERSION
TX_BAD_COUNTS
TX_BAD_LENGTH
TX_INPUT_ORDER
TX_DUPLICATE_INPUT
TX_INPUT_MISSING
TX_WRONG_OWNER
TX_IMMATURE_REWARD
TX_OUTPUT_ZERO
TX_BAD_OUTPUT_KEY
TX_VALUE_OVERFLOW
TX_OUTPUTS_EXCEED_INPUTS
TX_FEE_TOO_LOW
```

Block:

```text
BLOCK_BAD_JSON
BLOCK_BAD_NIP01_ID
BLOCK_BAD_SIGNATURE
BLOCK_BAD_KIND
BLOCK_BAD_SCOPE
BLOCK_BAD_TAGS
BLOCK_BAD_CONTENT
BLOCK_BAD_NONCE
BLOCK_GATE_FAILED
BLOCK_CACHEWALK_FAILED
BLOCK_BAD_TIME
BLOCK_FUTURE_TIME_PENDING
BLOCK_BAD_DIFFICULTY
BLOCK_SELF_PARENT
BLOCK_PARENT_MISSING
BLOCK_PARENT_INVALID
BLOCK_PARENT_CYCLE
BLOCK_TX_DUPLICATE
BLOCK_TX_MISSING
BLOCK_TX_INVALID
BLOCK_INPUT_CONFLICT
BLOCK_REWARD_OVERFLOW
```

Network/operation:

```text
NETWORK_REQUIRED
NETWORK_UNKNOWN
NETWORK_DESCRIPTOR_INVALID
NETWORK_GENESIS_MISMATCH
NETWORK_DATA_DIR_MISMATCH
NETWORK_CROSS_REPLAY
BOOT_NO_REMOTE_RELAY
BOOT_SYNC_INCOMPLETE
BOOT_SCHEMA_MISMATCH
BOOT_DATABASE_CHAIN_MISMATCH
BOOT_SIGNER_LOCKED
BOOT_SIGNER_UNAVAILABLE
RELAY_TLS_CONFIG_INVALID
RELAY_BIND_FAILED
RELAY_DEGRADED
NO_REMOTE_WRITE_RELAY
CLOCK_BEHIND_CHAIN
STORAGE_FULL
STORAGE_IO_ERROR
STORAGE_CORRUPT
CONTROL_UNAVAILABLE
MAINTENANCE_LOCKED
CLI_REFUSE_OVERWRITE
```

---

## 45. CacheWalk deterministic conformance vector

Inputs:

```text
G = 000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
P = 202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f
E = 404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f
```

Expected seed:

```text
a17195393abb5ef8e33588520d9e328cdfe90803fb97ba436b8a01563544d1ce
```

Expected initial lines:

```text
line[0] =
f18106d88dbf905be3e7fffcce667df4b7b77990bd1b10b9fc9fabd236292c3a14fad3cd3dd6da4bea579df143a02da9c3b5dead56187322fe5249a34d46cae4

line[4095] =
ba16a0b912c391051beb1d6293b98bff39be528faa818bf028198169a8467bc504d5fa677756d425fc14526fc86d4cb7f806bc1a7f145e0799381f82bacc704d
```

Initial state:

```text
16dbed5022d3f5e9cbbfc7eaa33f09d86575407b648cade522167814d3930d8b
```

First round:

```text
pass = 0
i = 0
j = 2838

B =
2763d7ae7db87728e1547500bdd0dea46d00ad103db275bfa680b0a69a1184328c2a94e54c91740626c1729fdaa9ff488e7e1e63fa9b08bded0c8885002f954b

m0 =
0745177cc561eddec699c0ded1f87598b4133e95aba4123085ace8b2b1fe5dc5

m1 =
592784a56b3cb936a2fef987555753c745b3c0da0accf20f5da09393700b9366
```

First `i == j` case:

```text
pass = 0
i = 244
j = 244

state =
f410e7430eb69b472a805a5c393236b1996a27d65e2ab4b020f88d9499a9773f

A = B =
2dee65662fedd9c90aa942c4fc8d737ab350dd306857e3ce2bf8137df030cc87ff055f7b77388c9f6368248b508a7d2f8483a6463291a9d1a82424517dc5a6a5

m0 =
ccd86561043b5560b356631a9b6accf56f2ec4c720ec9f08c5ed6da172fb3dc2

m1 =
a8a4ea0398d5eee49882a194b1f67e3e06906a1244f7b14a2c4d48bb944df4c1
```

Pass terminal states:

```text
state_after_pass_0 =
86afbc66890fb8b774869edbbf316cbb62e5de2fae2944ddce234e7c6fa2afb1

state_after_pass_1 =
4c6fd53cdccfe7978652bf4ff79322f05eb61317cc794c32bc6bf59db44ced8a
```

Final selection:

```text
j_final = 4060

line[j_final] =
5b4c4deb2e85d282acd8174eb423430593d7a40dcfa29d97f0d0c7cf2fc312bcc52805cbee926b56eeaa8fcca3c88bfe2fb65a6b2b769ce5018d44ca0275800e
```

Final work hash:

```text
7a307ddf4899eb02d44050c5538f8558bc1a32762a30bb43a83bfcc5a32899fc
```

Every implementation MUST reproduce every vector byte-for-byte.

### 45.1 Difficulty boundary vectors

With `D=10` and `target_span=1800`:

```text
actual_span = 1349 -> 11
actual_span = 1350 -> 10
actual_span = 1800 -> 10
actual_span = 2700 -> 10
actual_span = 2701 -> 9
```

At `D=1`, a slow-window result remains `1`.

At `D=63`, a fast-window result remains `63`.

---

## 46. Required automated test tiers

The repository MUST expose scripts equivalent to:

```text
npm run test:unit
npm run test:consensus
npm run test:cachewalk
npm run test:difficulty
npm run test:wallet
npm run test:storage
npm run test:relay
npm run test:sync
npm run test:reorg
npm run test:functional
npm run test:crash
npm run test:fuzz
npm run test:cross-network
npm run test:reference-vectors
```

`npm test` runs all deterministic tests suitable for routine CI.

A release candidate runs the full suite.

No failing test may be disabled merely to ship.

---

## 47. Consensus unit tests

At minimum:

### 47.1 Strict Nostr parser

Test:

```text
valid event
duplicate top-level JSON key
missing event member
extra event member
wrong field type
uppercase ID hex
wrong ID length
uppercase pubkey hex
invalid x-only pubkey
wrong signature length
uppercase signature hex
unsafe/non-integer created_at
kind below/above range
tag element not string
malformed JSON
NIP-01 escape cases
ID mismatch
invalid signature
```

### 47.2 Transaction codec

Test every input/output count boundary:

```text
0 inputs rejected
1 input accepted
32 inputs accepted
33 rejected
0 outputs rejected
1 output accepted
32 outputs accepted
33 rejected
```

Test:

```text
truncated content
trailing bytes
wrong version
input ordering
duplicate input
output zero
invalid output key
u128 boundaries
canonical tags
tag/content mismatch
wrong chain tag
mainnet tx on testnet
testnet tx on mainnet
```

### 47.3 Fees and UTXO

Test:

```text
exact minimum fee
one unit below minimum
zero priority
positive priority
overflow attempts
overspend
wrong owner
missing input
immature reward
mature reward
sum(UTXOs) == supply
```

### 47.4 Block codec

Test:

```text
empty block
64 transactions
65 rejected
duplicate tx ID
unsorted tx IDs
bad parent tag
self parent
bad nonce decimal
extra tag
wrong chain scope
wrong content
```

### 47.5 CacheWalk

Test all Section 45 vectors plus:

```text
single changed byte changes result
wrong endian fails
wrong domain string fails
wrong ChaCha counter fails
wrong scratch length fails
i==j implementation mistake fails
leading-zero count boundaries
```

### 47.6 Difficulty

Test:

```text
heights 1..120 initial difficulty
first retarget at 121
normal target unchanged
fast boundary
slow boundary
minimum clamp
maximum clamp
MTP first-height even/odd cases
non-positive span rejected
restart/reindex produces same next difficulty
```

---

## 48. Property and fuzz testing

Property tests MUST include:

```text
decode(encode(tx)) == tx
canonical input sort is idempotent
apply(block); undo(block) restores exact state
replay(history) == incremental application
reindex(events) == active state
same history => same UTXO digest
same history => same supply
same valid branch => same cumulative work
```

Fuzz targets:

```text
raw JSON parser
NIP-01 serialization
transaction binary decoder
block tag parser
amount parser
npub/hex recipient parser
fee arithmetic
UTXO apply/undo
reorg branch construction
CacheWalk input boundaries
relay REQ parser
relay EVENT parser
network descriptor parser
```

CI fuzz-smoke runs fixed seeds.

Long-running fuzz jobs MAY run separately but crashes found by them become regression tests.

---

## 49. Independent reference-vector verifier

Production consensus code and its unit tests can share the same bug.

Therefore a release MUST include a small independent verifier that does **not** import production consensus functions.

It verifies at least:

```text
NIP-01 event ID fixtures
BIP340 signature fixtures
genesis binary decode
CacheWalk Section 45 vector
difficulty boundary vectors
transaction codec vectors
UTXO digest vectors
```

This verifier may be a separate script/tool and may use independently written code.

Release CI must run it.

---

## 50. Three-full-node functional harness

The canonical integration topology is three full-node processes, not three nodes plus three standalone relays.

Example isolated test ports:

```text
Node A embedded relay: ws://127.0.0.1:19447
Node B embedded relay: ws://127.0.0.1:19448
Node C embedded relay: ws://127.0.0.1:19449
```

Each process has:

```text
separate data directory
separate SQLite database
separate signer key
embedded relay
outbound connections to the other nodes
```

The harness uses the selected test profile but MUST NOT weaken consensus code paths.

### 50.1 Required scenario

1. create/start A, B, C;
2. all validate same genesis;
3. all embedded relays start;
4. all reach READY;
5. signers unlock;
6. automatic mining begins;
7. blocks propagate across overlapping relay connections;
8. mine through reward maturity;
9. perform zero-priority payment;
10. verify minimum fee burn;
11. perform positive-priority payment;
12. verify miner receives priority;
13. verify priority does not increase supply;
14. create two conflicting mempool spends;
15. verify both may coexist;
16. verify a block can confirm only one;
17. create same-block parent/child spend;
18. verify block rejected;
19. partition C from A/B;
20. create competing branches;
21. test equal-work no-live-reorg;
22. extend one branch;
23. restore connectivity;
24. verify strictly greater work wins;
25. verify all nodes converge;
26. stop/restart each process;
27. verify identical state;
28. reindex each database;
29. verify identical state again;
30. replay retained events into a clean database;
31. verify identical state again.

Final compared fields:

```text
network
chain ID
height
tip
cumulative work
difficulty
supply
UTXO digest
state hash
```

---

## 51. Embedded-relay and propagation tests

Test the relay inside the full node:

```text
WebSocket upgrade
NIP-01 EVENT
NIP-01 REQ
CLOSE
EOSE
OK
CLOSED
NIP-11 metadata
NIP-65 replacement behavior
max frame
max subscriptions
max filters
exact-ID query
chain-scope filtering
duplicate events
wrong-network events
```

Propagation tests:

```text
A publishes only to relay A
B overlaps relay A and relay B
C connects only to relay B
B validates and republishes
C receives the same original event
event ID/signature unchanged
```

This test is mandatory because without rebroadcast, relay islands can fail to propagate the chain.

Disable Node B's embedded relay listener while leaving its process alive and verify outbound consensus operation continues through alternative relays.

Restore listener and verify peers reconnect.

---

## 52. Synchronization tests

Required cases:

```text
fresh sync from genesis
fresh sync from recent-block limit probe
child before parent
block before tx body
tx body later arrives
multiple missing ancestors
same block from several relays
relay returns incomplete history
EOSE with missing older history
exact-ID walk recovers
one bootstrap dead
two bootstraps dead
all bootstraps dead + manual --relay recovery
stale persisted relay URLs
NIP-65 discovered replacement relay
malicious relay lies/omits
relay disconnect during exact fetch
relay reconnect
optional NIP-77 reconciliation if implemented
```

The node must never trust relay-reported height/work.

---

## 53. Reorg tests

Required depths:

```text
1
2
10
120
241
```

The 241-block case crosses the reward-maturity boundary.

Test reorgs containing:

```text
minimum burns
priority fees
conflicting transactions
mature/immature rewards
mempool reintroduction
different difficulty windows
equal-work branches
greater-work branches
```

Inject process death during disconnect/connect and confirm atomic recovery.

---

## 54. Storage/crash tests

Required:

```text
fresh DB
double-open refusal
stale lock
clean shutdown
SIGTERM
SIGKILL
WAL recovery
kill during block connect
kill during reorg
kill during mempool confirmation
disk-full injection
write I/O error injection
corrupt meta
corrupt event row
wrong network in DB
wrong chain ID in DB
wrong genesis
future schema version
reindex from retained events
replay from NDJSON
```

A crash must never create money, lose an active spend while retaining its output, or leave two active blocks at one height.

---

## 55. Mining tests

Required:

```text
continuous mode default
one worker default
signer locked -> paused
signer unlock -> resume
zero remote write relays -> paused
remote write relay returns -> resume
tip change invalidates generation
difficulty change invalidates generation
stale worker result rejected
private key absent from worker data
winner independently recomputed
winner signed only after recomputation
locally committed block published
publication retry does not roll back block
mine-one mines exactly one then disables
disabled mode never starts workers
clock-behind pause
```

---

## 56. Wallet tests

Required:

```text
zero balance
immature balance
mature balance
8 decimals
too many decimals
negative
zero amount policy
invalid npub
invalid raw key
insufficient funds
deterministic UTXO order
one-output exact spend
two-output change
C == 0 change edge case
priority fee
minimum burn
actual fee display
signer locked
wrong network data directory
mainnet/testnet same pubkey but isolated UTXOs
broadcast
confirmation
reorged payment
```

---

## 57. Cross-network tests

This test tier is mandatory.

Run mainnet and testnet nodes simultaneously on one machine.

Verify:

```text
different default directories
different default embedded relay ports
different genesis IDs
different chain IDs
testnet block rejected by mainnet
mainnet block rejected by testnet
testnet tx rejected by mainnet
mainnet tx rejected by testnet
mainnet DB refused under --network testnet
testnet DB refused under --network mainnet
bootstrap descriptor mismatch refused
same npub does not imply shared balance
```

---

## 58. Adversarial tests

At minimum:

```text
duplicate JSON keys
oversized WebSocket messages
subscription flood
filter flood
slow WebSocket sender
invalid signatures
valid signature + wrong ID
wrong chain tags
unknown kind
uppercase consensus hex
malformed binary lengths
u128 overflow
u128 underflow
duplicate input
fee below minimum
immature reward
same-block child spend
invalid PoW gate
gate-valid but CacheWalk-invalid
wrong difficulty
future-time flood
unknown-parent flood
missing-tx flood
valid expensive blocks from many relays
same invalid block from many relays
deep side branch
invalid high-work branch
malicious relay omission
relay reordering
relay censorship
repeated disconnect/reconnect
```

Expensive-invalid-source throttling is tested without making relay reputation consensus.

---

## 59. Conformance isolation safety

`nostr-blockchain conformance --network mainnet|testnet` is a release verification command, not a participant in the selected public network.

It MUST:

```text
never connect to bundled public bootstrap URLs
never publish generated test events to public WSS endpoints
use temporary data directories
bind test relay endpoints to loopback only
refuse non-loopback relay URLs supplied to the harness
verify the selected public descriptor/genesis read-only
run deterministic consensus vectors for the selected NetworkParams
run multi-process mutation tests only on an internally generated isolated conformance chain
delete/retain temporary artifacts according to an explicit test option
```

The internal conformance chain may use accelerated test-only PoW/maturity constants **only** through dependency-injected test `NetworkParams` unavailable to the production CLI. The same production consensus functions must receive those parameters; there must be no `if (regtest)`/test bypass inside validity logic.

Release testing therefore has three layers:

```text
pure mainnet/testnet vectors
isolated accelerated multi-process conformance
persistent public testnet soak
```

Public mainnet is never used as a mutation target by automated tests.

## 60. Release CI

Full release candidate gate:

```bash
npm ci
npm run build
npm run lint
npm run typecheck
npm test
npm run test:reference-vectors
npm run test:functional
npm run test:reorg
npm run test:crash
npm run test:cross-network
npm run test:fuzz
```

After canonical network descriptors exist:

```bash
nostr-blockchain conformance --network testnet
nostr-blockchain conformance --network mainnet
```

Both must exit zero.

`conformance` MUST be deterministic where practical and MUST print enough diagnostics to identify the first divergent subsystem.

---

## 61. Conformance PASS contract

Successful report includes:

```text
STRICT-NOSTR: PASS
NETWORK-PARAMS: PASS
GENESIS: PASS
CACHEWALK: PASS
DIFFICULTY: PASS
TRANSACTIONS: PASS
FEES: PASS
UTXO: PASS
SUPPLY: PASS
REWARD-MATURITY: PASS
MEMPOOL-CONFLICTS: PASS
BLOCK-VALIDATION: PASS
FORK-CHOICE: PASS
REORG: PASS
SQLITE-CRASH: PASS
EMBEDDED-RELAY: PASS
RELAY-REBROADCAST: PASS
SYNC: PASS
WALLET: PASS
CROSS-NETWORK: PASS
REINDEX: PASS
REPLAY: PASS
REFERENCE-VECTORS: PASS

NETWORK-CONFORMANCE: PASS
```

No command may print PASS merely because unit tests passed.

---

## 62. Public testnet launch is the mainnet staging gate

Testnet is not an internal toy network.

It is a persistent public network using the same full-node process and the same protocol semantics, with only lower initial PoW difficulty and different genesis identity.

Mainnet MUST NOT be launched until the exact release candidate has operated on public testnet.

Minimum launch-readiness exercise SHOULD include:

```text
at least 3 public full nodes
at least 2 operators if available
at least 2 hosting failure domains
at least 7 continuous days
at least 10,000 blocks
reward maturity exercised repeatedly
real wallet transfers
positive and zero priority fees
forced node restarts
forced relay listener outages
network partitions
equal-work and greater-work forks
fresh sync from zero
reindex
database crash recovery
manual bootstrap recovery
```

No unresolved consensus divergence, money-supply mismatch, UTXO digest mismatch, or reproducible crash may remain.

CacheWalk performance on x86-64 and ARM64 SHOULD be recorded during testnet.

Before mainnet genesis, the release team MUST run a deterministic mainnet-profile mining benchmark on the actual initial-node hardware. With the frozen initial difficulty `10`, the measured aggregate expected block interval SHOULD fall within a broad launch sanity band of `3.75 .. 60` seconds (one quarter to four times the 15-second target).

If it falls outside that band, **do not launch mainnet**. The written protocol/profile must be deliberately amended before genesis, then rebuilt, re-tested, and re-soaked. The launch command never auto-tunes consensus parameters.

A GPU/reduced-memory experiment SHOULD be attempted before mainnet when feasible. These measurements inform risk; they do not silently alter v0 consensus.

---

## 63. Testnet one-time launch procedure

### 62.1 Prepare three public full-node endpoints

Example:

```text
wss://testnet-node-a.example.com:17447
wss://testnet-node-b.example.com:17447
wss://testnet-node-c.example.com:17447
```

Prepare:

```text
DNS
TLS certificates
firewall rules
Node.js 24 LTS
release-candidate source
```

No separate relay software is required.

### 62.2 Generate testnet launcher key

```bash
nostr-blockchain key generate \
  --out ./keys/testnet-launcher.ncryptsec
```

### 62.3 Launch canonical testnet genesis

```bash
nostr-blockchain launch \
  --network testnet \
  --launcher-key ./keys/testnet-launcher.ncryptsec \
  --bootstrap wss://testnet-node-a.example.com:17447 \
  --bootstrap wss://testnet-node-b.example.com:17447 \
  --bootstrap wss://testnet-node-c.example.com:17447
```

Created automatically:

```text
networks/testnet.json
networks/testnet-genesis.json
```

### 62.4 Verify testnet genesis independently

On at least two machines:

```bash
nostr-blockchain network-info --network testnet
```

Compare:

```text
chain ID
genesis ID
profile
file hashes
```

### 62.5 Freeze testnet chain ID into release

Commit:

```text
networks/testnet.json
networks/testnet-genesis.json
expected testnet genesis ID
```

Build again from that commit.

The rebuilt release MUST verify the exact previously created genesis; it MUST NOT regenerate it.

### 62.6 Initialize testnet full nodes

On A:

```bash
nostr-blockchain init \
  --network testnet \
  --relay-listen 0.0.0.0:17447 \
  --relay-public-url wss://testnet-node-a.example.com:17447 \
  --relay-tls-cert /etc/nostr-blockchain/testnet-a-fullchain.pem \
  --relay-tls-key /etc/nostr-blockchain/testnet-a-privkey.pem
```

Repeat for B and C with their own URLs/certificates/data.

### 62.7 Start all three with signers locked

```bash
nostr-blockchain start --network testnet --no-unlock
```

Run on every machine.

Wait until all show:

```text
same chain ID
height 0
embedded relay READY
at least one remote read/write relay
lifecycle READY
mining paused: SIGNER_LOCKED
```

### 62.8 Unlock mining

On each node:

```bash
nostr-blockchain signer unlock --network testnet
```

Continuous mining begins automatically.

Confirm block 1 propagates and all three nodes converge.

---

## 64. Mainnet one-time launch procedure

Mainnet launch follows the same architecture after the public testnet gate passes.

### 63.1 Freeze release candidate

Required before genesis:

```text
all CI green
testnet soak gate passed
release commit identified
package-lock frozen
network profile reviewed
CacheWalk vectors verified independently
three mainnet bootstrap machines prepared
DNS/TLS prepared
SECURITY.md published
release checksums process prepared
```

### 63.2 Prepare mainnet full-node endpoints

Example:

```text
wss://node-a.example.com:7447
wss://node-b.example.com:7447
wss://node-c.example.com:7447
```

These are the embedded relay endpoints of the initial full nodes.

### 63.3 Generate a fresh mainnet launcher key

```bash
nostr-blockchain key generate \
  --out ./keys/mainnet-launcher.ncryptsec
```

Do not reuse testnet launcher or mining keys.

### 63.4 Create canonical mainnet genesis exactly once

```bash
nostr-blockchain launch \
  --network mainnet \
  --launcher-key ./keys/mainnet-launcher.ncryptsec \
  --bootstrap wss://node-a.example.com:7447 \
  --bootstrap wss://node-b.example.com:7447 \
  --bootstrap wss://node-c.example.com:7447
```

Automatically creates:

```text
networks/mainnet.json
networks/mainnet-genesis.json
```

The printed genesis event ID is the permanent mainnet chain ID.

### 63.5 Independent verification before deployment

Copy only the public artifacts to two clean verifier machines.

Run:

```bash
nostr-blockchain network-info --network mainnet
```

and the independent reference verifier.

Both verifiers MUST agree on:

```text
genesis event ID
chain ID
signature validity
CacheWalk result
genesis profile
descriptor file hash
genesis file hash
```

Do not proceed on any disagreement.

### 63.6 Freeze mainnet chain ID into source/release

Commit:

```text
networks/mainnet.json
networks/mainnet-genesis.json
expected mainnet genesis ID
```

Build the **final launch binaries** from that commit.

Final binaries verify the existing genesis. They do not create a new one.

### 63.7 Initialize initial full nodes

Node A:

```bash
nostr-blockchain init \
  --network mainnet \
  --relay-listen 0.0.0.0:7447 \
  --relay-public-url wss://node-a.example.com:7447 \
  --relay-tls-cert /etc/nostr-blockchain/node-a-fullchain.pem \
  --relay-tls-key /etc/nostr-blockchain/node-a-privkey.pem
```

Node B/C use their own URLs/certificates.

### 63.8 Start all initial nodes with signers locked

On all three:

```bash
nostr-blockchain start --network mainnet --no-unlock
```

This starts each complete full node and embedded relay.

There is no separate relay start step.

Because the first node cannot count itself as a remote relay, it may remain synchronizing/degraded until another initial node is reachable. This is expected.

### 63.9 Verify pre-mining state

On each:

```bash
nostr-blockchain doctor --network mainnet
nostr-blockchain status --network mainnet
```

Require:

```text
same chain ID
same genesis tip
height 0
cumulative work 0
supply 0
embedded relay running
TLS valid
remote relay connectivity
signer locked
mining paused
```

At least two nodes MUST be mutually reachable before mining unlock.

Prefer all three.

### 63.10 Begin mainnet mining

Unlock signer on each node:

```bash
nostr-blockchain signer unlock --network mainnet
```

Mining starts automatically.

The first valid non-genesis block is block height 1 and creates the first 50 NSR reward UTXO.

### 63.11 Verify live network

After block 1:

```bash
nostr-blockchain status --network mainnet
```

All nodes should converge to:

```text
same chain ID
same height
same tip
same cumulative work
same supply
same UTXO digest
same state hash
```

Temporary propagation lag is normal.

### 63.12 Publish canonical launch information

Publish through multiple independent channels:

```text
release source/binaries
mainnet chain ID
networks/mainnet.json
networks/mainnet-genesis.json
SHA-256 hashes
bootstrap full-node WSS URLs
software version
release commit
security contact
```

Never publish:

```text
mainnet-launcher.ncryptsec
miner.ncryptsec
wallet secrets
TLS private keys
passwords
```

The launcher key may be archived securely or destroyed after launch. It has no consensus authority.

---

## 65. Normal user mainnet start

A user joining an already launched network never runs `launch`.

Mainnet:

```bash
nostr-blockchain init --network mainnet
nostr-blockchain start --network mainnet
```

Testnet:

```bash
nostr-blockchain init --network testnet
nostr-blockchain start --network testnet
```

On first init:

```text
canonical descriptor verified
genesis verified
network-specific data directory created
encrypted miner key generated by default
embedded relay configured
database initialized
```

On start:

```text
embedded relay starts
outbound relays connect
history sync begins
READY reached
signer unlocks
continuous mining begins
```

A validator-only operator uses:

```bash
nostr-blockchain init --network mainnet --validator-only
```

---

## 66. Bootstrap recovery after original nodes disappear

If all bundled bootstrap URLs become stale:

```bash
nostr-blockchain start \
  --network mainnet \
  --relay wss://known-live-chain-relay.example.com
```

A single known live full-chain relay can bootstrap discovery.

The node still verifies:

```text
selected network expected genesis
chain scope
PoW
all transactions
all state
all chainwork
```

A new relay cannot redefine mainnet.

Future software releases MAY update bootstrap hints without changing genesis.

---

## 67. Upgrade policy

v0 has no automatic governance authority.

A future consensus change requires:

```text
new written protocol specification/NBP
explicit activation rule
release implementation
test vectors
testnet exercise
public notice
```

No software update may reinterpret already-valid v0 history silently.

Application/network/policy extensions that do not affect v0 native UTXO validity may remain optional.

CacheWalk changes are consensus changes.

---

## 68. Release packaging and reproducibility

A production release SHOULD include:

```text
source commit/tag
package-lock.json
Node.js supported version
networks/mainnet.json
networks/mainnet-genesis.json
networks/testnet.json
networks/testnet-genesis.json
SHA256SUMS
detached release signatures
SECURITY.md
README mainnet/testnet quick start
migration notes
```

The release process MUST verify that `npm ci` from a clean checkout produces passing tests.

Release artifacts SHOULD be built in CI from the tagged commit.

Dependency vulnerability review MUST be performed before mainnet release.

Consensus-critical dependency upgrades require full conformance reruns.

Production deployments SHOULD run `nostr-blockchain start` under an OS service manager with automatic restart on failure, a dedicated unprivileged account, restrictive filesystem permissions, explicit file-descriptor limits, and a protected signer credential. The blockchain process itself remains foreground-oriented; daemonization is delegated to the service manager.

---

## 69. Mainnet launch gate

Mainnet is NOT ready to launch unless every item below is true:

```text
[ ] final production spec implemented
[ ] --network mainnet/testnet selection implemented everywhere
[ ] network data directories isolated
[ ] canonical testnet launched
[ ] public testnet soak completed
[ ] no unresolved consensus divergence
[ ] no supply/UTXO digest mismatch
[ ] 3-full-node embedded-relay functional test passes
[ ] relay rebroadcast/island propagation test passes
[ ] CacheWalk independent vectors pass
[ ] difficulty tests pass
[ ] fork/reorg tests pass
[ ] 241-block maturity-crossing reorg test passes
[ ] SQLite crash tests pass
[ ] disk-full test passes
[ ] restart/reindex/replay equality passes
[ ] wallet deterministic selection tests pass
[ ] cross-network replay tests pass
[ ] malicious/incomplete relay tests pass
[ ] fuzz smoke passes
[ ] independent reference verifier passes
[ ] clean build/lint/typecheck passes
[ ] SECURITY.md exists
[ ] release commit/tag selected
[ ] mainnet DNS names configured
[ ] 3 mainnet TLS certificates configured
[ ] 3 mainnet full-node machines prepared
[ ] mainnet launcher key generated separately
[ ] canonical mainnet genesis created exactly once
[ ] genesis independently verified on >=2 machines
[ ] mainnet chain ID frozen into final release
[ ] final release rebuilt after genesis freeze
[ ] final release verifies same genesis
[ ] initial nodes start with embedded relays
[ ] initial nodes reach READY with signer locked
[ ] remote connectivity verified
[ ] signers unlocked
[ ] block 1 mined and propagated
[ ] all nodes converge
[ ] public launch artifacts/checksums published
```

If any required item fails, mainnet launch stops.

---

## 70. Reference implementation module boundary

Recommended source layout:

```text
src/
  networks/
    params
    descriptor
    launch

  consensus/
    strict-json
    nip01
    codec
    transaction
    fees
    utxo
    block
    cachewalk-r1
    difficulty
    chainwork
    fork-choice

  chain/
    executor
    state-overlay
    reorg
    replay
    verification

  storage/
    sqlite
    schema
    migrations
    undo
    locks

  relay/
    embedded-server
    nip01
    nip11
    nip65
    nip77-optional
    limits

  network/
    relay-client
    relay-pool
    discovery
    subscriptions
    missing-object-fetcher
    sync
    rebroadcast

  mining/
    candidate-builder
    coordinator
    worker

  signer/
    ncryptsec
    provider

  wallet/
    amounts
    coin-selection
    builder

  control/
    local-socket

  cli/
    commands

  diagnostics/
    state-hash
    doctor
```

The embedded relay is a module inside the full-node process, not a separately required deployment.

Implementation order:

```text
1. strict parsing / NIP-01 / crypto
2. CacheWalk vectors
3. transaction/UTXO/fees
4. block/timestamp/difficulty/chainwork
5. fork choice and pure state transitions
6. SQLite + undo + reorg
7. embedded relay
8. outbound relay pool / sync / rebroadcast
9. mining workers/signer
10. wallet
11. --network CLI and descriptors
12. launch/init/start lifecycle
13. conformance/fuzz/crash/functional tests
14. public testnet
15. mainnet
```

## 71. Operational invariants

The following should be easy for operators to remember:

```text
--network chooses software network profile
genesis event ID chooses blockchain identity
one full-node process includes the relay
bootstrap URLs are hints, not authorities
every block/tx is independently verified
remote relays can omit or lie
full nodes rebroadcast validated signed events
same-block child spends are invalid
minimum fees burn
priority fees pay miners
reward index is 65535
reward matures after 240 blocks
CacheWalk hash never replaces Nostr event ID
difficulty comes from parent history
greater cumulative work wins
equal work does not trigger live reorg
reorgs are atomic
mainnet/testnet never share chain state
mining is continuous by default
```

---

## 72. External technical references

Normative external primitives/protocols used by v0:

```text
Nostr NIP-01 — basic event serialization and relay WebSocket protocol
Nostr NIP-11 — relay information document
Nostr NIP-13 — event-ID proof-of-work convention used as the cheap prefilter
Nostr NIP-19 — npub display/transport encoding
Nostr NIP-49 — encrypted private keys
Nostr NIP-65 — relay-list metadata
Nostr NIP-77 — optional negentropy reconciliation
BIP340 — secp256k1 Schnorr signatures
RFC 8439 — ChaCha20 primitive
SHA-256
SQLite WAL/synchronous semantics
Node.js worker_threads
```

Bitcoin Core's separation of chain parameters/networks and its unit/functional/fuzz/release-testing discipline are engineering precedent only; Bitcoin consensus is not imported into this protocol.

---

# Appendix A — Mainnet quick start after launch

Normal user:

```bash
nostr-blockchain init --network mainnet
nostr-blockchain start --network mainnet
```

Check:

```bash
nostr-blockchain status --network mainnet
```

Wallet:

```bash
nostr-blockchain wallet address --network mainnet
nostr-blockchain wallet balance --network mainnet
```

Send:

```bash
nostr-blockchain send \
  --network mainnet \
  --to <RECIPIENT_NPUB_OR_HEX> \
  --amount 1.00000000
```

Stop:

```bash
nostr-blockchain stop --network mainnet
```

Verify:

```bash
nostr-blockchain verify --network mainnet
```

---

# Appendix B — Testnet quick start after launch

```bash
nostr-blockchain init --network testnet
nostr-blockchain start --network testnet
nostr-blockchain status --network testnet
```

Testnet UI/CLI amounts display as `tNSR`.

---

# Appendix C — The first three mainnet machines

There are three processes, not six:

```text
Machine A
  Nostr Blockchain Full Node A
  + consensus
  + SQLite
  + miner
  + wallet/control
  + outbound relay client
  + embedded WSS relay

Machine B
  Nostr Blockchain Full Node B
  + same components

Machine C
  Nostr Blockchain Full Node C
  + same components
```

Network topology:

```text
A outbound client <------> B embedded relay
A outbound client <------> C embedded relay

B outbound client <------> A embedded relay
B outbound client <------> C embedded relay

C outbound client <------> A embedded relay
C outbound client <------> B embedded relay
```

Each node may additionally connect to generic or independently operated Nostr relays.

---

# Appendix D — Mainnet birth in one sequence

```text
1. launch and soak public testnet
2. freeze release candidate
3. prepare 3 mainnet machines + DNS + TLS
4. generate mainnet launcher key
5. launch --network mainnet
6. genesis is mined/signed
7. genesis ID becomes mainnet CHAIN_ID
8. independently verify genesis
9. commit/freeze chain ID into final release
10. rebuild final release
11. initialize A/B/C using same mainnet descriptor
12. start A/B/C with --no-unlock
13. embedded relays start automatically
14. nodes connect to one another over WSS
15. all nodes reach READY at genesis
16. unlock signers
17. continuous mining starts
18. block 1 is found
19. valid block is rebroadcast across relays
20. A/B/C converge
21. publish launch artifacts/checksums
```

That is the v0 production network launch contract.
