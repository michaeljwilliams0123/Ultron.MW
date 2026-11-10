# PR #361 — Unified GitHub App Identity & Token Factory: Final Source Acceptance

**Acceptance snapshot:** 2026-11-10 (UTC)  
**Repository:** `michaeljwilliams0123/Ultron.MW` (repository ID `1424939667`)  
**PR:** https://github.com/michaeljwilliams0123/Ultron.MW/pull/361  
**Branch:** `feat/unified-identity-token-factory` → `main`  
**Last verified implementation SHA before this documentation commit:** `cd590dcfdf93dd09603450dbee79ceb78677a02d`

## Decision and scope

**Source acceptance: SATISFIED for the Task 1 identity/token-factory implementation and its mocked integration test contract.** This is a review-ready code acceptance record, **not** a declaration that an actual GitHub App installation, browser session, deployment, or production GitHub mutation has passed live acceptance. The owner retains the final squash-merge/release decision. Do not interpret any Council recommendation as a human approval or source CI as runtime authorization.

## Concluded, evidence-backed acceptance criteria

| Criterion | Disposition | Evidence and invariant |
| --- | --- | --- |
| Required protected-server credentials | PASS (synthetic fixtures) | Requires `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_INSTALLATION_ID`; invalid, missing or nonpositive values fail closed before provider I/O |
| Exact installation/repository binding | PASS (mock provider) | Verified installation ID, canonical owner/repo and numeric repository ID; cross-repo reads and mismatched provider responses fail |
| Startup write-capability proof without a write | PASS (mock provider) | Exact `contents:write` scoped installation-token exchange; only repository GET and token exchanges occur |
| Operation-specific least-privilege grants | PASS | `getTokenForScope(operationOrCanonicalRequest)` returns `{token,operation,repositoryId,installationId,permissions,expiresAt}`; exact permissions and repository ID validated by existing issuer |
| Secure default and step-up boundary | PASS | Unknown, malformed, additional-permission and elevated/step-up scopes rejected before mint; possession of a GitHub App token never substitutes for signed owner approval |
| Compatibility with governed transport | PASS | Real factory composed directly with `createUnifiedGitHubTransport`; `identity.read` limited to canonical `GET /repos/michaeljwilliams0123/Ultron.MW` |
| Cryptographic token issuance | PASS (fixture key) | Actual RSA signature verification of generated App JWT; pinned issuer and bounded issuance/expiry claims checked |
| Cross-await mutation and same-permission retagging | PASS | Factory snapshots scope; common token issuer retains validated operation before async request. Two operations with equal permissions cannot be relabeled by a caller racing the network |
| Denial and failure behavior | PASS | Extra permissions, wrong repo, expired/oversized token lifetime, provider 403, network loss, and malformed readbacks fail closed in tests |
| Regression and full repository checks | PASS | Exact-source core tests **1,752 passed / 0 failed / 18 pre-existing skipped**; PostgreSQL tests **40 passed / 0 failed**; fixed-comparison and attested-receipt checks passed |
| No side effects or expanded dependency surface | PASS (diff audit) | Seven implementation/test files changed; no workflows, lockfiles, installation configuration, user secrets, deployment, or GitHub mutations introduced |

### Important API contract clarification

`octokit` is **not** an instance of `@octokit/rest`; it is an intentionally restricted, authenticated `repos.get` compatibility facade. The factory does not expose general API request/write methods. `getTokenForScope` accepts either the operation string or the exact transport request object and returns a **structured grant**, not a reusable bare token. This is an intentional boundary, not an implementation of a full Octokit SDK.

## Regression traceability

- Initial missing `identity.read` route: RED [run 42760224724](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/42760224724); corrected by an exact repository-GET route.
- Factory ↔ transport scope mismatch: RED [run 42761552365](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/42761552365); fixed by canonical request support.
- Factory async scope retagging: RED [run 42762169914](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/42762169914); fixed by snapshotting scope before issuing a token.
- Shared token issuer operation-label retagging: RED [run 42762581886](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/42762581886); fixed by capturing the validated operation before network await.
- GREEN source: [run 42762624838](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/42762624838), implementation SHA `cd590dcfdf93dd09603450dbee79ceb78677a02d`. Additional exact-source [run 42762908369](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/42762908369) also completed all three core jobs successfully.

## Explicit exclusions / requirements that remain OPEN

1. **Live GitHub App installation authentication:** Under protected, actual runtime configuration, independently obtain an installation token and read back the installed repository ID, effective grants, expiry and App identity. Do not print, log, copy or expose credentials, JWTs or tokens.
2. **Task 2 and Task 4 governed write integration:** Wire authorized signed grants, durable nonce/stop state, exact operation route validation, idempotent reservation and postcondition readback to the factory without giving any planner, browser or model arbitrary credentials.
3. **Production end-to-end operator acceptance:** Demonstrate one owner-authorized bounded live operation, negative/replay/paused/wrong-repo cases, unknown-write reconciliation, and revocation/rollback evidence. Track in [operator issue #167](https://github.com/michaeljwilliams0123/Ultron.MW/issues/167), with historical unified-principal architecture in [issue #169](https://github.com/michaeljwilliams0123/Ultron.MW/issues/169).
4. **Release controls:** Authenticated owner's explicit squash-merge decision, current-head required CI, applicable GitHub branch protections and security/review conditions. The owner's approval is the only required *human* approval under current policy; technical checks still apply.
5. **Cost/deployment:** No paid spending, new secrets, credential changes or deployment is approved by this acceptance record. Keep the paid-use ceiling at $0.

## Owner squash-merge review checklist

- [ ] Confirm PR #361's current head SHA and diff are the expected branch; no unrelated changes.
- [ ] Confirm exact-current-head core verification, attested receipt, and applicable required checks are green (do **not** rely on the historical green SHA if the head changes).
- [ ] Confirm no unresolved material review threads or GitHub-enforced protection blockers; respect owner-only human authorization.
- [ ] Confirm this file and the PR body still distinguish **source acceptance** from **live runtime acceptance**.
- [ ] Owner reviews and performs **squash merge**. No agent merge, auto-deploy, or branch deletion is authorized by this document.
- [ ] After merge, independently re-fetch resulting `main` SHA/checks; do not close operator live-acceptance issue #167 based solely on source merge.

**Conclusion:** Task 1 source implementation is technically verified for handoff and owner review. Live App canary and integrated operator execution are **explicitly not yet accepted**.
