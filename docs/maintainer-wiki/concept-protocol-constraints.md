# Concept: Protocol Constraints

The current repository does not implement protocol logic yet, but the architecture specification already establishes constraints that future work must preserve.

## Key constraints

- Only the `ChainExecutor` may mutate active chainstate.
- Consensus logic must remain pure and deterministic.
- Nostr transport is untrusted input; relay acceptance never implies validity.
- The reference node should remain single-process unless the repository later documents a change.
- Persistent storage should be one SQLite database with crash-safe transactions and rebuildable derived state.
- The node should not store ordinary user spending keys.

## Evidence

These constraints are stated in [`docs/Nostr_Blockchain_Reference_Node_Architecture.md`](../Nostr_Blockchain_Reference_Node_Architecture.md:57) and summarized in [`AGENTS.md`](../../AGENTS.md:10).

