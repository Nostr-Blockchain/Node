# Nostr Blockchain v0 — Production Readiness Audit

**Audited artifact:** `Nostr_Blockchain_v0_Production_Network_Specification.md`  
**Purpose:** record the launch-blocking defects found in previous drafts, the production decisions now frozen, the test evidence required from the implementation, and the risks a specification cannot eliminate by itself.

## 1. Result

The previous `...Mainnet_Specification_FINAL.md` should not be used for implementation.

It mixed an approved single-process full-node architecture with later operational regressions, including separate mandatory relay processes, mainnet-specific command families, stale discovery schema, incomplete wallet construction rules, and insufficient protection against cross-network/operator mistakes.

The replacement production specification is organized around:

```text
one executable
+ explicit --network mainnet|testnet
+ one full-node process
+ embedded restricted archival Nostr relay
+ outbound multi-relay client
+ deterministic consensus
+ deterministic persistence/reorg behavior
+ public testnet staging
+ one-time public network launch
+ automated release gates
```

## 2. Critical regressions removed

| Previous defect | Production resolution |
|---|---|
| Full node and relay launched as separate mandatory processes | Embedded relay is mandatory inside the standard full-node process and starts automatically |
| “3 nodes + 3 relays” acceptance topology | Three full-node processes; each has its own embedded relay |
| `npm run nb -- ...` exposed as the public interface | Public binary is `nostr-blockchain` |
| Separate `mainnet start`, `testnet start` command families | All stateful operations use explicit `--network mainnet|testnet` |
| Mainnet/testnet could be confused with chain identity | Network selector chooses immutable NetworkParams; genesis event ID remains chain ID |
| Same data directory could accidentally be used for another network | Separate defaults plus network + chain ID persisted in DB; mismatch is fatal |
| Custom chain-specific node-announcement event introduced | Removed; discovery uses bootstrap hints, persisted relays and standard NIP-65 relay lists |
| Stale `node_announcements` database table remained after protocol removal | Removed |
| Bootstrap relays looked like separate infrastructure | Bootstrap WSS URLs are normally the embedded relay endpoints of initial full nodes |
| No relay-island propagation rule | Full nodes rebroadcast fully validated original signed events across overlapping relay sets |
| EOSE risked being treated as history completeness | EOSE is explicitly non-authoritative; exact parent-ID walking and optional NIP-77 are used |
| No exact deterministic wallet-selection algorithm | Exact UTXO sort, fee/change cases, small-remainder behavior and output order are specified |
| Zero-change edge case was ambiguous | Explicit one-output/change cases prevent zero or negative outputs |
| Launch output paths were arbitrary | `launch --network` writes fixed `networks/<network>.json` and `networks/<network>-genesis.json` |
| Genesis nonce/timestamp search was underspecified | Timestamp fixed per search generation; nonce starts at 0 and increments canonically |
| Normal block candidate timestamp was underspecified | `max(now, MTP(parent)+1)` with clock-behind pause is frozen |
| Launch could leave descriptor/genesis partially written | Temp-file + fsync/flush + atomic-rename style artifact publication and reopen verification |
| No unattended secure signer-start mechanism | Protected `--signer-password-file` path; secret itself never appears in process arguments |
| Local embedded relay could accidentally satisfy its own connectivity policy | Self endpoint does not count as a remote relay for READY/mining |
| Mainnet automated conformance could risk touching the real network | Conformance is loopback-only, temporary, never connects to public bootstrap URLs |
| No protection against a fresh node declaring READY on obviously stale release-era history | Optional non-consensus `minimum_known_chainwork` release floor |
| Mining thermal/power behavior disappeared during rewrite | Restored as explicit local policy with visible pause/throttle reasons |
| Same NIP-01 event ID with different valid signatures was unspecified | Event ID is storage/consensus identity; first valid representation may be retained |
| Test-only shortcuts risked leaking into production consensus | Accelerated test NetworkParams are dependency-injected and unavailable through production CLI |
| Invalid-signature first arrival could poison a valid Nostr event ID | Representation-invalid observations cannot globally poison an ID; only intrinsic invalidity can |
| Wallet could accidentally select >32 inputs | Deterministic selection is capped at 32; largest-32 insufficiency fails cleanly |
| One-host relay discovery could become an eclipse concentration point | Relay-pool diversity/anchor/randomization policy added |
| Control socket was merely described as local | Owner-only control/data permissions are mandatory because control can unlock/sign/send |
| Public conformance could theoretically leak a generated branch | Conformance is explicitly loopback-only and never connects to public bootstraps |

