# Security and data boundaries

Ultron is an experimental, single-owner system. Only behavior supported by source, tests and dated runtime evidence should be treated as available.

## Reporting a vulnerability

Do not publish credentials, personal data, private client material or a working exploit in a public issue. Use GitHub's **Report a vulnerability** option if private vulnerability reporting is enabled. If it is unavailable, open a minimal public issue asking the owner to establish a private reporting channel, without sensitive details. No private reporting address or enabled GitHub security feature is claimed here.

## Public and local data

- This repository, GitHub task issues, receipts and Pages source are public. The console submits supported command names only; manually edited issues can still disclose private information.
- Cloud receipts contain repository observations, digests and execution provenance. A digest is not encryption. Actions logs and summaries follow repository visibility and GitHub retention settings.
- `.local/state.json` and local owner notes are plaintext. Filesystem access controls, backups and deletion remain the owner's responsibility.
- The browser vault encrypts saved records when enabled. Live unlocked context and external CDN-loaded model code have a different threat boundary. Deleting a vault does not erase browser model caches or exported backups.
- Do not commit `.env` files, pairing keys, credentials or generated local state. Revoke exposed credentials at their source; deleting a public post cannot retract copies.

## Execution controls

Cloud input never becomes a shell command. Owner and repository checks, a fixed capability catalogue, bounded planning, per-issue concurrency and timeouts limit the hosted lane. It has read access to repository contents and write access to issue receipts. No model, learned suggestion or task text can grant broader authority.

Local execution binds to loopback, validates Host and write Origin, and requires an additional session key for owner actions. The optional GitHub documentation adapter is disabled by default. Model outputs remain unverified narrative until a separate executor validates an operation and independently reads back its result.

Action SHAs and workflow-linter checksums are pinned in source. CI configuration does not itself enforce protected branches, PR review, Actions retention or private vulnerability reporting. Administrative settings and actual deployments require separate verification.
