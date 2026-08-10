# AGENTS.md

This file provides guidance to agents when working with code in this repository.

- This repository is currently specification-first: the only substantive source is [`docs/Nostr_Blockchain_v0_Prototype_Architecture_Specification_MAIN.md`](docs/Nostr_Blockchain_v0_Prototype_Architecture_Specification_MAIN.md). Do not invent package managers, scripts, tests, CI, or runtime files that are not checked in.
- The intended implementation target is TypeScript on Node.js, but that is design intent from the spec, not an implemented stack yet; treat build/lint/test commands as undefined until manifests exist.
- If implementation begins, preserve the spec’s central invariant: only [`ChainExecutor`](docs/Nostr_Blockchain_v0_Prototype_Architecture_Specification_MAIN.md) may mutate active monetary state; validators, mempool, miners, relays, and parsers must stay pure or read-only around chainstate.
- Consensus payload rules are stricter than typical Nostr handling: duplicate JSON keys must be rejected before semantic parsing, chain events must contain exactly 7 top-level fields, and consensus hex must be lowercase, even-length, and exact-width.
- Consensus arithmetic must never use JavaScript `number` for fees, amounts, rewards, supply, or nonce math; the spec requires exact integer handling with `bigint`/fixed-width decoding.
- `npub` is UI/transport only. Consensus ownership is always raw 32-byte BIP340 x-only public keys.
- v0 forbids same-block child spends and requires parent-state-only transaction validation. Do not introduce intra-block dependency logic.
- Fork choice is fixed-difficulty and sticky on ties: equal-work branches must not trigger reorg; lexical tip ordering is only for fresh-bootstrap local selection.
- Full-node mining is intended to be enabled by default on entering `READY`, but worker threads must never receive miner private key material; the main process revalidates winning work before signing.
- The recommended CLI surface from the spec is local-only (`status`, `balance`, `utxos`, `block`, `tx`, `mempool`, `mine-one`, `verify`, `reindex`, `replay`); avoid designing a general remote RPC by default.