## 3. Frozen public networks

### Mainnet

```text
network selector             mainnet
display asset                NSR
decimals                     8
block reward                 50.00000000 NSR
reward maturity              240 blocks
target block interval        15 seconds
initial CacheWalk difficulty 10
difficulty window            120 blocks
difficulty step              max +/-1 bit/window
NIP-13 prefilter             6 bits
base fee                     1000 base units
input fee                    250 base units
output fee                   500 base units
max inputs                   32
max outputs                  32
max transactions/block       64
embedded relay default port  7447
mining default               continuous
workers default              1
```

### Testnet

Testnet uses the same v0 transaction/state/economic rules, with:

```text
network selector             testnet
display asset                tNSR
initial CacheWalk difficulty 4
embedded relay default port  17447
```

Its genesis and chain ID are independent from mainnet.

## 4. Production consensus decisions made deliberately

These are no longer accidental side effects of an operational rewrite.

### Adaptive PoW difficulty

A fixed difficulty is unsuitable for a public PoW network whose aggregate mining power can change significantly. v0 therefore uses a deterministic 120-block retarget around a 15-second target, bounded to one difficulty bit per window.

This changes consensus relative to the early fixed-difficulty prototype. It is explicit, vector-tested and frozen before genesis.

### Consensus block time

Because difficulty uses elapsed chain time, block `created_at` has deterministic MTP validity rules. Transaction `created_at` remains non-monetary metadata.

### 240-block reward maturity

At the target interval this is approximately one hour. The purpose is to stop freshly mined rewards from immediately becoming liquid during shallow launch-period reorganizations while keeping initial mining usable.

The value is consensus and is identical on mainnet/testnet. It is not an operator setting.

### Mainnet difficulty 10 / testnet difficulty 4

Mainnet difficulty is frozen at 10. Testnet starts lower to make public staging practical.

Before mainnet genesis, the implementation must benchmark the mainnet profile on the actual initial mining hardware. If aggregate expected interval is outside the specified broad sanity band, launch is stopped; the protocol must be explicitly amended/retested rather than auto-tuning genesis.

### Perpetual 50 NSR block reward

The specification keeps the previously selected 50 NSR fixed reward model. It does not import Bitcoin's halving schedule or supply cap.

This is a monetary-policy choice, not an implementation accident.

## 5. Consensus-engineer viewpoint

The implementation is not conforming until these produce identical results independently:

```text
NIP-01 IDs
BIP340 verification
genesis binary decoding
CacheWalk vector
MTP
difficulty
transaction parsing
fee arithmetic
UTXO transitions
reward maturity
chainwork
fork choice
reorg undo/apply
supply
UTXO digest
state hash
```

The independent reference-vector verifier must not import production consensus functions.

## 6. Network-engineer viewpoint

The principal non-obvious risk is that Nostr relays do not automatically form a blockchain gossip mesh.

The production design therefore requires full nodes to rebroadcast an unchanged signed event after validation.

A required test proves:

```text
Node A -> Relay A
             |
             v
           Node B -> Relay B
                        |
                        v
                      Node C
```

where C receives A's original event even though C never connected to Relay A.

Nodes must treat all relay information as untrusted.

Fresh synchronization is:

```text
live subscription
+ recent candidate probe
+ exact parent walk
+ exact transaction fetch
+ local validation
+ optional NIP-77 reconciliation
```

## 7. Storage-engineer viewpoint

Release blockers include:

```text
two processes opening one data dir
half-applied block transition
half-applied reorg
wrong-network DB
wrong-genesis DB
unknown schema version
disk full
WAL crash recovery
corrupt metadata
reindex disagreement
replay disagreement
```

All active consensus state writes go through one ChainExecutor.

Reorg is one SQLite transaction.

Side-branch validation is in-memory until the branch wins.

## 8. Miner viewpoint

The full node mines automatically only when:

```text
READY
signer unlocked
mode = continuous
>= 1 remote write-capable relay
clock acceptable
storage healthy
```

