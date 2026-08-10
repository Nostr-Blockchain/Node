# Nostr Blockchain v0 — Minimum Viable Mainnet Specification

**Status:** normative implementation-and-operation specification for the v0 public mainnet
**Date:** 2026-08-10  
**Reference implementation:** TypeScript on Node.js 24 LTS  
**Native asset:** NSR  
**Consensus PoW:** Nostr CacheWalk R1  
**External blockchain communication:** Nostr over WebSocket only; public mainnet relays use `wss://`

This document is authoritative for the v0 public mainnet. A reference implementation is **not mainnet-complete** merely because its validation logic works locally. It is complete only if a new operator can build it, join the canonical mainnet from the published genesis descriptor, discover multiple relays/nodes through Nostr, independently synchronize and validate the chain, mine by default, transfer NSR, survive relay/node failures, restart/reindex, and pass the release-conformance scenario defined here.

The mainnet chain is identified only by its genesis event ID. Bootstrap relays, discovery events, software releases, websites, DNS names, and repositories are operational aids and never consensus authorities.

The v0 mainnet launch profile is fully frozen by this document:

```text
native asset                 NSR
decimals                     8
block reward                 50.00000000 NSR perpetual
reward maturity              240 blocks
target block interval        15 seconds
initial CacheWalk difficulty 10 leading-zero bits
difficulty window            120 blocks
difficulty step              at most +/-1 bit per window
NIP-13 prefilter             6 leading-zero bits
base fee                     0.00001000 NSR
per-input fee                0.00000250 NSR
per-output fee               0.00000500 NSR
max inputs / transaction     32
max outputs / transaction    32
max transactions / block     64
minimum launch relays        3 public WSS endpoints
default mining               continuous, 1 worker
minimum relay to mine        1 write-capable relay
```

No item in this launch profile is left for the implementation or launch operator to invent.


---

## 0. Operational definition of working mainnet

A build is considered a working v0 **mainnet node** only when all of the following are true:

1. `npm ci`, `npm run build`, and `npm test` succeed on a supported system.
2. The release ships a canonical `networks/mainnet.json` containing the complete signed/mined genesis event and at least three `wss://` bootstrap relay hints on distinct hostnames.
3. A fresh operator can run `mainnet init` and `mainnet start` without creating a new genesis or manually editing a database.
4. The node independently verifies the bundled/published genesis, connects to multiple Nostr relays, discovers additional relay candidates, downloads and validates chain history, and reaches `READY`.
5. Continuous mining starts automatically when the node is `READY`, a signer is available, and the node has sufficient relay connectivity; the operator may explicitly disable it.
6. A wallet can transfer NSR and independent nodes converge on the same greatest-work state-valid chain.
7. A node continues operating when any one bootstrap relay disappears and can learn replacement relays from Nostr relay-list discovery information.
8. Restart and reindex reproduce the same active tip, UTXO set, supply, and diagnostic state hash.
9. The release-conformance command exercises genesis, difficulty retargeting, fees, maturity, conflicting spends, forks/reorgs, relay failover, restart, and reindex.

The mandatory release gate is:

```bash
npm run nb -- mainnet conformance --clean
```

It MUST exit `0` only when the complete deterministic conformance and local multi-node release scenario passes. It MUST exit non-zero otherwise.

This command is a release test; it does **not** create a second public network and is not how users start mainnet.

## 1. Purpose

The v0 mainnet is a minimal public cryptocurrency blockchain whose native objects are signed Nostr events and whose external blockchain transport is ordinary Nostr relay traffic.

It provides independently verifiable proof-of-work consensus, UTXO ownership, NSR balances, perpetual issuance, burned minimum fees, miner priority fees, adaptive public-network difficulty, forks/reorgs, crash-safe persistence, wallet operation, and public relay/node discovery without introducing a general smart-contract VM.

A conforming implementation MUST provide:

```text
NIP-01 event identity
BIP340 ownership/signatures
UTXO monetary state
Nostr CacheWalk R1 proof of work
~15-second target through deterministic difficulty retargeting
fixed perpetual NSR block reward
reward maturity
minimum burned fees
priority fees paid to miners
block DAG + cumulative-work fork choice
Nostr-only block/transaction transport
multi-relay bootstrap and discovery
SQLite persistence
continuous mining by default on full nodes
secure local or remote signer support
wallet tooling
canonical mainnet bootstrap/join commands
replay/reindex verification
release conformance harness
```

The Core deliberately avoids application-specific state, a VM, staking, governance, and privileged validators.

## 2. Normative language and categories

The words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative.

Rules are classified as:

- **Consensus:** disagreement can split the chain.
- **Network protocol:** required for interoperable reference-node communication but not monetary validity itself.
- **Policy:** local behavior that may differ without changing block validity.
- **Operational contract:** required command/config behavior of the reference implementation.
- **Deferred NBP:** outside v0.

Unless explicitly marked otherwise, Sections 7 through 20 define consensus behavior except where a rule is explicitly marked policy/network; Sections 21–32 define mainnet networking and operational behavior.

---

## 3. Frozen v0 mainnet scope

### 3.1 Included

```text
NIP-01 event authentication
BIP340 x-only public-key ownership
UTXO transactions
CacheWalk R1 PoW
small NIP-13-compatible prefilter gate
15-second target interval
bounded deterministic difficulty retargeting
block DAG and cumulative chainwork
fixed perpetual NSR mining reward
240-block reward maturity
minimum fee burn
miner priority fee
implicit reward UTXO
parent-state-only block execution
fixed block transaction limit
Nostr relay transport over WebSocket/WSS
multi-relay bootstrap, failover, and discovery
signed chain-relay-list metadata
SQLite persistence
continuous built-in mining
public full-chain Nostr relay role
secure signer profile
reference wallet tooling
canonical mainnet launch/join/start contract
local release-conformance harness
```

### 3.2 Explicitly excluded from v0 consensus

```text
scripts or general VM
native multisig output type
height locks
relative locks
application-event anchoring
names
tokens
owned objects / NFTs
games
organizations
AI-agent semantics
staking
governance
bridges
state snapshots as consensus authority
archive-mesh commitments
```

Those may be introduced only by explicit later protocol/NBP rules. Their absence does not prevent v0 mainnet operation.

## 4. External references

The implementation reuses existing specifications rather than redefining them:

1. NIP-01 for Nostr event structure, ID serialization, relay messages, filters, and Schnorr event signatures.
2. NIP-11 for relay information documents used during relay capability probing.
3. NIP-13 for the `nonce` tag convention and leading-zero-bit event-ID proof-of-work concept. v0 retains a small NIP-13-compatible gate; CacheWalk supplies credited work.
4. NIP-49 for password-encrypted local private keys (`ncryptsec`) used by the default mainnet signer profile.
5. NIP-65 as compatible prior art for user relay-list metadata. Mainnet node discovery is chain-specific and does not reinterpret NIP-65.
6. NIP-66 as optional relay discovery/liveness evidence. A node MUST NOT trust one monitor or require NIP-66 to function.
7. NIP-77 as an optional synchronization optimization after baseline NIP-01 exact-ID/block subscriptions work.
8. NIP-44 / RFC 8439 only as prior use/reference for the ChaCha20 primitive. CacheWalk does not use NIP-44 encryption semantics.
9. BIP340 for x-only secp256k1 Schnorr signatures.
10. SQLite WAL and `synchronous=FULL` for reference persistence.
11. Node.js `worker_threads` for CPU mining workers.

The repository lockfile MUST pin exact dependency versions used by a released reference implementation.

Kinds `7342` and `7343` are frozen by this mainnet specification as the native transaction and block kinds. Mainnet implementations MUST interpret them only within the chain scope identified by the genesis event ID. Any future public kind-registry collision requires a later protocol version and MUST NOT silently reinterpret v0 events.

## 5. Mandatory reference executable contract

The package MUST expose the CLI through:

```bash
npm run nb -- <command> [arguments]
```

At minimum these commands MUST exist:

```text
version
key generate
chain inspect
relay start
node init
node start
node status
node block
node tx
node mempool
node mining
wallet address
wallet balance
wallet utxos
wallet send
chain verify
chain reindex
chain replay
conformance generate
conformance verify
mainnet launch
mainnet init
mainnet start
mainnet status
mainnet send
mainnet conformance
regtest start
regtest acceptance
regtest reset
```

`mainnet init/start/status/send` are the normal user-facing path. Lower-level `node`, `wallet`, and `chain` commands remain available for operators and debugging.

Unknown commands or missing required arguments MUST fail non-zero with a concise usage message. Every command/subcommand MUST support `--help`.

## 6. Supported build environment and repository contract

The reference implementation MUST target Node.js 24 LTS and TypeScript.

A clean checkout MUST support:

```bash
npm ci
npm run build
npm test
```

