# Native host admission contract (source only)

This is an experimental local protocol seam, **not a native Windows companion
or a production-ready execution system**. Nothing starts on import. There is
no network listener, daemon, Windows service, UI Automation provider, screen
capture, Excel/COM provider, mouse or keyboard injection, VLM, timeout
cancellation, or Council/cloud dispatch. No desktop or Office effect has
been performed. The existing browser owner-session authority, signed-event
inbox, Council routing and cloud ledgers are unchanged.

## Trust and configuration

`src/computer/native-host.mjs` accepts explicit local registration with a
host ID, distinct Ed25519 public keys for the proposal issuer and owner
consent issuer, lists of opaque target and workbook aliases, and
`maxPaidCents: 0`. Configuration is a trusted local operator input, not a
message that an agent or website can self-register. There are no default
keys, shared secrets, accounts, credentials or automatically provisioned
aliases. Registration is fingerprinted and checked against the local
ledger on every reconstruction; a change requires a new host identity and
an intentional migration outside this prototype.

Use an owner-controlled, dedicated ledger directory with OS permissions that
exclude other users and processes. The existing local file store provides
per-host exclusive locking and atomic replacement, not a tamper-proof ledger,
secure Windows ACL provisioning, backup, multi-machine consensus, or
crash-durable fsync. A malicious local process with access to the ledger or
owner signing key is outside this contract's protections. Protect and retain
the ledger: deletion, rollback or copying an old backup can defeat replay
protection. The ledger has a fixed 1,000-record capacity and does not prune.
Do not delete locks or ledger files automatically; investigate interrupted
work and retain evidence.

## Proposed operations

Discovery advertises four **unavailable** kinds:

- `screen.observe`: proposed redacted screen observation for one registered
  target alias. No pixels or redaction implementation exist.
- `uia.discover`: proposed UI Automation discovery for one target alias. No
  window attachment, accessibility tree or control activation exists.
- `excel.read-cell` and `excel.write-cell`: proposed access to one registered
  workbook alias, a bounded sheet index and A1 cell. Writes accept only
  bounded plain text and reject formula-like values. There is no workbook
  resolver, COM provider, workbook opening, saving or readback.

Aliases do not designate paths or handles by themselves. A future adapter must
resolve them from independently reviewed, owner-configured, canonical local
targets, restrict workbook paths and symlinks, validate file identity and
content, and enforce target/process/session boundaries. An alias alone is
not authorization. This slice explicitly excludes arbitrary paths, shell or
process spawning, credential stores or DPAPI, browser profiles, clipboard,
security settings, UAC bypass, input injection and unattended execution.

## Admission and operator sequence

1. Separately provision and protect two owner-controlled Ed25519 signing
   identities and configure the public keys and aliases locally. No key
   generation, enrollment or installation is performed here. The proposal
   issuer cannot issue owner consent merely by having its own key.
2. Authenticate the owner through an independently trusted, revocable owner
   session and disclose the exact host, target and action. This module verifies
   the owner signature but does **not** implement owner login or a consent UI;
   possession of a key alone does not establish a current owner session.
   Observation and discovery require their own explicit consent.
3. Use `canonicalNativeProposal` to serialize the fixed-field proposal and
   sign those exact UTF-8 bytes with the proposal key. The purpose, host,
   request ID, action, normalized parameters, nonce and millisecond expiry are
   authenticated. Submit with `propose`.
4. Present the exact proposal to the owner. Sign `canonicalNativeConsent`
   with the separate owner key, binding its decision to the proposal digest,
   request, host and action. Nonces are 32 random bytes represented as
   lowercase hex. Both deadlines must be future Unix milliseconds no more
   than five minutes away. The consent may be an explicit denial.
5. `dispatch` consumes a valid approval and returns `unavailable`; it never
   invokes an adapter. `readback` returns the durable local admission record,
   not proof of any external action. A repeated request or nonce is rejected.
   The store records hashes and metadata, not cell values or screen contents;
   hashes of low-entropy values can still reveal information by guessing.

The local API has no built-in authentication around `revoke`, and must only be
held by the trusted local operator. Revocation is durable and blocks new
proposals, consents and dispatches; historical readback remains available.
There is no remote revocation mechanism.

## Recovery and remaining work

On `native-host-reconcile-required`, lost acknowledgement, interrupted lock,
or inconsistent ledger readback, stop and inspect the local record under
trusted operator control. Never retry a potentially dispatched state change
without independent readback. The current slice cannot dispatch, so it cannot
produce a native timeout or external action receipt; a future runtime needs
durable pre-dispatch fencing, timeouts that do not imply cancellation,
independent effect readback, reconciliation of unknown acknowledgements, and
no automatic replay before any side effects can be admitted.

Native runtime design, live Windows session selection, redaction, UIA and COM
isolation, workbook identity checks, desktop owner-session authentication,
privacy-safe evidence, persistent secure storage, and independent adversarial
and end-to-end testing all remain required. Do not wire this contract into
Council, an HTTP/WebSocket server or a background service before those
controls are implemented and reviewed. No provider, deployment, authorization,
or native execution is implied by these source files.
