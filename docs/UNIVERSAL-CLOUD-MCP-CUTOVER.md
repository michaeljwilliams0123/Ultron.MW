# Ultron universal cloud execution — controlled cutover (PR #492)

## Source architecture

- Control plane remains the **existing Hatchable project** proj_A6GCXRSKizko, existing PostgreSQL and existing hourly scheduler; no second app or cron.
- The only currently certified non-GitHub external-write operations are GitLab branch creation and Microsoft Graph workbook cell write. The new owner-only Hatchable universal endpoint delegates to existing P-256 / WebAuthn provider engines; it does not independently mint provider tokens or treat caller-controlled approval flags as authority.
- The generic Node executor requires an exact-intent owner P-256 signature, durable nonce consumption, explicit zero paid cents, an atomic database sent fence and independent provider readback before claiming completion.
- The native PostgreSQL adapter uses brain_tasks rows with status external and idempotent unique keys; queued and leased task execution is unaffected. Lost acknowledgements require reconciliation, not another POST.
- The stateless MCP handler is source-only until a real remote endpoint is deployed and independently validated. Legacy session state is never created. Legacy client retirement remains gated by issue #348.
- Reusable-skill selection is Reef-gated on independently read-back PostgreSQL receipts, external ground truth and held-out evaluation. Selection does not publish or promote the skill.

## Automated source tests

- test/framework-mcp-2026-streamable-http.test.mjs: modern headers, protocol version and origin/token denials.
- test/universal-cloud-executor.test.mjs and test/universal-cloud-trust-boundary.test.mjs: ephemeral P-256 test signing; no untrusted approvals, paid operations, forged readback or retry after uncertain POST.
- test/universal-cloud-postgres-outbox.test.mjs: PostgreSQL reservation, CAS, pause-after-reservation, terminal readback and lost-ACK behavior.
- test/universal-cloud-routing.test.mjs: registered provider allowlist, strict zero-cost and owner proof.
- test/universal-cloud-learning.test.mjs: independent persisted receipt plus held-out evaluation.

## Unmet live acceptance and release gates

1. Re-fetch the current exact PR head/base and demand successful test, fixed-comparison, reef-runtime-probe and attested-receipt checks. A green Actions job is not App 5765239 ultron/council-7of7 approval.
2. Require an authentic dedicated Council App verdict, complete HOLD reasons, owner P-256 signature for sensitive code when required and applicable GitHub protected rules.
3. Reconcile each current Hatchable deployment file to current exact GitHub main; independently verify deployment digest and receipt rather than reusing old v119-v126 counts.
4. Owner-authorize the release and import only reviewed cloud source into the existing Hatchable project. Validate with dry-run, then separately authorize a production deployment; do not assume a GitHub merge deploys Hatchable.
5. Validate live owner-only route and HTTP401/403 denials. For one explicitly owner-approved bounded provider canary, independently GET the provider postcondition and DB terminal receipt, checking no replay, wrong target, expired grant, changed stop version, unknown ACK and zero paid inference.
6. Keep existing cron 17 * * * *. Never schedule a second job or claim missed executions without observed ledger evidence.
7. Keep Hugging Face, Composio, cloud-browser, uncertified generated OpenAPI adapters and automatic skill publication disabled until credential, source, conformance, held-out and independent live-acceptance gates pass.

## Rollback

Fail closed the new universal route, preserve immutable pending/unknown/terminal receipts, reconcile provider unknown outcomes and never blindly replay external effects. No merge, deployment, secret mutation, provider write or paid inference is performed by this source-only PR.
