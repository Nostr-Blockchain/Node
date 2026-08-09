# Decision Log

| Date | Decision | Rationale | Evidence |
| --- | --- | --- | --- |
| 2026-08-09 | Adopt standard maintainer wiki baseline for Carbon Memory. | The repository already had agent guidance and volatile memory, but lacked the durable wiki layer required by the Carbon Memory workflow. | [`AGENTS.md`](../../AGENTS.md), [`docs/Nostr_Blockchain_Reference_Node_Architecture.md`](../Nostr_Blockchain_Reference_Node_Architecture.md) |
| 2026-08-09 | Treat the repository as a specification-first skeleton, not as a runnable Node.js project. | No implementation files, package manifest, lockfile, tests, or tool configuration are present at the repository root. | [`AGENTS.md`](../../AGENTS.md), [`README.md`](../../README.md) |
| 2026-08-09 | Use the direct Understand Anything fallback instead of the slash-command route. | The host exposed [`/init`](../../README.md) but not the [`/understand`](../../README.md) alias, so repository indexing proceeded through the installed skill scripts. | [`.understand-anything/intermediate/scan-result.json`](../../.understand-anything/intermediate/scan-result.json) |

