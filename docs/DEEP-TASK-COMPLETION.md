# Continuum C06: Deep task completion contract

Ultron has a native GitHub Actions code-writing path:
owner issue `[Ultron PR] Implement code` with `ULTRON_CODE_PR_V1` +
source-bound exact patch → GitHub-created branch/commit → real non-draft PR →
exact-head workflow dispatch → verified merge eligibility and reviewed merge.
The owner issue is **input**; GitHub Actions execution and its independent
readback are **evidence**. A proposal PR alone is not task completion.

`src/deep-task.mjs` adds a reusable, bounded execution coordinator.
Supported steps: branch.create, source.patch, pr.create, ci.verify,
pr.squash, deploy.reversible, runtime.verify. Each step has explicit
dependencies and its own durable correlation key. An external writer
MUST reserve its irreversible dispatch intent before one attempt, then
read the provider's authoritative postcondition. Unknown results are
**reconcile-required**, not reasons for blind retries.

Every admission requires a genuine owner grant, capability binding,
versioned profile and stop readback, exact source identity, and $0 paid
cost. Merge additionally needs independent review, exact-head CI and
GitHub mergeability. Deployment also needs verified rollback.
Those checks are not satisfied merely by a Release profile label.

The module is source-only: its adapter methods are intentionally
injected, not secretly bound to unconfigured credentials. To make
it production operational, connect a PostgreSQL durable ledger,
independently authenticated GitHub executor, real CI/review receipts
and Hatchable post-deployment observation. Keep #188 and #204 OPEN
until a live multi-step objective completes and is independently observed.

## First live test

The owner-issued code task creating this module and tests exercises
the **real GitHub Actions write channel**. Its success requires a PR,
passing exact-head CI, legitimate merge, and source/readback receipt.
It does not prove an autonomous account has access to GitHub or that
the generic deep-task coordinator itself is deployed to Hatchable.
