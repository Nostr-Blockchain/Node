# Nostr Blockchain v0 — Prototype Architecture Specification

**Status:** Development-ready architecture freeze  
**Date:** 2026-08-10  
**Target implementation:** TypeScript / Node.js reference node  
**Document role:** Normative for the v0 working prototype except where explicitly marked *policy*, *implementation recommendation*, or *deferred NBP*.
**PoW:** Nostr CacheWalk R1 is active v0 consensus. It preserves the NIP-01 block event ID and NIP-13 nonce-search envelope, while a deterministic CPU-oriented cache walk supplies credited proof of work.

> This document supersedes the cumulative architecture notes that preceded it. Those notes remain useful design history, but they MUST NOT be used to resolve ambiguity against this specification.

---

## 1. Purpose

The v0 prototype exists to prove one narrow proposition:

> A cryptocurrency blockchain can use Nostr signed events as its native transaction and block objects, use Nostr relays for all external blockchain communication, and still provide independently verifiable proof-of-work consensus, UTXO ownership, balances, mining rewards, fee burning, miner priority fees, forks, reorgs, and deterministic replay.

The prototype is deliberately not a general-purpose blockchain platform.

A successful implementation MUST demonstrate:

- Nostr/BIP340 public keys as monetary identities;
- Nostr events as transactions and blocks;
- NIP-01 event IDs as transaction IDs and block IDs;
- NIP-13 nonce-search compatibility plus CacheWalk R1 proof of work derived from the block event ID;
- a deterministic UTXO state machine;
- fixed perpetual block issuance;
- minimum fees burned and excess fees paid to miners;
- reward maturity;
- greatest-work fork choice under fixed difficulty;
- atomic reorgs;
- block-first synchronization using Nostr only;
- crash-safe persistence and deterministic reindex;
- built-in full-node mining, enabled continuously by default as node policy, without exposing the miner private key to worker threads.

Everything not required to prove those properties is deferred.

---

## 2. Normative terminology

The terms **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative.

This document distinguishes four categories:

| Category | Meaning |
|---|---|
| Consensus | All conforming validators MUST agree or they may fork. |
| Network protocol | Required for interoperable reference-node communication but does not itself determine monetary validity. |
| Policy | Local behavior that MAY differ without changing block validity. |
| Deferred NBP | Explicitly outside the v0 prototype. |

When a rule is not marked otherwise, rules in Sections 5–22 are consensus rules.

---

## 3. Frozen v0 scope

### 3.1 Included

```text
NIP-01 event authentication
BIP340 x-only public-key ownership
UTXO transactions
fixed-difficulty Nostr CacheWalk R1 PoW
block DAG
fixed perpetual mining reward
reward maturity
minimum fee burn
miner priority fee
implicit reward UTXO
parent-state-only block execution
fixed block transaction limit
greatest-work fork choice
Nostr relay transport
SQLite persistence
built-in CacheWalk mining
basic archival full-node relay
```

### 3.2 Explicitly excluded

The following MUST NOT be implemented as v0 consensus shortcuts:

```text
dynamic difficulty
15-second consensus target
trusted block timestamps
scripts or VM
native multisig opcode/type
height locks
relative locks
adaptor-swap consensus semantics
application-event anchoring
names
tokens
NFTs / owned objects
games
AI-agent semantics
smart contracts
staking
governance
bridges
state snapshots as consensus authority
archive-mesh commitments in blocks
```

They are addressed only in the deferred roadmap.

### 3.3 Why this freeze exists

The previous design notes mixed the minimal experiment with future public-network and application ideas. That made implementation ambiguous. v0 now has one job: establish a small, reproducible consensus kernel first.

---

## 4. External normative references

The prototype reuses existing cryptographic and Nostr specifications rather than redefining them.