The repository README MUST reproduce the Mainnet Quick Start from Appendix A near its top. A user MUST NOT need to discover bootstrap or startup by reading source code.

The repository MUST contain at least:

```text
package.json
package-lock.json
tsconfig.json
src/
test/
README.md
networks/mainnet.json
Nostr_Blockchain_v0_Mainnet_Specification.md
```

The implementation SHOULD use:

```text
better-sqlite3
@noble/curves or another BIP340 implementation behind CryptoProvider
ws or an equivalent WebSocket implementation
worker_threads for mining
```

Consensus code MUST NOT rely on floating-point arithmetic.

---

## 7. Chain identity and protocol constants

The genesis Nostr event ID is the chain ID.

Normal chain events contain exactly one chain-scope tag:

```text
["t", "nostr-blockchain:<GENESIS_EVENT_ID>"]
```

The genesis event instead uses:

```text
["t", "nostr-blockchain:genesis"]
```

Frozen v0 mainnet kinds:

```text
TX_KIND    = 7342
BLOCK_KIND = 7343
```

Protocol constants:

```text
PROTOCOL_VERSION             = 0
NIP13_GATE_BITS              = 6
TARGET_BLOCK_SECONDS         = 15
DIFFICULTY_WINDOW_BLOCKS     = 120
DIFFICULTY_FAST_NUMERATOR    = 3
DIFFICULTY_FAST_DENOMINATOR  = 4
DIFFICULTY_SLOW_NUMERATOR    = 3
DIFFICULTY_SLOW_DENOMINATOR  = 2
MIN_POW_DIFFICULTY           = 1
MAX_POW_DIFFICULTY           = 63
FUTURE_BLOCK_DRIFT_SECONDS   = 120
MIN_MINING_RELAY_CONNECTIONS = 1
MAX_HEIGHT                   = 9223372036854775807
```

Display convention:

```text
DECIMALS = 8
1 NSR = 100000000 base units
```

Consensus monetary/account identity is the raw 32-byte BIP340 x-only public key. `npub` is display/transport encoding only.

## 8. Integer, byte, and arithmetic rules

All multibyte integer fields inside consensus binary payloads use unsigned **big-endian** encoding unless this document explicitly says `LE32`/`U32LE` for CacheWalk.

Consensus numeric domains:

```text
u8    0 .. 2^8-1
u16   0 .. 2^16-1
u32   0 .. 2^32-1
u64   0 .. 2^64-1
u128  0 .. 2^128-1
```

TypeScript consensus arithmetic for monetary values MUST use `bigint`.

Overflow or underflow is invalid; wrapping arithmetic MUST NOT be used.

Raw hashes and public keys are 32 bytes. Nostr signatures are 64 bytes.

Hex appearing in consensus events MUST be lowercase ASCII hex with exact expected length.

---

## 9. Strict Nostr event envelope and time semantics

Consensus event parsing MUST operate on raw received JSON and reject duplicate object keys.

A transaction or block event object MUST contain exactly these seven members and no others:

```text
id
pubkey
created_at
kind
tags
content
sig
```

Rules:

- `id`: exactly 64 lowercase hex characters.
- `pubkey`: exactly 64 lowercase hex characters and a valid BIP340 x-only public key.
- `created_at`: integer `0 <= created_at <= 9007199254740991`.
- `kind`: integer.
- `tags`: JSON array of arrays of strings only.
- `content`: string.
- `sig`: exactly 128 lowercase hex characters.

The event ID MUST equal SHA-256 of the UTF-8 bytes of the exact NIP-01 serialization:

```text
[0,pubkey,created_at,kind,tags,content]
```

encoded as compact JSON with no insignificant whitespace. The BIP340 signature MUST verify over the 32-byte event ID.

For `TX_KIND`, `created_at` is authenticated metadata only and has no monetary ordering semantics.

For `BLOCK_KIND`, `created_at` is the consensus block timestamp used only by the difficulty algorithm. A non-genesis block MUST satisfy:

```text
block.created_at > MedianTimePast(parent)
```

`MedianTimePast(B)` is the integer median of `created_at` from `B` and up to its ten preceding ancestors (maximum 11 timestamps). For an even count during the first ten heights, choose the lower of the two middle sorted values.

A block whose timestamp is more than `FUTURE_BLOCK_DRIFT_SECONDS` ahead of the node's current Unix time is not permanently invalid; it is held as `FUTURE_TIME_PENDING` and reconsidered as local time advances. Mainnet operators SHOULD maintain accurate system time.

## 10. Genesis event and mainnet monetary profile

Genesis is a special `BLOCK_KIND` event at height `0`.

### 10.1 Genesis tags

Genesis tags MUST be exactly:

```json
[
  ["t", "nostr-blockchain:genesis"],
  ["nonce", "<NONCE>", "6"]
]
```

No parent or transaction tags are permitted. `NONCE` is canonical unsigned decimal `u64`.

### 10.2 Genesis content

Genesis `content` is lowercase hex encoding of exactly 76 bytes:

```text
protocol_version       u8
block_reward           u128
reward_maturity        u32
pow_difficulty         u8   # initial CacheWalk difficulty
base_fee               u128
input_fee              u128
output_fee             u128
max_tx_inputs          u16
max_tx_outputs         u16
max_block_transactions u16
```

All integers are unsigned big-endian.

### 10.3 Canonical v0 mainnet launch profile

`mainnet launch` MUST use exactly:

```text
protocol_version       0
block_reward           5000000000 base units  # 50.00000000 NSR
reward_maturity        240 blocks             # ~1 hour at 15-second target
pow_difficulty         10                     # initial CacheWalk difficulty
base_fee               1000 base units
input_fee              250 base units
output_fee             500 base units
max_tx_inputs          32
max_tx_outputs         32
max_block_transactions 64
```

These values are the final v0 mainnet launch values. They are not prompts, defaults, examples, or operator choices. `mainnet launch` MUST use them exactly and MUST NOT accept monetary, maturity, fee, limit, target-time, retarget, or initial-difficulty overrides. A different profile creates a different chain and MUST NOT be labeled v0 mainnet.

At the 15-second target, perpetual fixed issuance is approximately 105,120,000 NSR/year before minimum-fee burns. Priority fees are transfers and do not change supply.

### 10.4 Absolute v0 bounds

A valid v0 genesis MUST satisfy:

```text
block_reward > 0
reward_maturity >= 1
MIN_POW_DIFFICULTY <= pow_difficulty <= MAX_POW_DIFFICULTY
base_fee > 0
1 <= max_tx_inputs <= 64
1 <= max_tx_outputs <= 64
1 <= max_block_transactions <= 256
```

`input_fee` and `output_fee` may be zero.

### 10.5 Genesis proof of work

For genesis:

```text
E = candidate NIP-01 event ID
G = E
P = 32 zero bytes
```

The event is valid only if:

```text
leading_zero_bits(E) >= NIP13_GATE_BITS
leading_zero_bits(CacheWalkR1(G, P, E)) >= genesis.pow_difficulty
```

After a winning unsigned event is found, the launch signer signs `E`.

Genesis creates no reward UTXO and initial NSR supply is zero. The genesis signing key has no protocol authority after genesis.

## 11. Transaction event format

A transaction is a regular Nostr event with:

```text
kind = TX_KIND
```

Its transaction ID is exactly `event.id`.

The event author owns and authorizes every input in that transaction.

### 11.1 Transaction binary content

`content` is lowercase hex of:

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

### 11.2 Canonical input order

Inputs MUST be unique and strictly ascending by:

```text
(source_id raw bytes, output_index unsigned integer)
```

Outputs retain authored order because their index becomes part of the created outpoint.

### 11.3 Transaction tags

Transaction tags are deterministic and MUST be exactly:

```text
1. ["t", "nostr-blockchain:<CHAIN_ID>"]
2. ["v", "0"]
3. one ["i", "<SOURCE_ID_HEX>", "<OUTPUT_INDEX_DECIMAL>"] for each input in binary order
4. one ["p", "<OWNER_PUBKEY_HEX>"] for each output in binary order
```

The decimal output index is canonical unsigned decimal with no leading zeros except `"0"`.

No other transaction tags are permitted.

### 11.4 Basic transaction limits

```text
1 <= input_count  <= max_tx_inputs
1 <= output_count <= max_tx_outputs
```

Every output amount MUST be greater than zero.

---

## 12. UTXO ownership and transaction validity

An outpoint is:

```text
(source_id, output_index)
```

A normal transaction output `k` creates:

```text
(tx.id, k)
```

A transaction is state-valid against a parent UTXO state only if:

1. all referenced outpoints exist;
2. no input is duplicated;
3. every input owner equals `tx.pubkey`;
4. every reward input is mature at the candidate block height;
5. all output public keys are valid x-only BIP340 keys;
6. all output amounts are non-zero;
7. all sums fit `u128`;
8. `sum(inputs) >= sum(outputs)`;
9. the actual fee satisfies the minimum burn rule in Section 13.

