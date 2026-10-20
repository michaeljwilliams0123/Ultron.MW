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
