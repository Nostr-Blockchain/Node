# Security Policy

## Scope and current risk profile

This repository contains an experimental Nostr Blockchain v0 implementation and production-network specification work.

Do not use this software to hold meaningful value.

Until the implementation proves the full production contract, all builds should be treated as pre-release and high risk.

## Reporting a vulnerability

Please report vulnerabilities privately and do not open a public issue for exploit details.

Include:

- affected commit, tag, or release archive;
- environment and operating system;
- exact reproduction steps;
- expected behavior;
- actual behavior;
- whether the issue can cause consensus divergence;
- whether private keys, encrypted signer material, wallet secrets, or funds are at risk;
- whether the issue is local-only, relay-triggered, or remotely exploitable.

Preferred initial report channels:

1. private security email to the maintainer or release contact published with the release artifacts;
2. if no release contact is currently published, open a minimal non-sensitive issue requesting a private contact path without disclosing exploit details.

If a report cannot be delivered privately, share only the minimum information needed to establish contact.

## Severity guidance

Treat the following as high severity:

- consensus divergence between honest nodes;
- invalid coin creation or total-supply corruption;
- unauthorized spending;
- exposure of plaintext secret keys, encrypted signer material, or wallet secrets;
- remote code execution;
- persistent database corruption affecting correctness;
- reliable network-wide denial of service.

Medium severity examples include authenticated local privilege mistakes, relay-triggered resource exhaustion with practical mitigations, or non-consensus data corruption without fund loss.

Low severity examples include non-sensitive logging mistakes, documentation-only defects, or issues that do not materially affect correctness, funds, or secret handling.

## Secret and key handling policy

- Never commit secret keys, wallet seeds, passwords, credential files, or decrypted signer material.
- Never store plaintext wallet or miner private keys in SQLite chainstate.
- Treat every relay-sourced event and descriptor as untrusted until fully validated.
- Do not place signer passwords on the command line where they can leak through process listings or shell history.
- Prefer encrypted local key storage and protected runtime credential files.
- The local encrypted signer path implemented under [`src/signer/ncryptsec.ts`](src/signer/ncryptsec.ts) should still be treated as pre-release operational surface until the final post-simplification full-suite verification and later public-network release verification are recorded.
- Development fixtures must use clearly fake keys only.

## Coordinated disclosure expectations

- Please allow maintainers reasonable time to reproduce, fix, and prepare a release before public disclosure.
- Fixes for consensus or key-exposure issues should include regression tests where practical.
- When a vulnerability affects release artifacts or operational guidance, update this file and the relevant release notes together.