The embedded self-relay does not satisfy the remote-connectivity requirement.

Worker threads never receive the private key.

A worker winner is re-derived in the main process before signing.

Tip/difficulty changes invalidate old mining generations.

Thermal/power throttling is visible local policy.

## 9. Wallet viewpoint

Wallet correctness is consensus-adjacent because a bug can destroy funds even if the node remains consensus-correct.

The production specification therefore fixes:

```text
base-unit parsing
8-decimal limit
recipient validation
spendable vs immature balance
UTXO sort order
selection
minimum burn
requested priority
small remainder handling
change amount
output order
input canonicalization
self-verification before broadcast
```

Mainnet and testnet balances never mix even if the same pubkey is used.

## 10. Operator viewpoint

Normal use is intentionally short.

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

A public bootstrap full node adds relay TLS/listen parameters during `init`.

There is no normal separate relay process.

`doctor --network ...` is the preflight diagnostic.

For unattended service startup, signer credentials are supplied by a protected runtime credential file path; the secret itself never appears in process arguments or persistent config.

## 11. Security viewpoint

Required defenses include:

```text
strict raw JSON duplicate-key rejection
cheap validation before CacheWalk
bounded orphan/missing queues
bounded relay filters/subscriptions
bounded mempool/conflicts
expensive-invalid-source throttling
cross-network replay rejection
encrypted signer key
no secret in worker threads
no password in command line
release checksum/signature process
independent genesis verification
loopback-only automated conformance
```

No relay, bootstrap host, website, DNS record, launcher key, or release server becomes a consensus authority.

## 12. Release-engineer viewpoint

A green TypeScript build is not readiness.

Required evidence spans:

```text
unit
consensus
CacheWalk
difficulty
wallet
SQLite
embedded relay
synchronization
reorg
functional
crash
fuzz
cross-network
independent vectors
public testnet soak
mainnet preflight
```

Mainnet genesis is not created until the public testnet gate is satisfied.

## 13. What “Bitcoin-level readiness” can and cannot mean

The implementation can target a mature-node engineering standard:

```text
deterministic chain parameters
explicit network selection
immutable genesis identity
adversarial parsing
chainwork fork choice
crash-safe state
full validation
network isolation
public staging network
fuzz/functional/crash tests
release gates
operator diagnostics
reproducible release artifacts
```

It cannot instantly acquire:

```text
Bitcoin's years of mainnet history
Bitcoin's accumulated PoW/security budget
Bitcoin's number of independent implementations/reviewers
Bitcoin's mining ecosystem
Bitcoin's liquidity
Bitcoin's long-term adversarial battle testing
```

Those are earned after launch.

## 14. Residual pre-mainnet risks

The following remain genuine even with a complete implementation.

### CacheWalk hardware economics

CacheWalk correctness can be tested deterministically. Its CPU/GPU/FPGA/ASIC economics cannot be proven from code review alone.

Mitigation:

```text
public testnet measurements
x86-64 and ARM64 benchmarks
GPU attempt
reduced-memory attempt
thermal tests
invalid-work flood tests
post-launch monitoring
```

### Initial network hash rate

The actual mainnet miner set is unknown before launch.

Mitigation: mandatory mainnet-profile preflight benchmark and bounded retarget.

### Nostr relay availability/censorship

Relays may omit events or disappear.

Mitigation:

```text
embedded relay in every standard full node
multiple outbound relays
rebroadcast
exact-ID fetch
persistent relay candidates
NIP-65 discovery
manual --relay recovery
```

### Single reference implementation risk

A single codebase can implement the same bug in producer and validator.

Mitigation:

```text
independent vector verifier
public testnet
external review
eventually a second independent validator implementation
```

A second independent implementation is strongly recommended after v0 launch stabilization.

## 15. Go/no-go rule

Do not launch mainnet because the program starts.

Launch only when:

```text
the exact release passes all automated gates
the exact release has survived the public testnet gate
mainnet profile benchmark is sane
canonical genesis is independently verified
final binaries are rebuilt after genesis ID is frozen
three initial full nodes reach READY with embedded relays
remote connectivity is verified before signer unlock
block 1 propagates
all initial nodes converge on chainwork/supply/UTXO/state hash
```

If any consensus/state hash differs, the launch stops.

That is the operational standard encoded by the replacement specification.
