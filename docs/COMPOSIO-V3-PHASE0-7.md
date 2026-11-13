# Composio v3 / Ultron.MW Phase 0–7 execution record

Status: source candidate on PR #442. **No production Composio Platform credentials or signed grants have been validated.** All API calls from an independently hosted Composio worker remain disabled until that evidence exists.

## Phase 0 — Preflight
- Canonical repository: michaeljwilliams0123/Ultron.MW, ID 1424939667; canonical owner ID 308995719; delegated user ID 354634860.
- Both historical migration names 0039_autonomous_repair_checkpoints.sql and 0039_github_idempotent_executions.sql are separate files, each with a separate database table already observed on Hatchable. Do not rename, consolidate or replay them.
- Add migration 0046_composio_sessions.sql only. It seeds two PENDING principals and stores ID references and hash digests, not secrets.
- Baseline verification runs in the existing canonical GitHub Verify workflow: scripts/verify-fast.mjs and scripts/audit-route-references.mjs; the Composio SDK is installed and tested as an additional existing Verify job step without creating a ninth workflow. scripts/verify-hatchable-parity.mjs needs --manifest FILE --version N --head SHA; live parity must remain unverified until an exact pinned deployment manifest is available.
- src/server.mjs and src/capability-bindings.mjs remain unchanged. cloud/hatchable/OPENAI-AGENTS-INTEGRATION.md remains a design, not a deployed Composio gateway.

## Phase 1 — SDK
- integrations/composio is a separate Node >=22.22.3 ESM package pinned to @composio/core 0.29.0, keeping the root Node >=20 runtime intact.
- It uses Composio, SessionPreset, composio.create and composio.use; no OpenAIToolSet or legacy connectedAccounts.initiate().
- Scoped Platform API key needs Session management and Session tool execution. Proxy execute is a separate optional permission. No key is written to source, PR comments, browser, or database. No paid Instant use.

## Phase 2 — Accounts
- Source principal aliases are mw-primary (michaeljwilliams0123) and ultron-admin (michaeljwilliams0123ultron).
- This is **not** a rename of the independent ChatGPT Composio connector's owner/ultron aliases. Platform connection IDs must be obtained in that actual project, not copied from ChatGPT-hosted accounts.
- Mixed session: multiAccount enable true, maxAccountsPerToolkit 3, requireExplicitSelection true.
- Primary direct session pins connectedAccounts.github to a single verified owner ID. Every worker execution also passes the selected account explicitly.
- Conversation 1's claimed Custom Auth Config ID and signed grants were not retrieved. The database therefore starts as pending and no delegated connection is activated.

## Phase 3 — Governance and persistence
- A trusted server-only Postgres store atomically reserves sessions, activates them after policy readback and blocks duplicate/unsettled sessions. An uncertain creation is reconcile-required, never silently retried.
- Owner primary DIRECT_TOOLS profile is restricted to two GitHub metadata reads. Multi-account mode omits DIRECT_TOOLS and preload because Composio documents that preloading is incompatible with multi-account.
- The existing enforceSignedApprovalAndTagPersona middleware and gatePasses Council gate are imported by the guarded GitHub App bridge. This does not authorize Composio OAuth-based mutations; protected GitHub App credentials and existing migration 0039 idempotency remain the only write path.
- A verified external read is not returned as accepted until an independent PostgreSQL receipt query confirms the exact source, identity and observation digest.

## Phase 4 — Proxy and custody
- Session proxyRead wrapper admits only a dedicated primary account GET to /user, the exact canonical repository, or its main ref, using the provider-side authentication Composio injects.
- No caller-supplied Authorization header, arbitrary URL, write method, delegated account, or raw provider header/body is returned.
- account.state.val is display-only and masked to its first four characters. It is never interpreted as an access token.

## Phase 5 — Hatchable parity
- cloud/hatchable/lib/composio-v3-policy.js mirrors src/composio-v3-policy.mjs byte-exactly and is checked in CI.
- cloud/hatchable/api/brain/composio-v3.js is owner/admin-only readiness, always reports productionAccepted:false, and never serializes the Composio key or session IDs.
- The isolated Node 22 worker cannot be imported into a Hatchable V8 function; runtime connection requires an explicitly provisioned trusted worker, not automatic source deployment.

## Phase 6 — Testing
- Canonical .github/workflows/verify.yml installs the isolated SDK and runs worker tests, SQL migration/Postgres checks, mirrored policy tests, route audit and fast baseline without any Composio credentials. The initially attempted ninth workflow composio-v3.yml was removed after exact-head CI caught two workflow-governance violations.
- Repository's existing exact-head Verify and Council checks are separate gates.
- Source checks cannot establish live account authorization, production schema migration, signed owner grants, or a deployed worker.

## Phase 7 — Canaries and acceptance
- Live ChatGPT-connected Composio readbacks of the owner and contributor have succeeded in prior work, as has a bounded sandbox issue-write/independent readback/closure. Those do **not** demonstrate Hatchable-to-Composio Platform production acceptance.
- Platform production acceptance requires verified owner credential binding and Custom Auth Config ID; an enrolled/revocable delegated grant; server-only scoped API key; exact account pin and default owner readback; committed 0046 applied; independently persisted/read-back session receipt; Hatchable deployment manifest parity; and exact-head CI with no release policy bypass.
- Do not mark productionAccepted:true or squash merge until those actual conditions pass.

Official sources:
- https://docs.composio.dev/docs/configuring-sessions
- https://docs.composio.dev/docs/authentication/managing-multiple-connected-accounts
- https://docs.composio.dev/docs/extending-sessions/proxy-execute
- https://docs.composio.dev/reference/sdk-reference/typescript/session
- https://docs.composio.dev/reference/changelog
