# Nostr Blockchain v0 — Minimum Viable Blockchain Architecture Specification

**Status:** Minimum-viable public-network architecture freeze  
**Date:** 2026-08-10  
**Target implementation:** TypeScript / Node.js reference node  
**Document role:** Normative for the v0 minimum-viable blockchain and public experimental network except where explicitly marked *policy*, *implementation recommendation*, or *deferred NBP*.
**PoW:** Nostr CacheWalk R1 is active v0 consensus. It preserves the NIP-01 block event ID and NIP-13 nonce-search envelope, while a deterministic CPU-oriented cache walk supplies credited proof of work.

> This document supersedes the cumulative architecture notes that preceded it. Those notes remain useful design history, but they MUST NOT be used to resolve ambiguity against this specification.

---

## 1. Purpose

The v0 MVP exists to provide a **usable permissionless native-currency blockchain**, not merely a local consensus demonstration.

A conforming deployment MUST allow an ordinary operator to:

```text
download the software
select the canonical genesis
connect to untrusted Nostr relays
independently reconstruct and validate the chain
receive native coins
create and broadcast payments
mine with a commodity CPU by default
survive relay/node failures and forks
restart or reindex without changing monetary state
select the objectively greatest-work valid chain
```

The architecture deliberately remains narrower than a general-purpose blockchain platform.

A successful implementation MUST demonstrate:

- Nostr/BIP340 public keys as monetary identities;
- Nostr events as transactions and blocks;
- NIP-01 event IDs as transaction IDs and block IDs;
- CacheWalk R1 proof of work derived from the NIP-01 block event ID;
- deterministic 15-second-target adaptive difficulty using integer-only ASERT-style arithmetic;
- cumulative-work fork choice rather than height-only fork choice;
- a deterministic UTXO state machine;
- fixed perpetual block issuance;
- minimum fees burned and excess fees paid to miners;
- reward maturity;
- atomic reorgs;
- trustless block/transaction synchronization over multiple Nostr relays;
- crash-safe persistence and deterministic reindex/replay;
- a usable local wallet with encrypted-key and remote-signer options;
- built-in full-node mining enabled continuously by default as policy;
- bounded resource/DoS handling that does not redefine consensus;
- an explicit protocol-version/activation rule for future consensus changes.

Everything not required to provide those native-money properties remains deferred.


## 2. Normative terminology

The terms **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative.

This document distinguishes four categories:

| Category | Meaning |
|---|---|
| Consensus | All conforming validators MUST agree or they may fork. |
| Network protocol | Required for interoperable reference-node communication but does not itself determine monetary validity. |
| Policy | Local behavior that MAY differ without changing block validity. |
| Deferred NBP | Explicitly outside the v0 MVP. |

When a rule is not marked otherwise, rules in Sections 5–22 are consensus rules.

A public-network implementation MUST NOT silently weaken a consensus MUST into policy for performance or convenience.


## 3. Frozen v0 MVP scope

### 3.1 Included

```text
NIP-01 event authentication
BIP340 x-only public-key ownership
UTXO transactions
CacheWalk R1 PoW
15-second target block interval
integer-only ASERT-style adaptive target
median-time-past block timestamp rule
cumulative-work fork choice
block DAG and atomic reorgs
fixed perpetual mining reward
240-block reward maturity in the MVP profile
minimum fee burn
miner priority fee
implicit reward UTXO
parent-state-only block execution
fixed block transaction limit
Nostr relay transport
multi-relay trustless bootstrap
SQLite persistence
built-in always-on full-node mining
archival Core-history retention
usable local wallet tooling
NIP-49 encrypted local key format support
NIP-46 remote-signer support as an optional wallet backend
resource/DoS controls
verify/reindex/replay
explicit future consensus activation rules
```

### 3.2 Explicitly excluded

The following MUST NOT be pulled into the MVP consensus path:

```text
scripts or a general VM
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
payment channels
pool reward accounting in consensus
```

They remain optional future NBPs.

### 3.3 MVP boundary

The MVP is complete when a new operator can join from only the released software, canonical genesis and untrusted bootstrap relay hints; independently validate the greatest-work history; create/receive native payments; mine; and recover the same state after restart/reindex.

The architecture MUST prefer a smaller native-money system over adding application features before this boundary is proven.


## 4. External normative references

The MVP reuses existing cryptographic and Nostr specifications rather than redefining them.

