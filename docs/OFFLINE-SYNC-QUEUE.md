# Signed offline queue — bounded local capability

**Status:** source-only candidate. This does not alter Ultron's live runtime, GitHub permissions, Council governance, or Composio v3 PR #442.

## Security model
- `src/core/offline-sync-queue.js` is a Node.js 20+ ESM library with **no network or remote-write execution API**.
- `signOfflineTask()` creates a signed, canonical Ed25519 event. The queue verifies it against a trusted public-key map. A signature establishes task origin, **not** approval to execute a GitHub mutation.
- `openOfflineSyncQueue()` takes a server-held 32-byte-or-longer HMAC key that authenticates the complete local JSON state; keys must remain outside the queue file, GitHub and logs.
- Payloads are restricted to bounded, plain JSON with common credential-bearing fields and recognizable key formats rejected. **This is not a guaranteed secret scanner**: never submit credentials or confidential material as task payloads.
- Local file permissions are created with `0600`; state is HMAC-protected **but not encrypted**. An operator must protect the storage volume and rotate the external keys appropriately.
- An exclusive `.lock` file blocks a second cooperating writer. After a process crash, inspect and manually clear an orphan lock only after confirming no writer remains. Locks are not auto-broken.
- Atomic temp-file replacement and file sync precede state transitions; if persistence fails, the queue instance becomes poisoned and refuses further dispatch. Directory fsync is performed on supported non-Windows platforms; power-loss guarantees depend on the filesystem.

## Task behavior
- The caller explicitly configures `readOperations` and `stagedWriteOperations`. The default read allowlist is empty.
- `enqueue()` rejects untrusted signers, changed signed payloads, duplicate idempotency keys, expired events and unsafe JSON. Identical replay returns the existing state.
- Mutating tasks are stored with `staged-write` and **never processed** by `drain()`. Future promotion must go through `enforce-signed-approval.mjs`, the trusted Council gate, the scoped GitHub App and the existing migration 0039 idempotency ledger. This library does not grant remote access.
- `drain(handler,{online:false})` skips execution. When online, it claims each read durably before calling the explicitly trusted read handler.
- A read handler must independently verify its provider result and return `{verified:true,receiptDigest:<64 hex>}`; otherwise the task enters `reconcile-required`.
- Explicit pre-dispatch failures may retry with bounded exponential backoff; uncertain remote outcomes never automatically replay. `reconcile(id,independentReadback)` requires a separate verified readback with the exact idempotency key.
- A restarted queue converts interrupted `dispatching` events into `reconcile-required`. This is *not* exactly-once external execution.
- Do not interpret this as CRDT/offline multi-master replication, cryptographic consensus, autonomous authorization, or a live background service. Those require separate design and approval.

## Validation and release
- `node --test test/offline-sync-queue.test.mjs`
- Existing `.github/workflows/verify.yml` discovers and runs the new tests automatically. No ninth workflow or additional dependencies were added.
- The module is not wired to startup or a timer. No external events are automatically executed, and paid API usage stays at $0.
- Keep this PR separate from #442, since both production approval and Composio Platform authentication remain independent.
