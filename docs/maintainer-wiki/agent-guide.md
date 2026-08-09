# Agent Guide

Use [`AGENTS.md`](../../AGENTS.md) as the repository policy entrypoint.

This wiki supplements, but does not override, repository policy. Durable facts belong here; short-lived local task context belongs in [`.kilocode/rules/memory-bank/`](../../.kilocode/rules/memory-bank/).

## Current operating assumptions

- The repository is not yet a runnable Node.js project.
- The architecture spec is the primary substantive source.
- Build, lint, test, and dev commands must not be invented.
- Consensus and chainstate boundaries documented in the architecture spec must be preserved.

## Indexed repository context

When refreshing Carbon Memory, treat the following as primary entrypoints:

- [`AGENTS.md`](../../AGENTS.md)
- [`README.md`](../../README.md)
- [`docs/Nostr_Blockchain_Reference_Node_Architecture.md`](../Nostr_Blockchain_Reference_Node_Architecture.md)
- [`docs/maintainer-wiki/index.md`](index.md)