The transaction signature authorizes all inputs. There is no script system in v0.

---

## 13. Fee model

For a state-valid transaction:

```text
ACTUAL_FEE = sum(input amounts) - sum(output amounts)

MINIMUM_BURN =
    base_fee
  + input_fee  * input_count
  + output_fee * output_count

require ACTUAL_FEE >= MINIMUM_BURN

PRIORITY_FEE = ACTUAL_FEE - MINIMUM_BURN
```

`MINIMUM_BURN` is destroyed.

`PRIORITY_FEE` is paid to the miner through the implicit reward UTXO.

Priority fees are transfers, not issuance.

---

## 14. Reward UTXO, maturity, and supply

Every valid non-genesis block creates exactly one implicit reward UTXO:

```text
source_id    = block.id
output_index = 65535
owner        = block.pubkey
amount       = block_reward + sum(PRIORITY_FEE of included transactions)
```

The reward is spendable in candidate block height `Hc` iff:

```text
Hc >= reward_created_height + reward_maturity
```

The entire reward, including priority fees, matures together.

Consensus supply is an unsigned `u128`. A block transition that would overflow it is invalid.

Consensus supply after an active tip is:

```text
SUPPLY = cumulative fixed block rewards - cumulative minimum burns
```

Genesis creates no supply.

---

## 15. Block event format

A non-genesis block is a Nostr event with:

```text
kind    = BLOCK_KIND
content = "00"
```

Its block ID is exactly `event.id`.

Tags MUST be exactly:

```text
1. ["t", "nostr-blockchain:<CHAIN_ID>"]
2. ["e", "<PARENT_BLOCK_ID>", "", "parent"]
3. ["nonce", "<NONCE>", "6"]
4+. one ["e", "<TX_ID>", "", "tx"] for each included transaction
```

Transaction IDs MUST be unique and strictly ascending by raw 32-byte value.

```text
0 <= transaction_count <= max_block_transactions
```

No arbitrary tags are permitted.

`NONCE` MUST be canonical unsigned decimal `u64`; the nonce tag third field MUST be exactly `"6"`.

The expected CacheWalk difficulty is **derived from the parent chain** by Section 16 and is deliberately not miner-selectable or serialized in a tag.

The NIP-01 block event ID commits to parent, nonce, transaction IDs, miner pubkey, `created_at`, kind, and content. v0 has no separate Merkle root.

## 16. Nostr CacheWalk R1 proof of work and mainnet difficulty

CacheWalk R1 is active v0 mainnet consensus. `block.id` remains the ordinary NIP-01 event ID; CacheWalk produces a derived 32-byte work hash that is not serialized.

Mining is:

```text
vary nonce
  -> compute NIP-01 event ID E
  -> require 6 leading zero bits in E
  -> CacheWalkR1(G, P, E)
  -> require expected_difficulty leading zero bits in cpu_work_hash
```

### 16.1 CacheWalk inputs and constants

```text
G = raw 32-byte genesis/chain ID
P = raw 32-byte parent block ID
E = raw 32-byte candidate NIP-01 event ID
```

For genesis only:

```text
G = E
P = 32 zero bytes
```

Consensus constants:

```text
CACHEWALK_R1_BYTES       = 262144
CACHEWALK_R1_LINE_BYTES  = 64
CACHEWALK_R1_LINES       = 4096
CACHEWALK_R1_PASSES      = 2
NIP13_GATE_BITS          = 6
```

All CacheWalk byte slicing is zero-based/half-open. `||` is concatenation. `LE32`/`U32LE` are unsigned little-endian exactly as stated.

### 16.2 NIP-13-compatible gate

Before CacheWalk:

```text
leading_zero_bits(E) >= 6
```

MUST hold. The gate contributes no credited chainwork and is not the primary expensive-validation DoS defense.

### 16.3 Seed

```text
seed = SHA256(
    ASCII("NostrCacheWalk-R1/seed")
    || G || P || E
)
```

### 16.4 Scratchpad generation

Use RFC-8439 ChaCha20 with:

```text
key       = seed
nonce96   = 12 zero bytes
counter   = 0
plaintext = 262144 zero bytes
```

The result is exactly 262144 bytes interpreted as 4096 mutable 64-byte lines.

### 16.5 Initial state

```text
state = SHA256(
    ASCII("NostrCacheWalk-R1/state")
    || seed || P || E
)
```

### 16.6 Dependent mutable-memory walk

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

### 16.7 Final work hash

```text
j_final = U32LE(state[4:8]) & 4095

cpu_work_hash = SHA256(
    ASCII("NostrCacheWalk-R1/final")
    || state || line[j_final] || seed || P || E
)
```

For a non-genesis block at height `H`, a block is PoW-valid iff:

```text
leading_zero_bits(cpu_work_hash) >= ExpectedDifficulty(H, parent)
```

### 16.8 Deterministic difficulty retarget

The target block interval is 15 seconds. Difficulty is an integer leading-zero-bit count and may change by at most one bit every 120 blocks.

For heights `1..120`:

```text
ExpectedDifficulty = genesis.pow_difficulty
```

For height `H > 120`, let `D = parent.work_difficulty`.

If `(H - 1) mod DIFFICULTY_WINDOW_BLOCKS != 0`, then:

```text
ExpectedDifficulty = D
```

Otherwise this is the first block of a new difficulty window. Let:

```text
end   = parent                                  # height H-1
start = ancestor(end, DIFFICULTY_WINDOW_BLOCKS) # exactly 120 ancestors back
actual_span = MedianTimePast(end) - MedianTimePast(start)
target_span = DIFFICULTY_WINDOW_BLOCKS * TARGET_BLOCK_SECONDS  # 1800
```

`actual_span <= 0` is invalid ancestor history and MUST NOT occur on a state-valid chain.

Then:

```text
if actual_span * 4 < target_span * 3:
    next = D + 1
else if actual_span * 2 > target_span * 3:
    next = D - 1
else:
    next = D

ExpectedDifficulty = clamp(next, MIN_POW_DIFFICULTY, MAX_POW_DIFFICULTY)
```

Thus a window faster than 75% of target raises difficulty one bit; a window slower than 150% lowers it one bit; otherwise it remains unchanged. This deliberately simple bounded controller is the v0 mainnet rule.

### 16.9 Credited work and cumulative chainwork

A valid non-genesis block contributes exactly:

```text
credited_work = 2^work_difficulty
```

Extra lucky zero bits do not add work. `work_difficulty` is the derived expected difficulty for that block.

Cumulative chainwork is the exact unsigned integer sum of credited work from all non-genesis blocks on the branch. With `MAX_HEIGHT < 2^63` and `MAX_POW_DIFFICULTY <= 63`, cumulative chainwork fits `u128`.

Fork choice is by cumulative chainwork, not height.

### 16.10 Signing order

Mining workers MUST NOT receive the private key. After a worker finds a candidate, the main process MUST independently recompute the NIP-01 event ID, NIP-13 gate, expected difficulty, CacheWalk hash, and target before asking the signer to sign the 32-byte event ID.

## 17. Block validation pipeline

For non-genesis candidate block height `H = parent.height + 1`, `H` MUST NOT exceed `MAX_HEIGHT`:

1. enforce frame/resource limits;
2. strict-parse JSON and reject duplicate keys;
3. validate exact event members and primitive encodings;
4. recompute the NIP-01 event ID;
5. require `BLOCK_KIND` and correct chain scope;
6. validate exact block content/tag layout;
7. reject duplicate IDs and self-parent references;
8. verify BIP340 signature;
9. if parent is missing, queue dependency and fetch parent before CacheWalk;
10. require `created_at > MedianTimePast(parent)`;
11. if `created_at > local_unix_time + FUTURE_BLOCK_DRIFT_SECONDS`, classify `FUTURE_TIME_PENDING` and defer expensive validation;
12. derive `ExpectedDifficulty(H,parent)`;
13. validate the 6-bit event-ID gate;
14. validate CacheWalk R1 against the expected difficulty;
15. require parent to be state-valid and reject parent cycles;
16. fetch every referenced transaction by exact event ID;
17. require each referenced object to be valid `TX_KIND` for this chain;
18. validate every transaction independently against the **parent's** UTXO state;
19. require no input outpoint to occur in more than one block transaction;
20. require derived reward amount and supply arithmetic to fit `u128`;
21. compute credited/cumulative work exactly;
22. atomically apply the complete block transition if it wins/extends the active chain, or store as a valid side branch otherwise.

### 17.1 Parent-state-only execution

Transactions in a block MUST NOT spend outputs created by another transaction in the same block. This keeps transaction validity order-independent.

