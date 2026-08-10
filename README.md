# Nostr Blockchain

**Experimental minimum-viable permissionless blockchain built on Nostr events.**

Nostr Blockchain uses ordinary Nostr signed events as its native transaction and block objects, Nostr relays as its external communication layer, BIP340 x-only public keys as monetary identities, and proof of work to establish an independently verifiable monetary history.

> **Experimental software. Do not treat the network, wallet, keys, coins, mining algorithm, or economic parameters as production-ready or suitable for meaningful real-world value.**

The current milestone is a public experimental MVP: anyone should be able to run a full node, independently reconstruct and validate the chain from genesis, mine with a commodity CPU, receive and send native coins, recover from forks and restarts, and determine the objectively greatest-work valid chain without trusting a relay or another node.

---

## What makes it different

Nostr Blockchain does not put a conventional blockchain networking protocol beside Nostr.

Nostr **is** the external communication layer.

```text
wallet / miner / full node
          |
          v
      Nostr events
          |
          v
     Nostr relays
          |
          v
 independent validation
          |
          v
      active chain
```

Core identities remain Nostr/BIP340 keys.

Transactions are signed Nostr events.

Blocks are signed Nostr events.

Transaction IDs and block IDs are their ordinary NIP-01 event IDs.

Relays transport and store events, but they are not consensus authorities.

---

## Current status

Architecture status:

```text
Minimum-viable public-network architecture frozen
```

Implementation target:

```text
TypeScript
Node.js 24 LTS
SQLite
Nostr WebSocket relays
```

The previous fixed-difficulty prototype passed its acceptance suite. The MVP extends that baseline with public-network requirements such as adaptive difficulty, cumulative-work fork choice, production timestamp rules, fresh-node bootstrap, stronger resource handling, and a minimum usable wallet surface.

The authoritative architecture and consensus specification is:

```text
Nostr_Blockchain_Minimum_Viable_Blockchain_Architecture_Specification.md
```

When implementation behavior and informal documentation disagree, the architecture specification wins.

---

## Core properties

The v0 MVP is designed around the following properties:

- Nostr/BIP340 public keys are monetary identities.
- NIP-01 events are the native transaction and block objects.
- NIP-01 event IDs are transaction IDs and block IDs.
- Native currency uses a deterministic UTXO state model.
- One transaction signature authorizes all inputs owned by its event pubkey.
- Blocks use Nostr CacheWalk R1 proof of work.
- CacheWalk keeps the normal NIP-01 block event ID as block identity.
- A small NIP-13-compatible gate provides cheap early PoW filtering.
- Target block spacing is approximately 15 seconds.
- Difficulty adjusts deterministically using integer-only ASERT-style arithmetic.
- Fork choice uses greatest cumulative validated work, not height.
- Mining rewards are implicit; there is no coinbase transaction.
- Minimum transaction fees are burned.
- Fee above the minimum is a miner priority fee.
- Mining rewards mature before they can be spent.
- Same-block child spends are intentionally forbidden in v0.
- Nostr relays are untrusted transport and storage.
- Fresh nodes can reconstruct chainstate from canonical genesis and untrusted relay data.
- Full-node mining is enabled continuously by default as local policy.
- Mining workers never receive the miner's private signing key.
- Consensus state can be deterministically replayed and reindexed.

---



## Currency denomination

The native coin is **NSR** and its smallest indivisible unit is **nos**.

```text
1 NSR = 100,000,000 nos
1 nos = 0.00000001 NSR
```

All consensus monetary values are integer `nos`. `NSR` is the human-facing decimal denomination.

Examples:

```text
50 NSR          = 5,000,000,000 nos
1 NSR           =   100,000,000 nos
0.01 NSR        =     1,000,000 nos
0.00000001 NSR  =             1 nos
```

Wallets and nodes must never use floating-point arithmetic for money. Decimal NSR input is parsed exactly to `nos`, with at most eight fractional digits and no rounding.

---

## CacheWalk R1

CacheWalk R1 is the active experimental v0 proof-of-work function.

A candidate block follows this path:

```text
NIP-01 block event
        |
        v
normal NIP-01 event ID E
        |
        v
small NIP-13 leading-zero gate
        |
        v
256 KiB ChaCha20-derived mutable scratchpad
        |
        v
two dependent memory-walk passes
        |
        v
SHA-256 cpu_work_hash
        |
        v
required adaptive target
```

The block ID remains:

```text
block.id = NIP-01 event ID
```

The CacheWalk result is derived validation data and is not serialized as a second block identifier.

CacheWalk is intentionally experimental. The project does **not** claim CPU-only execution or permanent resistance to GPUs, FPGAs, ASICs, botnets, or future specialized implementations. Hardware behavior will be measured and attacked experimentally after the chain is running.

