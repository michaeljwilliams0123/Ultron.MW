# Event-driven release reconciliation (follow-up to #525)

## Authority and current release
Hatchable remains the canonical release ledger. GitHub publishes exact-main CI and signed source-inventory evidence. Cloudflare webhooks and queue messages are wake-up hints only; they are not owner grants or proof of a deployment. Keep v157 and main 0d28f9a stable until its receipt is independently reconciled. Never copy the production owner signing key to GitHub, Cloudflare, or an agent. Never put signed grant envelopes in public workflow artifacts, logs or repository comments.

## This change
The existing edge queue silently acknowledged main pushes and completed checks lacking caller-provided manifest fields. It also started cache synchronization on deployment hints before final proof. The corrected consumer starts watch mode on canonical repository main pushes, successful check suites and authenticated deployment-success events, validates SHA and scope, ignores caller-provided receipt fields, and retries failed workflow starts. Missing Workflow binding is an explicit bounded retry/DLQ outcome. No edge deployment, new paid resource, credential change or signing authority is included.

## Remaining integration acceptance
1. Confirm the actual deployed Worker configuration and whether the existing Workflow binding can be used within the zero-spend policy. The lite Wrangler configuration has no Workflow binding; do not enable a paid resource automatically.
2. Keep GitHub webhook signature validation, exact repository ID, delivery deduplication and authenticated provider re-fetch. A successful exact-main Verify completion or provider deployment event should wake reconciliation; a webhook is never a release approval. Validate and deduplicate deliveries before triggering, including redelivery and stale head tests.
3. Use an approved service identity limited to read-only release evidence, not an owner session or unrestricted admin token. The canonical owner-only Hatchable release-proof route currently cannot be called by an unauthenticated edge worker. Establish an explicitly reviewed read-only reconciliation contract, or keep the recheck inside Hatchable's scheduler.
4. After an owner-authorized receipt is recorded by the existing receipt endpoint, initiate a read-only reconciliation using the same canonical release-proof policy. Re-fetch current main, pinned CI, dedicated Council check, actual authenticated deployment manifest and durable receipt. Bind the result to exact source SHA, live target, digest, grant and receipt identity. Never infer acceptance from public status-public or from webhook data.
5. Reconcile automatically after valid receipt submission; use bounded retries for delayed CI or manifest availability and a periodic recovery sweep for lost events. Deduplicate by release identity and delivery ID. No new grants are minted on retry. A missing or invalid signature stays awaiting-owner-authorization, not verified.
6. Only after the canonical verifier returns verified:true for the current source and version should Cloudflare publish sanitized status or synchronize caches. Do not change origin-lock or execution authorization as part of release verification.
7. Prove a real end-to-end run with a genuine signed receipt, duplicate delivery, out-of-order CI/deployment events, stale main, wrong digest, revoked grant, provider outage and lost acknowledgement. Preserve the exact evidence on #525. This change alone does not complete #525.

No scheduled job or webhook subscription has been changed by this draft.