### 17.2 Missing/future data is not permanent invalidity

A structurally/PoW-plausible block with missing transactions is `TX_DATA_MISSING`, not invalid.

A block too far ahead of local wall time is `FUTURE_TIME_PENDING`, not invalid.

Neither may become active until its pending condition clears and full validation succeeds.

## 18. Block DAG and fork choice

Recommended validation states:

```text
PARENT_MISSING
FUTURE_TIME_PENDING
STRUCTURAL_VALID
TX_DATA_MISSING
STATE_VALID
INVALID
INVALID_ANCESTOR
```

Only fully `STATE_VALID` tips participate in fork choice.

The active branch changes only when another fully state-valid tip has **strictly greater cumulative credited work**.

Height is never a substitute for chainwork once adaptive difficulty is active.

### 18.1 Equal-work rule

If another branch has exactly equal cumulative work to the current active branch, a live node MUST NOT reorg solely because of lexical ordering or arrival order. It stays on its current active branch until one branch gains strictly greater cumulative work.

A fresh database discovering multiple equal-work maximum tips before any active selection MUST choose the lexicographically smallest raw 32-byte tip ID as its initial local selection for deterministic tooling. That tie rule is not extra work and MUST NOT later trigger an equal-work reorg.

## 19. Mempool policy

The mempool is policy, not consensus.

A transaction may enter the mempool only if it is syntactically valid and would be state-valid in a candidate block at `active_height + 1` against the current active UTXO state, including reward-maturity checks.

The reference mempool MUST permit a bounded number of conflicting valid spends of the same outpoint. It MUST NOT globally reserve an outpoint for the first transaction seen.

This avoids first-seen transaction pinning.

The reference miner sorts candidate transactions by:

1. higher `PRIORITY_FEE` first;
2. on equal priority fee, ascending `SHA256(parent_block_id || txid)`.

It skips any transaction whose input conflicts with an already selected transaction.

A different miner selection policy is permitted as long as the produced block is consensus-valid.

### 19.1 Reorg and restart behavior

When an active block disconnects, its non-conflicting transactions SHOULD be reconsidered for the mempool against the new active tip. Transactions confirmed by newly connected blocks MUST be removed from the mempool. After every reorg and restart, all persisted mempool transactions MUST be revalidated against the active tip; invalid or now-spent transactions are dropped, while bounded valid conflicts may remain.

---

## 20. Mining architecture and always-on behavior

Mining is built into the full node and **continuous mining is enabled by default**.

Modes:

```text
continuous   # default
Disabled     # explicit operator opt-out (CLI spelling: disabled)
mine-one     # local deterministic control/testing
```

A mainnet full node starts/resumes continuous mining when:

```text
lifecycle == READY
signer available
mining.mode == continuous
at least MIN_MINING_RELAY_CONNECTIONS active write-capable relay connections
```

The relay-count condition is local propagation policy, not consensus. A miner MUST have at least one active write-capable relay connection before starting new work so a found block has an immediate publication path.

The reference implementation starts with one worker unless configured otherwise. Mining workers receive candidate fields and nonce ranges but never the private key.

Every active-tip or expected-difficulty change increments a mining generation. Results from older generations are discarded.

A candidate fixes chain scope, parent, selected sorted transaction IDs, miner pubkey, `created_at`, content, and derived expected difficulty. Only the nonce changes in the inner loop.

`created_at` for a newly built candidate MUST be at least `MedianTimePast(parent)+1` and SHOULD be current Unix time when that is greater.

If the `u64` nonce space is exhausted, rebuild with a new valid `created_at` and restart search.

When a winning block is found, the main process revalidates it, signs it, commits it through the normal `ChainExecutor`, publishes included transaction events to every active write relay, then publishes the block to every active write relay. Failed deliveries enter retry queues and never roll back a valid local block.

The node MUST expose mining mode, workers, generation, NIP-01 candidate rate, CacheWalk evaluation rate, expected difficulty, and pause reason.

## 21. Nostr-only mainnet networking, bootstrap, and discovery

All external blockchain communication is ordinary Nostr over WebSocket. Public mainnet relay URLs MUST use `wss://`; `ws://` is permitted only for loopback/private operator links.

No custom blockchain P2P wire protocol is permitted in v0. Nodes do not need to discover each other directly. Relays are rendezvous and transport; consensus remains local verification.

### 21.1 Bootstrap relay set

The canonical mainnet descriptor MUST launch with at least three public `wss://` bootstrap relay hints on distinct hostnames. This is an operational mainnet requirement, not consensus.

A fresh node connects to all bootstrap relays concurrently plus any operator-supplied relays. Failure of one or two bootstrap relays MUST NOT prevent operation if at least one usable chain relay remains reachable.

### 21.2 Baseline block subscription

For every active read relay, keep a live NIP-01 subscription for:

```json
{"kinds":[7343],"#t":["nostr-blockchain:<CHAIN_ID>"]}
```

Transaction events MAY also be subscribed broadly, but missing transaction bodies MUST always be requested by exact event ID.

A node MUST NOT use `since`/`until` as a consensus-history boundary.

### 21.3 Block-first synchronization

Any received candidate block gives the node a concrete block ID and parent ID.

For an unknown branch, the node:

1. verifies the NIP-01 envelope and cheap block structure;
2. requests the exact parent block ID from all suitable connected relays;
3. recursively walks parent IDs until known history/genesis is reached;
4. requests every referenced transaction by exact event ID;
5. validates the branch forward from the known ancestor;
6. computes expected difficulty and cumulative chainwork locally;
7. applies normal fork choice.

### 21.4 Relay discovery without a custom node protocol

v0 defines no chain-specific relay-list event.

Additional relay candidates are learned from:

```text
canonical mainnet bootstrap hints
operator-supplied --relay URLs
NIP-65 relay-list events published by miner/service pubkeys already observed on valid chain events
locally persisted previously successful relay URLs
```

When a node validates a block, it MAY query for the block miner's current NIP-65 relay-list event and add well-formed `wss://` relay URLs to a bounded candidate pool.

NIP-65 data is discovery metadata only. A relay learned from it has no authority.

### 21.5 Relay pool and failover

The reference node SHOULD maintain four simultaneous relay connections when available, but one functioning relay is sufficient for operation and mining.

The pool MUST deduplicate URLs, apply bounded reconnect/backoff, persist successful hints, periodically retry failed bootstrap relays, and promote newly working relays.

### 21.6 NIP-77

NIP-77 MAY be used as a synchronization optimization. Mainnet interoperability MUST NOT depend on it.

### 21.7 Relay trust

Relays provide transport and availability only. They may omit, delay, reject, censor, reorder, or lie about what they retain.

Nodes independently verify every event, parent link, PoW result, transaction, state transition, difficulty transition, and cumulative-work claim.

EOSE from a generic relay proves only completion of that relay's response, not complete global chain history.

## 22. Public full-chain Nostr relay role

The repository MUST include a chain-focused Nostr relay that can be run publicly or privately.

It MUST support at least standard NIP-01 `EVENT`, `REQ`, `CLOSE`, `EOSE`, and `OK` messages and MUST preserve ordinary WebSocket/Nostr interoperability.

For a configured chain it MAY reject unrelated kinds and SHOULD retain:

```text
all accepted BLOCK_KIND events for the chain
all TX_KIND events referenced by retained blocks
recent/useful unconfirmed TX_KIND events by policy
 events by bounded retention policy
```

On first startup it seeds the validated genesis event from `mainnet.json`/the supplied network descriptor.

It MUST verify basic NIP-01 ID/signature integrity before storage. It MAY perform chain-aware validation, but no validator may depend on relay-side validity decisions.

For public mainnet operation the relay MUST be reachable through a `wss://` URL. TLS MAY terminate in a reverse proxy. The reference relay process may listen on plain WebSocket behind that proxy.

A full-chain relay's promise is an availability contract, never consensus proof. Multiple independently operated full-chain relays are expected.

## 23. SQLite persistence contract

The reference node uses one SQLite database per node data directory. A node MUST acquire an exclusive process lock at `<data_dir>/node.lock` before opening the writable database and MUST refuse startup if another live process holds it. Stale locks MAY be recovered only after confirming the owning process is gone.

Required pragmas on every writable connection:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

There is one logical active-state writer: `ChainExecutor`.

Connecting/disconnecting active-chain blocks, UTXO mutations, undo records, supply changes, and active-tip changes MUST occur inside one SQLite transaction.

### 23.1 Required logical tables

The schema MUST represent at least:

```text
meta
events
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
missing_objects
relay_state
node_announcements
```

`block_transactions.tx_id` MUST NOT require a foreign key to `transactions`, because a block may arrive before the referenced transaction body.

`mempool_inputs` MUST NOT have a unique constraint on outpoint because conflicting mempool transactions are allowed.

