---
description: "Ultron architecture with explicit cloud, local and evidence boundaries."
---
# System architecture

## Canonical control plane

| Component | Purpose | Authority |
| --- | --- | --- |
| GitHub protected `main` | Canonical source and release lineage | Source and merge authority |
| GitHub Actions | Read-only cloud objectives, PR conversation, scan and exact-head Verify | Bounded owner-authorized workflows |
| GitHub Pages | Static UI and public command preflight | No API secrets or privileged backend |
| Optional loopback Node runtime | Local state and paired owner actions | Separate local-only owner confirmation |
| GitLab secondary project | Imported recovery copy | No independent production changes |
| GitBook | Curated operational docs and historical decisions | No code/merge/deployment authority |

## Source boundaries

GitHub `main` is authoritative. The capability manifest in [`docs/core/capabilities.mjs`](https://github.com/michaeljwilliams0123/Ultron.MW/blob/main/docs/core/capabilities.mjs) is metadata rather than proof of provider readiness. Source routing, admission and evidence should remain distinct.

The Pages UI is static: cloud objectives route to owner-confirmed GitHub actions or issues; it cannot silently mint credentials or perform privileged server-side requests. The local server is optional and no direct authenticated public bridge into it has been proven.

## Source modules worth knowing

* [`src/pr-brain.mjs`](https://github.com/michaeljwilliams0123/Ultron.MW/blob/main/src/pr-brain.mjs) — owner PR discussion and bounded execution.
* [`src/pr-brain-verify.mjs`](https://github.com/michaeljwilliams0123/Ultron.MW/blob/main/src/pr-brain-verify.mjs) — independent exact-head verification.
* [`src/pr-brain-patch.mjs`](https://github.com/michaeljwilliams0123/Ultron.MW/blob/main/src/pr-brain-patch.mjs) — exact-context source mutations.
* [`src/self-scan-pr.mjs`](https://github.com/michaeljwilliams0123/Ultron.MW/blob/main/src/self-scan-pr.mjs) — material-finding deduplication and PR publication.
* [`src/heartbeat-ledger.mjs`](https://github.com/michaeljwilliams0123/Ultron.MW/blob/main/src/heartbeat-ledger.mjs) — bounded local standby evidence; not a cloud daemon.

Detailed source: [architecture notes](https://github.com/michaeljwilliams0123/Ultron.MW/blob/main/docs/ARCHITECTURE.md).

## Single hosted brain (October 29, 2026)

The only **active Hatchable runtime** is [Ultron MW Cloud Brain](https://ultron-mw-cloud.hatchable.site/) (production v18, one hourly scheduled task). The former experimental project is paused, has no scheduled task, and redirects its application landing page to production. Historical test data remains in that separate retained project; it was not merged into production because test fixtures are not production work. [Read the source-linked retirement evidence](https://github.com/michaeljwilliams0123/Ultron.MW/blob/main/docs/verification/HATCHABLE-SINGLE-PRODUCTION-2026-10-29.md).

The owner-generated Mahoraga Native PR Operator private key passed an independent local GitHub App authentication test and a one-repository scoped App-bot issue create/readback/close canary ([Mahoraga #1183](https://github.com/michaeljwilliams0123/mahoraga/issues/1183)). The **Hatchable-hosted experimental key configuration failed a PEM signing preflight** before any external write, so this is not acceptance of hosted App-only execution. Production deliberately preserves its functioning PAT-first authentication; neither the private key nor installation tokens are stored in GitHub source or public UI.

The scheduled public acceptance audit checks **production only**, not the retired experiment. Green public observations do not assert private multi-provider authority, owner browser transfers, or independently measured learning improvement.
