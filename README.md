# Nostr Blockchain

**Specification-first Nostr-native blockchain reference node and protocol repository.**

Nostr Blockchain uses ordinary Nostr signed events as its native transaction and block objects, Nostr relays as its external communication layer, BIP340 x-only public keys as monetary identities, and proof of work to establish an independently verifiable monetary history.

> **Checked-in code is still a prototype subset.** The repository now carries a final production-network specification, but the implementation and test evidence in this checkout do not yet prove full conformance or mainnet readiness.

The current documentation milestone is the production-network contract for v0: a standard full node is one process containing consensus, UTXO state, SQLite persistence, mining, signer/wallet control, outbound relay clients, and an embedded restricted archival relay. The current checked-in codebase still represents only a narrower prototype subset of that contract.

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

Repository status:

```text
Sprints 1-12 are implemented in code/test scope; final post-simplification full-suite verification is still pending
```

Implementation target:

```text
TypeScript
Node.js 24 LTS
SQLite
Nostr WebSocket relays
```

The earlier prototype and MVP documents remain useful as design history and supporting architecture context, but they are no longer the top source of truth when they conflict with the production-network specification.

Recorded local automated evidence before the later simplification pass:

```text
npm run build                         PASS
npm run check                         PASS
npm test                              PASS 150/150
npm run test:reference-vectors        PASS 6/6
npm run test:functional               PASS 3/3
npm run test:reorg                    PASS 5/5
npm run test:crash                    PASS 2/2
npm run test:cross-network            PASS 2/2
npm run test:fuzz                     PASS 1/1
npm run test:relay                    PASS 5/5
npm run test:sync                     PASS 7/7
node dist/cli/main.js conformance --network testnet   PASS
node dist/cli/main.js conformance --network mainnet   PASS
```

Recorded post-simplification focused evidence after changes to [`src/conformance/harness.ts`](src/conformance/harness.ts) and [`src/cli/main.ts`](src/cli/main.ts):

```text
npm run build              PASS
npm run check              PASS
npm run test:functional    PASS 3/3
npm run test:relay         PASS 5/5
npm run test:sync          PASS 7/7
npm run test:crash         PASS 2/2
npm run test:cross-network PASS 2/2
npm run test:wallet        PASS 9/9
```

The final full-suite rerun of [`npm test`](package.json:17) after that simplification pass is still pending. An earlier first rerun exposed wallet CLI regressions that were then fixed, so this repository should currently claim focused affected-suite proof after simplification, not final full-suite post-simplification proof.

The top authoritative protocol, operational, launch, and conformance specification is:

```text
Nostr_Blockchain_v0_Production_Network_Specification.md
```

Supporting architecture decomposition remains in:

```text
Nostr_Blockchain_Minimum_Viable_Blockchain_Architecture_Specification.md
```

When implementation behavior and informal documentation disagree, the production-network specification wins.

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
- Difficulty adjusts in 120-block windows using exact integer bit-level retarget steps.
- Fork choice uses greatest cumulative validated work, not height.
- Mining rewards are implicit; there is no coinbase transaction.
- Minimum transaction fees are burned.
- Fee above the minimum is a miner priority fee.
- Mining rewards mature before they can be spent.
- Same-block child spends are intentionally forbidden in v0.
- Nostr relays are untrusted transport and storage.
- Fresh nodes can reconstruct chainstate from canonical genesis and untrusted relay data.
- Full-node mining is enabled continuously by default once the node is `READY`, its signer is unlocked, and at least one remote write-capable relay is reachable.
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

Reference public mining commands:

```text
nostr-blockchain mining --network mainnet|testnet --mode continuous|disabled|mine-one
nostr-blockchain signer unlock --network mainnet|testnet
nostr-blockchain status --network mainnet|testnet
```

Mining pauses when the node is not ready, the signer is unavailable, consensus/storage has failed, or required network policy conditions are not met.

---

## CLI contract

The production specification defines a single public executable:

```text
nostr-blockchain
```

Required command families include:

```text
version
launch / network-info
init / start / stop / status / doctor
signer unlock / signer lock
mining
wallet address / balance / utxos
send
block / tx / mempool
verify / reindex / replay
conformance
```

Every chain-reading or chain-mutating command requires explicit [`--network mainnet|testnet`](docs/Nostr_Blockchain_v0_Production_Network_Specification.md:75).

---

## Wallet

The production specification folds wallet control into the main CLI surface rather than requiring a separate public wallet binary.

```text
nostr-blockchain wallet address --network mainnet|testnet
nostr-blockchain wallet balance --network mainnet|testnet
nostr-blockchain wallet utxos --network mainnet|testnet
nostr-blockchain send --network mainnet|testnet --to <NPUB_OR_HEX> --amount <DECIMAL_NSR> [--priority-fee <DECIMAL_NSR>]
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

Local encrypted key storage uses NIP-49 `ncryptsec` by default; signer types currently frozen by the production spec are local encrypted storage and validator-only `none`, while NIP-46 remains an allowed future non-consensus extension.

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
bundled network descriptor
bundled canonical genesis event
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

A release intended to match the production specification should include at minimum:

```text
networks/mainnet.json
networks/mainnet-genesis.json
networks/testnet.json
networks/testnet-genesis.json
genesis event IDs / chain IDs
reference vectors and independent verifier
software version and source revision
SHA256SUMS and detached release signatures
SECURITY.md
```

Once a network is launched, its `genesis.json` and consensus vectors are immutable historical artifacts.

Bootstrap relay hints may change without changing consensus.

---

## Current repository-state caution

The checked-in prototype has strong local automated evidence through Sprint 12, but this repository should not claim public-network readiness until it can prove the stronger contract in [`docs/Nostr_Blockchain_v0_Production_Network_Specification.md`](docs/Nostr_Blockchain_v0_Production_Network_Specification.md:1), especially:

- official public [`networks/mainnet.json`](networks/mainnet.json) and [`networks/testnet.json`](networks/testnet.json) launch artifacts, which are still intentionally absent/prelaunch;
- final post-simplification full-suite [`npm test`](package.json:17) verification;
- public-network evidence beyond the recorded loopback-only conformance passes, where public bootstrap URLs contacted remained `0`;
- any broader launch/soak proof needed for a real public testnet or mainnet rollout;
- the release-harness [`NETWORK-CONFORMANCE: PASS`](docs/Nostr_Blockchain_v0_Production_Network_Specification.md:3604) gate as an end-to-end published release claim.

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