### 23.2 Minimum table semantics

`meta` stores schema version, chain ID, active tip, active height, supply, and clean-shutdown marker.

`events` stores raw validated Nostr event JSON keyed by event ID.

`blocks` stores parent, height when known, validation state, active flag, work difficulty, median-time-past, credited work, and cumulative work.

`transactions` stores parsed validity and fee data.

`utxos` stores the current active UTXO set only.

`undo_spent` and `undo_created`, together with the validated block fee/reward summary, contain everything necessary to disconnect an active block without rereading unrelated history. For an active non-genesis block, `supply_after = supply_before + block_reward - total_minimum_burn`. Disconnect restores `supply_before` by reversing that exact delta.

`active_chain(height -> block_id)` is unique by height.

### 23.3 Side-branch validation

Validating a side branch MUST NOT mutate the active SQLite UTXO set.

The reference implementation SHOULD create an in-memory `StateOverlay` by logically undoing the active branch to the common ancestor and applying side-branch state transitions in memory.

Only when a strictly better tip wins may `ChainExecutor` atomically perform the real disconnect/connect sequence.

---

## 24. Canonical mainnet descriptor and bootstrap artifact

The canonical release MUST ship `networks/mainnet.json`.

Logical format:

```json
{
  "format": "nostr-blockchain-mainnet-v0",
  "network": "mainnet",
  "chain_id": "<64 lowercase hex genesis event id>",
  "protocol_version": 0,
  "genesis_event": { "id": "...", "pubkey": "...", "created_at": 0, "kind": 7343, "tags": [], "content": "...", "sig": "..." },
  "bootstrap_relays": [
    {"url":"wss://relay1.example","role":"full-chain","read":true,"write":true},
    {"url":"wss://relay2.example","role":"full-chain","read":true,"write":true},
    {"url":"wss://relay3.example","role":"full-chain","read":true,"write":true}
  ]
}
```

The shown values are structural placeholders only. The released file MUST contain the complete canonical mined/signed genesis event and real bootstrap URLs.

`chain_id` MUST equal `genesis_event.id`.

Bootstrap relay entries are mutable operational hints, not consensus. Different distributions of `mainnet.json` MAY carry different relay hint lists while representing the same mainnet **only if the embedded genesis event and chain ID are byte-identical**.

A node MUST verify the embedded genesis from first principles and MUST refuse any descriptor labeled `mainnet` whose genesis does not equal the canonical mainnet chain ID compiled/bundled by that release unless the operator explicitly uses a custom-network command.

Before the one-time launch, a release-candidate build may contain no canonical `mainnet.json`; in that state `mainnet launch` is the only command allowed to create it. After launch, every public release MUST bundle the exact canonical descriptor/chain ID and `mainnet launch` MUST refuse to create a second mainnet.

## 25. Mainnet signer and local key contract

Plaintext monetary/mining private-key files MUST NOT be the default mainnet profile.

`key generate` MUST create a password-encrypted NIP-49 `ncryptsec` secret by default and store it in a local file with restrictive permissions (`0600` on POSIX where possible). The command prompts interactively for the password twice unless a secure supported secret-input mechanism is explicitly selected.

Example logical file:

```text
ncryptsec1...
```

The CLI MUST refuse to overwrite an existing key unless `--force` is explicitly supplied.

The secret scalar MUST come from the operating-system CSPRNG and be a valid non-zero secp256k1 scalar.

Supported mainnet signer types MUST include:

```text
local-ncryptsec   # default
none              # validator-only
```

A released implementation SHOULD additionally support NIP-46 remote signing. Hardware signers MAY be added without consensus changes.

When a local encrypted key is unlocked for continuous mining, the decrypted scalar may remain only in process memory for the running session and SHOULD be zeroed on shutdown where the runtime permits. Mining worker threads never receive it.

## 26. Node configuration file

`node init`/`mainnet init` create `node.json` with this logical structure:

```json
{
  "format": "nostr-blockchain-node-v0",
  "network_file": "./networks/mainnet.json",
  "data_dir": "./node-data",
  "signer": {"type":"local-ncryptsec","path":"./miner.ncryptsec"},
  "relays": [],
  "mining": {"mode":"continuous","workers":1,"min_active_relays":1},
  "discovery": {"enabled":true,"target_active_relays":4},
  "control": {"enabled":true}
}
```

If `relays` is empty, bootstrap hints from the network descriptor seed discovery. Operator-supplied relays augment rather than replace discovery unless `discovery.enabled=false` is explicitly chosen.

`signer` MAY be `{ "type": "none" }`; such a node validates and relays but cannot mine.

Relative paths are resolved relative to the configuration file directory.

## 27. Node lifecycle and first-run initialization

`node start` MUST follow:

```text
STARTING
 -> LOAD_CONFIG
 -> VALIDATE_MAINNET_DESCRIPTOR
 -> OPEN_DATABASE
 -> INITIALIZE_OR_VERIFY_DATABASE
 -> RECOVER
 -> CONNECT_BOOTSTRAP_RELAYS
 -> DISCOVER_RELAYS
 -> INITIAL_SYNC
 -> SYNC_STABLE
 -> READY
 -> STOPPING
 -> STOPPED
```

### 27.1 Empty database

If no database exists, the node creates schema, verifies/stores canonical genesis as height 0, initializes empty UTXO/supply, commits atomically, then begins Nostr synchronization. No manual DB-init command is required.

### 27.2 Existing database

With the exclusive data-directory lock held, verify chain ID, protocol version, exact canonical genesis, schema version, active-chain metadata, and DB consistency. Any mismatch stops startup; the node MUST NOT silently create another chain/database.

### 27.3 Crash recovery

Because active chain transitions are one SQLite transaction, startup should observe either the state before or after a committed transition. If verification fails, stop with an actionable `chain verify`/`chain reindex` error.

### 27.4 SYNC_STABLE and READY

A fresh mainnet node reaches `SYNC_STABLE` when:

1. canonical genesis/database validation succeeds;
2. at least one read-capable relay connection is active;
3. the baseline block subscription has reached EOSE on at least one active relay where EOSE is supported;
4. every currently known candidate branch reachable through exact-parent walking has been validated, queued for a concrete missing object, or rejected;
5. no strictly better fully validated chain has been discovered during the final 30 seconds of startup synchronization;
6. active tip/state are internally consistent.

The node then enters `READY` and continues subscriptions, exact-ID fetching, relay discovery, and failover in the background.

Continuous mining starts on `READY` when a signer is available, mining is `continuous`, and at least one write-capable relay is active.

## 28. Local control channel

A running node MUST expose a local-only control endpoint inside its data directory.

On POSIX the default is:

```text
<data_dir>/control.sock
```

It MUST NOT listen on a public TCP interface by default. On startup the node MAY remove a stale socket file only after it has acquired the exclusive data-directory lock and verified that no live node owns the endpoint.

The CLI uses this channel for status, wallet queries, transaction submission, mining mode control, and test orchestration.

This local control channel is not blockchain networking and does not violate the Nostr-only external communication requirement.

---

## 29. Exact CLI behavior

### 29.1 Version

```bash
npm run nb -- version
```

Prints implementation, protocol, schema, and bundled mainnet chain ID.

### 29.2 Generate an encrypted mainnet key

```bash
npm run nb -- key generate --out ./miner.ncryptsec
```

Prompts for a password, writes NIP-49 encrypted key material, and prints the public key/`npub`.

### 29.3 One-time canonical mainnet launch

Before the public mainnet exists, the launch operator runs exactly once:

```bash
npm run nb -- mainnet launch \
  --out ./networks/mainnet.json \
  --genesis-out ./networks/mainnet-genesis.json \
  --launcher-key ./launcher.ncryptsec \
  --bootstrap-relay wss://relay1.example \
  --bootstrap-relay wss://relay2.example \
  --bootstrap-relay wss://relay3.example
```

The command MUST require at least three syntactically distinct `wss://` bootstrap relay URLs and MUST use exactly the Section 10.3 mainnet profile. It mines/signs genesis, verifies it from scratch, writes both artifacts, prints the chain ID and SHA-256 file digests, and refuses to overwrite an existing canonical mainnet descriptor unless a dedicated dangerous development flag is compiled/enabled outside release builds.

Once the canonical mainnet descriptor has been published, ordinary users **never run `mainnet launch`**.

### 29.4 Inspect mainnet

```bash
npm run nb -- chain inspect --network ./networks/mainnet.json
```

Verifies genesis and prints chain ID, launch timestamp, monetary parameters, initial difficulty, retarget constants, limits, and bootstrap hints.

### 29.5 Start a public full-chain relay

```bash
npm run nb -- relay start \
  --network ./networks/mainnet.json \
  --data-dir ./relay-data \
  --listen 127.0.0.1:7447 \
  --public-url wss://relay.example
```

