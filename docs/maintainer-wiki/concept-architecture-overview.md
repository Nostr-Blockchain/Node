# Concept: Architecture Overview

## Repository type

The repository is currently a specification-first skeleton for a Nostr-native blockchain reference node.

## Present top-level structure

- [`docs/`](../) — durable project documents, currently dominated by the reference-node architecture specification.
- [`.kilocode/`](../../.kilocode/) — local agent rules and volatile memory bank.
- [`AGENTS.md`](../../AGENTS.md) — repository operating guidance for agents.
- [`README.md`](../../README.md) — title stub only.

## Reference-node architecture from the specification

The specification describes a single-process node composed conceptually of:

- relay/network ingestion
- event firewall
- mempool
- block DAG
- a single-writer [`ChainExecutor`](../Nostr_Blockchain_Reference_Node_Architecture.md)
- SQLite persistence
- optional mining and embedded relay features

The central architecture boundary is that only the chain-execution path may mutate active chainstate. Networking, mining, and mempool components must remain read-only with respect to active chainstate.

## Proposed future source tree

The specification proposes a future layout under [`src/`](../Nostr_Blockchain_Reference_Node_Architecture.md:179) with modules for consensus, crypto, state, chain, storage, mempool, nostr, mining, node, cli, and tests. That tree is design intent only and is not yet implemented in this repository.

## External dependencies described by the spec

- Nostr relay transport over WebSockets
- BIP340/Schnorr verification
- SQLite as the persistent store
- optional mining workers and signer boundary

