# UUAM staging edge ingress (deployed, fail-closed)

**Staging deployment checkpoint (2026-11-14):** Cloudflare Worker
`ultron-mw-edge-staging` was uploaded from GitHub source SHA
`e2eb6b48b132ee0c72756874b4ed6241530ccd6b` with producer bindings
to the existing `ultron-staging-events` and `ultron-staging-events-dlq`
queues. Both queues had zero backlog and **no consumers** at this checkpoint.
The Worker is available on `ultron-mw-edge-staging.mahoraga-mjw0123.workers.dev`
but has `HATCHABLE_INBOX_ENABLED = "false"`, no HMAC secrets, and **no
operational ingress**. `GET /healthz` returned `200` with `accepting:false`;
unsigned `POST /ingress` returned `503`. This is **not production acceptance**.

Committing source does not provision Cloudflare resources or grant authority.
`wrangler.toml` retains its default-disabled configuration; do not activate
traffic based only on a successful deployment or unit test.

## Trust boundary

`POST /ingress` accepts only the custom `ultron.uuam.ingress.v1`
server-to-server format; it does **not** implement direct GitHub webhook
signature verification. Submit `Content-Type: application/json` and a JSON
object with **exactly** these fields:

- `schema`: `ultron.uuam.ingress.v1`
- `source`, `deliveryId`, `taskKey`: bounded IDs
- `operationDigest`: exact 64-character lowercase SHA-256 hexadecimal
- `githubIdempotencyKey`: `ultron-task-...` matching the existing 0039 ledger
- `nonce`: 32–64 lowercase hex characters
- `payload`: JSON object (no executable policy authority)

The caller must authenticate **the original UTF-8 HTTP body bytes** using
`X-Ultron-Timestamp: <epoch seconds>` and
`X-Ultron-Signature: sha256=<lowercase hex HMAC-SHA256>`.
The signed bytes are UTF-8 `<timestamp>.` followed by exact raw request bytes.
Requests outside a five-minute window, missing signatures, invalid input,
and bodies over 64 KiB fail closed. The Worker verifies before inserting a
message into Cloudflare Queue. The response `202 status=queued` never means
authorization, remote persistence, or task execution.

Set two **different** cryptographically random 32+-character Worker secrets
using a secure deployment secret mechanism, never committed to source:

- `ULTRON_INGRESS_HMAC_KEY`: verifies the caller-to-Cloudflare signature
- `HATCHABLE_DELIVERY_HMAC_KEY`: signs Cloudflare-to-Hatchable delivery

**Do not set `DATABASE_URL` or copy owner/GitHub App private keys into Cloudflare.**
For production use, consider versioned key IDs and overlapping rotation
windows. This staging implementation has neither.

## Hatchable receiver deployed but disabled

The receiver implementation is now checked in as
\`cloud/hatchable/api/brain/uuam-inbox.js\` and
\`cloud/hatchable/lib/uuam-inbox.js\`, with PostgreSQL and signature
regression coverage in \`test/uuam-hatchable-inbox.test.mjs\`.
The receiver was deployed into the existing Hatchable project as **v111**;
**v112** added an owner-only read-only Cloudflare staging health endpoint
and iPhone owner setup status. Both
`brain_signed_inbox` and `brain_omni_execution_state` had zero records
after negative probes. The protected HMAC secret is **not configured** and
the Hatchable intake switch is **false**, so staging delivery remains blocked.

The Hatchable project's \`hatchable.toml\` declares an optional protected
\`ULTRON_UUAM_DELIVERY_HMAC_KEY\` secret and a default-\`false\` boolean
\`uuam_inbox_enabled\` configuration switch. The owner must supply the same
random HMAC key value to Hatchable's protected Setup and to Cloudflare's
\`HATCHABLE_DELIVERY_HMAC_KEY\` secret binding; it must be **distinct** from
Cloudflare \`ULTRON_INGRESS_HMAC_KEY\`. Do not activate either switch until
the real migration and remote canaries have passed. Missing keys or the
default-disabled switch return HTTP 503 without a database mutation.

Migration \`0047_omni_state_machine.sql\` records an immutable, unique
\`ingress_nonce\` on the existing event-state projection and rejects
replays that change delivery ID while reusing a previously committed nonce.
The Hatchable receiver uses \`db.transaction([...])\`, never pooled
\`BEGIN\`/\`COMMIT\` calls, and verifies exact PostgreSQL readback before
returning the source queue acknowledgement receipt.

The consumer targets exactly
`https://ultron-mw-cloud.hatchable.site/api/brain/uuam-inbox`.
The endpoint now exists and rejects unsigned/disabled requests (403/503);
keep ingress disabled until the matching protected delivery key and a signed,
durable PostgreSQL readback canary have been independently verified. The receiver MUST:

1. Validate the staging environment, HTTPS delivery, `X-Ultron-Timestamp`,
   and `X-Ultron-Signature` over **exact POST bytes** using the matching
   delivery key, with constant-time signature verification and strict
   timestamp freshness. **Never** trust a caller-provided identity header.
2. Check `rawSha256` against the forwarded original `rawBody` bytes, parse
   the ingress schema, and bind source, delivery ID, nonce, task key, operation
   digest, and GitHub idempotency key.
3. Atomically insert into **existing** `brain_signed_inbox` using
   `(source,delivery_id)` and compare the recorded hash on duplicates.
   Insert or reconcile only the additive `brain_omni_execution_state`
   projection. Reject nonce/delivery conflicts.
4. Independently read back the PostgreSQL commitment and return HTTP **200**
   or **201** with JSON
   `{"status":"persisted","deliveryId":"...","payloadSha256":"..."}` or
   `{"status":"already_persisted",...}`, binding the exact original request.
   The receiver must not claim persisted if it only queued another event.
5. Keep owner grant verification, seven-role attestations, nonce redemption,
   durable GitHub write execution, and independent remote readback in their
   *existing* trusted core. Mere edge admission NEVER authorizes a write.

The consumer acknowledges only a 200/201 matching durable receipt. A
transient network error, missing receiver, ambiguous response, or missing
receipt calls `retry()`; configured `max_retries=3` and `dead_letter_queue`
then handle exhaustion. Terminal 400/401/403/404/409/410/422 responses are
explicitly copied to the separately bound DLQ and acknowledged **only after
successful DLQ admission**; failed DLQ publishing retries the original.
Inspect/replay DLQ items through the same approval and idempotency gates.

No outgoing write is performed when `HATCHABLE_INBOX_ENABLED=false` or
signing secrets are missing.

## Verification

The isolated built-in Node 22 test suite is:

```bash
npm ci --ignore-scripts --no-audit --no-fund
node --test test/uuam-edge-worker.test.mjs test/uuam-hatchable-inbox.test.mjs
```

Core CI's `scripts/verify.mjs` also discovers the test automatically.
On 2026-11-14, all **24** focused ingress and PostgreSQL tests passed
with 0 failures and 0 skips; the owner-mobile/edge status set passed **32**
targeted tests. Mocked delivery and embedded PostgreSQL tests do **not**
prove live signed delivery or production acceptance. The $0 target requires checking account quotas before any
cloud provisioning, monitoring backlog, and planning recovery within
Cloudflare's free-tier message-retention window.