The process prints `RELAY READY ... chain=<CHAIN_ID>`. If `--public-url` is supplied it SHOULD also be included in the operator/miner's NIP-65 relay list when that identity publishes one.

### 29.6 Initialize a low-level node

```bash
npm run nb -- node init \
  --network ./networks/mainnet.json \
  --data-dir ./node-data \
  --key ./miner.ncryptsec \
  --out ./node.json
```

`--no-signer` creates a validator-only node. Exactly one of `--key`/`--no-signer` is required.

### 29.7 Start a low-level node

```bash
npm run nb -- node start --config ./node.json
```

It runs in the foreground and prints:

```text
NODE READY chain=<CHAIN_ID> height=<H> tip=<ID> work=<W> difficulty=<D> mining=<MODE>
```

when ready.

### 29.8 Node status

```bash
npm run nb -- node status --config ./node.json
```

Prints lifecycle, chain ID, height, tip, cumulative work, current/next difficulty, supply, UTXO/state hashes, relay connections/candidates, unresolved tip hints, mempool, mining mode/workers/rates, and pause reason.

### 29.9 Block/transaction/mempool

```bash
npm run nb -- node block --config ./node.json --height <HEIGHT>
npm run nb -- node block --config ./node.json --id <BLOCK_ID>
npm run nb -- node tx --config ./node.json --id <TX_ID>
npm run nb -- node mempool --config ./node.json
```

These commands expose stored/derived validation details without changing consensus state.

### 29.10 Mining control

```bash
npm run nb -- node mining --config ./node.json --mode continuous
npm run nb -- node mining --config ./node.json --mode disabled
npm run nb -- node mining --config ./node.json --mode mine-one
```

`mine-one` is local tooling and returns to `disabled` after one block.

### 29.11 Wallet commands

```bash
npm run nb -- wallet address --key ./miner.ncryptsec
npm run nb -- wallet balance --config ./node.json --pubkey <PUBKEY_HEX>
npm run nb -- wallet utxos --config ./node.json --pubkey <PUBKEY_HEX>
```

Send exact decimal NSR:

```bash
npm run nb -- wallet send \
  --config ./node.json \
  --key ./miner.ncryptsec \
  --to <RECIPIENT_NPUB_OR_HEX> \
  --amount 1.00000000 \
  --priority-fee 0.00000000
```

Decimal parsing MUST convert exactly to integer base units; floating point is forbidden. Coin selection/fee/change construction follows the deterministic wallet rules in this specification.

### 29.12 Verify/reindex/replay

```bash
npm run nb -- chain verify --config ./node.json
npm run nb -- chain reindex --config ./node.json
npm run nb -- chain replay --network ./networks/mainnet.json --events ./events.ndjson
```

Reindex requires the node stopped/exclusively locked and MUST preserve the remembered active equal-work branch when still valid maximum work.

### 29.13 User-facing mainnet wrapper

Fresh operator setup:

```bash
npm run nb -- mainnet init --data-dir ~/.nostr-blockchain
```

This uses bundled `networks/mainnet.json`, creates the data directory, prompts to create an encrypted mining key unless `--validator-only` is supplied, and writes the node config. It MUST NOT create genesis.

Start:

```bash
npm run nb -- mainnet start --data-dir ~/.nostr-blockchain
```

If the configured signer is `local-ncryptsec`, startup MUST prompt on the controlling terminal to unlock it before mining. A validator may continue syncing while the signer remains locked; mining reports `SIGNER_LOCKED`. Non-interactive operators SHOULD use a supported remote signer or secure secret-input mechanism rather than placing the password in command-line arguments.

Status:

```bash
npm run nb -- mainnet status --data-dir ~/.nostr-blockchain
```

Send:

```bash
npm run nb -- mainnet send --data-dir ~/.nostr-blockchain --to <NPUB_OR_HEX> --amount 1.00000000
```

These are wrappers over the lower-level commands and MUST operate on the same database/config.

## 30. Exact public-mainnet launch and start procedure

This section is the normative operational path.

### 30.1 One-time network launch

Before genesis, reserve at least three public `wss://` relay endpoints on distinct hostnames. They may initially be run by the launch team, but no consensus privilege attaches to them.

Generate the launch key:

```bash
npm ci
npm run build
mkdir -p ./networks
npm run nb -- key generate --out ./launcher.ncryptsec
```

Create the canonical genesis/descriptor:

```bash
npm run nb -- mainnet launch \
  --out ./networks/mainnet.json \
  --genesis-out ./networks/mainnet-genesis.json \
  --launcher-key ./launcher.ncryptsec \
  --bootstrap-relay wss://relay1.example \
  --bootstrap-relay wss://relay2.example \
  --bootstrap-relay wss://relay3.example
```

Publish `mainnet.json`, `mainnet-genesis.json`, their SHA-256 digests, and the chain ID through multiple independent channels. The chain ID/genesis event, not the publication channel, defines mainnet.

Start the configured relay stores using the new descriptor and seed genesis. Then start at least three independent full nodes with separate keys/databases and connect them to the relay set. The first non-genesis block begins normal issuance.

The launcher's genesis signing key has no special authority and MAY be retired after launch.

### 30.2 Normal user/operator start

A user joining an already launched mainnet runs:

```bash
npm ci
npm run build
npm run nb -- mainnet init --data-dir ~/.nostr-blockchain
npm run nb -- mainnet start --data-dir ~/.nostr-blockchain
```

`mainnet init` never creates a chain; it joins the canonical chain bundled in `networks/mainnet.json`.

The node connects to bootstrap relays, discovers additional relay candidates through ordinary Nostr relay-list metadata and observed chain participants, validates candidate branches by exact block IDs, enters `READY`, and begins continuous mining by default if it has a signer and at least one write relay.

### 30.3 Mainnet is not tied to launch relays

After genesis, the network remains usable if every original bootstrap relay eventually disappears, provided users can reach at least one relay carrying valid chain history or explicitly supply a known relay URL. Relay hints can be updated in software/distributed descriptors without changing chain identity.

## 31. Mainnet convenience and degraded-start behavior

`mainnet init` and `mainnet start` are mandatory convenience commands; users should not have to assemble low-level configs for normal operation.

The node SHOULD maintain at least four live relay connections when available. With exactly one functioning relay it remains operational and may mine; status SHOULD report `DEGRADED_RELAYS`. With zero functioning write relays, mining pauses with `NO_WRITE_RELAY` while the node keeps reconnecting.

An operator may add a known relay at startup:

```bash
npm run nb -- mainnet start \
  --data-dir ~/.nostr-blockchain \
  --relay wss://known-chain-relay.example
```

This is the recovery path if bundled bootstrap hints are stale.

`mainnet status` MUST clearly distinguish:

```text
READY
SYNCING
DEGRADED_RELAYS
SIGNER_LOCKED
SIGNER_UNAVAILABLE
MINING
MINING_PAUSED
```

and show the active/discovered relay set so operators can diagnose connectivity without reading logs.

## 32. Joining and recovering the existing mainnet

The minimum identity needed to select mainnet is its canonical genesis event ID. The normal software release bundles the verified descriptor so users do not type it manually.

If an operator obtains a descriptor from elsewhere, they MUST run:

```bash
npm run nb -- chain inspect --network ./mainnet.json
```

and compare its chain ID to the expected published mainnet chain ID before using it.

A fresh node independently validates genesis, discovers/fetches candidate tips and history through Nostr, resolves transaction dependencies, computes difficulty/chainwork, selects the greatest-work valid branch, and enters `READY`.

If all bundled bootstrap relays are dead, the operator supplies one or more currently known relay URLs with `--relay`; from there the node can learn additional relay candidates through NIP-65 relay lists associated with already observed valid miner/service pubkeys and through persisted/operator hints. No checkpoint or trusted current tip is required.

## 33. Diagnostic UTXO digest and state hash

The diagnostic UTXO digest is not consensus input, but it is mandatory for conformance and node comparison.

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
bits 1..7 = 0
```

Sort records ascending by `(source_id raw bytes, output_index)`.

Then:

```text
UTXO_DIGEST = SHA256(concat(all sorted 91-byte records))
```

For an empty set, hash the empty byte string.

The reference diagnostic state hash is:

```text
STATE_HASH = SHA256(
    ASCII("NostrBlockchain-v0/state")
    || CHAIN_ID
    || U64BE(active_height)
    || ACTIVE_TIP_ID
    || U8(active_tip_work_difficulty)
    || U128BE(active_cumulative_work)
    || U128BE(supply)
    || UTXO_DIGEST
)
```

Every node-status and acceptance report MUST expose both hashes.

---

## 34. CacheWalk deterministic conformance vector

The following vector is normative for CacheWalk R1 implementation correctness.

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

Expected initial scratch lines before mutation:

```text
line[0] =
f18106d88dbf905be3e7fffcce667df4b7b77990bd1b10b9fc9fabd236292c3a14fad3cd3dd6da4bea579df143a02da9c3b5dead56187322fe5249a34d46cae4

