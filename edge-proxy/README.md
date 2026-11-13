# UUAM staging edge ingress (source-only)

This package is **not deployed or production-accepted**. Its staging
`wrangler.toml` defaults to `HATCHABLE_INBOX_ENABLED = "false"`. No
Cloudflare Queue, Worker, DB migration, or Hatchable secret is provisioned
by committing this code.

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

## Required Hatchable endpoint, NOT currently deployed

The consumer targets exactly
`https://ultron-mw-cloud.hatchable.site/api/brain/uuam-inbox`.
Do not enable ingress until that endpoint exists and its real behavior is
independently verified. The receiver MUST:

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
node --test test/uuam-edge-worker.test.mjs
```

Core CI's `scripts/verify.mjs` also discovers the test automatically.
This tests mocked queues and signed HTTPS receipts, **not** live outage
acceptance. The $0 target requires checking account quotas before any
cloud provisioning, monitoring backlog, and planning recovery within
Cloudflare's free-tier message-retention window.
