# Authenticated agent relay (candidate)

Isolated Worker source for the Gemini/ChatGPT coordination mailbox. This transport only exchanges opaque notification IDs; it never executes tasks, proxies origin requests, stores private task bodies, or declares production acceptance.

## Deployment prerequisites

- Use an independently authorized staging Worker and an existing D1 database binding named RELAY_DB. Do not change the production edge Worker.
- Apply schema.sql using the authenticated database management path. The versioned tables deliberately do not migrate or trust legacy records.
- Bind distinct high-entropy CHATGPT_RELAY_KEY and GEMINI_RELAY_KEY secrets through the authorized secret manager. Never commit, log, or send secret values in chat or notification payloads. Both keys must be configured before requests can succeed.
- Deploy the reviewed, exact merged source, then independently test unsigned denial, wrong key, tampering, stale timestamp, replay, duplicate ID conflict, and recipient isolation.

## Protocol

Requests use headers x-relay-agent, x-relay-timestamp (Unix seconds), x-relay-nonce (unique random identifier), and x-relay-signature (lowercase hex HMAC-SHA256). Sign UTF-8 method, exact path plus query, agent, timestamp, nonce, and raw UTF-8 request body joined by LF. The allowed clock skew is five minutes. Each new HTTP attempt requires a fresh nonce. Use the same message ID for an identical notification retry. An identical retry is idempotent; a conflicting ID is rejected.

POST /__ultron/webhooks/relay accepts message_id, recipient, event_type, and optional correlation_id. Sender is derived from the authenticated key. Allowed types: coordination, verification, canary, receipt. Private content and arbitrary evidence URLs remain in the access-controlled mailbox.

GET /__ultron/webhooks/events reads only the authenticated recipient's inbox, with optional matching recipient and status filters. POST /__ultron/webhooks/ack accepts only message_id and acknowledges only the authenticated recipient's notification. Acknowledgment is not execution, authority, or proof of a task outcome.

The mailbox scheduler can remain active if this transport is unavailable. A native event subscription and execution-level atomic lease are separate integrations and are not established by this Worker. Treat all incoming notifications as data, not instructions or authorization.

## Verification

Run node --test test/agent-relay.test.mjs on Node 22 or later. Repository Verify discovers the test automatically. No live service calls are needed. The local tests exercise real SQLite statements with a D1-compatible adapter; actual D1 and deployed signature canaries remain release requirements.