line[4095] =
ba16a0b912c391051beb1d6293b98bff39be528faa818bf028198169a8467bc504d5fa677756d425fc14526fc86d4cb7f806bc1a7f145e0799381f82bacc704d
```

Expected initial state:

```text
16dbed5022d3f5e9cbbfc7eaa33f09d86575407b648cade522167814d3930d8b
```

First round (`pass=0`, `i=0`) MUST produce:

```text
j = 2838

B =
2763d7ae7db87728e1547500bdd0dea46d00ad103db275bfa680b0a69a1184328c2a94e54c91740626c1729fdaa9ff488e7e1e63fa9b08bded0c8885002f954b

m0 =
0745177cc561eddec699c0ded1f87598b4133e95aba4123085ace8b2b1fe5dc5

m1 =
592784a56b3cb936a2fef987555753c745b3c0da0accf20f5da09393700b9366
```

The first `i == j` case in this vector occurs at `pass=0`, `i=244`, `j=244` and MUST use a copy of the pre-mutation line for both `A` and `B`:

```text
state =
f410e7430eb69b472a805a5c393236b1996a27d65e2ab4b020f88d9499a9773f

A = B =
2dee65662fedd9c90aa942c4fc8d737ab350dd306857e3ce2bf8137df030cc87ff055f7b77388c9f6368248b508a7d2f8483a6463291a9d1a82424517dc5a6a5

m0 =
ccd86561043b5560b356631a9b6accf56f2ec4c720ec9f08c5ed6da172fb3dc2

m1 =
a8a4ea0398d5eee49882a194b1f67e3e06906a1244f7b14a2c4d48bb944df4c1
```

Expected pass terminal states:

```text
state_after_pass_0 =
86afbc66890fb8b774869edbbf316cbb62e5de2fae2944ddce234e7c6fa2afb1

state_after_pass_1 =
4c6fd53cdccfe7978652bf4ff79322f05eb61317cc794c32bc6bf59db44ced8a
```

Expected final selection:

```text
j_final = 4060

line[j_final] =
5b4c4deb2e85d282acd8174eb423430593d7a40dcfa29d97f0d0c7cf2fc312bcc52805cbee926b56eeaa8fcca3c88bfe2fb65a6b2b769ce5018d44ca0275800e
```

Expected final work hash:

```text
7a307ddf4899eb02d44050c5538f8558bc1a32762a30bb43a83bfcc5a32899fc
```

A reference implementation that does not reproduce every value above byte-for-byte is non-conforming and MUST NOT create or join a v0 chain.

### 34.1 Difficulty-retarget arithmetic vectors

With `D=12` and `target_span=1800`:

```text
actual_span = 1349 -> next difficulty 13
actual_span = 1350 -> next difficulty 12
actual_span = 1800 -> next difficulty 12
actual_span = 2700 -> next difficulty 12
actual_span = 2701 -> next difficulty 11
```

The comparisons are strict exactly as written in Section 16.8. At `D=1`, a slow-window result remains `1`; at `D=63`, a fast-window result remains `63`. Implementations MUST include these boundary vectors in unit tests.

---

## 35. Conformance corpus command

The mandatory CLI additionally includes:

```text
conformance generate
conformance verify
```

Generate:

```bash
npm run nb -- conformance generate \
  --network ./networks/mainnet.json \
  --out ./run/conformance
```

The generated corpus MUST include:

```text
CacheWalk R1 vector from Section 34
valid genesis event
invalid genesis signature
invalid genesis CacheWalk
valid first-window block
difficulty-retarget unchanged fixture
difficulty-retarget +1 fixture
difficulty-retarget -1 fixture
invalid wrong-difficulty block
valid empty block
invalid block gate
invalid block CacheWalk
valid transaction
wrong-owner transaction
immature-reward transaction
fee-too-low transaction
positive-priority transaction
duplicate-input transaction
bad-canonical-order transaction
same-block-child invalid block
conflicting block-spend invalid case
fork/reorg state fixtures
UTXO digest fixtures
state hash fixtures
```

Verify:

```bash
npm run nb -- conformance verify --dir ./run/conformance
```

MUST produce no network traffic and MUST exit non-zero on any mismatch.

The repository test suite MUST include the fixed CacheWalk vector even when no generated network corpus is present.

---

## 36. Consensus error taxonomy

Implementations SHOULD expose stable machine-readable error codes.

Transaction minimum set:

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

Block minimum set:

```text
BLOCK_BAD_JSON
BLOCK_BAD_NIP01_ID
BLOCK_BAD_SIGNATURE
BLOCK_BAD_KIND
BLOCK_BAD_SCOPE
BLOCK_BAD_TAGS
BLOCK_BAD_CONTENT
BLOCK_BAD_NONCE
BLOCK_BAD_GATE_COMMITMENT
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

Operational minimum set:

```text
BOOT_BAD_NETWORK_FILE
BOOT_BAD_GENESIS
BOOT_CHAIN_ID_MISMATCH
BOOT_SCHEMA_MISMATCH
BOOT_DATABASE_CHAIN_MISMATCH
BOOT_NO_RELAY_CONNECTIVITY
BOOT_SIGNER_UNAVAILABLE
BOOT_SIGNER_LOCKED
BOOT_RECOVERY_FAILED
BOOT_RELAY_DEGRADED
CLI_REFUSE_OVERWRITE
CONTROL_UNAVAILABLE
MAINTENANCE_LOCKED
```

---

## 37. Resource and DoS policy

These are reference policies, not consensus rules.

The node and chain-focused relay SHOULD enforce:

```text
maximum WebSocket text frame: 262144 bytes
bounded unknown-parent queue
bounded missing-object queue
bounded per-relay concurrent exact-ID fetches
per-relay token bucket for candidates reaching CacheWalk verification
bounded mempool size
bounded conflicting transactions per outpoint
```

The reference mempool conflict cap SHOULD default to `4` transactions per outpoint.

Cheap validation and known-parent checks MUST precede expensive CacheWalk whenever possible.

An unknown-parent block MUST be dependency-queued before CacheWalk is evaluated.

A peer/relay repeatedly delivering expensive invalid candidates MAY be throttled or disconnected. The same block received later from another source is evaluated normally.

---

## 38. Reindex, replay, and crash correctness

### 38.1 Reindex invariant

Given the same stored valid chain history, genesis, and remembered pre-reindex active-tip selection, reindex MUST reconstruct the same:

```text
active tip
height
UTXO set
supply
UTXO digest
state hash
```

This remembered-tip rule is required because live equal-work branches deliberately do not reorg merely due to lexical ordering.

### 38.2 Replay invariant

Two independent conforming implementations given the same event corpus MUST classify the same consensus events and derive the same best-work state set. Equal-work live-branch local stickiness is not encoded into a static corpus; replay tooling MUST report all equal-work best tips and then apply the fresh-bootstrap lexical initial-tip rule.

### 38.3 Crash tests

The automated test suite MUST inject process termination around:

```text
block connect
block disconnect
multi-block reorg
mempool confirmation/removal
relay ingestion
```

After restart, database verification or reindex MUST restore/confirm a valid state without monetary divergence.

---

## 39. Mainnet release-conformance scenario

The command:

```bash
npm run nb -- mainnet conformance --clean
```

MUST create an isolated local **regtest harness** using the same consensus code with accelerated local-only parameters where explicitly allowed by the harness. It is a release test, not a second public chain.

The scenario MUST automatically verify:

1. deterministic CacheWalk vector and genesis parsing;
2. block timestamp/MTP rules;
3. unchanged, +1, and -1 difficulty-retarget windows;
4. three independent node databases and Nostr-only relay transport;
5. automatic continuous mining;
6. reward creation and maturity;
7. zero-tip transfer and fee burn;
8. positive-priority transfer and miner reward accounting;
9. conflicting mempool spends;
10. same-block child-spend rejection;
11. equal-chainwork no-reorg behavior;
12. strictly greater-chainwork reorg;
13. relay failure/rotation while nodes continue through other relays;
14. clean and unclean restart;
15. reindex/replay equality.

The final report MUST contain:

```text
CACHEWALK: PASS
TIMESTAMP RULES: PASS
DIFFICULTY RETARGET: PASS
THREE NODES READY: PASS
NOSTR RELAY FAILOVER: PASS
AUTO MINING: PASS
REWARD MATURITY: PASS
PAYMENT/FEE ACCOUNTING: PASS
CONFLICT HANDLING: PASS
FORK/REORG: PASS
RESTART: PASS
REINDEX/REPLAY: PASS
SAME ACTIVE TIP: PASS
SAME CUMULATIVE WORK: PASS
SAME SUPPLY: PASS
SAME UTXO DIGEST: PASS
SAME STATE HASH: PASS

MAINNET-CONFORMANCE: PASS
```