---

## Mining

Mining is built into the full node.

For the full-node profile, the default mode is:

```text
continuous
```

A node mines when it is synchronized and in the `READY` lifecycle state, a signer is available, and the operator has not disabled mining.

Reference policy starts conservatively with one low-priority mining worker.

Supported modes:

```text
continuous   # default
disabled     # operator opt-out
mine-one     # deterministic development/testing
```

Useful commands:

```text
nostr-chain-node mining
nostr-chain-node mine-one
nostr-chain-node status
```

Mining pauses when the node is not ready, the signer is unavailable, consensus/storage has failed, or required network policy conditions are not met.

---

## Node commands

The minimum local administrative surface is:

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

`status` should expose at least:

```text
chain ID
active tip
height
cumulative work
required next target
recent median block interval
derived total supply
UTXO digest
relay health
mining status
```

---

## Wallet

The MVP includes a separate wallet utility.

```text
nostr-chain-wallet new
nostr-chain-wallet import <nsec|ncryptsec>
nostr-chain-wallet address
nostr-chain-wallet balance
nostr-chain-wallet utxos
nostr-chain-wallet send <npub|hex-pubkey> <amount-NSR> [--priority-fee-nos N]
nostr-chain-wallet tx <id>
nostr-chain-wallet history
nostr-chain-wallet export-encrypted
nostr-chain-wallet signer-connect <nip46-token>
```

The wallet is responsible for:

- generating/importing a BIP340 key;
- displaying the corresponding `npub`;
- querying spendable UTXOs in integer `nos` and displaying them as NSR;
- parsing decimal NSR amounts exactly into integer `nos`;
- calculating the minimum burn in `nos`;
- optionally adding a priority fee in `nos`;
- calculating change;
- constructing the exact binary transaction payload;
- creating and signing the NIP-01 transaction event;
- publishing to multiple configured relays;
- tracking pending and confirmed payments.

Private wallet keys must never be written to the node's chainstate database.

Local encrypted wallet storage uses NIP-49 `ncryptsec` when enabled. NIP-46 may be used for remote or hardware signing.

---

## Fees

For every transaction:

```text
ACTUAL_FEE
=
sum(inputs) - sum(outputs)
```

Consensus requires:

```text
ACTUAL_FEE >= MINIMUM_BURN
```

where all values are integer `nos` and the minimum burn is determined by consensus fee parameters.

The difference is:

```text
PRIORITY_FEE
=
ACTUAL_FEE - MINIMUM_BURN
```

The minimum fee is destroyed.

The priority fee is paid to the miner of the confirming block.

There is no explicit tip field in a transaction; wallets create the desired fee by adjusting change.

---

## Block rewards and supply

There is no coinbase transaction.

Every valid non-genesis block implicitly creates one reward UTXO owned by the block's miner:

```text
fixed block reward (nos)
+
sum(priority fees in nos)
```

The reward output is derived from the block and does not appear as an ordinary transaction.

Minimum transaction burns reduce supply.

Priority fees transfer already-existing value and do not create new supply.

The implementation must be able to deterministically derive total supply from validated chain history.

---

## Nostr networking

The blockchain communicates externally through Nostr relays.

A fresh node starts with:

```text
canonical genesis.json
chain ID derived from genesis
bootstrap relay hints and/or operator-supplied relays
```

The node then:

1. connects to multiple relays;
2. retrieves candidate block events for the chain;
3. resolves missing parents by exact event ID;
4. validates timestamps and proof of work;
5. resolves referenced transactions by exact ID;
6. independently executes candidate branches;
7. computes cumulative work;
8. selects the greatest-work state-valid chain.

A relay can censor, omit, delay, replay, reject, or delete events.

Therefore:

```text
relay response != consensus truth
EOSE != proof of complete history
bootstrap relay != trust anchor
```

Only local cryptographic and state validation determines chain validity.

---

## Trust model

Everything received from a relay is attacker-controlled until validated.

```text
UNTRUSTED BYTES
    |
    v
AUTHENTICATED NIP-01 EVENT
    |
    v
STRUCTURALLY VALID CHAIN OBJECT
    |
    v
TIME / POW VALID OBJECT
    |
    v
STATE-VALID OBJECT
    |
    v
ACTIVE MONETARY STATE
```

The node is expected to use multiple relays, bounded dependency queues, exact-ID retrieval, duplicate filtering, resource caps, and per-peer expensive-validation budgets.

---

## Fresh-node verification

A critical MVP requirement is that a completely fresh node can join without trusting an existing node's state.

Given only the canonical genesis and relay hints, it must be able to:

```text
download candidate history
        |
        v
validate all relevant Nostr events
        |
        v
validate CacheWalk and difficulty
        |
        v
reconstruct UTXO state
        |
        v
calculate cumulative work
        |
        v
select the best valid branch
```

No trusted snapshot is required for correctness.

---

## Replay and deterministic state

Offline deterministic replay is a first-class diagnostic path:

```text
nostr-chain-node replay <events.ndjson>
```

Replay must not treat file order as blockchain order.

Given the same event set and a unique greatest-work state-valid tip, independent conforming implementations should derive the same:

```text
chain ID
active tip
height
cumulative work
next required target
UTXO set
UTXO digest
supply
invalid objects
pending dependencies
```

The diagnostic UTXO digest is not itself consensus; it exists to make cross-node and cross-implementation comparison easy.

---

## Canonical release artifacts

A public experimental network release should include:

```text
genesis.json
genesis event ID / chain ID
bootstrap-relays.json
consensus conformance corpus
CacheWalk vectors
ASERT vectors
software version
source revision
SHA-256 checksums
```

Once a network is launched, its `genesis.json` and consensus vectors are immutable historical artifacts.

Bootstrap relay hints may change without changing consensus.

---

## Minimum acceptance test

The public experimental MVP is considered functionally working only after the automated suite proves at least:

- all previous prototype regression tests still pass;
- CacheWalk conformance vectors pass;
- adaptive target vectors pass;
- cumulative-work fork choice works across changing difficulty;
- reward maturity and fee rules pass;
- ordinary payments confirm;
- double spends are resolved by confirmed chainstate;
- three independent nodes mine and synchronize;
- deliberate partitions produce forks;
- nodes converge to the greatest-work branch after reconnection;
- restart does not corrupt consensus state;
- reindex/replay reconstruct identical state;
- malformed and expensive invalid input does not corrupt the node;
- a fourth empty node bootstraps from genesis and untrusted relays;
- the wallet can create, sign, publish and confirm a payment.

At final convergence:

```text
A.tip        == B.tip        == C.tip        == D.tip
A.chainwork  == B.chainwork  == C.chainwork  == D.chainwork
A.supply     == B.supply     == C.supply     == D.supply
A.state_hash == B.state_hash == C.state_hash == D.state_hash
```

---

## Experimental network warning

This project is intended to be published and operated as an experiment.

Passing the functional acceptance suite demonstrates that the implementation behaves according to the current architecture under tested conditions. It does **not** demonstrate:

- production-grade economic security;
- long-term stability of CacheWalk against specialized hardware;
- safe use for material financial value;
- resistance to every network-level denial-of-service attack;
- formally verified consensus code;
- audited wallet/key-management security;
- mature upgrade governance.

Do not market experimental coins as investment products or imply guarantees of value, liquidity, safety, or future compatibility.

---

## Not in the MVP

The following are intentionally outside the minimum viable native-money blockchain:

```text
general smart-contract VM
staking
on-chain governance
application-specific consensus
global names
fungible user-issued tokens
NFT / owned-object engines
games
AI-agent semantics
adaptor swaps
payment channels
archive markets
storage markets
bridges
trusted snapshots
```

These may be introduced later only through explicit proposals without weakening the core consensus boundary.

---

## Development rule

The architecture specification is the implementation contract.

Do not silently change consensus because another design appears more convenient during coding.

If implementation exposes a genuine consensus ambiguity:

1. identify the exact conflicting rules;
2. stop treating the behavior as an implementation detail;
3. resolve it explicitly in the specification;
4. add a deterministic conformance vector;
5. only then update the implementation.

Non-consensus implementation details may evolve normally.

---

## Security

Please do not use the experimental network to hold meaningful value.

Security reports should include:

```text
affected version / commit
reproduction steps
expected behavior
actual behavior
whether consensus divergence is possible
whether funds or private keys are at risk
```

Consensus divergence, invalid coin creation, unauthorized spending, private-key exposure, remote code execution, persistent state corruption, and reliable network-wide denial of service should be treated as high-severity issues.

---

## Protocol philosophy

Nostr Blockchain intentionally keeps the consensus kernel narrow.

Nostr handles:

```text
identity
communication
discovery
transport
application data
```

The blockchain handles:

```text
scarce native money
canonical economic ordering
proof of work
UTXO ownership
irreversible settlement
```

Future application protocols should remain outside Core whenever two honest validators do not need the feature to agree on monetary validity.

The design principle is:

> **Most things remain off-chain and interoperable. Only scarce conflicts require consensus.**

---

## License

The implementation repository should declare its software license explicitly before public release.

The architecture specification and conformance artifacts should also state their applicable license so independent implementations can reuse them without ambiguity.
