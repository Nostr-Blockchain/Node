# Workflows

## Documentation update workflow

1. Treat repository evidence as the source of truth.
2. Prefer durable updates in [`docs/maintainer-wiki/`](./) for facts that should persist.
3. Keep [`.kilocode/rules/memory-bank/`](../../.kilocode/rules/memory-bank/) short, local-only, and noncanonical.
4. Update [`index.md`](index.md) whenever a maintainer wiki page is added or removed.

## Carbon Memory workflow for this repository

1. Durable layer: [`docs/maintainer-wiki/`](./).
2. Volatile layer: [`.kilocode/rules/memory-bank/`](../../.kilocode/rules/memory-bank/).
3. Indexed context layer: repository entrypoints such as [`AGENTS.md`](../../AGENTS.md), [`README.md`](../../README.md), and [`.understand-anything/knowledge-graph.json`](../../.understand-anything/knowledge-graph.json).

## Validation commands

No repository-defined documentation validation command currently exists.

Do not invent commands such as `npm run docs:check`, `npm test`, or `npm run build` unless a manifest or tool configuration is later added to the repository.

## Implementation-boundary workflow

Until code exists, documentation changes should preserve the architectural constraints in [`docs/Nostr_Blockchain_Reference_Node_Architecture.md`](../Nostr_Blockchain_Reference_Node_Architecture.md) and the repository guardrails in [`AGENTS.md`](../../AGENTS.md).

