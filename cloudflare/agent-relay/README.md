# Authenticated agent relay (candidate, v2)

Isolated Worker for Gemini/ChatGPT coordination: opaque notification IDs only. No origin proxy, task body, production approval or external task execution. Do not deploy to the production Worker.

## Configuration and cutover
- Use an authorized staging Worker and D1 binding RELAY_DB; apply schema.sql. Versioned tables do not trust or mutate legacy canaries.
- Bind AGENT_PUBLIC_KEYS as a JSON object with exactly ChatGPT and Gemini, each with a distinct public EC P-256 JWK (kty, crv, x, y). Private signing keys stay in their respective authorized signers. Never share the owner signing key or register the same public key twice.
- This is a deliberate versioned protocol cutover; both callers must adopt v2 together. Do not silently accept v1 or downgrade. No private keys or live credentials in source.
- Independently verify exact deployed source, unsigned denial, wrong key, tampering, stale/future timestamps, nonce replay, duplicate conflict, recipient isolation, concurrent claim, expired lease and stale fence before enabling. Preserve private mailbox fallback.

## Protocol
Headers: X-Ultron-Agent, X-Ultron-Timestamp (13-digit Unix milliseconds), X-Ultron-Nonce (16-128 URL-safe characters), X-Ultron-Signature (base64url IEEE P1363 raw 64-byte ECDSA P-256 SHA-256 signature).
Sign the UTF-8 LF-joined fields: ULTRON-WEBHOOK-v2, HTTP method, exact path plus query, agent, timestamp, nonce, lowercase SHA-256 hex of raw UTF-8 body. Clock window: -300s/+60s; fresh nonce each HTTP attempt. No signature downgrade.

POST /__ultron/webhooks/relay: message_id, recipient, event_type, optional correlation_id. Sender derived from signing identity. Allowed event types: coordination, verification, canary, receipt. Same notification retry is idempotent; conflicting duplicate ID rejected.
GET /__ultron/webhooks/events: own inbox only, optional matching recipient and status; bounded results. No lease token returned from list.
POST /__ultron/webhooks/claim: message_id, optional ttl_ms (integer 5000-300000, default 60000). Atomic claim returns lease_token, fencing_generation and lease_expires_at. Expired claims can be reclaimed; generation increases.
POST /__ultron/webhooks/ack: message_id, lease_token, fencing_generation. Recipient, token, generation, state and expiry checked in one atomic SQL update. Identical completed acknowledgment retries are idempotent; stale fences denied.

A relay lease protects notification processing, not an external task side effect. Actual execution needs a separately authorized canonical execution ledger with durable effect reconciliation. Native ChatGPT event subscription is a distinct integration; polling remains available.

## Verification
Run node --test test/agent-relay.test.mjs on Node 22+. Repository Verify discovers this test. Local tests use real SQLite statements with a D1-compatible adapter. Live D1 canaries and independent exact-head CI are required.
