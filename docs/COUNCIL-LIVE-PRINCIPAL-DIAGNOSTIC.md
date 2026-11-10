# Council identity and debate acceptance — read-only implementation slice

Scope: Ultron.MW only. One primary GitHub App principal, seven logical personas. This source change is advisory and does not deploy or enable writes, provision keys, create another brain, or invoke paid AI.

## Run a real principal proof

After merging, use **Actions → Council GitHub App identity proof (read-only) → Run workflow** on `main`. Provision existing App settings via the GitHub secrets/variables UI (never chat or source):

- Variable `ULTRON_GITHUB_APP_ID` = numerical **App ID**, not an OAuth client ID.
- Variable `ULTRON_GITHUB_INSTALLATION_ID` = installation ID covering this repository.
- Secret `ULTRON_GITHUB_APP_PRIVATE_KEY` = private PEM.

`scripts/verify-council-fleet.mjs` delegates issuance to the existing `createScopedInstallationTokenProvider` with operation `identity.read`, repo ID `1424939667` and exactly `metadata:read`. It then queries the authenticated `GET /installation/repositories?per_page=2`, requiring exactly the one intended repository. Results in `artifacts/council-principal-proof.json` contain no keys, JWTs or installation access tokens. Missing credentials, denial, scope mismatch, expired token and API failure produce `held` and nonzero exit. Rate-limited calls stop immediately with a bounded retry-after advisory, never automatic retries.

**Interpretation:** a passing proof verifies ONE GitHub App installation, never 7 independently authenticated agents. `personasDefined=7`, `verifiedPrincipalCount=1`, `verifiedIndependentRoleCount=0`. The production Council 0/7 counter must not be rewritten or reclassified from a single App token. Only separate real role execution evidence can change role-participation observations. This workflow does not update Hatchable production or its readiness ledger.

## Evidence-bound debate

`src/engine/council-debate-engine.mjs` provides `executeCouncilDebateLoop(taskContext,{runPersona})`, an optional advisory library. Real provider-backed read-only `runPersona` must return a matching role and source SHA with a version-compatible evidence position. Builder+Generator propose; Skeptic+Sentinel challenge; Predictor+Companion examine impact; Steward synthesizes, using existing `createCollectivePosition` and `synthesizeCollectiveDeliberation`. Missing providers, stale responses, missing evidence, uncertainty or dissent return `held`. Even an evidence-complete `advisory-ready` has `authorized=false` and `githubWritePerformed=false`. No pseudo-consensus signature, implicit main commit, automatic permission, or separate reviewer identity is invented.

**Not activated:** a trustworthy runtime adapter, durable role-turn checkpoints, cross-restart replay, real provider invocation, provenance and independent promotion evidence are still required before wiring this module into the Hatchable queue or any executor. See #183, #186, #187, #204. Do not add a second coordinator.

## Failure-mode safeguards and remaining work

- Nonces for actual owner grants must be cryptographically random, globally unique and atomically claimed by migration `0037`; never use `Date.now()` as nonce identity. This probe does not mint owner grants.
- The CLI normalizes escaped PEM newlines in trusted process memory; invalid keys fail closed.
- Rate limits: a GitHub 403/429 with rate-limit evidence returns `held`; real mutation workers must honor Retry-After and reconcile uncertain outcomes via provider readback.
- Ref races and shallow clones: use exact-SHA GitHub API readbacks and compare-and-swap updates; do not force-push and do not depend on `HEAD~1` or `.git` existing in production.
- Serverless termination and DB pools: persist phase/outbox receipts before external effects; use bounded worker leases and correct client release. The read-only probe has no database pool.
- Node ESM: use the repository's existing crypto/App token module, no new `@octokit` or `pg` runtime dependencies.

Run focused tests with `node --test test/council-fleet-probe.test.mjs test/council-debate-engine.test.mjs`; verify full CI and exact head with the repository's `node scripts/verify.mjs`. A simulated/mock callback result is a unit test, **not** independent model or installation evidence.
