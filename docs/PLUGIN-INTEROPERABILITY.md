# Plugin interoperability

The provider registry covers GitHub, Remote Desktop Commander, Descope, Hugging Face, Browser Use, Compound Engineering, and Caveman.

The runtime module is src/plugin-interoperability.mjs and tests are in test/plugin-interoperability.test.mjs.

This is an adapter for the existing authenticated capability broker. No catalogue entry grants execution authority.

Only broker bindings with matching provider, operation, effect, cost allowance, unexpired status, and a recent health probe can be routed. Skills are metadata only, not independent execution engines. Provider writes still require broker authorization, idempotency, and independently verified postconditions.

Existing cloud parity, browser acceptance, and separate executor identity requirements remain independently gated.

## Mahoraga control

`src/mahoraga-control.mjs` adds a write-capable, repository-bound GitHub App adapter.
It admits two actions: create a bounded issue on Mahoraga's exact current `main`,
and dispatch its existing `verify.yml` workflow on an exact `mahoraga/*` branch
head. Both actions require a Mahoraga-only installation token with the needed
permissions, a fresh broker health probe, an explicit broker authority decision,
zero declared cost, one idempotency key, and GitHub readback. An uncertain write
remains in `reconcile-required` and is never replayed blindly.

The operator must be configured with Mahoraga's repository ID, installation ID,
client ID and a protected private-key loader. The binding uses a protected
`ULTRON_MAHORAGA_GITHUB_APP_KEY` reference; no key belongs in source or in a
GitHub issue. Ultron's own repository grant cannot substitute for a Mahoraga
grant. An OpenAI API key, Descope project, or GitHub author display name cannot
prove this installation identity. This adapter does not grant a merge, release,
deployment, arbitrary file write, or Destiny Work-account attestation. Those
actions still follow Mahoraga's protected verification and authority policy.

This source integration is **not a live production connection** until a
Mahoraga-scoped app installation and protected runtime binding are configured
and the real action and readback are observed. The current broker holds attempt
state in memory; a hosted unattended caller must persist reconciliation state
under its durable task ID before activating writes.