Any failure exits non-zero.

## 40. Regtest-only controls

The release harness MAY expose local-only controls:

```text
set mining mode continuous|disabled|mine-one
connect relay URL
disconnect relay URL
advance/fix local test clock
query status
submit raw event
```

These controls MUST be unavailable through any public network interface and MUST NOT change mainnet consensus behavior. `regtest start`, `regtest acceptance`, and `regtest reset` are developer/release tooling only.

## 41. Wallet presentation rules

Wallets distinguish:

```text
confirmed       all active-chain UTXOs owned by key
spendable       confirmed minus immature rewards
immature_reward confirmed reward UTXOs not yet mature
pending         local mempool presentation only
```

No account balance table participates in consensus.

A wallet MUST display NSR amounts without using floating point internally. Decimal parsing/formatting converts exactly between strings and integer base units using 8 display decimals.

Example:

```text
1.00000000 NSR = 100000000 base units
```

---

## 42. Event storage identity

Consensus identity is the NIP-01 event ID.

If the same event ID is received with multiple valid BIP340 signatures, it is still one transaction/block identity because the signature is not part of the NIP-01 event-ID preimage.

Local storage MAY retain the first valid representation.

An event with the same ID but different committed event fields is impossible without a SHA-256 collision and is outside the v0 threat model.

---

## 43. Reference schema minimum DDL

Implementations may add indexes/columns, but the following logical structure MUST remain representable. Types shown use SQLite conventions; hashes/keys/amounts SHOULD be stored as BLOBs to avoid numeric/hex ambiguity.

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
  parse_valid INTEGER NOT NULL
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
  active INTEGER NOT NULL DEFAULT 0,
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
  role TEXT NOT NULL,
  last_connected INTEGER,
  last_eose INTEGER,
  last_error TEXT,
  source TEXT,
  score INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE node_announcements (
  pubkey BLOB PRIMARY KEY,
  event_id BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  tip_id BLOB,
  height INTEGER,
  cumulative_work BLOB,
  raw_json TEXT NOT NULL
);
```

Monetary amounts and cumulative work encoded in BLOB columns MUST use 16-byte unsigned big-endian (`u128`) representation. Block IDs/keys use fixed 32-byte BLOBs.

---

## 44. Implementation architecture

Recommended modules:

```text
consensus/
  strict-json
  nip01
  codec
  transaction
  fees
  utxo
  block
  cachewalk
  difficulty
  fork-choice

chain/
  chain-executor
  state-overlay
  reorg
  replay

storage/
  sqlite
  schema
  undo

network/
  relay-client
  sync
  missing-object-fetcher
  relay-discovery
  relay-pool
  chain-relay

mining/
  candidate-builder
  coordinator
  worker

wallet/
  key
  coin-selection
  builder

cli/
  commands

mainnet/
  wrappers
  launch

regtest/
  supervisor
  acceptance
```

Consensus modules SHOULD be pure functions wherever possible and MUST NOT perform network or filesystem access.

---

## 45. Implementation order

A coding agent/developer implementing this specification SHOULD proceed in this order:

1. strict JSON, integer/hex codecs, NIP-01 ID/signature verification;
2. CacheWalk R1 and Section 34 vector;
3. block timestamp/MTP and difficulty-retarget pure functions with fixed vectors;
4. canonical mainnet genesis codec/miner and `mainnet launch`;
5. transaction codec/validation/fees;
6. block validation/reward/cumulative-work fork choice;
7. SQLite schema, ChainExecutor, undo/reorg, hashes;
8. local control channel and status;
9. Nostr relay client plus public chain relay;
10. multi-relay pool,  relay-list metadata, tip-directed sync, exact-ID dependency resolution;
11. continuous mining workers;
12. encrypted signer and wallet utility;
13. `mainnet init/start/status/send` wrappers;
14. conformance corpus and local release harness;
15. README Mainnet Quick Start and release checklist.

A release MUST NOT be described as mainnet-ready before Section 39 prints `MAINNET-CONFORMANCE: PASS`.

## 46. Future NBP boundary

The v0 Core intentionally remains small.

Future NBPs may define application anchoring, names, fungible assets, owned objects, organizations, deterministic application state processors, games, height validity, adaptor swaps, archive markets, and other features.

A future application feature MUST NOT silently change v0 native UTXO validity.

Consensus-changing NBPs require explicit activation/version rules.

Application/network/policy NBPs may remain optional.

---

## 47. CacheWalk v0 mainnet boundary

CacheWalk R1 is active v0 mainnet consensus. Its hardware economics remain intentionally observable and improvable only through a future explicit protocol version.

Operators/researchers SHOULD measure CPU rate, latency, memory, energy/thermal behavior, GPU implementations, reduced-memory attacks, parallel candidate scaling, and invalid-work flooding on the live network and test environments.

None of those observations may silently alter v0 validity. A future PoW revision requires explicit activation rules and existing v0 history remains interpreted by the rules under which it was mined.

The project claims neither CPU-only execution nor permanent ASIC/GPU resistance.

## 48. Mainnet release checklist

Before publishing a release as v0 mainnet-ready, every answer MUST be yes:

```text
Can I run npm ci, build, and tests from a clean checkout?
Does the release contain the exact canonical networks/mainnet.json?
Can chain inspect independently verify its genesis?
Can a fresh user run mainnet init without editing files?
Can mainnet start reach READY from an empty database?
Does it connect to multiple WSS relays?
Can it discover additional relays/tips from Nostr relay-list discovery?
Does it survive loss of any one bootstrap relay?
Does tip-directed exact-ID sync recover history missed by capped broad queries?
Does block time retarget deterministically around the 15-second target?
Does continuous mining start automatically when safe to propagate?
Are default private keys encrypted?
Can a validator-only node run without a monetary key?
Can I see matured reward and send NSR?
Are minimum fees burned and priority fees paid to miners?
Can two independent nodes derive the same cumulative work/UTXO/supply?
Can a fork with greater work reorg correctly?
Can restart and reindex reproduce state exactly?
Does mainnet conformance print MAINNET-CONFORMANCE: PASS?
Is the README Mainnet Quick Start accurate?
```

If any answer is no, the release is not mainnet-ready.

# Appendix A — Mainnet Quick Start

For a normal user joining the already launched public mainnet:

```bash
npm ci
npm run build
npm run nb -- mainnet init --data-dir ~/.nostr-blockchain
npm run nb -- mainnet start --data-dir ~/.nostr-blockchain
```

`mainnet init` prompts for an encrypted mining key by default. Use `--validator-only` if the node should not mine.

In another terminal:

```bash
npm run nb -- mainnet status --data-dir ~/.nostr-blockchain
```

After a mining reward matures, send NSR:

```bash
npm run nb -- mainnet send \
  --data-dir ~/.nostr-blockchain \
  --to <NPUB_OR_HEX> \
  --amount 1.00000000
```

If bundled bootstrap relays are stale, start with a known live chain relay:

```bash
npm run nb -- mainnet start \
  --data-dir ~/.nostr-blockchain \
  --relay wss://known-chain-relay.example
```

The user never creates genesis when joining mainnet.

# Appendix B — Design invariants

The following short list captures the rules most likely to cause accidental consensus divergence:

```text
block/tx identity is always normal NIP-01 event.id
BIP340 signs event.id
TX created_at has no monetary order; BLOCK created_at drives MTP/difficulty only
all native monetary state is UTXO state
one transaction author owns every input
inputs are canonically sorted
same-block child spends are forbidden
minimum fee is burned
priority fee goes to miner
reward UTXO index is 65535
reward plus tips matures together
CacheWalk hash is derived and never replaces block.id
NIP-13 6-bit gate contributes no chainwork
CacheWalk difficulty retargets every 120 blocks; block work = 2^difficulty
only fully state-valid branches participate in cumulative-work fork choice
live equal-work branches do not trigger reorg
missing transaction bodies make a block pending, not invalid
relays/relay-list metadata are never consensus authorities
all external blockchain traffic is Nostr
active reorg is atomic in SQLite
full-node mining defaults to continuous
```

---

# Appendix C — What is deliberately not required for v0 mainnet

The public chain MUST be usable without:

```text
an exchange listing
Lightning integration
Cashu integration
browser wallet support
mobile clients
archive mesh
application NBPs
tokens
names
games
AI services
staking
governance
a smart-contract VM
```

Those can be built after the base mainnet is operating. What **is** required is a canonical genesis, multi-relay Nostr connectivity/discovery, deterministic difficulty, secure signing, independent validation, wallet transfer, crash/reorg correctness, and a reproducible public join path.
