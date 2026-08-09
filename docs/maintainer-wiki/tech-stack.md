# Tech Stack

## Current repository reality

This repository does not yet contain an implemented application stack.

## Evidence-backed inventory

| Area | Current status | Evidence |
| --- | --- | --- |
| Primary artifact type | Markdown specification and agent documentation | [`docs/Nostr_Blockchain_Reference_Node_Architecture.md`](../Nostr_Blockchain_Reference_Node_Architecture.md), [`AGENTS.md`](../../AGENTS.md) |
| Implementation language in repository | None checked in | [`AGENTS.md`](../../AGENTS.md:8) |
| Recommended future implementation language | TypeScript on Node.js, as design intent only | [`docs/Nostr_Blockchain_Reference_Node_Architecture.md`](../Nostr_Blockchain_Reference_Node_Architecture.md:35) |
| Runtime/tooling manifests | None checked in | [`README.md`](../../README.md), [`AGENTS.md`](../../AGENTS.md:8) |
| Tests | None checked in | [`AGENTS.md`](../../AGENTS.md:8) |
| Build/lint/dev tooling | None checked in | [`AGENTS.md`](../../AGENTS.md:9) |
| Persistence model in specification | One SQLite database with crash-safe transactions | [`docs/Nostr_Blockchain_Reference_Node_Architecture.md`](../Nostr_Blockchain_Reference_Node_Architecture.md:405), [`docs/Nostr_Blockchain_Reference_Node_Architecture.md`](../Nostr_Blockchain_Reference_Node_Architecture.md:671) |
| Networking model in specification | Nostr over WebSocket, treated as untrusted input | [`docs/Nostr_Blockchain_Reference_Node_Architecture.md`](../Nostr_Blockchain_Reference_Node_Architecture.md:63), [`docs/Nostr_Blockchain_Reference_Node_Architecture.md`](../Nostr_Blockchain_Reference_Node_Architecture.md:121) |

## Important absence policy

Do not infer package managers, scripts, linters, CI systems, or test frameworks until those files exist in the repository.