1. [NIP-01 — Basic protocol flow description](https://github.com/nostr-protocol/nips/blob/master/01.md): event fields, event-ID serialization, Schnorr signatures, relay messages and filters.
2. [NIP-13 — Proof of Work](https://github.com/nostr-protocol/nips/blob/master/13.md): nonce-tag search and leading-zero-bit PoW over the NIP-01 event ID. v0 retains a small NIP-13 gate, while CacheWalk supplies credited work.
3. [NIP-44 — Encrypted Payloads](https://github.com/nostr-protocol/nips/blob/master/44.md): existing Nostr use of RFC-8439 ChaCha20 and SHA-256. CacheWalk reuses the ChaCha20 primitive only.
4. [RFC 8439](https://www.rfc-editor.org/rfc/rfc8439): exact ChaCha20 primitive used for CacheWalk scratchpad generation.
5. [BIP340 — Schnorr Signatures for secp256k1](https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki): x-only keys and verification semantics.
6. [Bitcoin Cash ASERT specification](https://upgradespecs.bitcoincashnode.org/2020-11-15-asert/): integer-only exponentially scheduled difficulty adjustment. This specification adapts the target calculation to CacheWalk, a genesis anchor, full 256-bit targets and a 15-second target spacing.
7. [NIP-49 — Private Key Encryption](https://github.com/nostr-protocol/nips/blob/master/49.md): `ncryptsec` encrypted private-key format for the local MVP wallet.
8. [NIP-46 — Nostr Remote Signing](https://github.com/nostr-protocol/nips/blob/master/46.md): optional remote/hardware signer backend.
9. [NIP-77 — Negentropy Syncing](https://github.com/nostr-protocol/nips/blob/master/77.md): optional set-reconciliation optimization; not required for correctness.
10. [SQLite WAL](https://www.sqlite.org/wal.html) and [PRAGMA synchronous](https://www.sqlite.org/pragma.html#pragma_synchronous): persistence behavior.
11. [Node.js release schedule](https://nodejs.org/en/about/previous-releases) and [worker_threads](https://nodejs.org/api/worker_threads.html): reference runtime and CPU-worker model.
12. [better-sqlite3](https://github.com/WiseLibs/better-sqlite3): reference SQLite binding.
13. [noble-curves](https://github.com/paulmillr/noble-curves): reference TypeScript BIP340 implementation.
14. [libsecp256k1](https://github.com/bitcoin-core/secp256k1): independent/high-assurance secp256k1 reference.
15. [BIP327 — MuSig2](https://github.com/bitcoin/bips/blob/master/bip-0327.mediawiki): deferred aggregate-key signing design.
16. [BIP65](https://github.com/bitcoin/bips/blob/master/bip-0065.mediawiki), [BIP68](https://github.com/bitcoin/bips/blob/master/bip-0068.mediawiki), and [BIP112](https://github.com/bitcoin/bips/blob/master/bip-0112.mediawiki): deferred absolute/relative height-lock prior art.

If an external specification changes after this architecture freeze, the implementation MUST continue following the version/behavior captured by the v0 conformance suite until an explicit protocol revision is activated.


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

`npub` is display/transport encoding only and MUST be decoded before consensus operations.

### 5.2 Event kinds

```text
TX_KIND    = 7342
BLOCK_KIND = 7343
```

These are v0 network constants. Before canonical public genesis is frozen, the current Nostr kind registry MUST be rechecked; once genesis/release artifacts are frozen, the selected values MUST NOT change for that chain.

### 5.3 Protocol constants

```text
PROTOCOL_VERSION      = 0
NIP13_GATE_BITS       = 6
MTP_WINDOW            = 11
MAX_FUTURE_DRIFT      = 120 seconds
```

`NIP13_GATE_BITS` is a cheap NIP-13-compatible prefilter and contributes no credited chainwork.

`MAX_FUTURE_DRIFT` is a contextual activation bound against the validating node's system UTC clock. A block beyond it is `PENDING_TIME`, not permanently invalid.

Unknown transaction or block payload versions MUST be rejected.

### 5.4 Reserved output index

```text
REWARD_OUTPUT_INDEX = 0xffff
```

Normal transaction output indexes are restricted to `0x0000..0xfffe`.


## 6. Primitive encodings

Consensus binary encodings use network byte order (big-endian).

| Type | Bytes | Range |
|---|---:|---:|
| `u8` | 1 | 0..255 |
| `u16` | 2 | 0..65,535 |
| `u32` | 4 | 0..4,294,967,295 |
| `u64` | 8 | 0..2^64−1 |
| `u128` | 16 | 0..2^128−1 |
| `u256` | 32 | 0..2^256−1, big-endian |
| `hash32` | 32 | raw bytes |
| `pub32` | 32 | BIP340 x-only public key |

All consensus arithmetic MUST use exact integers. JavaScript `number` MUST NOT be used for coin amounts, fee totals, rewards, supply arithmetic, nonce arithmetic, PoW targets, block work, cumulative work, or ASERT fixed-point arithmetic.


For the v0 reference implementation, valid block height is bounded to `0..2^63-1` so it is exactly representable in SQLite `INTEGER`. Reaching this bound is physically irrelevant to the MVP but makes the storage/consensus boundary explicit.

`u128` amounts are decoded to `bigint`.


### 6.1 Native monetary denomination

The native coin is **NSR**. The smallest indivisible monetary unit is **nos**.

The denomination is fixed as:

```text
1 NSR = 100,000,000 nos
1 nos = 0.00000001 NSR
```

Every consensus-encoded monetary `u128` value is denominated in integer `nos`, including transaction outputs, fees, miner rewards, UTXO amounts and derived supply. `NSR` is a human-facing decimal denomination only and is never encoded as a floating-point consensus value.

Implementations MUST NOT use binary floating point to parse, format, add, subtract, compare or convert monetary values. A decimal NSR parser MUST accept at most eight fractional decimal places and convert exactly to integer `nos`; values with greater precision are rejected rather than rounded.

Canonical textual examples:

```text
50 NSR          = 5,000,000,000 nos
1 NSR           =   100,000,000 nos
0.01 NSR        =     1,000,000 nos
0.00000001 NSR  =             1 nos
```

The identifiers are case-sensitive in protocol documentation: `NSR` is the coin/unit symbol and `nos` is the smallest-unit name. These names do not alter the binary transaction or genesis layouts; they define the interpretation and presentation of existing integer amount fields.

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

The genesis event is a special `BLOCK_KIND` event and binds all MVP consensus parameters that are intended to vary by chain.

### 8.1 Genesis tags

Tags MUST be exactly:

```text
[
  ["t", "nostr-blockchain:genesis"],
  ["nonce", "<NONCE>", "6"]
]
```

No parent tag, transaction tags or arbitrary tags are permitted.

### 8.2 Genesis content

Genesis `content` is lowercase hexadecimal encoding of exactly **147 bytes**:

```text
protocol_version        u8
block_reward            u128
reward_maturity         u32
initial_pow_target      u256
pow_limit_target        u256
target_block_interval   u32
asert_half_life         u32
base_fee                u128
input_fee               u128
output_fee              u128
max_tx_inputs           u16
max_tx_outputs          u16
max_block_transactions  u16
```

Targets are unsigned 256-bit big-endian integers. Larger target = easier CacheWalk work.

The content MUST decode exactly; trailing bytes are invalid.

### 8.3 Genesis PoW

Genesis uses CacheWalk R1 with:

```text
G = E = candidate genesis NIP-01 event ID
P = 32 zero bytes
required_target = initial_pow_target
```

Genesis MUST satisfy both:

```text
leading_zero_bits(E) >= NIP13_GATE_BITS
U256BE(CacheWalkR1(G, P, E)) <= initial_pow_target
```

The nonce tag third field is the fixed NIP-13 gate commitment (`"6"`), not the CacheWalk target.

### 8.4 Genesis monetary state

Genesis is height `0`, creates **no reward UTXO**, and initial supply is zero.

The genesis signer has no authority after genesis.

### 8.5 MVP network profile

The reference MVP profile uses:

```text
protocol_version        0
block_reward            5,000,000,000 nos  # 50 NSR
reward_maturity         240 blocks
initial_pow_target      00ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
pow_limit_target        0fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
target_block_interval   15 seconds
asert_half_life         4,320 seconds
base_fee                1,000 nos
input_fee               250 nos
output_fee               500 nos
max_tx_inputs           32
max_tx_outputs          32
max_block_transactions  64
```

`asert_half_life = 4,320` seconds corresponds to 288 target blocks at a 15-second interval. It preserves the approximate block-count half-life of the deployed 600-second/172,800-second ASERT profile while adapting much faster in wall-clock time.

A UI SHOULD display monetary values in NSR where useful, using exactly eight-decimal fixed-point conversion when a canonical decimal representation is required. The consensus value `5,000,000,000 nos` is `50.00000000 NSR`.

### 8.6 Absolute v0 genesis bounds

Every v0 genesis MUST satisfy:

```text
block_reward > 0
reward_maturity >= 1
0 < initial_pow_target <= pow_limit_target < 2^256
5 <= target_block_interval <= 600
asert_half_life >= 32 * target_block_interval
base_fee > 0
1 <= max_tx_inputs <= 64
1 <= max_tx_outputs <= 64
1 <= max_block_transactions <= 256
```

`input_fee` and `output_fee` may be zero. `base_fee` is positive so every confirmed transaction destroys at least some native value.

The canonical public genesis event, its resulting event ID, and this decoded parameter set MUST be shipped as release artifacts. A genesis outside these bounds is invalid even if its payload decodes.


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

`DIFFICULTY` MUST be the canonical decimal encoding of the fixed protocol constant `NIP13_GATE_BITS`. It is the NIP-13 gate commitment and MUST NOT encode the adaptive CacheWalk target.

---

## 15. Proof of work, adaptive target and credited work

v0 proof of work is **Nostr CacheWalk R1** with a derived adaptive 256-bit target.

The block remains a normal NIP-01 event. `block.id` is the ordinary NIP-01 SHA-256 event ID and BIP340 signs that ID. CacheWalk produces a separate derived 32-byte work hash that is never serialized.

Mining:

```text
vary nonce tag
    ↓
recompute NIP-01 event ID E
    ↓
cheap NIP-13 gate
    ↓
CacheWalkR1(G, P, E)
    ↓
compare work hash to required_target(height)
```

### 15.1 CacheWalk inputs and constants

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

All byte slicing is zero-based and half-open. `||` is byte concatenation. ASCII domain strings have no trailing NUL. `LE32(x)` and `U32LE(b)` are unsigned 32-bit little-endian encode/decode.

### 15.2 Cheap NIP-13 gate

Before CacheWalk:

```text
leading_zero_bits(E) >= NIP13_GATE_BITS
```

MUST hold. The nonce tag third field MUST be canonical decimal `"6"`.

The gate contributes no credited work and is not sufficient by itself as an expensive-validation DoS defense.

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

Use RFC-8439 ChaCha20:

```text
key       = seed
nonce96   = 12 zero bytes
counter   = 0
plaintext = 262144 zero bytes
scratch   = ChaCha20(key, nonce96, counter, plaintext)
```

Interpret the exact 262144-byte result as 4096 mutable 64-byte lines.

Only the RFC-8439 ChaCha20 primitive is reused; NIP-44 ECDH/HKDF/HMAC/padding/message-format rules do not participate.

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

`A` and `B` MUST be copied before mutation, including when `i == j`.

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

Interpret `cpu_work_hash` as unsigned 256-bit **big-endian** integer `W`.

### 15.8 ASERT-derived required target

The target for every block is computed locally; it is **not serialized in the block**.

Genesis anchor values:

```text
anchor_height      = 0
anchor_target      = genesis.initial_pow_target
target_spacing     = genesis.target_block_interval
half_life          = genesis.asert_half_life
anchor_parent_time = genesis.created_at - target_spacing
pow_limit          = genesis.pow_limit_target
RADIX              = 65536
```

For genesis:

```text
required_target(0) = anchor_target
```

For candidate block height `H >= 1`, use the candidate's parent as the ASERT evaluation block:

```text
h_eval       = H - 1
t_eval       = parent.created_at
height_delta = h_eval - anchor_height
time_delta   = t_eval - anchor_parent_time
```

Then execute with arbitrary-precision signed integers and **no floating point**:

```text
exponent = trunc_div(
    (time_delta - target_spacing * (height_delta + 1)) * RADIX,
    half_life
)

num_shifts = arithmetic_shift_right(exponent, 16)
frac       = exponent - num_shifts * RADIX

factor = (
    (
        195766423245049 * frac
        + 971821376 * frac^2
        + 5127 * frac^3
        + 2^47
    ) >> 48
) + RADIX

next_target = anchor_target * factor

if num_shifts < 0:
    next_target = next_target >> (-num_shifts)
else:
    next_target = next_target << num_shifts

next_target = next_target >> 16

if next_target < 1:
    next_target = 1
if next_target > pow_limit:
    next_target = pow_limit
```

`trunc_div(a,b)` truncates toward zero. `arithmetic_shift_right` preserves sign. `frac` therefore lies in `0..65535`.

A block is PoW-valid iff:

```text
W <= required_target(H)
```

The v0 adaptation deliberately uses full 256-bit targets directly and does not use Bitcoin compact `nBits`, eliminating compact-target rounding from consensus.

### 15.9 Block work and cumulative work

For target `T`:

```text
block_work(T) = floor((2^256 - 1) / (T + 1)) + 1
```

Genesis cumulative work is `block_work(initial_pow_target)`.

For every other block:

```text
cumulative_work(block)
= cumulative_work(parent) + block_work(required_target(block.height))
```

Extra lucky zero bits in `E` or `cpu_work_hash` earn no extra work.

Fork choice MUST compare cumulative work, not height or raw hash values.

### 15.10 Signing order

Workers never receive the miner private key.

When a worker reports a winning nonce, the main process MUST independently recompute:

```text
NIP-01 event ID E
NIP-13 gate
required target
CacheWalk R1
work-hash target comparison
```

Only then may the signer sign `E`.

### 15.11 Nonce exhaustion

If the complete `u64` nonce space is exhausted for one candidate template, rebuild with another committed value, normally `created_at`, and restart nonce search.

### 15.12 Consensus freeze and experimental status

CacheWalk R1 and this ASERT adaptation are active v0 consensus and are not runtime-selectable.

Changing CacheWalk constants, target arithmetic, target spacing, half-life interpretation, NIP-13 gate semantics or block-work arithmetic requires an explicit later protocol revision.

CacheWalk remains experimentally CPU-oriented; v0 makes no claim of CPU-only execution or permanent GPU/FPGA/ASIC resistance. Hardware behavior is measured after the chain runs.


## 16. Block state validation

A block is state-valid only after its parent and every referenced transaction event are available and its contextual time/PoW rules pass.

For candidate height `H = parent.height + 1`:

1. Validate NIP-01 envelope and recompute event ID.
2. Require `BLOCK_KIND`.
3. Validate exact content, tags, parent, sorted transaction IDs, canonical nonce and NIP-13 gate commitment.
4. Reject duplicate IDs and malformed/self-parent references.
5. Validate BIP340 signature.
6. If the parent is missing, persist a bounded dependency record and fetch it; do not spend CacheWalk verification budget yet.
7. Compute the candidate block's median-time-past requirement from the parent branch.
8. If `created_at <= MTP(parent)`, reject with `BLOCK_TIME_TOO_OLD`.
9. If `created_at > local_system_utc + MAX_FUTURE_DRIFT`, classify `PENDING_TIME`; re-evaluate later. This is contextual liveness handling, not permanent invalidity.
10. Validate the cheap NIP-13 gate.
11. Compute the exact ASERT required target from the parent and genesis parameters.
12. Validate CacheWalk R1 against that target.
13. Require the parent to be state-valid and reject detected parent cycles, except genesis.
14. Fetch/resolve every referenced transaction event by exact ID.
15. Require each referenced object to be a valid `TX_KIND` event for this chain.
16. Validate **every transaction independently against the parent's UTXO state**, not against mutations from earlier transactions in the block.
17. Require no input outpoint to appear in more than one block transaction.
18. Require derived implicit reward amount to fit `u128`.
19. Compute and persist block work/cumulative work.
20. If all checks pass, apply the entire transition atomically.

### 16.1 Parent-state-only execution

v0 forbids same-block child spends.

Consequences:

- transaction validation is order-independent;
- transactions can be validated in parallel after input resolution;
- no package relay or CPFP dependency graph is required;
- block transaction IDs may be lexicographically sorted without changing monetary semantics.

### 16.2 Missing data is not invalidity

A structurally/time/PoW-valid block whose transaction bodies are missing is `PENDING_TX_DATA`, not `INVALID`.

It MUST NOT activate until all required objects are fetched and state validation succeeds.

### 16.3 Contextual future time is not permanent invalidity

A block that is otherwise structurally valid but currently exceeds the local future-time bound is `PENDING_TIME`. Nodes MUST retain it only within normal bounded orphan/resource policy and retry when local UTC catches up.


## 17. Block DAG and fork choice

Every known structurally valid block belongs to a block DAG keyed by event ID and parent ID.

### 17.1 Validation states

Recommended persistent states:

```text
PARENT_MISSING
STRUCTURAL_VALID
PENDING_TIME
TX_DATA_MISSING
STATE_VALID
INVALID
INVALID_ANCESTOR
```

`ACTIVE` is a separate flag/property.

### 17.2 Fork choice

Only fully `STATE_VALID` tips participate.

The active branch changes only when another fully validated tip has **strictly greater cumulative work**.

Height is never a substitute for cumulative work once adaptive targets are active.

### 17.3 Equal-work rule

If another branch has exactly equal cumulative work to the active branch:

```text
DO NOT REORG
```

Keep the current branch until one obtains strictly greater work.

### 17.4 Fresh-bootstrap tie

A fresh database may discover multiple equal-work maximum tips before selecting an active branch.

For deterministic tooling only, choose the lexicographically smallest 32-byte tip ID as the initial local selection among equal-work state-valid tips.

This contributes no work and MUST NOT cause live equal-work reorgs.

### 17.5 Invalid ancestor propagation

Once a block is proven `INVALID`, descendants MUST be marked `INVALID_ANCESTOR` without repeating full state execution.


## 18. Block time semantics

Block `created_at` is miner-authenticated consensus input because adaptive difficulty needs a deterministic time series. Transaction `created_at` remains authenticated metadata and is not used for monetary validity.

### 18.1 Median time past

For a non-genesis block, define `MTP(parent)` as the median of `created_at` values from the parent and up to its 10 preceding ancestors (`MTP_WINDOW = 11`). If fewer than 11 ancestor blocks exist, use all available blocks ending at the parent.

A candidate block MUST satisfy:

```text
candidate.created_at > MTP(parent)
```

Median is selected after sorting integer timestamps ascending; for an even temporary early-chain sample, use the lower middle element (`sorted[(n-1)//2]`).

### 18.2 Future bound

A node MUST NOT activate a block while:

```text
block.created_at > local_system_utc_seconds + MAX_FUTURE_DRIFT
```

with `MAX_FUTURE_DRIFT = 120` seconds in v0.

Such a block is `PENDING_TIME` and MAY become eligible as wall time advances.

Implementations SHOULD warn loudly when their local clock appears unsynchronized. Network time is not taken from a relay or miner quorum.

### 18.3 Uses and non-uses of time

Block time is used only for:

```text
MTP validity
ASERT target calculation for descendant blocks
future-time activation bound
operator metrics
```

It MUST NOT directly determine:

```text
transaction validity
reward maturity
issuance
fork-choice ordering beyond its effect on derived target/work
block height
```

Reward maturity and transaction semantics remain height-based.


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

Mining is built into the reference full node and is **enabled continuously by default as policy**.

For the full-node profile:

```text
when lifecycle == READY
and a signer is available
and mining has not been explicitly disabled
    -> continuously build and mine the active-tip candidate
```

Mining pauses outside `READY`, on consensus/storage failure, when the signer is unavailable, and by default when all external relay connectivity is lost. Implementations SHOULD throttle on thermal/power policy. Mobile/light-client profiles do not mine by default.

The default must be visible, documented and trivially disableable. Reference default: one low-priority worker.

### 21.1 Components

```text
CandidateBuilder
DifficultyCalculator
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
NIP-13 gate commitment = "6"
ASERT required target derived from parent/genesis
```

Only the nonce changes inside one worker generation.

A miner SHOULD periodically refresh `created_at` and therefore the event template when wall time advances materially, while preserving the rule that each individual work attempt is validated against the exact event bytes that produced `E`.

### 21.3 Worker nonce partitioning

For `N` workers, worker `i` tests:

```text
i, i+N, i+2N, ...
```

Workers receive no private key.

### 21.4 Signing

On a reported winner:

1. recompute the NIP-01 event ID;
2. recheck MTP/future-time eligibility;
3. recompute required ASERT target;
4. recheck NIP-13 gate and CacheWalk target;
5. sign the 32-byte NIP-01 event ID;
6. pass through the normal local receive/validation path;
7. submit to `ChainExecutor` and publish only after local acceptance.

### 21.5 Stale work

Every active-tip transition increments `stateVersion` / `miningGeneration`. Results from older generations MUST be ignored.

A mempool change does not have to interrupt current mining.

### 21.6 Mining modes

```text
continuous   # default full-node profile
disabled     # explicit operator opt-out
mine-one     # deterministic test/development control
```

Expose mining enabled state, worker count, generation, CacheWalk evaluations/sec, required target, approximate displayed difficulty, pause reason and latest block interval.


## 22. Consensus error taxonomy

Implementations SHOULD expose stable machine-readable error codes.

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
BLOCK_BAD_JSON
BLOCK_BAD_NIP01_ID
BLOCK_BAD_SIGNATURE
BLOCK_BAD_KIND
BLOCK_BAD_SCOPE
BLOCK_BAD_TAGS
BLOCK_BAD_CONTENT
BLOCK_BAD_PARENT
BLOCK_PARENT_MISSING
BLOCK_PARENT_INVALID
BLOCK_PARENT_CYCLE
BLOCK_BAD_NONCE
BLOCK_BAD_GATE_COMMITMENT
BLOCK_NIP13_GATE_FAIL
BLOCK_TIME_TOO_OLD
BLOCK_TIME_FUTURE
BLOCK_BAD_ASERT_TARGET
BLOCK_BAD_CACHEWALK
BLOCK_TX_DUPLICATE
BLOCK_TX_MISSING
BLOCK_TX_INVALID
BLOCK_DOUBLE_SPEND
BLOCK_REWARD_OVERFLOW
BLOCK_WORK_OVERFLOW
```

`BLOCK_TIME_FUTURE` maps to contextual `PENDING_TIME`, not permanent `INVALID`, unless another permanent-invalid condition also exists.


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
├─ miner
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
    difficulty.ts
    time.ts
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

  wallet/
    keystore.ts
    wallet.ts
    signer-backends.ts

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
    wallet-main.ts

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

The following is the recommended v0 MVP logical schema. Migrations may adjust SQL details but MUST preserve these semantics.

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
  required_target   BLOB CHECK(required_target IS NULL OR length(required_target)=32),
  block_work_dec    TEXT,
  cumulative_work_dec TEXT,
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
active_cumulative_work
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

Coin amounts remain 16-byte big-endian `u128`. `required_target` is exactly 32-byte big-endian `u256`. `block_work_dec` and `cumulative_work_dec` are canonical unsigned base-10 integer strings with no leading zeros except `"0"`, because cumulative work is unbounded over chain lifetime.

Transaction fee totals can exceed `u128` because up to 32 inputs are summed, so the database uses fixed 17-byte unsigned big-endian fee encodings. This is a storage representation only; consensus uses arbitrary precision.

### 28.3 Derived counters

Supply, cumulative burn, cumulative priority fees, active height and tip MAY be cached in `meta`, but they are derived and MUST be reconstructible from active history.

---

## 29. Event persistence policy

The MVP is an archival **Core-history** validator but not a general Nostr archive.

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

The v0 MVP retains enough active undo data to reach genesis; pruning deep undo is deferred.

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

For v0's small MVP limits, one database transaction for the complete reorg is preferred over partially committed reorg steps.

If any assertion fails, roll back and leave the old active chain intact.

---

## 33. Nostr Relay Manager

Nostr is the only external blockchain communication plane in the MVP.

Maintain one WebSocket connection per configured relay and deduplicate all events by NIP-01 event ID.

Relay classes are local policy:

```text
bootstrap
archive/full-chain
gossip
local/embedded
```

A relay is never a consensus authority.

### 33.1 Public bootstrap hints

A release MUST ship `bootstrap-relays.json` containing at least three default relay URLs on distinct hostnames when available.

These URLs are **hints, not trust roots**. They may be updated between software releases without a consensus change. Operators MAY replace or supplement them entirely.

The node SHOULD maintain at least four healthy outbound relay connections when enough configured/discovered relays are available and SHOULD avoid relying on one hostname/operator for all history.

### 33.2 Relay omission model

A relay may omit, delay, reject or delete any event. Therefore:

```text
EOSE != proof of complete chain history
one relay's best tip != trusted tip
one relay's absence of an event != invalidity
```

Only cryptographic validation and cumulative-work fork choice determine active state.


## 34. Basic synchronization and trustless bootstrap

A fresh node starts with only:

```text
canonical genesis.json
chain ID derived from genesis
bootstrap relay hints or operator-supplied relays
```

It MUST NOT require a trusted snapshot or trusted remote tip.

### 34.1 Block-first synchronization

1. Validate and persist canonical genesis.
2. Connect to multiple relays.
3. Subscribe for `BLOCK_KIND` events carrying this chain's exact `t` tag.
4. Persist structurally valid block candidates into the DAG regardless of arrival order.
5. For every candidate block, fetch missing parents by exact NIP-01 ID.
6. Apply time and PoW validation only when required ancestors are known.
7. Fetch each referenced transaction by exact ID.
8. State-validate candidate branches.
9. Compute cumulative work for every state-valid branch.
10. Activate the unique strictly greatest-work branch, using the equal-work rules in Section 17.
11. Continue live block/transaction subscriptions.

### 34.2 Multi-relay retrieval

Missing parents and transactions SHOULD be requested from more than one relay over time. A failed/empty response from one relay MUST NOT permanently fail an object.

Exact-ID requests use normal NIP-01 `REQ` filters with `ids`.

### 34.3 NIP-77

NIP-77 MAY later accelerate reconciliation, but the MVP correctness path MUST work with ordinary NIP-01 subscriptions and exact-ID fetching alone.

### 34.4 Bootstrap completion

A node is `READY` only when it has:

```text
a fully state-valid active tip
no unresolved dependency on the active path
completed startup recovery checks
live connectivity to at least one configured relay
```

A fresh node MUST be able to delete all relay cache metadata and reconstruct the same active state from the same authenticated event set.


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

The reference node SHOULD include a restricted embedded NIP-01 relay mode for Core chain data.

When enabled it stores/serves:

```text
all accepted block events
all transactions referenced by stored structurally valid blocks
confirmed historical transactions
currently useful mempool transactions
objects requested as active missing dependencies
```

The embedded relay MUST serve historical confirmed Core events regardless of `created_at` age.

It MUST NOT advertise or imply consensus authority, finality, or snapshot trust.

Publicly reachable operators are encouraged to enable this role because fresh-node liveness improves with independent full-history sources, but inbound reachability is not required for validator conformance.


## 38. Event firewall

Network processing SHOULD reject cheaply before expensive operations:

```text
1. WebSocket frame byte cap
2. strict JSON syntax + duplicate-key rejection
3. message shape
4. kind/scope prefilter
5. duplicate event ID lookup
6. NIP-01 ID recomputation
7. exact chain structural parse
8. BIP340 signature verification
9. known-parent/dependency lookup
10. MTP/future-time contextual check
11. cheap NIP-13 gate
12. per-peer expensive-validation budget
13. CacheWalk + ASERT target verification
14. semantic/state validation
```

Unknown-parent blocks enter a bounded dependency queue before CacheWalk verification.

Diagnostic tests may exercise other orders for error precedence, but the firewall MUST never accept an event consensus rejects.


## 39. Resource-policy defaults

Initial local defaults, changeable without forking:

```text
max relay connections                 16
target healthy outbound relays         4
max websocket frame               64 KiB
max JSON nesting                      16
max mempool transactions          10,000
max stored unresolved orphans      2,000
max missing-object queue          10,000
max concurrent exact fetches          64
max exact IDs per REQ batch           256
max pending future-time blocks      1,000
expensive block verifications/peer      4 burst
expensive verification refill       1/sec
mining workers                         1 default
```

Exact token-bucket numbers are policy and MAY be tuned.

When a cap is reached, eviction/throttling is policy; it MUST NOT reclassify a consensus-valid object as permanently invalid.

Orphans, future-time blocks, missing confirmed dependencies and mempool transactions are separate resource classes.


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
2. load/validate selected canonical genesis and bound ASERT parameters
3. open DB and run schema migration
4. verify stored genesis binding
5. recover active tip/state metadata
6. start relay manager
7. block-first synchronization
8. exact missing transaction retrieval
9. state-validate candidate branches and compute cumulative work
10. activate greatest-cumulative-work branch
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
active cumulative work
next required target
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

## 44. CLI and minimum viable wallet surface

The node SHOULD avoid a remotely exposed unauthenticated general-purpose RPC service.

Node administration:

```text
nostr-chain-node status
nostr-chain-node balance <pubkey|npub>
nostr-chain-node utxos <pubkey|npub>
nostr-chain-node block <id>
nostr-chain-node tx <id>
nostr-chain-node mempool
nostr-chain-node mining
nostr-chain-node mine-one
nostr-chain-node verify
nostr-chain-node reindex
nostr-chain-node replay <events.ndjson>
```

`status` MUST expose active tip, height, cumulative work, required next target, recent median block interval, supply, UTXO digest and relay health.

### 44.1 Wallet utility

The MVP REQUIRES a separate wallet command/application that is not part of node chainstate:

```text
nostr-chain-wallet new
nostr-chain-wallet import <nsec|ncryptsec>
nostr-chain-wallet address
nostr-chain-wallet balance
nostr-chain-wallet utxos
nostr-chain-wallet send <npub|hex-pubkey> <amount> [--priority-fee N]
nostr-chain-wallet tx <id>
nostr-chain-wallet history
nostr-chain-wallet export-encrypted
nostr-chain-wallet signer-connect <nip46-token>
```

Minimum behavior:

- create a BIP340 key and display `npub`;
- store local private keys encrypted using NIP-49 `ncryptsec` when a local keystore is used;
- never persist plaintext secret keys in the node database;
- support NIP-46 as an optional remote/hardware signer backend;
- query a local node for spendable UTXOs;
- deterministically calculate minimum burn, requested priority fee and change;
- create/sign the exact NIP-01 TX event;
- publish to multiple configured relays;
- show pending/confirmed/replaced-conflict status and confirmation depth.

The wallet MUST use the same transaction codec/conformance vectors as the node.

### 44.2 Local node access

For the MVP, wallet-to-node access MAY be implemented by a loopback-only/Unix-domain local control interface or by invoking stable local CLI commands. It MUST NOT require opening a public RPC port.


## 45. Configuration and release artifacts

Runtime configuration MAY contain:

```text
data directory
canonical genesis file
bootstrap/additional relay URLs
embedded relay bind address
mining enabled (default true for full-node profile)
mining mode (default continuous)
mining worker count (default one)
signer backend
wallet local-control endpoint
resource caps
log level
```

Consensus parameters MUST NOT be independently overridable after genesis selection, including:

```text
block reward
reward maturity
initial/pow-limit targets
target spacing
ASERT half-life
fee constants
transaction limits
block transaction limit
CacheWalk parameters
```

### 45.1 Canonical release bundle

A network release MUST provide:

```text
genesis.json
genesis event ID / chain ID
bootstrap-relays.json
consensus conformance corpus
CacheWalk vectors
ASERT vectors
software version and source revision
SHA-256 checksums of release artifacts
```

Bootstrap-relay changes do not alter consensus. `genesis.json` and consensus vectors for an existing chain MUST be immutable.

Miner/wallet secret keys SHOULD use NIP-49, NIP-46, an OS key store, hardware signer, or an explicitly protected development key outside chainstate.


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
TIME/POW VALID OBJECT
    ↓
STATE-VALID OBJECT
    ↓
ACTIVE MONETARY STATE
```

### 46.2 Relay/eclipsing assumptions

Relays can censor, omit, delay, replay or partition data. The node therefore uses multiple relays, exact-ID dependency fetches and cumulative-work validation.

Bootstrap relays are availability hints, never trust anchors.

### 46.3 Timestamp manipulation

Miners choose signed block timestamps, so timestamps are not external truth. MTP prevents arbitrary backward movement; the local future-time bound limits forward claims; ASERT uses integer schedule error rather than trusting claimed hash rate.

Clock-dependent future acceptance can cause temporary differences between badly skewed nodes. Operators MUST keep system UTC synchronized; a block becomes eligible as the slower clock catches up.

### 46.4 CacheWalk verification DoS

A valid-looking block can force expensive CacheWalk work. The firewall MUST perform cheap validation, known-parent handling and per-peer expensive-work budgeting first.

The NIP-13 gate is only a cheap filter, not a complete DoS defense.

### 46.5 Key separation

Mining workers MUST never receive signing secrets. Wallet keys MUST never be written to chainstate. Local encrypted storage uses NIP-49 or an equivalent protected signer backend; NIP-46 MAY isolate signing completely.

### 46.6 Consensus/library supply chain

Cryptographic/runtime dependency upgrades require the complete conformance corpus. A package upgrade MUST NOT silently change consensus serialization, ChaCha20, SHA-256 or BIP340 behavior.


## 47. Testing requirements

No implementation phase is complete without automated tests.

### 47.1 NIP-01 / BIP340 / wallet key formats

CI MUST include:

- NIP-01 event-ID serialization fixtures;
- official BIP340 test vectors;
- malformed x-only keys/signatures;
- strict-JSON duplicate-key cases;
- NIP-49 test vectors when local encrypted wallet storage is enabled.

### 47.2 Consensus corpus

Phase 0 MUST generate and freeze a neutral v0 corpus including at least:

```text
valid genesis
invalid genesis target bounds
CacheWalk intermediate/final vectors
valid/invalid NIP-13 gate
valid/invalid CacheWalk target
ASERT ideal-schedule unchanged target
ASERT ahead-of-schedule harder target
ASERT behind-schedule easier target
ASERT pow-limit clamp
ASERT hardest-target clamp
negative exponent/truncation vectors
MTP exact boundary
future-time pending boundary
valid empty blocks through reward maturity
valid exact-maturity reward spend
valid zero-priority transaction
valid positive-priority transaction
miner reward containing priority fee
supply invariant
wrong-owner input
immature reward spend
bad content/tags/version
invalid output key
duplicate input
fee too low
same-block child spend
block double spend
missing-transaction pending block
equal-cumulative-work competing branches
higher-work shorter branch defeating a taller lower-work branch
multi-block reorg across changed targets
```

Fixture secret keys MUST be public test-only keys.

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
required target deterministic from ancestry/genesis
cumulative_work strictly increases per connected block
reward maturity boundary exact
parent-state-only execution
connect then disconnect restores identical digest/relevant counters
reorg then reverse reorg restores identical state
```

### 47.4 Fuzzing

Fuzz parsers/codecs, genesis, transaction/block tags, nonce, x-only keys, fee arithmetic, ASERT signed arithmetic, target comparison, CacheWalk and state transitions.

### 47.5 Network simulation

Simulate duplicates, reordering, dropped events, unknown parents, block-before-TX, relay partitions/omissions, future-time blocks, conflicting forks and fresh-node bootstrap from different relay subsets.

Also test mining policy:

```text
READY starts continuous mining by default
explicit disabled mode starts no workers
SYNCING/DEGRADED/SHUTTING_DOWN pause workers
active-tip change invalidates stale work
worker never receives signing secret
```

### 47.6 Hash-rate/time simulations

Without changing consensus, simulate fast/slow timestamp schedules and work rates to confirm target arithmetic is monotonic, deterministic, bounded by `pow_limit_target`, and converges toward the 15-second schedule without integer divergence.

These simulations validate implementation correctness; they are not a promise of a particular real-world hashrate.

### 47.7 Crash tests

Kill the process during block connection, reorg, event persistence, mempool update and startup recovery. Restarted state MUST be pre-commit or post-commit, never partial.


## 48. Development plan with gates

### Phase 0 — Consensus freeze and corpus

Deliver:

```text
this specification
binary codecs
genesis generator
CacheWalk implementation/vectors
ASERT implementation/vectors
neutral conformance corpus
wallet event codec/key-format tests
```

Gate: deterministic byte-for-byte agreement on all vectors.

### Phase 1 — Pure consensus in memory

Deliver NIP-01 validation, transaction/block validation, CacheWalk, ASERT target/work, MTP, fee split, UTXO state, reward/maturity and cumulative-work fork choice.

Gate: consensus corpus/property tests pass without SQLite/networking.

### Phase 2 — DAG, overlay and reorg

Deliver block DAG, StateOverlay, ChainExecutor model, mempool conflicts and cumulative-work reorg logic.

Gate: adaptive-target fork simulations pass, including a higher-work branch that is not simply the taller branch.

### Phase 3 — SQLite persistence

Deliver schema, atomic connect/disconnect/reorg, restart recovery, verify, reindex and replay.

Gate: crash-injection suite passes.

### Phase 4 — Nostr networking/bootstrap

Deliver strict relay framing, RelayManager, default bootstrap hints, block-first sync, exact-ID fetch and live subscriptions.

Gate: fresh nodes using different untrusted relay subsets reconstruct the same unique greatest-work state.

### Phase 5 — Wallet + miner

Deliver usable wallet commands, NIP-49 local keystore, optional NIP-46 signer, candidate builder, worker miner, `mine-one`, continuous default mining and priority-fee selection.

Gate: a user can create an address, mine/receive funds, send a signed payment through Nostr and observe confirmation without manually constructing events.

### Phase 6 — Embedded relay and multi-node MVP demo

Deliver restricted full-chain relay mode, three independent node processes, partition/reconnect test and a fourth clean bootstrap node.

Gate: Section 49 passes.

### Phase 7 — Public experimental release hardening

Deliver resource tuning, structured metrics/logs, packaging, immutable genesis/release bundle, signed/checksummed artifacts, fuzzing expansion, clock warnings and CacheWalk hardware measurements.

No application NBP is required for MVP status.


## 49. Minimum-viable blockchain acceptance demo

Run at least three full-node processes with separate databases and mining keys, plus independent Nostr relay paths where practical.

All full nodes MUST start continuous mining automatically in `READY` unless explicitly disabled for a deterministic test step.

Demonstrate:

1. Nodes start from the same canonical genesis and different bootstrap-relay subsets.
2. Mining produces CacheWalk-valid blocks and adaptive required targets.
3. Observed target/block intervals change in the correct direction when the test harness changes available mining workers.
4. At least one reward reaches the 240-block MVP maturity boundary.
5. The wallet creates an encrypted local key or connects a NIP-46 signer and displays an `npub` receive identity.
6. A matured reward is paid to another wallet with exact minimum burn and zero priority fee.
7. A second payment uses a positive priority fee; miner reward increases by exactly that priority fee while supply changes only by fixed reward minus minimum burn.
8. All nodes report identical active tip, cumulative work, UTXO digest, balances, cumulative burn and supply.
9. Conflicting mempool spends may differ locally, but confirmed state converges.
10. Same-block child spend is rejected.
11. Partition nodes and mine competing branches across at least one target adjustment.
12. Create a case where height alone is insufficient; all nodes MUST choose the strictly greater cumulative-work valid branch.
13. Equal cumulative work MUST NOT trigger a live reorg.
14. Reconnect; nodes fetch missing parents/TXs and converge.
15. Restart every node; state remains identical.
16. Delete derived chainstate on one node and `reindex`; it returns to the same state.
17. Start a fourth node with an empty database, only `genesis.json` and untrusted bootstrap hints; it independently reconstructs the same active tip/state.
18. Remove one bootstrap relay and prove already-running nodes continue through remaining relays.
19. `replay` of the authenticated Core event history in shuffled input order produces the same unique best state when the maximum-work tip is unique.

The MVP is working when these checks pass without trusted snapshots, centralized ordering, non-Nostr blockchain transport, or manual database edits.


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
required next target
displayed difficulty
active cumulative work
median recent block interval
MTP
future-time pending blocks
CacheWalk evaluations/sec
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

# Post-MVP NBP roadmap

## 51. NBP governance principle

The MVP should establish an NBP process modeled on Nostr's strongest extension principle:

> If a feature is not required for every honest validator to agree on the active native monetary state, it should normally remain optional.

Classify proposals as:

```text
APPLICATION
NETWORK
POLICY
CONSENSUS
```

A Consensus NBP may be optional before activation but cannot remain optional for nodes following that chain after activation.

Do not expand the MVP boundary to wait for these proposals.

---

## 52. Post-MVP difficulty evolution

The v0 MVP already uses:

```text
15-second target spacing
CacheWalk R1
integer-only ASERT-style adaptive target
full 256-bit target comparison
cumulative-work fork choice
```

This is sufficient for MVP/public experimentation.

Any later change to target spacing, ASERT half-life, timestamp rules, target arithmetic, emergency-difficulty behavior or PoW algorithm is a **Consensus NBP** and requires:

```text
explicit protocol revision
activation boundary
independent implementation
valid/invalid vectors
fork analysis
hash-rate shock simulation
rollback/failure analysis
```

Do not add an emergency difficulty shortcut in v0 without separate evidence; the MVP launches near the easy PoW limit and relies on always-on full-node mining plus ASERT adaptation.


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

| Problem | Resolution |
|---|---|
| Fee rules conflicted | One split-fee rule: minimum burn + miner priority fee. |
| Miner inclusion incentive was weak | Priority fees are added to implicit miner reward. |
| First-seen mempool pinning | Bounded conflicts may coexist; miner chooses by priority policy. |
| Raw TXID ordering grind | Fee priority first; parent-keyed hash only as tie-break. |
| Nostr JSON ambiguity | Strict duplicate-key rejection, exact event fields and canonical binary payloads. |
| Nonce text underspecified | Canonical decimal `u64`; third tag field is fixed NIP-13 gate commitment. |
| Fixed difficulty could not sustain a public chain | Full 256-bit ASERT-derived target with 15-second target spacing and genesis-bound parameters. |
| Height ceased to represent work under adaptive difficulty | Fork choice uses exact cumulative work derived from each required target. |
| Timestamp semantics were absent | MTP-11, 120-second contextual future bound and integer-only ASERT ancestry rules. |
| Small-network launch could start too hard | MVP initial target is easy and ASERT may relax only up to a genesis-bound PoW limit. |
| CacheWalk was previously described inconsistently | CacheWalk R1 is active v0 consensus; post-start hardware resistance remains experimental. |
| Full-node mining required opt-in | READY full nodes mine automatically by default; opt-out is policy. |
| Missing-data high-work block could seize tip | Missing TX data never activates; exact dependencies must be available/state-valid. |
| Same-block order affected execution | All transactions validate against parent state; child spends wait one block. |
| Fee/supply arithmetic overflow | Exact `bigint` aggregate arithmetic and explicit bounds. |
| Invalid output keys | Every x-only owner must be a valid BIP340 point. |
| Fresh-node bootstrap could become trusted | Genesis is the trust anchor; relay seeds are replaceable hints; all history/state/work is verified locally. |
| One relay could eclipse history by omission | Multi-relay retrieval, exact-ID fetch and no trust in EOSE/tip claims. |
| Wallet was only a developer utility | MVP wallet creates/imports protected keys, queries UTXOs, sends payments and supports NIP-49/NIP-46. |
| Key storage risk | No wallet key in node DB; encrypted local or remote signer backends. |
| Public release had no immutable bundle | Genesis, relay hints, vectors, source revision and checksums are explicit artifacts. |
| Future consensus changes could be silent | Every consensus change requires an explicit protocol revision/activation rule. |
| Archive/application roadmap threatened Core | Post-MVP NBPs remain outside native-money consensus. |

No unresolved architectural blocker remains for implementing the v0 minimum-viable blockchain.


## 61. Definition of done

The architecture is implementation-ready when developers can answer from this document, without inventing consensus rules:

```text
What exact bytes are signed?
What exact bytes form a transaction/genesis?
What tags are legal?
How are fees split?
What creates/destroys supply?
When is a reward spendable?
What state does each transaction validate against?
What timestamp makes a block eligible?
How is median time past computed?
How is the exact required CacheWalk target computed?
How much work does each block contribute?
How is cumulative work compared across forks?
What happens on equal work?
What happens when parent/TX data is missing?
Who may mutate active UTXOs?
How is a reorg crash-safe?
How does a fresh node bootstrap without trusting a relay?
How are historical TX bodies retrieved?
How does a user create/protect a wallet key and send a payment?
When does a full node mine automatically?
How are expensive invalid blocks rate-limited without redefining validity?
What does restart/reindex/replay reproduce?
What files define a canonical network release?
How can future consensus rules activate without silently changing v0?
What remains a post-MVP NBP?
```

The **software** is a working minimum-viable blockchain when Section 49 passes and a fresh fourth node can independently reconstruct the same greatest-work monetary state from canonical genesis plus untrusted relay sources.

The next engineering action is Phase 0: implement codecs, CacheWalk, ASERT, genesis tooling and the neutral conformance corpus, then proceed directly through the development gates.


---

---

# Appendix A — CacheWalk R1 Post-Start Experimental Review

**Status:** active v0 consensus. Hardware-specialization evaluation occurs after implementation and chain start.

CacheWalk R1 is judged as its own experimental construction. No comparison against another PoW is a prerequisite for implementation, genesis creation, interoperability or MVP operation.

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

