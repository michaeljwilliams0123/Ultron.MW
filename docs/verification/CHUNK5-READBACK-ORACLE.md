# Chunk 5 — Independent external-effect oracle and Hatchable trajectory storage

Status: **source implementation and local deterministic tests only**. This change does not deploy the cloud app, provision a signing key, turn on a new action, or declare production acceptance.

## Contract

- A successful fetch, GitHub write response, page title, button click, or DOM change is **not** an externally verified task completion. The new oracle runs **after** an already-approved, separately ledger-reserved write. It never dispatches, retries, or authorizes mutations.
- src/verification/readback_oracle.mjs is the Node ESM implementation. src/verification/readback_oracle.ts is the requested TypeScript declaration/re-export; the repository's test/build toolchain remains node:test and does not compile TypeScript.
- http_status confirms only a bounded HTTPS GET response (transport-only). dom_element_present uses a trusted origin-bound accessibility/DOM reader (dom-only). github_api_readback performs a fresh GET against paths under the **Ultron.MW** GitHub API repository only (provider-state). database_readback requires a separately supplied trusted DB observer with a matching committed correlation key (provider-state).
- Checks match explicit expected values from the trusted plan. Plugin/MCP request bodies and _meta fields are never credential authority. No arbitrary-origin fetch, redirected token request, secret-bearing event, or fetched JSON as executable instructions.
- verifyExternalEffect(assertion, services) retains the requested boolean interface for one assertion. observeExternalEffect returns a scoped evidence tier and sanitized reason. verifyAndReportExternalEffect processes 1–8 assertions and cannot return verified-external without an actual provider-state match and a **durable read-after-write** of its evidence receipt.
- Error/timeout/unknown outcome: reconcile-required, not a replay. Provider mismatch: not-verified. HTTP/DOM-only matches: observed-only. Receipt write/readback failure: reconcile-required, even if provider state matched.

## Hatchable adapter

- cloud/hatchable/migrations/0038_readback_oracle_events.sql creates an immutable event register; migration 0037 is reserved for the GitHub approval nonce migration in PR #354. No existing C04 Council ledger or Council Room table is repurposed or bypassed.
- cloud/hatchable/lib/readback-oracle-reporter.js exposes createHatchableReadbackReporter(db) with parameterized, idempotent INSERT and independent SELECT. It validates event schema, SHA-256 digest over deterministic canonical JSON, evidence-tier consistency and collision identity; this is **evidence storage**, not owner authorization.
- An authenticated Hatchable backend composition root can create the reporter using its existing db service, then pass it to the oracle alongside independent readers. **Do not expose this module as a public unauthenticated POST route.** Future GitHub-to-Hatchable ingress must be authenticated with repository/workflow-bound OIDC or another separately reviewed signature protocol before persistence.
- The existing council-room-execution API intentionally rejects verified status for documentation-only proposal PRs. This patch neither changes that rule nor claims PR creation satisfies runtime acceptance.

Example trusted server-side composition (illustrative, no production caller added):

~~~js
const reporter = createHatchableReadbackReporter(db);
const result = await verifyAndReportExternalEffect({
  attemptId: trustedPlan.attemptId,
  assertions: trustedPlan.expectedPostconditions,
  services: trustedReadbackAdapters,
  reporter
});
// External verification is proof only when the calling executor separately
// establishes owner approval, exact source/action identity and durable intent.
~~~

## Verification and remaining acceptance

Local focused suite: `node --test test/readback-oracle*.test.mjs` exercises the real reporter against both an isolated adapter fake and a PGlite PostgreSQL JSONB write/read round-trip, including idempotent and conflicting replays. Repository full validation: `node scripts/verify.mjs`; CI must run this on the exact new PR head.

**Not yet proven:** migration 0038 in real Hatchable PostgreSQL; authenticated GitHub-origin intake; independent provider readback after an owner-approved write; protected exact-head CI; production runtime wiring; live service read-after-write; owner UI trajectory display. Separately test these before closing acceptance issues. No paid provider spend or new credential material.
