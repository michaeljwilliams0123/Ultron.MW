# Execution pressure test — 2026-10-21 ET

**Foundation under test:** draft PR #64 at `9cca530dc0c4a4dfe3226134e18d8b12a3e2939a`.
**Rule:** this record separates observed operations from source-only guarantees. It is not production acceptance.

## P0 browser and durability observations

- A real isolated Chrome session loaded `https://michaeljwilliams0123.github.io/Ultron.MW/` and exposed the current Objective console.
- The synthetic objective `Inspect repository status and report the current verified revision without making changes.` was entered and **Plan objective** was clicked. The UI produced a session-only draft, marked both requested steps blocked, and displayed the Pages execution boundary. No GitHub form was submitted and no external write was requested.
- The test host had no Chromium/Chrome executable and no Playwright package installed. The PR's Playwright adapter therefore remains source-tested but not provisioned on an Ultron execution host.
- A new subprocess pressure test acquires the filesystem objective lock, is killed before cleanup, and verifies that a second process is denied. The crash lock remains for explicit reconciliation rather than being stolen or replayed.

These observations clear the live public-UI planning check and the local crash-lock test. They do **not** clear #65: no Ultron-owned browser session performed an authorized click/type workflow, screenshot grounding, refresh readback, MFA/takeover, or sensitive-session handling.

## P0 hosting readback

- The connected Cloudflare profile answered an authenticated identity probe.
- A read-only Cloudflare API request returned HTTP 200 and listed six existing Worker scripts. All were Mahoraga-named; no Ultron Worker was present.
- No resource was created, modified, deployed, or billed. Railway was not retried.

Issue #66 therefore remains blocked on the owner's one-runtime choice, budget/session-retention requirements, and a real deployed lease store. GitHub Pages remains the UI; GitHub Actions remains CI/PR execution rather than an always-on browser.

## P1 provider-binding tranche

Two independent connected providers completed narrow read operations:

| Provider | Observed read | Result | Authority not inferred |
|---|---|---|---|
| GitHub | Repository/PR/issue and exact-head workflow readback | Ultron.MW accessible; `main` is default | No universal write grant |
| Cloudflare | Profile probe and Worker-script listing | Authenticated read succeeded; no Ultron runtime found | No deploy, secret, billing or mutation grant |

`src/capability-bindings.mjs` adds one `ultron.binding.v1` broker contract with provider identity references, origins, operations, effects, scopes, expiry, credential references and cost ceilings. It implements `bind`, `status`, `health`, `execute`, `observe` and `unbind` with these boundaries:

- connection metadata starts `not-probed`; only matching provider identity and complete observed scopes become `ready`;
- writes and destructive operations require a separate affirmative authorization callback;
- credentials are references only and provider payloads are never persisted in receipts;
- exact idempotent retries return the prior receipt; changed requests cannot reuse the key;
- every request declares an integer cost estimate that cannot exceed the binding ceiling;
- uncertain provider outcomes become `reconcile-required` and are not replayed;
- expired, revoked, partial, foreign-provider and unknown-operation cases fail closed;
- unbinding requires approval and provider-confirmed revocation.

Real providers are still invoked by their owner-authorized external adapters. This source broker does not mint tokens or silently expand current connector permissions.

## P2 reference inventory

Static repository references were counted while excluding the master plan itself. A nonzero count proves a source reference, not live use.

| Route/component | Reference files | Classification |
|---|---:|---|
| `verify.yml` | 21 | retain — required exact-head gate |
| `pr-brain.yml` | 7 | retain — PR conversation and repair |
| `cloud-pr.yml` | 6 | retain — owner PR submission |
| `cloud-objective.yml` | 5 | retain — bounded hosted reads |
| `self-scan-pr.yml` | 10 | retain — current-main findings PR |
| `gitlab-mirror.yml` | 1 | retained fallback — live parity still required |
| `docs/app.js` | 6 | retain — single UI |
| `docs/index.html` | 2 | retain — Pages entrypoint |
| `src/action-gateway.mjs` | 4 | retain pending device acceptance |
| `src/brain.mjs` | 18 | evolve, do not duplicate |
| `src/grokbot-governor.mjs` | 8 | evolve as advisory reasoning |
| `src/always-on.mjs` | 4 | consolidate only after durable scheduler parity |
| `src/experience.mjs` | 3 | reuse for measured outcomes |
| `src/learning.mjs` | 5 | reuse for held-out promotion |
| `src/framework-integration-runtime.mjs` | 5 | reuse behind capability bindings |
| `docs/browser-brain.mjs` | 2 | keep separate from execution authority |

No route passed the deletion bar. Issue #69 remains intentionally open until live parity, failure injection and rollback evidence exist.

## Dependency order and remaining gates

1. Keep PR #64 open and green as the execution foundation.
2. Land the capability broker only after its stacked exact-head checks pass.
3. Choose and approve one runtime for #66; do not deploy multiple paid planes.
4. Provision Playwright and an isolated owner session there, then finish #65's real click/type/readback and negative cases.
5. Feed those independently measured trajectories into #68 memory/skill/prediction evaluation.
6. Delete routes under #69 only after side-by-side parity and rollback.

Issue #32 remains the separate protected-main and autonomous-PR live acceptance authority.
