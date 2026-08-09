# AGENTS.md

This file provides guidance to agents when working with code in this repository.

- Repository state: there is no implementation code yet; the only substantive source is `docs/Nostr_Blockchain_Reference_Node_Architecture.md`.
- Treat this repo as a specification-first skeleton for a Nostr-native blockchain reference node, not as a runnable Node.js project.
- `README.md` is currently only a title stub and adds no operational detail.
- No `package.json`, lockfile, `src/`, tests, or tool configs exist at the repository root.
- Do not invent build, lint, test, or dev commands; none are defined in the checked-in files.
- The architecture spec recommends TypeScript on Node.js for the first implementation, but that is design intent from the spec, not an implemented stack.
- Core architectural constraint from the spec: only the `ChainExecutor` may mutate active chainstate; networking, mining, and mempool components must stay read-only with respect to chainstate.
- Keep consensus logic pure: no sockets, clocks, databases, logging decisions, or wallet-key handling inside consensus functions.
- Preserve the spec's single-process reference-node assumption unless the repository gains code or docs that explicitly replace it.
- Preserve the spec's storage model: one SQLite database, crash-safe transactions, and rebuildable derived indexes.
- Preserve the spec's networking model: Nostr transport is untrusted input; relay acceptance never implies transaction or block validity.
- Preserve the spec's wallet boundary: the node should not store ordinary user spending keys; mining may use a dedicated block-signing key only.
- If you add implementation files later, align names and boundaries with the proposed tree in `docs/Nostr_Blockchain_Reference_Node_Architecture.md` unless a newer repo document supersedes it.
- Before changing agent guidance, re-check whether new repository files introduce real commands, tooling, or implementation conventions.

## Mode files

- Code: `.kilocode/rules-code/AGENTS.md`
- Debug: `.kilocode/rules-debug/AGENTS.md`
- Ask: `.kilocode/rules-ask/AGENTS.md`
- Architect: `.kilocode/rules-architect/AGENTS.md`
