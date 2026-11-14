# Ultron.MW — production acceptance and online/offline autonomy reconciliation

Baseline: 2026-11-13. Canonical repository: michaeljwilliams0123/Ultron.MW. Source SHA: 48fc6fc4811474123fef803e00212044e378c65f. Hatchable: proj_A6GCXRSKizko, deployed v105. This is a reviewable transition decision, **not** authorization to deploy or grant new permissions.

## Directly verified pressure-test findings

| Claim | Evidence / decision |
|---|---|
| Database footprint | Live information_schema records **57 base tables (including __hatchable_migrations) and 1 view**. Hatchable documents 50 free-tier tables and 2 hours of monthly database time. Project tier returned 'personal'; the effective allowance/billing status has not been independently proved. Avoid new base tables pending clarification. |
| Duplicate 0039 | Both 0039_autonomous_repair_checkpoints.sql and 0039_github_idempotent_executions.sql are applied. Preserve names and history; assess clean-room ordering in tests rather than renaming historical migrations. |
| Migration v105 | 0040 and 0046–0049 are applied, but this proves schema presence, not live API/worker parity or production acceptance. |
| Scheduler | The existing Hatchable configuration has one hourly 17 * * * * tick with bounded recovery. No minute-frequency Hatchable cron polling was demonstrated. Measure DB compute and event rates before refactoring. |
| Browser authority | Current passkey enrollment and assertion verification code pins the promoted hostname ultron-mw-cloud.hatchable.site. Test rejection of draft origins before claiming this is missing. |
| GitHub write concurrency | The branch executor currently has a compare-and-set reserved → in_flight claim before first POST and refuses blind retries after uncertain effects. A concurrent-first-claim double-write has **not** been reproduced. Test two-worker races and crash recovery before expanding the state machine. |
| Source drift | Many of the named mirrors are byte-for-byte identical, while the Hatchable master pipeline and continuum ACK have intentional platform adapter differences. The accompanying CI check verifies 18 exact mirrors without rewriting legitimate adapters. |
| GitHub credentials | An RSA signer and App PEM configuration are available to deployed server code. Server-side code placement alone does not isolate raw keys from all project code; use a separately restricted signer/broker for stronger separation. Never expose the signing key to sandbox/AI/browser code. |

Official platform documentation:
- https://hatchable.com/features/database
- https://hatchable.com/docs/developers/config
- https://hatchable.com/docs/developers/secrets
- https://hatchable.com/docs/developers/mcp

## Minimal authoritative execution model

1. **Policy:** single versioned owner profile, explicit operation allowlist, zero-dollar paid ceiling and global stop/revocation sequence. Council votes inform release risk; they cannot mint owner authority.
2. **Intent:** one canonical operation digest bound to repository ID, exact expected head SHA, operation scope, owner grant, expiry and stable idempotency key.
3. **Admission:** persist the intent, recheck owner/profile/stop/head preconditions and atomically claim it with a single-winner conditional update. If lease reclaim is introduced, add a monotonic fencing generation and validate it on subsequent state changes.
4. **Provider:** GitHub does not honor internal fencing tokens. Never use a newer fence to justify a second write when the first provider request might have succeeded. Only independent provider GET/readback may resolve ambiguous dispatch.
5. **Signing:** broker independently validates the signed grant, token scope, installation ID and current stop version before generating narrowly scoped App credentials. A dedicated trust boundary must prevent untrusted sandboxes or tools from reading the private key.
6. **Receipt:** append durable postcondition evidence with operation digest, authorization version, provider effect, readback SHA, verification time and a non-replay assertion. Do not equate a local log or simulated check with a real provider effect.
7. **Promotion:** exact-head green CI, risk evaluation, owner-authorized release and independent deployed artifact readback belong at the release tier, not every Tier 0 reasoning step.

**Do not create the proposed two-table database kernel immediately.** Existing production has 57 tables and many historical references. First adapt existing ledgers behind a single interface, shadow-compare receipts, prove forward-only migration and export/backfill recovery, and then retire obsolete writers separately. Do not DROP historical stores merely to make a table count look smaller.

## Online/offline split

- **Tier 0 local cortex (optional):** local filesystem/repository observation, deterministic tests, AST inspection, forecasting and private local inference. It may queue unprivileged proposals; it does not hold production signing keys or create irreversible GitHub mutations while offline.
- **Edge filtering (optional):** verify inbound webhook signatures and suppress irrelevant events before entering PostgreSQL. Edge is a relay, never an owner or signer. Do not introduce Cloudflare or paid infrastructure before a measured operational need.
- **Hatchable cloud authority:** the single owner UI, authoritative profile/stop state, durable claim, credentials broker interface, provider readback and receipts. Existing hourly scheduler handles bounded reconciliation, not unbounded thinking.
- **Reconnection:** sync content-addressed observations idempotently; validate TTL, expected GitHub SHA and current owner/stop policy for every queued intent. Divergence goes to reconcile_required for read-only investigation and local replanning.
- **Graduated autonomy:** Tier 0 = no external writes; Tier 1 = bounded reversible draft/branch actions under explicit standing approval; Tier 2 = evaluated release and owner grant; Tier 3 = permissions, credentials or paid spending, always fresh owner WebAuthn step-up. Calibration can reduce authority, never silently increase Tier 3.

## Sequenced delivery and issue disposition

**G1 production acceptance, next:** #342 and #379 — independently verify exact App installation and canonical account identity; #167 — repository-operator epic and production runtime parity; #183 — crash/race/lease and no-replay evidence; #204 — one canonical provider postcondition receipt; #285 — owner-signed, single-effect GitHub canary. Keep these issues open until independent live readback demonstrates their gates.

**Next release tier:** #412 deployed runtime wiring; #351 exact-head PR workflow jobs and protected closure guard; #168 real repair PR; #173 independent release evaluation; #245 full release train. Do not falsely close release blockers upon a branch canary alone.

**Operations, evidence before redesign:** #184 and #195 — monitor hourly scheduler, run-level success, usage, 24-hour pilot and 7-day SLO; profile the database budget. Source claims about minute-by-minute cloud polling and unavoidable cost overrun remain hypotheses, not verified faults.

**Later, non-blocking for G1:** #187/#225 capability policy, #190 Mahoraga federation, #193 memory, #194 command center, #219–#222 predictive capabilities, #343–#348 optional connectors.

## Exact G1 acceptance tests

- Verify real GitHub App identity and installation access (not just configured credentials or connected-user OAuth).
- Owner explicitly enables the canary operation; use a correctly signed, short-lived P-256 grant. Enrollment of an owner WebAuthn credential alone does not satisfy the current branch canary's separate signature path.
- Force two-worker race, crash before write, ambiguous timeout after request and resume/reconcile: at most one provider effect.
- Write one bounded, non-destructive branch or comment at the permitted SHA; independently read GitHub effect; persist immutable PostgreSQL proof; reject same-key replay.
- Confirm owner UI readback and zero paid external expenditure.
- Preserve the existing current 0039/0041/0045/0047–0049 evidence and stop controls. Roll back new dispatch via feature gate, not by deleting receipts or renaming migrations.

**CI/closure policy:** This change adds one lightweight source-parity check, not another approval authority. Existing scripts/check-protected-issue-closures.mjs remains operative; do not auto-close protected trackers before independently proving acceptance.
