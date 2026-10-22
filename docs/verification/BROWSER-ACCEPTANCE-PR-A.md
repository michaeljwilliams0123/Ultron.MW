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
| Redirect isolation | A direct foreign 302 and an apparently safe same-origin first-hop 302 both fail closed; third server receives zero requests | Local synthetic proof |
| Ambiguous disconnect | Browser closes just after actual submit; objective requires reconciliation; repeated run makes no second write | Local synthetic proof |
| Owner session bounds | Independent injected verification callback, expiration, revocation, origin and approval cap | Unit tests; no external identity connected |
| Session stop during observation/checkpoint | Revocation denies subsequent passive navigation; a pending checkpoint becomes reconciliation-required without dispatch or replay | Unit tests; no external identity connected |
| Actual authenticated SaaS owner approval and MFA takeover | Requires a connected approved owner host and authorization provider | **Not proven** |
| Screenshot-driven semantic visual reasoning and session persistence across devices | Requires separately accepted implementation and redaction policy | **Not proven** |
| Production GitHub Pages dispatch and saved authenticated GitHub receipt | End-user session validation and current-main workflow evidence | **Not proven by this fixture** |

## Security boundaries

- `route.continue()` by itself did not block HTTP redirects after an admitted
  URL. More importantly, even `route.fulfill({ response: 3xx })` can permit a
  browser-native redirect chain without invoking another route handler.
  The worker now uses `maxRedirects: 0` and **rejects every HTTP 3xx**,
  including apparently safe first hops. A future redirect-aware network
  implementation is required before ordinary redirecting websites and the
  standard POST/Redirect/GET pattern can be supported. The synthetic form
  intentionally responds with HTTP 200 and verifies persisted state separately.
- WebSockets and popups remain closed; service workers remain blocked.
- Screenshot buffers and accessibility snapshots are hashed **in memory**;
  their raw bytes/text are not included in durable checkpoints or test receipts.
  The DOM text is used in volatile verification and its digest is persisted.
- The injected `verifyOwner` callback **must be implemented by a trusted,
  authenticated host**; arbitrary webpage JS or an LLM cannot be a verifier.
- The local console runner is a bounded, interactive operator tool, not SSO.
- `canContinue` is checked before/after observation and before dispatch of
  **all** actions, including navigation. On expiry or revocation, no new step
  is dispatched. If the session ends after a pending checkpoint is saved, the
  worker conservatively requires reconciliation instead of replay.
- An action already in flight at revocation may have executed. Its unverified
  outcome remains `reconcile-required`; it cannot be silently replayed.
- Application-layer allowlists are not protection against DNS rebinding or
  arbitrary private-network access in a hosted runtime. Add network-level
  egress controls before expanding beyond approved local testing.

## Independent read-only Pages smoke

Using a **fresh, cookie-free Chrome context** against the existing public Pages
deployment (not the draft PR), the Brain, Learning and Systems tabs were
clicked and verified at desktop (1280 × 760) and mobile (390 × 844) viewports.
Both document navigations returned HTTP 200 with zero observed page errors.
Screenshots were hashed only in memory, not saved or published. This is
unprivileged UI rendering/navigation evidence; it does **not** establish
authenticated GitHub dispatch, live browser owner approval, or the PR's
unmerged code running in production.

## Release boundary

Draft PR only. Do not merge on test-green alone. Issues #65 and #32 must stay
open until external owner-authenticated acceptance, actual approved browser UI,
negative-path gate and source-of-truth receipts have been witnessed.
