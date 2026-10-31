# Reef runtime CI bootstrap — non-approval evidence

Issue: [#173](https://github.com/michaeljwilliams0123/Ultron.MW/issues/173).

The `reef-runtime-probe` GitHub Actions job is an **ephemeral protocol test**, not a model-improvement or security clearance. On a standard public-repository GitHub runner it installs the released Reef wheel `reef-infra==0.1.3` after checking the published wheel SHA-256, then runs `reef serve` on loopback using a **deterministic, non-model fixture** as the upstream. It checks the health endpoint, inference receipt, feedback report and receipt, and scenario release list. The only uploaded artifact is `artifacts/reef-runtime-probe.json`; no logs or upstream credentials are retained. No paid inference or user-host requirement is introduced.

Passing this job proves the real package launched and accepted a recorded request and report **only if** the artifact shows the expected receipts and package version. It does **not** prove:
- a trained or improved Ultron harness, real model-quality feedback, or any candidate promotion;
- independent held-out comparison, security reviewer identity, or a release acceptance gate;
- live Repair or Admin GitHub App identity, Hatchable integration, deployment, or UI/browser acceptance.

Consequently `eligibleForMerge=false` and `candidateEvaluated=false` are **hard-coded invariants** of this runtime probe. A follow-on candidate evaluation must use representative repository tasks, real candidate/base artifact digests, receipt-bound observations and held-out cases, separate independent review, and protected exact-head GitHub checks.

The Reef task remains **Blocked** for PR #168/#169/#170 until that full verification exists. This file and job are the first infrastructure evidence slice, not permission to close #173.

Operational notes:
- The workflow is read-only (`contents:read`), has no secrets, does not commit, deploy, modify repository settings, or merge.
- The GitHub Actions runner owns the ephemeral Python process; the PC and Hatchable are unaffected.
- On bootstrap failure, the artifact explicitly marks `runtimeVerified=false`; no inferred success is permitted.
