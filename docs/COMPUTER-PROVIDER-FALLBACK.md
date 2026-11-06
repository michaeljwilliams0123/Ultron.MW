# Provider-first browser fallback

`src/computer/provider-fallback.mjs` is a local integration seam, not a
deployed Hatchable tool. It invokes a supplied provider adapter first. A
browser opens only if that adapter explicitly returns `status: "unsupported"`
and `dispatched: false`. A failure, exception, held operation, malformed
response, or uncertain provider outcome never triggers a fallback.

The provider is trusted code: its unsupported result must be based on a
decision made **before** any side effect. A caller must supply its own
durable provider admission, idempotency, and independent reconciliation;
this seam cannot prove a provider's claim or prevent a faulty provider from
dispatching. A browser fallback is not safe after a provider timeout.

The browser path requires an enabled computer binding, an explicitly
supplied authority callback, an owner-session continuation callback, and a
durable store with a per-plan lock. It launches a fresh headless context using
the binding's exact origin allowlist and the existing Playwright network
policy, executor preflight, checkpoints, and action-level approval.
Playwright and browser binaries must already be installed in the selected
runtime; this module does not install them or connect an account. The caller
must provision and protect the actual durable store and owner authority.

The browser execution deadline defaults to 120 seconds and can be reduced via
`browserDeadlineMs` (1–120000 milliseconds). On expiry, the executor stops
admitting new driver operations, closes the browser, and returns
`reconcile-required`: an already dispatched operation may have taken effect.
A pending owner callback or store operation can continue after that return;
the per-plan lock remains held until the executor actually exits. The deadline
does not cover the provider, browser launch, or browser close, and depends on
the JavaScript event loop being responsive. Browser close failures are surfaced.
The isolated launcher's individual navigation, interception and action timeouts
also apply. This is not a universal MCP gateway or a
Microsoft Graph integration, and does not establish a provider connection or
prove that a hosted runtime has network enforcement.