1. [NIP-01 — Basic protocol flow description](https://github.com/nostr-protocol/nips/blob/master/01.md): event fields, event-ID serialization, Schnorr signatures, relay messages, filters and regular-event ranges.
2. [NIP-13 — Proof of Work](https://github.com/nostr-protocol/nips/blob/master/13.md): nonce-tag search and leading-zero-bit PoW over the NIP-01 event ID. v0 retains a small NIP-13 gate but credits CacheWalk work instead.
3. [NIP-44 — Encrypted Payloads](https://github.com/nostr-protocol/nips/blob/master/44.md): existing Nostr use of RFC-8439 ChaCha20 and SHA-256. CacheWalk reuses the same ChaCha20 primitive but not NIP-44 encryption semantics.
4. [RFC 8439](https://www.rfc-editor.org/rfc/rfc8439): exact ChaCha20 primitive used for CacheWalk scratchpad generation.
5. [BIP340 — Schnorr Signatures for secp256k1](https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki): x-only keys and verification semantics.
6. [NIP-77 — Negentropy Syncing](https://github.com/nostr-protocol/nips/blob/master/77.md): optional future set reconciliation. It is not required for the first working prototype.
7. [SQLite WAL](https://www.sqlite.org/wal.html) and [PRAGMA synchronous](https://www.sqlite.org/pragma.html#pragma_synchronous): persistence behavior.
8. [Node.js release schedule](https://nodejs.org/en/about/previous-releases) and [worker_threads](https://nodejs.org/api/worker_threads.html): reference runtime and CPU-worker model.
9. [better-sqlite3](https://github.com/WiseLibs/better-sqlite3): reference SQLite binding.
10. [noble-curves](https://github.com/paulmillr/noble-curves): prototype TypeScript BIP340 implementation.
11. [libsecp256k1](https://github.com/bitcoin-core/secp256k1): independent/high-assurance secp256k1 reference for later cross-checking.
12. [BIP327 — MuSig2](https://github.com/bitcoin/bips/blob/master/bip-0327.mediawiki): deferred aggregate-key signing design.
13. [BIP65](https://github.com/bitcoin/bips/blob/master/bip-0065.mediawiki), [BIP68](https://github.com/bitcoin/bips/blob/master/bip-0068.mediawiki), and [BIP112](https://github.com/bitcoin/bips/blob/master/bip-0112.mediawiki): deferred absolute/relative height-lock prior art.

If one of these external specifications changes after this architecture freeze, the implementation MUST continue following the version/behavior validated by the v0 conformance suite until an explicit protocol revision is made.

---

## 5. Chain identity and protocol constants

### 5.1 Chain ID

The **genesis Nostr event ID** is the chain ID.

Normal chain events MUST contain exactly one chain-scope tag:

```text
["t", "nostr-blockchain:<GENESIS_EVENT_ID>"]
```

The genesis event itself instead uses:

```text
["t", "nostr-blockchain:genesis"]
```

Nodes MUST reject a configured database whose stored genesis ID differs from the selected genesis event.

### 5.1.1 Monetary identity

Consensus account/owner identity is always the raw 32-byte BIP340 x-only public key.

`npub` is a Bech32 display/transport encoding for user interfaces only. It MUST be decoded to the raw 32-byte key before consensus operations and MUST NOT appear inside transaction binary payloads.

### 5.2 Prototype event kinds

```text
TX_KIND    = 7342
BLOCK_KIND = 7343
```

Both are in NIP-01's regular-event range. They are **prototype constants**, not a claim of permanent global assignment. Before any public network launch, the current Nostr event-kind registry MUST be rechecked and the kinds MUST be registered or deliberately reassigned if necessary.

### 5.3 Protocol version

```text
PROTOCOL_VERSION = 0
NIP13_GATE_BITS  = 6
```

`NIP13_GATE_BITS` is a fixed v0 protocol constant. It is a cheap NIP-13-compatible prefilter only and contributes no credited chainwork.

Unknown transaction or block payload versions MUST be rejected.

### 5.4 Reserved output index

```text
REWARD_OUTPUT_INDEX = 0xffff
```

Normal transaction output indexes are therefore restricted to `0x0000..0xfffe`. v0 limits are far below this boundary.

---

## 6. Primitive encodings

Consensus binary encodings use network byte order (big-endian).

| Type | Bytes | Range |
|---|---:|---:|
| `u8` | 1 | 0..255 |
| `u16` | 2 | 0..65,535 |
| `u32` | 4 | 0..4,294,967,295 |
| `u64` | 8 | 0..2^64−1 |
| `u128` | 16 | 0..2^128−1 |
| `hash32` | 32 | raw bytes |
| `pub32` | 32 | BIP340 x-only public key |

All consensus arithmetic MUST use exact integers. JavaScript `number` MUST NOT be used for coin amounts, fee totals, rewards, supply arithmetic, or nonce arithmetic.


For the v0 reference implementation, valid block height is bounded to `0..2^63-1` so it is exactly representable in SQLite `INTEGER`. Reaching this bound is physically irrelevant to the prototype but makes the storage/consensus boundary explicit.

`u128` amounts are decoded to `bigint`.

All hexadecimal consensus payload strings MUST be:

- lowercase ASCII;
- even length;
- free of `0x` prefixes;
- exact-length for the expected payload;
- rejected if any non-hex character is present.

---

## 7. Strict Nostr event envelope

A chain event MUST first satisfy NIP-01 and the stricter v0 profile below.

### 7.1 Exact event object

After strict JSON decoding, a chain event object MUST contain exactly these seven members:

```text
id
pubkey
created_at
kind
tags
content
sig
```

Unknown extra members are rejected for v0 chain events.

The inbound JSON decoder MUST reject duplicate object-member names before semantic parsing. Plain `JSON.parse` without duplicate-key detection is insufficient for untrusted relay frames.

### 7.2 Field restrictions

- `id`: exactly 64 lowercase hex characters.
- `pubkey`: exactly 64 lowercase hex characters and a valid BIP340 x-only point.
- `created_at`: integer in `0..9007199254740991` (`Number.MAX_SAFE_INTEGER`).
- `kind`: integer in `0..65535` and exactly the expected chain kind.
- `tags`: array of arrays containing only non-null strings.
- `content`: string.
- `sig`: exactly 128 lowercase hex characters.

The `created_at` restriction is a v0 interoperability rule that prevents integer-serialization disagreement between JavaScript and implementations with wider integer types. It does **not** make the timestamp a consensus clock.

### 7.3 ID and signature validation

The validator MUST:

1. serialize `[0,pubkey,created_at,kind,tags,content]` exactly as required by NIP-01;
2. SHA-256 that UTF-8 serialization;
3. require the result to equal `event.id`;
4. verify `event.sig` as a BIP340 signature of the 32-byte event ID under `event.pubkey`.

Chain-event tags and contents are constrained below to ASCII hexadecimal, decimal digits and fixed ASCII tag names, which removes arbitrary-text canonicalization from the consensus payload surface.

### 7.4 Event identity

Consensus identity is the event ID. If the same event ID is received with more than one valid BIP340 signature, it is still the same transaction or block. Local storage MAY retain the first valid representation.

---

## 8. Genesis event

The genesis event is a special `BLOCK_KIND` event.

### 8.1 Genesis tags

Tags MUST be exactly:

```text
[
  ["t", "nostr-blockchain:genesis"],
  ["nonce", "<NONCE>", "<DIFFICULTY>"]
]
```

No parent tag, transaction tags, or arbitrary tags are permitted.

### 8.2 Genesis content

Genesis `content` is the lowercase hexadecimal encoding of exactly 76 bytes:

```text
protocol_version       u8
block_reward           u128
reward_maturity        u32
pow_difficulty         u8   # CacheWalk leading-zero-bit difficulty
base_fee               u128
input_fee              u128
output_fee             u128
max_tx_inputs          u16
max_tx_outputs         u16
max_block_transactions u16
```

The content MUST decode exactly; trailing bytes are invalid.

### 8.3 Genesis PoW

Genesis uses the same CacheWalk R1 function as every later block.

For genesis only:

```text
G = E = the candidate genesis NIP-01 event ID
P = 32 zero bytes
```

The genesis event MUST satisfy:

```text
leading_zero_bits(E) >= NIP13_GATE_BITS
leading_zero_bits(CacheWalkR1(G, P, E)) >= pow_difficulty
```

The nonce tag third field commits to `NIP13_GATE_BITS`, not `pow_difficulty`.

### 8.4 Genesis monetary state

Genesis is height `0`, creates **no reward UTXO**, and the initial supply is zero.

The genesis signer's key has no special authority after genesis.

### 8.5 Conformance profile

The first conformance network uses these parameters:

```text
protocol_version       0
block_reward           5,000,000,000 base units
reward_maturity        10 blocks
pow_difficulty         8 CacheWalk leading-zero bits
base_fee               1,000 base units
input_fee              250 base units
output_fee             500 base units
max_tx_inputs          32
max_tx_outputs         32
max_block_transactions 64
```

A UI MAY display eight decimal places, making `5,000,000,000` appear as `50.00000000`; decimal placement is not consensus.

These parameters are for deterministic development/conformance, not a public monetary-policy recommendation.


### 8.6 Absolute v0 genesis bounds

To keep resource-validity and implementation limits aligned, every v0 genesis MUST also satisfy:

```text
block_reward > 0
reward_maturity >= 1
1 <= pow_difficulty <= 255  # CacheWalk result leading-zero bits
base_fee > 0
1 <= max_tx_inputs <= 64
1 <= max_tx_outputs <= 64
1 <= max_block_transactions <= 256
```

`input_fee` and `output_fee` may be zero, but `base_fee` is positive so every confirmed transaction destroys at least some native value.

A genesis outside these bounds is not a valid v0 chain even if its binary payload decodes.

---

## 9. Transaction event format

A transaction is a Nostr regular event with:

```text
kind = TX_KIND
```

Its transaction ID is exactly `event.id`.

The event signature authorizes **all inputs**.

### 9.1 Binary content

Transaction content is lowercase hex encoding of:

```text
version       u8
input_count   u16
inputs        Input[input_count]
output_count  u16
outputs       Output[output_count]
```

Input:

```text
source_id     hash32
output_index  u16
```

Output:

```text
owner_pubkey  pub32
amount        u128
```

Exact decoded length:

```text
5 + (34 * input_count) + (48 * output_count)
```

### 9.2 Count constraints

```text
1 <= input_count  <= max_tx_inputs
1 <= output_count <= max_tx_outputs
```

### 9.3 Input canonical order

Inputs MUST be strictly sorted ascending by:

```text
(source_id raw bytes, output_index numeric)
```

Duplicate outpoints are invalid.

### 9.4 Output order

Outputs are **not sorted**. Their serialized position defines the output index.

Every output amount MUST be in `1..MAX_U128`.

There is no additional consensus dust threshold in v0. Any positive `u128` output is valid if the transaction otherwise pays its required minimum burn.

Every `owner_pubkey` MUST pass BIP340 `lift_x` validity. v0 does not use malformed x-only keys as an alternative burn mechanism.

### 9.5 Transaction tags

Tags MUST exactly equal the deterministic index tags derived from content, in this order:

```text
1. chain scope tag
2. unique input source IDs as e-tags, sorted by raw 32-byte ID
3. unique output owner pubkeys as p-tags, sorted by raw 32-byte key
```

Example shape:

```text
[
  ["t", "nostr-blockchain:<CHAIN_ID>"],
  ["e", "<SOURCE_ID_A>"],
  ["e", "<SOURCE_ID_B>"],
  ["p", "<OWNER_A>"],
  ["p", "<OWNER_B>"]
]
```

Each source ID or owner appears at most once in tags even if used multiple times in content.

No additional tags are permitted.

### 9.6 Single-owner rule

Every input UTXO MUST be owned by `event.pubkey`.

Therefore v0 has:

```text
no per-input signature
no script
no sighash modes
no native multisig object
no transaction combining inputs from different owners
```

This is an intentional simplification.

---

## 10. UTXO model and balances

The active monetary state is a UTXO set.

An outpoint is:

```text
(source_id, output_index)
```

A UTXO contains:

```text
owner_pubkey   pub32
amount         u128
created_height u64 logically
is_reward      boolean
```

A user's confirmed balance is derived:

```text
balance(pubkey)
=
sum(amount of active UTXOs where owner_pubkey == pubkey)
```

There is no independent consensus account-balance table.

Wallets SHOULD distinguish:

```text
confirmed total
spendable at next candidate height
pending incoming
pending outgoing
```

Only the UTXO set is consensus state.

---

## 11. Transaction semantic validation

To evaluate transaction `tx` for candidate block height `H` against the **parent state**:

1. Parse and validate the NIP-01 event.
2. Require `kind == TX_KIND`.
3. Require exact chain scope and exact deterministic tags.
4. Decode the binary transaction exactly.
5. Require `version == 0`.
6. Enforce count, sorting, duplicate-input, positive-output and valid-owner-key rules.
7. Resolve every input from the parent UTXO view.
8. Require every input to exist.
9. Require every input owner to equal `tx.pubkey`.
10. For a reward UTXO created at height `R`, require:

```text
H - R >= reward_maturity
```

11. Sum input and output values with arbitrary-precision integers.
12. Require `sum_inputs >= sum_outputs`.
13. Compute fees as specified in Section 12.
14. Require `PRIORITY_FEE <= MAX_U128 - block_reward`, so every individually valid transaction can fit the implicit reward of an otherwise empty block.
15. Return the deterministic state transition; do not mutate state inside the validator.

A transaction spending a same-block output fails step 8 because same-block outputs are absent from the parent state.

---

## 12. Canonical fee separation

The fee model has two native components:

```text
MINIMUM BURN
    -> permanently destroyed

PRIORITY FEE
    -> block miner
```

Optional service fees for relays, archives, agents or applications are not Core consensus.

### 12.1 Actual fee

```text
ACTUAL_FEE(tx)
=
sum_inputs - sum_outputs
```

### 12.2 Minimum burn

For v0:

```text
MINIMUM_BURN(tx)
=
base_fee
+ input_fee  * input_count
+ output_fee * output_count
```

All arithmetic is exact `bigint` arithmetic.

### 12.3 Validity

```text
ACTUAL_FEE >= MINIMUM_BURN
```

otherwise the transaction is invalid.

### 12.4 Priority fee

```text
PRIORITY_FEE
=
ACTUAL_FEE - MINIMUM_BURN
```

No explicit `tip` field exists. A wallet offers a larger priority fee by reducing its outputs/change.

### 12.5 Supply effect

`MINIMUM_BURN` destroys supply.

`PRIORITY_FEE` transfers existing coins from transaction sender(s) to the miner and does not create or destroy supply.

---

## 13. Reward UTXO

Every valid non-genesis block implicitly creates exactly one reward UTXO:

```text
source_id    = block.id
output_index = 0xffff
owner        = block.pubkey
```

Its amount is:

```text
BLOCK_REWARD_AMOUNT
=
block_reward
+ sum(PRIORITY_FEE(tx) for every tx in block)
```

The sum MUST be computed with arbitrary precision and MUST be `<= MAX_U128`. A block whose implicit reward would overflow `u128` is invalid.

The entire implicit output, including collected priority fees, is subject to reward maturity.

There is no coinbase transaction.

The fixed `block_reward` is created by every valid non-genesis block forever in v0. There is no halving schedule and no supply cap.

### 13.1 Supply equation

For the active chain:

```text
TOTAL_SUPPLY
=
cumulative fixed block rewards
- cumulative minimum burns
```

Priority fees are omitted because they are transfers.

A powerful invariant is:

```text
sum(active UTXO amounts)
+ cumulative minimum burns
=
cumulative fixed block rewards
```

Genesis contributes zero reward.

---

## 14. Block event format

A normal block is a Nostr regular event with:

```text
kind    = BLOCK_KIND
content = "00"
```

The block ID is exactly `event.id`.

The block event `pubkey` is the miner identity and implicit reward owner.

### 14.1 Normal block tags

Tags MUST be exactly:

```text
1. chain scope tag
2. one parent e-tag
3. zero or more transaction e-tags sorted ascending by raw tx ID
4. one final nonce tag
```

Example:

```text
[
  ["t", "nostr-blockchain:<CHAIN_ID>"],
  ["e", "<PARENT_BLOCK_ID>"],
  ["e", "<TX_ID_1>"],
  ["e", "<TX_ID_2>"],
  ["nonce", "<NONCE>", "<DIFFICULTY>"]
]
```

The first `e` tag is always the parent. Remaining `e` tags are transaction IDs.

Transaction IDs MUST be unique and strictly ascending.

```text
0 <= transaction_count <= max_block_transactions
```

No arbitrary tags are permitted.

v0 has no Merkle root or separate block-body hash. The NIP-01 block event ID already commits to the ordered transaction-ID tags. Introducing a compact commitment is deferred until transaction-count scaling demonstrates a need.

### 14.2 Nonce canonical form

`NONCE` MUST be canonical unsigned decimal `u64`:

- ASCII digits only;
- value `0..2^64−1`;
- no leading zeros except the string `"0"`.

`DIFFICULTY` MUST be the canonical decimal encoding of the fixed protocol constant `NIP13_GATE_BITS`. It is the NIP-13 gate commitment and MUST NOT encode CacheWalk `pow_difficulty`.

---

## 15. Proof of work and credited work

v0 proof of work is **Nostr CacheWalk R1**.

The block remains a normal NIP-01 event. Its `id` remains the ordinary NIP-01 SHA-256 event ID, and its BIP340 signature signs that event ID. CacheWalk produces a separate derived 32-byte work hash that is never serialized into the block.

Mining remains:

```text
vary nonce tag
    ↓
recompute normal NIP-01 event ID E
    ↓
cheap NIP-13 gate
    ↓
CacheWalkR1(G, P, E)
    ↓
CacheWalk target test
```

### 15.1 Inputs and constants

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

All byte slicing is zero-based and half-open. `||` is byte concatenation. ASCII domain strings have no trailing NUL. `LE32(x)` encodes unsigned 32-bit little-endian. `U32LE(b)` decodes exactly four bytes as unsigned little-endian.

### 15.2 Cheap NIP-13 gate

Before CacheWalk:

```text
leading_zero_bits(E) >= NIP13_GATE_BITS
```

MUST hold.

The nonce tag third field MUST be canonical decimal `"6"` in v0.

This gate exists for Nostr compatibility and cheap early rejection only. It contributes no credited work and is not sufficient by itself as an expensive-validation DoS defense.

### 15.3 Full-context seed

```text
seed = SHA256(
    ASCII("NostrCacheWalk-R1/seed")
    || G
    || P
    || E
)
```

### 15.4 Scratchpad generation

Use RFC-8439 ChaCha20 with:

```text
key       = seed
nonce96   = 12 zero bytes
counter   = 0
plaintext = 262144 zero bytes
```

Then:

```text
scratch = ChaCha20(key, nonce96, counter, plaintext)
```

The result MUST be exactly 262144 bytes, interpreted as 4096 mutable 64-byte lines.

Only the RFC-8439 ChaCha20 primitive is reused from the NIP-44 implementation surface. NIP-44 ECDH, HKDF, HMAC, padding and message-format rules do not participate.

### 15.5 Initial state

```text
state = SHA256(
    ASCII("NostrCacheWalk-R1/state")
    || seed
    || P
    || E
)
```

### 15.6 Full-line dependent mutable-memory walk

Execute exactly:

```text
for pass in 0 .. 1:
    for i in 0 .. 4095:
        j = U32LE(state[0:4]) & 4095

        A = COPY(line[i])
        B = COPY(line[j])

        m0 = SHA256(
            ASCII("NostrCacheWalk-R1/round/0")
            || state
            || A
            || B
            || LE32(pass)
            || LE32(i)
        )

        m1 = SHA256(
            ASCII("NostrCacheWalk-R1/round/1")
            || m0
            || state
            || B
            || A
            || LE32(pass)
            || LE32(i)
        )

        line[i][0:32]  ^= m0
        line[i][32:64] ^= m1

        state = m0
```

`A` and `B` MUST be copied before mutation, including when `i == j`.

Every byte of each visited physical line is mutable. Optimized implementations are permitted only if byte-for-byte results remain identical.

### 15.7 Final work hash

```text
j_final = U32LE(state[4:8]) & 4095

cpu_work_hash = SHA256(
    ASCII("NostrCacheWalk-R1/final")
    || state
    || line[j_final]
    || seed
    || P
    || E
)
```

A block is PoW-valid iff:

```text
leading_zero_bits(cpu_work_hash) >= pow_difficulty
```

`pow_difficulty` is the fixed genesis consensus parameter.

`cpu_work_hash` MUST NOT be serialized into the block and MUST NOT replace `block.id`.

### 15.8 Credited work

Extra lucky zero bits in either `E` or `cpu_work_hash` earn no extra work.

Every valid non-genesis block contributes exactly:

```text
2^pow_difficulty
```

units of nominal credited work.

Because v0 difficulty is fixed, greatest cumulative credited work is equivalent to greatest validated height. The NIP-13 gate contributes zero work.

### 15.9 Signing order

The signature is generated after a winning nonce is found.

Workers never receive the miner private key.

When a worker reports a winner, the main process MUST independently recompute:

```text
NIP-01 event ID E
NIP-13 gate
CacheWalk R1
CacheWalk target
```

before signing `E`.

### 15.10 Nonce exhaustion

If the complete `u64` nonce space is exhausted for a candidate template, rebuild the candidate with another committed value, normally `created_at`, and restart nonce search.

### 15.11 Consensus freeze

CacheWalk R1 is active v0 consensus and is not runtime-selectable.

Changing any of the following creates a different protocol:

```text
scratchpad size
line size
pass count
domain strings
ChaCha20 parameters
walk equations
NIP-13 gate
CacheWalk target interpretation
```

Such a change requires an explicit later protocol revision.

### 15.12 Experimental status

CacheWalk R1 is intentionally experimental and is implemented directly.

The development order is:

```text
implement
generate deterministic vectors
start the experimental blockchain
measure real hardware behavior
attack the design
revise only in a later explicit protocol version if evidence requires it
```

v0 does not claim CPU-only execution or permanent GPU/FPGA/ASIC resistance. The experimental objective is to make commodity CPU mining the intended default path and observe whether the dependent mutable-memory work narrows specialization advantages.


## 16. Block state validation

A block is state-valid only after its parent and every referenced transaction event are available.

For candidate block height `H = parent.height + 1`:

1. Validate NIP-01 envelope and recompute the NIP-01 event ID.
2. Require `BLOCK_KIND`.
3. Validate exact content, tags, parent, tx ordering, nonce encoding and NIP-13 gate commitment.
4. Reject duplicate IDs and malformed/self-parent references.
5. Validate the BIP340 signature.
6. For non-genesis blocks, require the parent object to be known before spending the expensive CacheWalk verification budget. If missing, queue the dependency and fetch the parent.
7. Validate the cheap NIP-13 gate, then CacheWalk R1 PoW.
8. Require the parent to be state-valid and reject any detected parent cycle, except genesis.
9. Fetch/resolve every referenced transaction event by exact ID.
10. Require each referenced object to be a valid `TX_KIND` event for this chain.
11. Validate **every transaction independently against the parent's UTXO state**, not against mutations from earlier transactions in the block.
12. Require no input outpoint to appear in more than one block transaction.
13. Require the derived implicit reward amount to fit `u128`.
14. If all checks pass, apply the entire block transition atomically.

### 16.1 Parent-state-only execution

v0 deliberately forbids same-block child spends.

Consequences:

- transaction validation is order-independent;
- transactions can be validated in parallel after input resolution;
- no package relay is required;
- no CPFP dependency graph is required;
- block transaction IDs may be lexicographically sorted without affecting monetary semantics.

### 16.2 Missing data is not invalidity

A structurally/PoW-valid block whose transaction data is missing is:

```text
PENDING_TX_DATA
```

not `INVALID`.

It MUST NOT become active until all required objects are fetched and full state validation succeeds.

---

## 17. Block DAG and fork choice

Every known structurally valid block belongs to a block DAG keyed by its event ID and parent ID.

### 17.1 Validation states

Recommended persistent states:

```text
PARENT_MISSING
STRUCTURAL_VALID
TX_DATA_MISSING
STATE_VALID
INVALID
INVALID_ANCESTOR
```

`ACTIVE` is a separate flag/property, not a substitute for validation state.

### 17.2 Fork choice

Only fully `STATE_VALID` tips participate in fork choice.

The active branch changes only when another fully validated tip has **strictly greater cumulative work**.

Under fixed v0 difficulty this means strictly greater height.

### 17.3 Equal-work rule

If another branch has equal work to the current active branch:

```text
DO NOT REORG
```

Keep the current active branch until one branch receives a valid extension and has greater work.

This intentionally avoids treating lucky extra hash bits or block-ID lexical order as hidden work.

### 17.4 Fresh bootstrap tie

A fresh database may discover multiple equal-work maximum tips before it has an active branch.

For deterministic tooling only, the reference implementation MUST choose the lexicographically smallest 32-byte tip ID as its **initial local active selection** among equal-work state-valid tips.

This is not extra consensus work and MUST NOT cause a live node to reorg between equal-work branches.

`replay` tooling SHOULD also report the complete set of equal-work best tips so the tie is observable.

### 17.5 Invalid ancestor propagation

Once a block is proven `INVALID`, descendants MUST be marked `INVALID_ANCESTOR` without repeating full state execution.

---

## 18. Time semantics

In v0:

```text
created_at is authenticated data
but not consensus time
```

Except for the safe-integer envelope restriction, transaction/block validity MUST NOT depend on whether `created_at` is old, future, close to wall clock, monotonic, or close to the parent timestamp.

Do not use `created_at` for:

```text
fork choice
reward maturity
transaction validity
issuance
difficulty adjustment
block-height derivation
```

Height is derived solely as `parent.height + 1`.

This rule is why v0 can safely use fixed difficulty without introducing a trusted-clock problem.

---

## 19. Deterministic state transition

A pure transaction evaluator returns:

```text
TxEvaluation {
  consumedOutpoints
  createdOutputs
  sumInputs
  sumOutputs
  actualFee
  minimumBurn
  priorityFee
}
```

It does not modify storage.

A pure block evaluator returns:

```text
BlockEvaluation {
  txEvaluations
  consumedOutpoints
  createdTxOutputs
  rewardOutput
  totalMinimumBurn
  totalPriorityFee
}
```

### 19.1 Apply order

After the complete block has validated against the parent view:

1. remove all consumed parent UTXOs;
2. create every normal transaction output with `created_height = H` and `is_reward = false`;
3. create the implicit reward UTXO with `created_height = H` and `is_reward = true`;
4. update derived counters;
5. advance active tip.

The apparent order above is implementation order only. The validity result was already determined against the unchanged parent state.

---

## 20. Mempool policy

The mempool is non-consensus.

### 20.1 Admission

A transaction may enter the reference mempool if:

- its NIP-01 and transaction structure are valid;
- its inputs exist in the current active UTXO set;
- its author owns all inputs;
- any reward inputs are mature at `active_height + 1`;
- its actual fee meets the minimum burn;
- it does not depend on an unconfirmed output;
- it passes local size/resource limits.

### 20.2 Conflicting transactions

The reference mempool SHOULD retain multiple state-valid transactions that spend the same active outpoint, subject to local caps.

`mempool_inputs(source_id,index)` therefore MUST NOT have a uniqueness constraint across transaction IDs.

This deliberately avoids first-seen transaction pinning and allows a user to publish a replacement that pays a higher priority fee without introducing an RBF consensus protocol.

### 20.3 Candidate selection

Because v0's consensus block capacity is a simple maximum transaction count, the reference miner SHOULD:

1. sort mempool entries by `priorityFee` descending;
2. tie-break equal fees by ascending `SHA256(parent_block_id || txid)`;
3. walk the list greedily;
4. include a transaction if none of its inputs conflict with an already selected transaction;
5. stop at `max_block_transactions`.


The builder MUST also skip any transaction whose addition would make `block_reward + accumulatedPriorityFees` exceed `MAX_U128`.

This policy is simple, parent-dependent, and aligned with miner revenue. Other miners MAY use different selection policies.

A zero-priority transaction remains mineable when capacity exists because it still pays the mandatory burn.

### 20.4 Active-tip changes

On block connection or reorg, the mempool MUST be revalidated against the new active state.

- confirmed transactions are removed;
- transactions conflicting with confirmed spends are removed;
- disconnected transactions are reconsidered as ordinary new candidates;
- remaining entries are rechecked for ownership, maturity, fee and input existence.

---

## 21. Mining architecture

Mining is built into the reference full node.

For the **full-node profile**, continuous mining is **enabled by default as policy**. This is not a consensus rule: a user MAY disable mining without becoming a non-conforming validator.

"Always-on" means:

```text
when lifecycle == READY
and a signer is available
and mining has not been explicitly disabled
    -> continuously build and mine the active-tip candidate
```

Mining MUST pause outside `READY`, on consensus/storage failure, and when the configured signer is unavailable. Implementations SHOULD also pause or throttle under explicit host thermal/power policy. Mobile/light-client profiles do not mine by default because they are not full-node profiles.

Default mining MUST be visible, documented, trivially disableable, and run with a conservative resource budget. The reference implementation SHOULD begin with one mining worker unless the operator selects a larger worker count. Where practical, implementations SHOULD use low-priority scheduling and/or duty-cycle controls rather than silently consuming all host CPU.

The v0 prototype mines CacheWalk R1 exactly as defined in Section 15. The NIP-13 event-ID gate is only a cheap first stage; credited work comes from CacheWalk. The PoW algorithm MUST NOT be switchable by runtime configuration on a v0 chain.

### 21.1 Components

```text
CandidateBuilder
MiningCoordinator
WorkerThreadPool
BlockSigner
LocalBlockValidator
Publisher
```

### 21.2 Candidate

A candidate fixes:

```text
chain scope
parent block ID
sorted selected tx IDs
miner pubkey
created_at
content = "00"
CacheWalk target difficulty
```

Only the nonce changes inside worker loops. The nonce tag's third entry remains the fixed `NIP13_GATE_BITS` commitment; CacheWalk difficulty comes from genesis and is not miner-selectable.

### 21.3 Worker nonce partitioning

For `N` workers, worker `i` tests:

```text
i, i+N, i+2N, ...
```

Workers receive no private key.

### 21.4 Signing

Once a worker reports a winning nonce:

1. the main process recomputes the NIP-01 event ID;
2. the main process rechecks the NIP-13 gate and CacheWalk R1 target;
3. the configured signer signs the 32-byte NIP-01 event ID;
4. the complete event is passed through normal local block validation;
5. only then is it submitted to `ChainExecutor` and published to relays.

### 21.5 Stale work

Every active-tip transition increments `stateVersion` / `miningGeneration`.

Results from older generations MUST be ignored.

A mempool change does not have to interrupt current mining. The next candidate can pick up the new transactions.

### 21.6 Mining modes and default

```text
continuous   # default for full-node profile
disabled     # explicit operator opt-out
mine-one     # deterministic test/development control
```

`mine-one` is required for deterministic integration tests and demonstrations.

A full node MUST expose whether mining is enabled, its current worker count, active generation, measured work rate, and any pause reason.

---

## 22. Consensus error taxonomy

Implementations SHOULD expose stable machine-readable error codes. At minimum:

### Transaction

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
TX_PRIORITY_TOO_LARGE
```

### Block

```text
BLK_BAD_JSON
BLK_BAD_NIP01_ID
BLK_BAD_SIGNATURE
BLK_BAD_KIND
BLK_BAD_SCOPE
BLK_BAD_CONTENT
BLK_BAD_TAGS
BLK_BAD_PARENT
BLK_PARENT_CYCLE
BLK_BAD_NONCE
BLK_BAD_DIFFICULTY
BLK_INSUFFICIENT_POW
BLK_DUPLICATE_TX
BLK_PARENT_MISSING
BLK_TX_DATA_MISSING
BLK_TX_INVALID
BLK_DOUBLE_SPEND
BLK_SAME_BLOCK_SPEND
BLK_REWARD_OVERFLOW
BLK_INVALID_ANCESTOR
```

Missing dependencies are pending states, not permanent invalidity codes.

Policy rejection codes SHOULD be prefixed separately, for example `POLICY_...`.

---

# Reference-node architecture

## 23. Implementation language and runtime

The first reference node SHOULD use:

```text
Node.js 24 LTS
TypeScript
better-sqlite3
WebSocket client/server library
@noble/curves BIP340 Schnorr provider behind an adapter
```

Node.js 24 is an LTS line as of this architecture freeze; production Node applications are advised by the Node project to use supported LTS releases.

`@noble/curves` is appropriate for a fast TypeScript prototype and supports BIP340 Schnorr. The cryptographic API MUST remain behind a small `CryptoProvider` interface so an independent implementation or native `libsecp256k1` backend can cross-check consensus behavior.

The implementation MUST pin dependency versions in its lockfile and CI image. Upgrades to cryptographic libraries, SQLite bindings, or Node major versions require the conformance suite to pass before merge.

---

## 24. One process, one logical state writer

The first node SHOULD be one OS process, not microservices.

```text
main process
├─ configuration / lifecycle
├─ strict Nostr codec
├─ relay manager
├─ event store
├─ block DAG
├─ consensus codecs/validators
├─ state views / overlays
├─ ChainExecutor              <-- only active-state writer
├─ mempool
├─ optional embedded relay
├─ optional miner
└─ CLI
```

The central invariant is:

> **Only `ChainExecutor` may mutate active monetary state.**

Network callbacks, miners, parsers, validators, sync workers and mempool code MUST NOT directly write the active UTXO set or active-chain tables.

---

## 25. Source layout

Recommended layout:

```text
src/
  consensus/
    constants.ts
    primitives.ts
    nip01.ts
    genesis.ts
    transaction-codec.ts
    transaction-validation.ts
    block-codec.ts
    block-validation.ts
    pow.ts
    fees.ts
    errors.ts

  crypto/
    provider.ts
    noble-provider.ts

  state/
    utxo-view.ts
    overlay.ts
    digest.ts

  chain/
    block-index.ts
    fork-choice.ts
    chain-executor.ts
    reorg.ts

  storage/
    database.ts
    schema.ts
    repositories.ts

  mempool/
    mempool.ts
    selection.ts

  nostr/
    strict-json.ts
    relay-manager.ts
    subscriptions.ts
    fetch-queue.ts
    embedded-relay.ts

  mining/
    candidate-builder.ts
    coordinator.ts
    worker.ts
    signer.ts

  node/
    config.ts
    lifecycle.ts
    runtime.ts

  cli/
    main.ts

  tests/
```

`consensus/` MUST NOT import networking, SQLite, mining or CLI modules.

---

## 26. Core interfaces

The implementation should make consensus functions pure and explicit.

Conceptual TypeScript interfaces:

```text
parseTransaction(event, context) -> ParsedTransaction | ConsensusError
validateTransaction(parsedTx, inputCoins, candidateHeight, params)
    -> TxEvaluation | ConsensusError

parseBlock(event, context) -> ParsedBlock | ConsensusError
validateBlockStructure(parsedBlock, params)
    -> StructuredBlock | ConsensusError

validateBlockTransactions(
    block,
    txs,
    parentView,
    candidateHeight,
    params
) -> BlockEvaluation | ConsensusError
```

The pure validator MUST NOT retrieve its own UTXOs from SQLite. The caller resolves dependencies and supplies a read-only view.

### 26.1 Crypto provider

```text
interface CryptoProvider {
  isValidXOnlyPublicKey(pubkey32): boolean
  verifySchnorr(pubkey32, message32, signature64): boolean
  signSchnorr?(secret32, message32): signature64
}
```

Consensus uses verification only. Signing exists only for genesis tooling and mining.

---

## 27. SQLite strategy

Use one database file:

```text
nostr-blockchain.sqlite
```

Required pragmas on the writer connection:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

The program MUST verify that `journal_mode` actually became `wal`.

SQLite documents `synchronous=FULL` in WAL mode as ACID and performs an additional WAL sync after each transaction commit, which is appropriate for chainstate durability.

Keep the default automatic WAL checkpoint initially. Operational metrics MUST expose WAL size; if sustained readers cause checkpoint starvation, checkpoint policy may be tuned without changing consensus.

---

## 28. Persistent schema

The following is the recommended v0 logical schema. Migrations may adjust SQL details but MUST preserve these semantics.

```sql
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value BLOB NOT NULL
) STRICT;

CREATE TABLE events (
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

CREATE TABLE transactions (
  tx_id         BLOB PRIMARY KEY REFERENCES events(id),
  author        BLOB NOT NULL CHECK(length(author)=32),
  input_count   INTEGER NOT NULL,
  output_count  INTEGER NOT NULL
) STRICT;

CREATE TABLE tx_inputs (
  tx_id         BLOB NOT NULL REFERENCES transactions(tx_id),
  input_pos     INTEGER NOT NULL,
  source_id     BLOB NOT NULL CHECK(length(source_id)=32),
  source_index  INTEGER NOT NULL CHECK(source_index BETWEEN 0 AND 65535),
  PRIMARY KEY(tx_id, input_pos),
  UNIQUE(tx_id, source_id, source_index)
) STRICT;
CREATE INDEX tx_inputs_outpoint ON tx_inputs(source_id, source_index);

CREATE TABLE tx_outputs (
  tx_id         BLOB NOT NULL REFERENCES transactions(tx_id),
  output_index  INTEGER NOT NULL CHECK(output_index BETWEEN 0 AND 65534),
  owner         BLOB NOT NULL CHECK(length(owner)=32),
  amount_be16   BLOB NOT NULL CHECK(length(amount_be16)=16),
  PRIMARY KEY(tx_id, output_index)
) STRICT;
CREATE INDEX tx_outputs_owner ON tx_outputs(owner);

CREATE TABLE blocks (
  block_id          BLOB PRIMARY KEY REFERENCES events(id),
  parent_id         BLOB CHECK(parent_id IS NULL OR length(parent_id)=32),
  miner_pubkey      BLOB NOT NULL CHECK(length(miner_pubkey)=32),
  height            INTEGER,
  nonce_be8         BLOB NOT NULL CHECK(length(nonce_be8)=8),
  difficulty        INTEGER NOT NULL,
  validation_state  TEXT NOT NULL,
  invalid_code      TEXT,
  active            INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1))
) STRICT;
CREATE INDEX blocks_parent ON blocks(parent_id);
CREATE INDEX blocks_height ON blocks(height);

CREATE TABLE block_transactions (
  block_id      BLOB NOT NULL REFERENCES blocks(block_id),
  tx_pos        INTEGER NOT NULL,
  tx_id         BLOB NOT NULL CHECK(length(tx_id)=32),
  PRIMARY KEY(block_id, tx_pos),
  UNIQUE(block_id, tx_id)
) STRICT;
CREATE INDEX block_transactions_tx ON block_transactions(tx_id);

-- tx_id intentionally has no foreign key to transactions(tx_id):
-- a valid block reference must be storable before the referenced TX event arrives.

CREATE TABLE active_chain (
  height        INTEGER PRIMARY KEY,
  block_id      BLOB NOT NULL UNIQUE REFERENCES blocks(block_id)
) STRICT;

CREATE TABLE utxos (
  source_id       BLOB NOT NULL CHECK(length(source_id)=32),
  source_index    INTEGER NOT NULL CHECK(source_index BETWEEN 0 AND 65535),
  owner           BLOB NOT NULL CHECK(length(owner)=32),
  amount_be16     BLOB NOT NULL CHECK(length(amount_be16)=16),
  created_height  INTEGER NOT NULL CHECK(created_height>=0),
  is_reward       INTEGER NOT NULL CHECK(is_reward IN (0,1)),
  PRIMARY KEY(source_id, source_index)
) STRICT;
CREATE INDEX utxos_owner ON utxos(owner);

CREATE TABLE undo_spent (
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

CREATE TABLE undo_created (
  block_id       BLOB NOT NULL REFERENCES blocks(block_id),
  source_id      BLOB NOT NULL CHECK(length(source_id)=32),
  source_index   INTEGER NOT NULL,
  PRIMARY KEY(block_id, source_id, source_index)
) STRICT;

CREATE TABLE mempool (
  tx_id             BLOB PRIMARY KEY REFERENCES transactions(tx_id),
  actual_fee_be17   BLOB NOT NULL CHECK(length(actual_fee_be17)=17),
  min_burn_be17     BLOB NOT NULL CHECK(length(min_burn_be17)=17),
  priority_fee_be17 BLOB NOT NULL CHECK(length(priority_fee_be17)=17),
  received_seq      INTEGER NOT NULL
) STRICT;

CREATE TABLE mempool_inputs (
  tx_id         BLOB NOT NULL REFERENCES mempool(tx_id),
  source_id     BLOB NOT NULL CHECK(length(source_id)=32),
  source_index  INTEGER NOT NULL,
  PRIMARY KEY(tx_id, source_id, source_index)
) STRICT;
CREATE INDEX mempool_inputs_outpoint ON mempool_inputs(source_id, source_index);

CREATE TABLE missing_objects (
  object_id       BLOB PRIMARY KEY CHECK(length(object_id)=32),
  object_type     TEXT NOT NULL,
  first_seen_seq  INTEGER NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_retry_ms   INTEGER
) STRICT;

CREATE TABLE relay_state (
  url               TEXT PRIMARY KEY,
  relay_class       TEXT NOT NULL,
  last_connected_ms INTEGER,
  last_error         TEXT
) STRICT;
```

### 28.1 Required metadata keys

At minimum `meta` SHOULD contain canonical values for:

```text
schema_version
chain_id
protocol_version
active_tip
active_height
cumulative_fixed_rewards
cumulative_minimum_burns
cumulative_priority_fees
next_received_seq
```

`chain_id` is immutable after database initialization. Cached active/counter values are verified against/rebuilt from derived state during `verify` or `reindex`.

Recommended `events.object_state` values are:

```text
NIP01_VALID
STRUCTURAL_VALID
INVALID
```

A block's more detailed dependency/state lifecycle belongs in `blocks.validation_state`.

### 28.2 Database-only integer encodings

Coin amounts remain 16-byte big-endian `u128`.

Transaction fee totals can exceed `u128` because up to 32 inputs are summed, so the database uses fixed 17-byte unsigned big-endian fee encodings. This is a storage representation only; consensus uses arbitrary precision.

### 28.3 Derived counters

Supply, cumulative burn, cumulative priority fees, active height and tip MAY be cached in `meta`, but they are derived and MUST be reconstructible from active history.

---

## 29. Event persistence policy

The prototype is an archival **Core-history** validator but not a general Nostr archive.

Persist indefinitely:

```text
genesis block event
all known block events that pass envelope/structure/PoW admission
all transaction events referenced by persisted blocks
all currently admitted mempool transaction events
```

A valid signed transaction that is neither mempool-admissible nor referenced by a known block does not need permanent storage.


If an exact block dependency is a NIP-01-authenticated event but its chain-object structure is invalid, the event SHOULD be retained with `object_state=INVALID` and the block can then be permanently classified invalid. An unauthenticated/invalid-signature representation is not definitive because another relay may later provide a valid signature for the same NIP-01 event ID; such failures may be negative-cached only as policy.

This prevents the node from becoming a free archive for arbitrary valid-but-useless transaction spam.

Nostr deletion or vanish requests MUST NOT alter confirmed blockchain history.

---

## 30. ChainExecutor

`ChainExecutor` serializes:

```text
connectBlock
considerCandidateTip
activateBranch
disconnectTip
revalidateMempool
```

There is one logical active-state writer.

### 30.1 Connect block transaction

Inside one SQLite write transaction:

1. verify expected active parent/state version;
2. insert `undo_spent` rows for every consumed UTXO;
3. delete consumed UTXOs;
4. insert all normal transaction outputs and `undo_created` rows;
5. insert implicit reward UTXO and `undo_created` row;
6. update block active flag and `active_chain`;
7. update derived counters/tip metadata;
8. update mempool according to the connected block;
9. commit.

Any error rolls back the entire transition.

### 30.2 Disconnect tip

Inside one SQLite write transaction:

1. require the requested block to be the active tip;
2. delete every outpoint listed in `undo_created`;
3. restore every UTXO in `undo_spent`;
4. reverse active-chain metadata and derived counters;
5. clear/delete that block's active undo records if desired after successful reversal;
6. commit.

Blocks are always disconnected tip-first.

---

## 31. Side-branch validation with StateOverlay

The node MUST NOT keep a full UTXO database per fork.

To validate candidate branch `A-B-X-Y-Z` when active chain is `A-B-C-D`:

```text
active UTXO view at D
    ↓ overlay undo D
    ↓ overlay undo C
state at B
    ↓ apply X
    ↓ apply Y
    ↓ apply Z
candidate state
```

The overlay is in-memory and read-through to the active UTXO database.

It MUST NOT mutate SQLite active state.

If `Z` becomes strictly better and is fully state-valid, `ChainExecutor` performs the real disconnect/connect sequence in one serialized reorg operation.

Prototype v0 retains enough active undo data to reach genesis; pruning deep undo is deferred.

---

## 32. Atomic reorg procedure

For a winning state-valid candidate:

1. acquire ChainExecutor write serialization;
2. recheck active tip/state version;
3. find common ancestor;
4. begin one SQLite transaction;
5. disconnect active blocks down to the ancestor;
6. connect winning branch blocks forward;
7. update active flags and `active_chain`;
8. revalidate/rebuild mempool;
9. commit;
10. increment `stateVersion` and mining generation.

For v0's small prototype limits, one database transaction for the complete reorg is preferred over partially committed reorg steps.

If any assertion fails, roll back and leave the old active chain intact.

---

## 33. Nostr Relay Manager

All **external blockchain communication** uses Nostr relay protocol messages over WebSocket.

No custom blockchain P2P socket protocol is permitted in v0.

Use one WebSocket connection per configured relay and multiplex NIP-01 subscriptions over it.

Relay classes are local configuration:

```text
FULL_CHAIN
GOSSIP
LOCAL_EMBEDDED
```

Relay URLs and classifications are not consensus.

Nodes MUST assume duplicate, delayed, reordered and omitted delivery.

Relay subscriptions and historical queries MUST be processed with bounded queues/backpressure. A node MUST NOT accumulate an entire multi-year relay response in an unbounded in-memory array before validation/storage.

Every received chain object is independently validated.

### 33.1 Publication

A locally admitted transaction SHOULD be published to every configured writable `GOSSIP` and `FULL_CHAIN` relay. Failure or rejection by one relay does not change transaction validity.

A newly mined locally state-valid block SHOULD be published to every configured writable chain relay after local validation/activation. Relay `OK` acknowledgements are transport observations, not confirmations.

For resilience, wallet and node tools SHOULD normally publish important objects to more than one independently operated relay when available.

---

## 34. Basic synchronization protocol

The first working prototype MUST implement **block-first synchronization** without requiring NIP-77.

### 34.1 Block discovery

For the selected chain scope, request:

```text
kinds = [BLOCK_KIND]
#t    = [chain scope]
```

Do not use `since`/`until` as a consensus-history partition because `created_at` has no consensus ordering meaning.

A configured `FULL_CHAIN` relay contract means that EOSE represents completion of the block events it retains for this chain. Generic public-relay EOSE MUST NOT be interpreted as proof that global history is complete.

### 34.2 Build DAG first

As block events arrive:

- validate envelope/structure/PoW;
- deduplicate by ID;
- store parent links;
- queue unknown parents;
- build the DAG before trying to synchronize every historical transaction gossip event.

### 34.3 Exact transaction retrieval

Extract transaction IDs from relevant block branches and request missing transactions by exact NIP-01 `ids` filters, in bounded batches.

Do not synchronize historical unconfirmed transaction gossip; it has no consensus value.

### 34.4 Activation

A high-work branch with missing transaction data remains pending. It becomes eligible for fork choice only after complete state validation.

### 34.5 NIP-77

NIP-77 is a useful future optimization for reconciling block/event ID sets, but it is draft/optional and is **not** a blocker for the first prototype. Even when used, NIP-77 discovers missing IDs; actual events still transfer through normal `EVENT` / `REQ` flows.

---

## 35. Live subscriptions

After initial sync, maintain subscriptions for:

```text
BLOCK_KIND + chain #t
TX_KIND    + chain #t
```

Block events route to the DAG/dependency queue.

Transaction events route through the event firewall and then either:

- satisfy a missing block dependency;
- enter the mempool if state/policy-valid;
- or are discarded after validation if neither is useful.

Event arrival order never defines blockchain order.

---

## 36. Missing-object fetch queue

Track missing parent/transaction IDs with:

```text
object_id
object_type
first_seen_seq
attempts
next_retry
relays_tried
```

Fetch an exact ID from multiple configured relays with bounded concurrency and exponential backoff.

A response MUST be validated against the requested ID, kind and chain scope.

A relay's failure to return an object is an availability failure, not a consensus vote.

---

## 37. Embedded full-chain relay

For the three-node prototype, a node MAY expose a restricted archival Nostr relay backed by its event store.

Minimum messages:

Client to relay:

```text
EVENT
REQ
CLOSE
```

Relay to client:

```text
EVENT
EOSE
OK
CLOSED
```

`NOTICE` is optional.

Supported filters need only include:

```text
ids
kinds
#t
limit
```

Unsupported expensive filter forms SHOULD be closed with an `unsupported:` reason.

### 37.1 Relay write policy

For `BLOCK_KIND`, accept for archival storage after:

```text
strict JSON
NIP-01 ID/signature
kind/scope
exact block structure
valid target commitment
valid PoW
```

Parent/transaction availability is not required merely to archive the block.

For `TX_KIND`, persist if at least one is true:

```text
currently mempool-admissible
referenced by a stored structurally valid block
currently requested as a missing historical dependency
```

The embedded relay MUST serve historical confirmed chain events regardless of their `created_at` age.

---

## 38. Event firewall

Network processing SHOULD reject cheaply before expensive work:

```text
1. WebSocket frame byte cap
2. strict JSON syntax + duplicate-key rejection
3. message shape
4. kind/scope prefilter
5. duplicate event ID lookup
6. NIP-01 ID recomputation
7. chain structural parse
8. block PoW check when applicable
9. BIP340 signature verification
10. semantic routing/state validation
```

Diagnostic conformance tests may intentionally exercise a different validation order to assert specific error precedence, but a network firewall MUST never accept an event that consensus rejects.

---

## 39. Resource-policy defaults

Initial local defaults, changeable without forking:

```text
max relay connections             16
max websocket frame               64 KiB
max JSON nesting                  16
max mempool transactions          10,000
max stored unresolved orphans      2,000
max missing-object queue          10,000
max concurrent exact fetches          64
max exact IDs per REQ batch          256
mining workers                    CPU-count policy
```

When a cap is reached, eviction is policy; eviction MUST NOT reclassify a structurally valid block as consensus-invalid.

Orphans and missing confirmed dependencies are separate from the mempool.

---

## 40. Lifecycle

Node states:

```text
STARTING
RECOVERING
SYNCING
READY
DEGRADED
SHUTTING_DOWN
```

Mining is permitted only in `READY`. For the full-node profile it starts automatically on entry to `READY` unless explicitly disabled.

Recommended startup order:

```text
1. load config
2. load/validate selected genesis
3. open DB and run schema migration
4. verify stored genesis binding
5. recover active tip/state metadata
6. start relay manager
7. block-first synchronization
8. exact missing transaction retrieval
9. state-validate candidate branches
10. activate greatest-work branch
11. start live subscriptions
12. start embedded relay if configured
13. enter READY
14. automatically start continuous mining when mining is enabled (the full-node default)
```

If all external relays disappear, node enters `DEGRADED`; mining SHOULD pause by default to reduce isolated-fork mining.

### 40.1 Failure policy

| Failure | Required behavior |
|---|---|
| SQLite write/commit failure | Stop ChainExecutor mutation and mining; enter `DEGRADED` or terminate. |
| State invariant failure | Stop ChainExecutor; require `verify`/`reindex`. |
| Miner signer unavailable | Pause mining; validation/networking may continue. |
| One relay unavailable | Continue with others; retry with backoff. |
| All external relays unavailable | Enter `DEGRADED`; pause mining by default. |
| Higher-work branch missing TX data | Keep current active state; continue exact-ID fetching. |
| Embedded relay failure | Validation may continue if external relay connectivity remains. |
| Mining worker crash | Replace/disable worker; never affect consensus state. |

---

## 41. Crash recovery

SQLite atomic commit is the state boundary.

After process or machine failure, startup MUST verify:

```text
genesis ID
active tip exists
active_chain is contiguous
active flags agree with active_chain
UTXO metadata/counters are internally plausible
```

No application-level "finish half a block" recovery journal should be invented outside SQLite.

If invariant checks fail, stop active-state mutation and require `verify` or `reindex`.

---

## 42. Reindex and deterministic replay

### 42.1 `reindex`

`reindex` MUST preserve authenticated Core history (`events`, parsed blocks/transactions) but discard and rebuild derived tables:

```text
active_chain
utxos
undo_*
mempool-derived state
cached counters
```

It replays from genesis according to the current v0 consensus implementation.

### 42.2 Offline replay

Provide:

```text
nostr-chain-node replay <events.ndjson>
```

with network and mining disabled.

Output at minimum:

```text
chain ID
active tip
height
best-tip set
UTXO digest
UTXO count
cumulative fixed rewards
cumulative minimum burns
cumulative priority fees
derived total supply
invalid event IDs + codes
pending dependency IDs
```

This command is essential for differential testing with future independent implementations.


The NDJSON input order MUST NOT define chain order. Replaying the same event set in different line orders MUST produce the same state whenever there is a unique greatest-work state-valid tip. If maximum work is tied, the reported best-tip set MUST be identical and the fresh-bootstrap lexical tie policy determines only the local selected tip.

---

## 43. Diagnostic UTXO digest

For testing and replay diagnostics only, serialize each active UTXO record as:

```text
source_id       32 bytes
output_index     2 bytes big-endian
owner_pubkey    32 bytes
amount          16 bytes big-endian
created_height   8 bytes big-endian
flags            1 byte
```

`flags bit 0 = is_reward`; all other bits are zero in v0.

Record size is 91 bytes.

Sort records ascending by `(source_id raw bytes, output_index)` and compute:

```text
SHA256(concatenation of all records)
```

The empty set digest is SHA-256 of the empty byte string.

This digest is **not consensus**. It is a cross-implementation diagnostic checkpoint.

---

## 44. CLI surface

The prototype SHOULD avoid a remotely exposed general-purpose RPC server.

Provide local administration through:

```text
nostr-chain-node status
nostr-chain-node balance <pubkey|npub>
nostr-chain-node utxos <pubkey|npub>
nostr-chain-node block <id>
nostr-chain-node tx <id>
nostr-chain-node mempool
nostr-chain-node mine-one
nostr-chain-node verify
nostr-chain-node reindex
nostr-chain-node replay <file>
```

A loopback RPC can be proposed later if a concrete integration needs it.

### 44.1 Developer wallet utility

The working prototype also REQUIRES a separate development utility or test wallet that is **not part of node chainstate**.

Minimum capabilities:

```text
genesis-create -> mine/sign a v0 genesis event from explicit parameters
key -> derive/display BIP340 pubkey/npub
inspect -> obtain spendable UTXOs from local node CLI/export
build-tx -> deterministic v0 binary transaction payload/tags
sign-tx -> produce NIP-01 TX event with a development secret key
publish -> send EVENT to one or more Nostr relays
```

This tool exists so the three-node demonstration can construct real payments while preserving the rule that the full node stores no ordinary wallet private keys.

The transaction codec used by this utility MUST be the same tested codec contract used by browser/wallet implementations; it MUST NOT have a separate informal serialization.

---

## 45. Configuration

Runtime configuration MAY contain:

```text
data directory
selected genesis file
relay URLs and relay class
embedded relay bind address
mining enabled (default `true` for full-node profile)
mining mode (default `continuous`)
mining worker count (reference default: one worker)
signer backend
local resource caps
log level
```

Consensus parameters MUST NOT be independently overridable after genesis selection.

For example, a config file MUST NOT be able to change:

```text
block reward
maturity
difficulty
fee constants
transaction limits
block transaction limit
```

Those values come from the genesis event.

Miner secret keys SHOULD NOT be stored in the node database. Use a signer abstraction and preferably an environment, OS key store, hardware signer, or dedicated development key file outside chainstate.

---

## 46. Security model

### 46.1 Untrusted Nostr input

All relay data is attacker-controlled until independently validated.

Trust zones:

```text
UNTRUSTED BYTES
    ↓
AUTHENTICATED NIP-01 EVENT
    ↓
STRUCTURALLY VALID CHAIN OBJECT
    ↓
STATE-VALID OBJECT
    ↓
ACTIVE CONSENSUS STATE
```

Do not collapse these zones.

### 46.2 Relay omission/equivocation

Relays have no consensus authority. Fetch from multiple relays and verify event IDs/signatures locally.

### 46.3 Missing-data high-work attack

A PoW-valid branch that withholds referenced transactions cannot become active. Work without executable data is pending, not winning consensus state.

### 46.4 JSON/parser divergence

Strict JSON decoding, safe `created_at`, exact binary payloads and exact tag sets are consensus-hardening measures. Fuzz them.

### 46.5 Arithmetic

Never convert consensus amounts/fees to floating point. Every add/subtract/multiply is bounds-checked where the resulting field has a fixed width.

### 46.6 Database corruption

`verify` SHOULD run `PRAGMA integrity_check` and replay state invariants. `reindex` is the recovery path for derived-state corruption.

### 46.7 Signer compromise

Compromise of a miner signer can steal that miner's rewards and impersonate that mining identity, but it does not by itself grant authority to rewrite consensus without sufficient PoW.

### 46.8 Sybil relays

Multiple relay identities are not multiple votes. Consensus never counts relays.

### 46.9 Equal-work eclipse

A network partition may leave honest nodes on equal-work branches. v0 intentionally tolerates temporary divergence until one branch gains strictly greater work.

---

## 47. Testing requirements

No implementation phase is complete without automated tests.

### 47.1 NIP-01 / BIP340

CI MUST include:

- NIP-01 event-ID serialization fixtures;
- official BIP340 test vectors;
- malformed x-only public keys;
- malformed signatures;
- strict-JSON duplicate-key cases.

### 47.2 Consensus corpus

Phase 0 MUST generate and freeze a **neutral v0 conformance corpus** from this specification.

The previously generated experimental corpus is superseded because it used a retired chain-scope string and predates canonical fee separation.

The new corpus MUST include at least:

```text
valid genesis
valid empty blocks through reward maturity
valid exact-maturity reward spend
valid zero-priority transaction
valid positive-priority transaction
miner reward containing priority fee
supply invariant showing priority fee does not change supply
wrong-owner input
immature reward spend
bad content hex
bad tags
duplicate input
zero output
invalid x-only output key
fee too low
same-block child spend
block double spend
insufficient PoW
bad nonce canonicalization
bad target commitment
reward overflow synthetic vector
missing-transaction pending block
equal-work competing branches
strictly longer reorg branch
```

Fixture secret keys MUST be publicly labeled test-only keys.

### 47.3 Property tests

At every active height:

```text
sum(UTXO amounts) + cumulativeMinimumBurn
== cumulativeFixedRewards
```

Also property-test:

```text
all active outpoints unique
all UTXO amounts > 0
all owners valid x-only keys
active_chain contiguous
reward maturity boundary exact
parent-state-only block execution
connect then disconnect restores identical digest
reorg then reverse reorg restores identical digest
```

### 47.4 Fuzzing

Fuzz:

```text
strict JSON frame parser
NIP-01 event parser
hex decoder
genesis decoder
transaction binary decoder
block tags
nonce parser
x-only keys
fee arithmetic
state transitions
```

### 47.5 Network simulation

Simulate:

```text
duplicates
reordering
delays
dropped events
block before transaction
transaction before block
unknown parent
relay disconnect/reconnect
multiple relays disagreeing by omission
competing forks
```

Also test full-node mining policy:

```text
READY starts continuous mining by default
explicit disabled mode never starts workers
SYNCING / DEGRADED / SHUTTING_DOWN stop or pause workers
active-tip change invalidates stale mining generations
worker restart does not expose signer private key
```

### 47.6 Crash tests

Kill the process during:

```text
block connection
reorg
mempool update
event persistence
startup recovery
```

After restart, state MUST correspond to either the pre-transaction or post-transaction committed state, never a partial state.

---

## 48. Development plan with gates

### Phase 0 — Protocol freeze and corpus

Deliver:

```text
this specification
binary codecs
neutral genesis generator
neutral deterministic conformance corpus
development wallet/event utility
BIP340/NIP-01 fixtures
```

Gate: two independent codec paths or one implementation plus hand/fixture checks agree on every event ID and binary decode.

### Phase 1 — Pure consensus, in memory

Deliver:

```text
NIP-01 validator
transaction parser/validator
block parser/validator
fee split
UTXO view
reward/maturity
fork-choice model
```

Gate: full conformance corpus and property tests pass without SQLite or networking.

### Phase 2 — DAG, overlay and reorg

Deliver:

```text
block DAG
StateOverlay
ChainExecutor in-memory model
mempool conflicts
reorg logic
```

Gate: deterministic fork/reorg simulation passes.

### Phase 3 — SQLite persistence

Deliver:

```text
schema
atomic connect/disconnect/reorg
restart recovery
verify
reindex
replay
```

Gate: crash-injection suite passes.

### Phase 4 — Basic Nostr networking

Deliver:

```text
strict relay framing
RelayManager
block-first sync
exact-ID dependency fetch
live subscriptions
```

Gate: two nodes starting from different local histories converge when a unique greatest-work state-valid tip exists.

### Phase 5 — Miner

Deliver:

```text
candidate builder
worker_threads miner
signer abstraction
mine-one
continuous mining enabled by default for full-node profile
lifecycle pause/resume
priority-fee selection
```

Gate: mined blocks pass the same normal receive/validation path; workers never receive private key material; a newly started READY full node mines continuously without requiring an explicit `--mine` flag.

### Phase 6 — Embedded chain relay and three-node demo

Deliver:

```text
restricted NIP-01 relay
development wallet publishes signed TX via Nostr
archival confirmed Core history
three independent node processes
partition/reconnect test
```

Gate: Section 49 acceptance demo passes.

### Phase 7 — Hardening, not new consensus

Deliver:

```text
resource-policy tuning
metrics
structured logs
fuzzing expansion
NIP-77 experiment
performance profiling
CacheWalk R1 benchmark harness (strictly non-consensus)
```

CacheWalk benchmarking begins only after the Phase 6 prototype acceptance gate unless it is developed in parallel by a separate research track. No optional NBP, including CacheWalk, should block declaring the v0 prototype successful.

---

## 49. Prototype acceptance demo

Run three full-node processes:

```text
Node A: full node + chain relay
Node B: full node + chain relay
Node C: full node
```

All three MUST report continuous mining enabled automatically after entering `READY`. The test harness MAY temporarily switch individual nodes to `mine-one` or `disabled` mode when deterministic fork construction is required; that is an explicit test override of the normal default.

Demonstrate, with only Nostr external blockchain communication:

1. All READY full nodes begin mining without an explicit mining-enable command, and at least one mines a reward.
2. The other nodes obtain/validate the block through Nostr.
3. Reward maturity is reached.
4. A reward is spent to another pubkey with the exact minimum burn and zero priority fee.
5. A second spend uses a positive priority fee; the next miner reward increases by exactly that priority fee while supply changes only by fixed reward minus minimum burn.
6. All nodes report identical active tip, UTXO digest, balances, cumulative burn and supply.
7. Two conflicting mempool spends coexist locally; miner selection follows priority policy without changing consensus validity.
8. A same-block child-spend candidate is rejected.
9. Partition the nodes and mine competing equal-work forks; neither live side reorgs merely because the other tip ID is lexically smaller.
10. Extend one branch to strictly greater work.
11. Reconnect; all nodes fetch any missing transaction data, fully validate, and reorg to the greater-work branch.
12. Restart every node; state remains identical.
13. Delete derived chainstate on one node and `reindex`; it returns to the same unique active state and UTXO digest.

Passing this demo is the definition of a working v0 prototype.

---

## 50. Observability

Structured logs SHOULD include:

```text
event_id
block_id
tx_id
relay_url
validation_stage
error_code
active_height
state_version
reorg_depth
missing_object_count
```

Metrics SHOULD include:

```text
active height
known DAG blocks
state-valid tips
UTXO count
mempool size
mempool conflicts
minimum burn total
priority fee total
missing-object queue
relay connection state
block validation latency
reorg count/depth
mining enabled/mode
mining worker count
mining hash rate
mining pause reason
WAL size
DB size
```

Metrics are diagnostics and MUST NOT affect consensus.

---

# Deferred NBP roadmap

## 51. NBP governance principle

The prototype should establish an NBP process modeled on Nostr's strongest extension principle:

> If a feature is not required for every honest validator to agree on the active native monetary state, it should normally remain optional.

Classify proposals as:

```text
APPLICATION
NETWORK
POLICY
CONSENSUS
```

A Consensus NBP may be optional before activation but cannot remain optional for nodes following that chain after activation.

Do not let the working prototype wait for these proposals.

---

## 52. Public-network 15-second target

The desired public-network direction is approximately:

```text
TARGET_BLOCK_INTERVAL = 15 seconds
```

v0 fixed difficulty does **not** guarantee this interval.

A real target requires a separate Consensus NBP defining:

```text
consensus timestamp semantics
difficulty retarget algorithm
integer arithmetic
hash-rate shock behavior
minimum/maximum adjustment
timestamp manipulation bounds
activation boundary
valid/invalid vectors
```

A smooth per-block or short-window algorithm should be researched and simulated before selection.

At a 15-second target, a one-hour reward maturity is approximately 240 blocks. That is a future profile recommendation, .

---

## 53. Transaction height-validity NBP

A future generic Consensus NBP SHOULD introduce transaction-level block-height validity rather than swap-specific timeout opcodes.

Recommended semantics to research:

```text
valid_from_height
optional valid_until_height
```

A transaction is mineable only inside its permitted height range.

This enables:

```text
pre-signed refunds
scheduled payments
escrow timeouts
bounty refunds
reservation windows
agent budget releases
machine deposits
```

The chain can enforce when a transaction is valid, but **cannot guarantee inclusion at an exact height**. Applications should normally use a `valid_from` or a reasonable validity window rather than a one-block-only window.

A later proposal may add relative-height validity based on UTXO creation height.

Bitcoin's BIP65 and BIP68/BIP112 are useful prior art for absolute and relative lock semantics, but this chain should retain its simpler transaction model rather than import Bitcoin Script wholesale.

---

## 54. Adaptor-swap NBP without native multisig

Native Core `2-of-2` ownership is **not currently required** for the preferred swap architecture.

BIP327 MuSig2 allows multiple parties to aggregate keys and jointly produce an ordinary BIP340 signature under one aggregate x-only public key. From v0 consensus's perspective, such an output can remain an ordinary single-key UTXO.

Conceptual future flow:

```text
Alice key + Bob key
    ↓ MuSig2 aggregation off-chain
aggregate BIP340 key
    ↓
ordinary v0-owned UTXO
```

Both parties jointly sign settlement/refund transaction events under the aggregate key.

A pre-signed refund additionally needs the height-validity NBP so it cannot confirm before the agreed timeout.

Adaptor signatures themselves MUST remain an experimental application protocol until the project selects a specifically reviewed construction with test vectors. The [libsecp256k1 MuSig2 integration discussion](https://github.com/bitcoin-core/secp256k1/issues/1452) deliberately omitted adaptor-signature APIs because those functions lacked a specification and satisfactory security proof at the time of integration.

Therefore:

```text
MuSig2 cooperative signing
    can reuse ordinary Core ownership

height lock
    future generic Consensus NBP

adaptor swap construction
    optional APPLICATION/NETWORK NBP
```

Do not add a consensus object named `ADAPTOR_SWAP`.

---

## 55. Generic application-event anchoring

A future Consensus NBP may allow native transactions to commit to signed Nostr application-event IDs.

Core should provide only:

```text
authentication reference
canonical PoW order
data-availability requirement at validation
minimum anchoring burn
```

Core should **not** execute application semantics.

Optional deterministic state engines can then interpret anchored events for:

```text
global names
fungible assets
owned objects / NFTs
games
service receipts
agent protocols
```

No application anchoring is required for v0.

---

## 56. Global names, assets and owned objects

Future optional state engines should preserve the event-sourcing principle:

```text
signed Nostr events
+ canonical anchor order
→ disposable derived application database
```

Global names can provide scarce human-readable ownership while storing mutable metadata in Nostr.

Fungible assets should use event IDs as canonical asset identifiers, not globally unique display symbols.

NFTs should be generalized as owned objects; large media stays in content-addressed storage rather than Core history.

These engines MUST NOT become mandatory native-coin validator state merely because applications find them useful.

---

## 57. Agents, services and Nostr RPC patterns

Nostr can act as a signed, asynchronous request/response delivery bus:

```text
requester pubkey
→ relay(s)
→ service/agent pubkey
→ signed result
→ relay(s)
→ requester
```

AI agents, applications and machines should remain ordinary cryptographic actors, not special consensus identities.

Payments, escrow or scarce commitments can use the blockchain; job messages, quotes, results, metadata and most workflow traffic should remain Nostr-only.

Generalized universal vending-machine standards should be avoided in favor of small use-case-specific NBPs.

---

## 58. Segmented Nostr Archive Mesh

Long-term historical retrievability is distinct from validation-time data availability.

Future archive architecture may separate:

```text
1. Core replay data
2. optional application/NBP history
3. large content-addressed blobs
```

Core historical events can be packed into immutable block-range segments with signed manifests, replicated across independent failure domains, audited through sampling, and optionally paid through a storage market.

Archives may be partial; the network collectively can retain complete history with redundant segment coverage.

None of the following should become v0 block-validity requirements:

```text
archive signatures
archive quorum
segment commitments in blocks
named storage providers
```

A validator still requires every referenced consensus transaction when validating a block. Only after validation may older transaction bodies be pruned by nodes that deliberately choose a pruned profile.

NIP-77 is a natural optional reconciliation mechanism for archive/event sets.

---

## 59. Fee separation across future services

Preserve economic separation by resource:

```text
minimum consensus fee
    → burn

ordering urgency
    → miner priority fee

archive retention
    → optional archive provider

relay delivery
    → optional relay economics

AI / service execution
    → provider
```

Do not force every infrastructure business model through miner consensus fees.

---

# Review resolution

## 60. Resolved blockers and simplifications

The architecture review resolves the major blockers from the cumulative design notes as follows:

| Problem | Resolution |
|---|---|
| Older sections contradicted newer fee rules | One canonical split-fee rule: minimum burn + miner priority fee. |
| Miner had no incentive to include transactions | Priority fees are added to the implicit reward UTXO. |
| First-seen mempool conflict could pin low-fee spends | Keep bounded conflicting spends; miner selects by priority fee. |
| Raw TXID ordering was grindable | Priority fee first; parent-keyed hash only as tie-break. |
| Nostr JSON parser differences could fork implementations | Strict duplicate-key rejection, exact event members, safe `created_at`, ASCII-constrained chain payloads. |
| Nonce text was underspecified | Canonical decimal `u64`, no leading zeros, exact target commitment. |
| Extra lucky PoW could accidentally affect fork choice | Credited work is exactly target work; fixed difficulty reduces fork choice to validated height. |
| Full-node mining required an explicit opt-in despite the decentralization goal | Full-node profile now starts continuous mining automatically in `READY`; disabling remains explicit local policy and never changes validator conformance. |
| Experimental CacheWalk was prematurely treated as frozen consensus | Keep NIP-13 as v0 consensus; preserve the reviewed CacheWalk construction in Appendix A behind independent implementation, hardware, reduced-memory and validation-DoS . |
| Equal-work tie behavior was ambiguous on fresh sync | Sticky live tie; lexical ID only for initial local bootstrap selection. |
| Same-block transaction order could affect state | Every tx validates against parent state; same-block child spends forbidden. |
| Fee arithmetic could overflow fixed integers | Aggregate arithmetic uses `bigint`; implicit reward has explicit `u128` overflow rejection. |
| Invalid x-only output bytes could create ambiguous/unspendable ownership | Every output key must pass BIP340 point validity. |
| All authenticated Nostr TX events threatened disk spam | Persist tx indefinitely only when mempool-useful or referenced by a stored block. |
| Generic relay EOSE was mistaken for complete chain proof | Only configured full-chain relay role claims archive completeness; node verifies history cryptographically. |
| NIP-77 risked becoming a v0 dependency | Basic NIP-01 block-first sync first; NIP-77 is optional optimization. |
| Archive mesh had grown into Core architecture | Deferred to Network NBPs; v0 is archival Core-history only. |
| 15-second target conflicted with fixed difficulty/no time semantics | v0 fixed difficulty; 15-second adaptive target is a future Consensus NBP. |
| Adaptor swaps seemed to require native `2-of-2` | Prefer MuSig2 aggregate BIP340 key; Core still sees one owner. Height lock is the only clear generic consensus addition needed for refund timing. |
| Adaptor signature standardization risk | Keep adaptor construction experimental until a reviewed specification/test suite is selected. |
| Old conformance vectors used retired scope/fee assumptions | Phase 0 MUST regenerate and freeze a neutral corpus from this specification. |
| Document was too large and roadmap-heavy to implement | Normative prototype is now separated from concise deferred-NBP roadmap. |

No unresolved architectural blocker remains for starting Phase 0 of the v0 prototype.

---

## 61. Definition of done

The architecture is considered development-ready when the implementation team can answer every one of the following from this document without inventing a new consensus rule:

```text
What exact bytes are signed?
What exact bytes form a transaction?
What exact tags are legal?
How is a fee split?
Who receives the priority fee?
What creates supply?
What destroys supply?
When is a reward spendable?
What state does each transaction validate against?
What makes a block valid?
How much work does a block contribute?
What happens on equal-work forks?
What happens when tx data is missing?
Who may mutate active UTXOs?
How is a reorg made crash-safe?
What does a fresh node download first?
How are old transactions fetched?
What may a relay decide without affecting consensus?
What does the miner know versus the signer?
When does a full node mine automatically, and how can the operator disable it?
Why is experimental CacheWalk not part of v0 consensus?
What must be reproduced by reindex/replay?
What belongs to a future NBP instead of v0?
```

This specification supplies those answers.

The next engineering action is **Phase 0: implement codecs/genesis tooling and generate the neutral conformance corpus before building networking or persistence**.

---

---

# Appendix A — CacheWalk R1 Post-Start Experimental Review

**Status:** active v0 consensus. Hardware evaluation occurs after implementation and chain start.

CacheWalk R1 is judged as its own experimental construction. No comparison against another PoW is a prerequisite for implementation, genesis creation, interoperability or prototype success.

## A.1 Experimental question

The question is:

> Does CacheWalk R1 make commodity CPU mining practically useful and reduce the extreme specialization advantage of raw SHA-256 mining?

The protocol does not claim CPU-only execution, GPU/FPGA/ASIC impossibility, or a formal proof of memory hardness.

## A.2 Correctness tests required before genesis

Performance testing is deferred; deterministic correctness is not.

Before canonical genesis, vectors MUST cover:

```text
seed
first scratchpad line
last scratchpad line
initial state
representative round with i != j
state after pass 0
state after pass 1
j_final
cpu_work_hash
NIP-13-gate failure
CacheWalk-target failure
valid CacheWalk block
single-byte mutation
genesis special case
```

An independent verifier or deliberately separate reference implementation SHOULD reproduce these vectors.

## A.3 Measurements after chain start

Full nodes SHOULD expose local measurements for:

```text
CacheWalk evaluations per second
average evaluation latency
worker count
mining memory
CPU utilization
block-find rate
stale-work rate
thermal/power observations when available
```

None enter consensus.

## A.4 Attacks to attempt later

After the blockchain is running, experimentally attempt:

```text
GPU implementation
reduced-memory execution
scratchpad recomputation
parallel-lane scaling
NUMA scaling
x86/ARM comparison
invalid-work flooding
parent-missing flooding
thermal stress
botnet economics
FPGA feasibility analysis
ASIC cost/area analysis
```

These are research tasks, not implementation blockers.

## A.5 DoS policy

Before expensive CacheWalk verification, the node SHOULD perform:

```text
frame bounds
strict JSON
kind/scope filtering
NIP-01 ID recomputation
duplicate lookup
exact structural validation
signature validation
known-parent/dependency handling
per-peer expensive-validation token bucket
```

Unknown-parent blocks SHOULD enter a bounded dependency queue first. Repeated expensive invalid submissions MAY be throttled or disconnected.

These policies do not change block validity.

## A.6 Revision rule

If operation reveals a serious weakness, any replacement or parameter change MUST use an explicit later protocol revision. Existing v0 blocks MUST never be silently reinterpreted.

## A.7 Nostr-native identity remains deliberate

Even with CacheWalk:

```text
block.id = normal NIP-01 event ID
```

and:

```text
cpu_work_hash = derived proof predicate only
```

This preserves Nostr addressing, BIP340 signing, relay deduplication, exact-event retrieval and the single event-store identity model.

