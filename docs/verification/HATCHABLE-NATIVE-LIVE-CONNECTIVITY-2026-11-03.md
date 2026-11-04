# Native Hatchable live connectivity — implementation and operating contract

## What changed

The single Hatchable owner console now uses **Hatchable native realtime events** on the private `ultron.owner` channel. A new `GET /api/brain/events-token` route (admin/owner-only) mints the short-lived platform subscription token. The browser subscribes through `/__hatchable/events.js`, not custom WebSocket or custom timers. On a `changed` or `$reset` message, it rereads the authenticated PostgreSQL/GitHub snapshot and owner task ledger. Never trust event payloads as authoritative state.

- Post-commit notification sources: owner objective admission, notes and cancel/retry, bounded task worker completion, hourly backlog admission, runtime stop changes, profile changes, protected cloud notes, and signed event-bridge admission. Existing Hatchable MCP queue/control/note handlers share the same backend publisher. Repeated idempotency keys do not double-publish an admission notification.
- Event payload is restricted to `{kind, id?}`; no notes, JWTs, token-bearing requests, private source or task results enter the event bus. `events.publish` errors are swallowed and never undo a committed database write, thereby avoiding dangerous write retries.
- Existing MCP tools stay available. New owner/admin tool `ultron_connectivity` provides a bounded **read-only** snapshot of the PostgreSQL runtime and task queue, exact GitHub main SHA, latest current-main CI, and recent pull requests.

## Current live-capability boundary

**The native event bus is real-time only for events originated by the Hatchable service.** It does not establish that GitHub push/PR/workflow webhook delivery is already connected. Ultron's existing `/api/brain/events` route requires an HMAC secret and accepts only its own signed envelope. As of predeployment verification, `ULTRON_EVENT_BRIDGE_HMAC_KEY` was **not configured**. Enabling an inbound GitHub webhook requires a separately authenticated, signed adapter plus GitHub-side delivery registration/verification. Do not repurpose the existing signature scheme, turn off checks, or claim external push acceptance before provider-side proof.

Hatchable's `[[cron]]` remains hourly, the fastest supported recurring cadence; no multiple faux-minute crons or free-tier API flooding. `scheduler.now` runs bounded admitted work promptly after a valid request. Native realtime events make browsers responsive to actual changes, without wasteful continuous polling. No paid AI models, tokens, secret rotations, or additional hosting used.

## Acceptance checklist

1. Private token: anonymous `GET /api/brain/events-token` => 401; member => 403; owner/admin => 200 with platform grant token; no owner notes in token route.
2. Private connectivity API still rejects anonymous and non-admin callers. Open browser shows a clear sign-in state without leaking private event payloads.
3. On a safe, unique read-only `repo.inspect` task admission, persisted task appears once; a repeated idempotency key yields the original task without duplicate admission. Server emits a bounded event only after the database commit; a subscriber refetches the durable ledger.
4. The task worker publishes another update after a successful or failed terminal state. The `$reset` event forces a fresh snapshot after reconnection.
5. Existing MCP clients may authorize access to `https://ultron-mw-cloud.hatchable.site/mcp` through Hatchable's project-scoped OAuth. The new `ultron_connectivity` tool is admin-gated and does not execute or authorize GitHub writes.
6. No new cron, extra project, $0 ceiling changes, or secret exposure. Keep Pages as a rollback while #170 and #194 acceptance are pending.

**Failure semantics:** The bus is a notification hint, not an outbox with guaranteed exactly-once push. A failed publish can leave a browser stale until reconnection, an hourly event, or manual refresh; the durable database/GitHub readback remains source of truth. The admin UI keeps the Refresh button.
