# Concept: Carbon Memory

Carbon Memory in this repository has three layers:

1. Durable wiki: [`docs/maintainer-wiki/`](./)
2. Volatile local memory bank: [`.kilocode/rules/memory-bank/`](../../.kilocode/rules/memory-bank/)
3. Indexed repository context: entrypoint files and the Understand Anything output under [`.understand-anything/`](../../.understand-anything/)

## Command semantics for this repository

- "Initialize carbon memory" means create or refresh the maintainer wiki, local memory bank, and indexed repository context from repository evidence.
- "Update carbon memory" means incrementally refresh those layers without inventing new implementation details.

## Indexed sources for this repository

At minimum, Carbon Memory should index:

- [`AGENTS.md`](../../AGENTS.md)
- [`README.md`](../../README.md)
- [`docs/Nostr_Blockchain_Reference_Node_Architecture.md`](../Nostr_Blockchain_Reference_Node_Architecture.md)
- [`docs/maintainer-wiki/index.md`](index.md)

## Understand Anything route used during initialization

The preferred slash-command route was attempted first, but the host did not expose the understand alias. Initialization therefore used the direct installed-skill fallback, which generated [`.understand-anything/.understandignore`](../../.understand-anything/.understandignore) and [`.understand-anything/intermediate/scan-result.json`](../../.understand-anything/intermediate/scan-result.json), then recorded a minimal repository graph in [`.understand-anything/knowledge-graph.json`](../../.understand-anything/knowledge-graph.json).

## Safety rule

The memory bank is noncanonical. Durable project understanding must be preserved in this wiki and traced back to repository evidence.

