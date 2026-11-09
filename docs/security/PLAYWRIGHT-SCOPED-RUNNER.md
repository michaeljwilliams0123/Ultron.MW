# Chunk 4: origin-bound Playwright action adapter

The executable runtime lives in `src/mcp/playwright_scoped_runner.mjs`; the
requested `src/mcp/playwright_scoped_runner.ts` is a typed facade because this
repository uses Node ESM and `node:test` without a TypeScript build pipeline.
This adapter is NOT an automatically exposed MCP tool or an owner approval service.

## Contract

- A trusted host passes `targetUrl`, a canonical approved `allowedOrigin`,
  `actionType` and an exact accessible target: `role=button[name="Save"]`
  for click, or `label=Display name` for fill. Raw CSS, pixels, arbitrary
  JavaScript, and password/MFA fill are rejected. Empty-string fill is valid.
- The host must supply `authorizeAction(metadata)`, backed by an existing
  verified, action-specific owner grant; user-controlled `_meta`, issue text,
  DOM content, and model assertions cannot create approval. The host must
  verify target origin against its own allowlist; the request is not authority.
- A restored `storageStateJson` is accepted only when every cookie hostname
  and browser storage origin exactly matches the selected origin; parent-
  domain cookies, third-party and partitioned cookies are refused. State is
  size-bounded and is never emitted as a receipt or console log. A persistent
  store must encrypt state per origin and honor revocation; no shared CDP
  profile is accepted.
- For restored state, `validateSession(page, origin)` and
  `revokeSession(origin)` are mandatory, and a failed auth check revokes the
  saved state. Login/MFA requires fresh owner takeover; this module does
  not capture or replay usernames, passwords or MFA codes.
- The runner creates a clean context, blocks service workers, installs the
  EXISTING `installNetworkPolicy` before page navigation (strict HTTP origin,
  redirect control, and no WebSocket connections), rejects extra tabs, pins
  the accessible DOM element before approval, and closes context/browser in
  `finally` even when denied. The trusted deployment must ALSO enforce a
  network-level DNS/IP egress boundary (e.g. to mitigate WebRTC and DNS
  prefetch); Playwright request interception is not a full network sandbox.
- Optional `persistSession(origin, validatedState)` receives only verified
  same-origin state and must be implemented by the trusted encrypted vault.
- `success: true` means an action was dispatched to the DOM, NOT a durable
  external provider write. Never auto-retry after an ambiguous click/fill;
  require independent provider-side readback, event receipt and reconciliation.

## Validation

Run `node --test test/playwright-scoped-runner.test.mjs`. The tests use
synthetic Playwright interfaces and exercise origin rejection, hostile state,
authorization denial, scoped action selection, expired session revocation,
network policy installation, and closure. Real live-browser acceptance,
provider-side write evidence and deployment are deliberately **not** claimed.
Playwright remains an optional dependency, installed only in an authorized,
network-isolated browser worker. No new paid services are required.

Related: `src/computer/playwright-driver.mjs` and governance PR #352.
