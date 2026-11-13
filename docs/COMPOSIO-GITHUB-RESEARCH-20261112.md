# Composio GitHub integration research — 2026-11-12

## Recommendation
Use Composio's current session API as an optional, read-only integration gateway. Keep Ultron's capability broker, signed owner authorization, GitHub App principal, durable outbox, and independent verification as separate security boundaries. Do not route GitHub mutations around those controls.

## Primary sources
- https://docs.composio.dev/toolkits/github — Current GitHub toolkit catalog, 905 tools.
- https://docs.composio.dev/docs/configuring-sessions — Session allowlists, connected account selection and execution configuration.
- https://docs.composio.dev/docs/authentication/managing-multiple-connected-accounts — Explicit selection for multi-account toolkits.
- https://docs.composio.dev/reference/sdk-reference/typescript/session — Session execute API and account option.
- https://docs.composio.dev/docs/production-readiness — Separate projects, stable user IDs and server-side credentials.
- https://docs.composio.dev/docs/sessions-via-mcp — Hosted MCP bypasses SDK pre/post execution hooks.
- https://github.com/ComposioHQ/composio — Official maintained SDK source.
- https://github.com/cycle-sync-ai/composio-get-started — User-supplied older sample relying on composio-core 0.5 and OpenAI inference; not a $0 production design.
- https://composio.dev/content/github-mcp-server-use-cases-setup-and-integration-guide — Architectural overview; does not certify production authorization.

## Evidence boundary
Using the connected Composio app in ChatGPT, the owner account login and ID matched michaeljwilliams0123 / 308995719 and the dedicated account matched michaeljwilliams0123ultron / 354634860. A connected-account repository read identified michaeljwilliams0123/Ultron.MW, repository ID 1424939667. This confirms those ChatGPT-connected OAuth accounts; their presence inside a separate Composio Platform project is not verified.

The dedicated account reports GitHub two-factor authentication disabled; the owner reports it enabled. Do not expand contributor permissions before addressing this.

## Proposed gateway in this branch
src/composio-github-session.mjs provides a fail-closed read-only policy and verifies immutable GitHub user and repository IDs, selecting the target connected account explicitly on each call. No deployment wiring, SDK dependency, API keys, account mutations, or paid service calls were added. The source branch is not production-accepted.

## Acceptance still required
- The Platform project needs its own verified connection IDs and server-only Composio key.
- The SDK session must be instantiated on the trusted backend with a stable user ID.
- Existing Ultron broker must authorize any later non-read transport; no write path is present in this change.
- Regression tests and CI must pass at the exact branch head.
- Live sandbox readback and failure-path checks are needed before enabling in production.
