# AGENTS.md

This file provides guidance to agents when working with code in this repository.

- This repository is specification-first, but it now also contains a checked-in TypeScript/Node.js prototype implementation with manifests, source, storage, CLI, and tests. Treat the authoritative source order as [`docs/Nostr_Blockchain_v0_Production_Network_Specification.md`](docs/Nostr_Blockchain_v0_Production_Network_Specification.md), then [`docs/Nostr_Blockchain_Minimum_Viable_Blockchain_Architecture_Specification.md`](docs/Nostr_Blockchain_Minimum_Viable_Blockchain_Architecture_Specification.md), then [`docs/Nostr_Blockchain_v0_Prototype_Architecture_Specification_MAIN.md`](docs/Nostr_Blockchain_v0_Prototype_Architecture_Specification_MAIN.md) as historical context only.
- The intended and partially implemented stack is TypeScript on Node.js with SQLite; use only checked-in commands and files rather than inventing missing tooling or runtime surfaces.
- Preserve the central invariant reflected in [`ChainExecutor`](src/chain/chain-executor.ts:1): only that execution path may mutate active monetary state; validators, mempool logic, miners, relays, parsers, and sync helpers must stay pure or read-only around chainstate.
- Consensus payload rules are stricter than typical Nostr handling: duplicate JSON keys must be rejected before semantic parsing, chain events must contain exactly 7 top-level fields, and consensus hex must be lowercase, even-length, and exact-width.
- Consensus arithmetic must never use JavaScript `number` for fees, amounts, rewards, supply, or nonce math; the spec requires exact integer handling with `bigint`/fixed-width decoding.
- `npub` is UI/transport only. Consensus ownership is always raw 32-byte BIP340 x-only public keys.
- v0 forbids same-block child spends and requires parent-state-only transaction validation. Do not introduce intra-block dependency logic.
- Fork choice is cumulative-work based and sticky on ties: equal-work branches must not trigger live reorg; lexical tip ordering is only for fresh-bootstrap initial selection.
- Full-node mining is intended to be enabled by default on entering `READY`, but only when the signer is unlocked and at least one remote write-capable relay is reachable; worker threads must never receive miner private key material, and the main process revalidates winning work before signing.
- The production spec's public CLI contract is the [`nostr-blockchain`](docs/Nostr_Blockchain_v0_Production_Network_Specification.md:77) executable with explicit [`--network mainnet|testnet`](docs/Nostr_Blockchain_v0_Production_Network_Specification.md:75) selection, integrated node/wallet/signer/mining commands, and no general remote RPC by default.
