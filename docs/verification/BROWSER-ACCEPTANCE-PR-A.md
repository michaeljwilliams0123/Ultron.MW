# PR A — Browser execution acceptance (issues #65 and #32)

## Scope and evidence boundary

This change augments the merged PR #64 foundation. It keeps GitHub Pages,
GitHub Actions, source protection, and existing routing unchanged. It does not
deploy a browser service, add a paid provider, reuse an existing browser profile,
or claim an external login or owner-authenticated browser session.

The fixture acceptance runs actual installed Chrome via optional Playwright
on two ephemeral **loopback** origins. The callback that approves fixture
actions is explicitly synthetic and must never be used for external sites.
The user-operated CLI continues to require a local per-step challenge. A TTY
indicates an interactive local operator, NOT an authenticated third-party owner.

## How to reproduce on an authorized Windows test machine

From a clean isolated checkout:

```powershell
npm.cmd install --no-save --package-lock=false --ignore-scripts playwright
node --test test/computer-executor.test.mjs test/computer-bindings.test.mjs test/computer-session.test.mjs
node scripts/computer-browser-acceptance.mjs --synthetic
node scripts/verify.mjs
```

The optional `playwright` package and installed Chrome are host prerequisites,
not changes to the project's committed dependencies or lockfile. System Chrome
is selected explicitly (`channel: 'chrome'`), not a privileged existing profile.
The existing local owner-operated script can select system Chrome using
`ULTRON_BROWSER_CHANNEL=chrome`; it still requires every action's TTY approval.

## Acceptance matrix

| Assertion | Validation | Evidence status |
| --- | --- | --- |
| Two distinct loopback origins | Real Chrome navigates fixture A and B | Local synthetic proof |
| Type and click with post-action readback | Fixture form save and independently fetched state | Local synthetic proof |
| Crash-safe idempotency | Rerun same objective, one external write | Local synthetic proof |
| Visual observation | SHA-256 of real screenshot and accessibility snapshot in each receipt | Local synthetic proof; hashes, not image interpretation |
| Foreign redirect | Allowed origin responds with 302 to forbidden third origin; third server must receive zero requests | Local synthetic proof |
| Ambiguous disconnect | Browser closes just after actual submit; objective requires reconciliation; repeated run makes no second write | Local synthetic proof |
| Owner session bounds | Independent injected verification callback, expiration, revocation, origin and approval cap | Unit tests; no external identity connected |
| Actual authenticated SaaS owner approval and MFA takeover | Requires a connected approved owner host and authorization provider | **Not proven** |
| Screenshot-driven semantic visual reasoning and session persistence across devices | Requires separately accepted implementation and redaction policy | **Not proven** |
| Production GitHub Pages dispatch and saved authenticated GitHub receipt | End-user session validation and current-main workflow evidence | **Not proven by this fixture** |

## Security boundaries

- `route.continue()` by itself did not block HTTP redirects after an admitted
  URL. Redirect-safe interception now fetches only the already-admitted request
  with `maxRedirects: 0`, checks its `Location` origin, then fulfills or aborts.
  The actual Chrome test caught the previous forbidden-origin contact.
- WebSockets and popups remain closed; service workers remain blocked.
- Screenshot buffers and accessibility snapshots are hashed **in memory**;
  their raw bytes/text are not included in durable checkpoints or test receipts.
  The DOM text is used in volatile verification and its digest is persisted.
- The injected `verifyOwner` callback **must be implemented by a trusted,
  authenticated host**; arbitrary webpage JS or an LLM cannot be a verifier.
- The local console runner is a bounded, interactive operator tool, not SSO.
- An action already in flight at revocation may have executed. Its unverified
  outcome remains `reconcile-required`; it cannot be silently replayed.
- Application-layer allowlists are not protection against DNS rebinding or
  arbitrary private-network access in a hosted runtime. Add network-level
  egress controls before expanding beyond approved local testing.

## Release boundary

Draft PR only. Do not merge on test-green alone. Issues #65 and #32 must stay
open until external owner-authenticated acceptance, actual approved browser UI,
negative-path gate and source-of-truth receipts have been witnessed.
