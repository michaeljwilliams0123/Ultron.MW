# Ultron MW — Architecture Governance Decision (AGD-2026-11-09)

**Status:** adopted on `main` in squash-merged PR #347 (`57d5107ec4738101e4999dbb685a30432f8f37d4`), closing issue #346. This is a repository policy and review contract, **not** a claim of runtime admission enforcement or production deployment. Specific implementation and live acceptance remain governed by linked open issues.

**Canonical name:** Ultron MW Cloud Brain (never "Ultro"). **Source and CI:** `michaeljwilliams0123/Ultron.MW`. **Owner-facing UI and cloud control:** `https://ultron-mw-cloud.hatchable.site`, project `proj_A6GCXRSKizko`. **Durable execution authority:** Hatchable PostgreSQL. GitHub owns branches, PRs, tests, exact-head release evidence. GitHub Pages remains an explicit fallback until #170 proves retirement parity. Mahoraga, GitLab, Codex and third-party services are external peers, not implied co-owners.

## 1. Authority and source of truth

1. The single authenticated owner (`michaeljwilliams0123`) authorizes consequential operations. Council opinions, model output, task text, browser pages, A2A peer messages and stored memories are **untrusted input**, not credentials or policy changes.
2. Keep the existing operation-scoped and versioned authorization path: explicit resource/actor/operation, owner P-256 grant where required, fresh step-up for privileged changes, expiry, idempotency key, pause/stop/revoke, $0 additional paid spend, and independently observed postcondition. A model may propose but **cannot issue its own grant** or widen its effective permissions.
3. Never put tokens, HMAC values, signing private keys, authenticated session cookies or raw private data in source, issues, receipts, model prompts or output. Separate provider read-only, write and administrative identities; use short-lived operation-scoped tokens wherever supported. **Configured != authenticated != authorized != verified external effect**.
4. Keep the existing issue priority order and dependent acceptance contracts. A new architecture standard cannot reopen previously *scoped* accepted milestones or turn a green test into unproved production release. See #169, #187, #204, #225, #342–#345.
5. External writes require authenticated scope, precondition, durable intent before network dispatch, independent provider-side readback, reconciliation after unknown outcomes, and no blind replay; the November 9 controlled browser-to-Hatchable receipt #341 is **not** third-party SaaS login acceptance (#192).

## 2. Protocol and transport governance

- Preferred **new remote MCP** target: official `2026-07-28` with JSON-RPC 2.0, per-request `_meta` protocol/client capabilities, explicit tools/resources/prompts contracts, `server/discover` when needed, and Streamable HTTP with modern authorization and required routing headers. Explicit OAuth client and issuer binding apply to remote clients; do not assume an authorization grant from a protocol header.
- The 2026 stateless **protocol transport** removes `initialize`, `notifications/initialized` and `Mcp-Session-Id` for *modern-version requests*. **Do not conflate this with stateless business execution**. PostgreSQL tasks, outbox/inbox, leases, authorization, replay protection, owner session management and persistent cloud-browser sessions remain durable where their contracts require them.
- Older clients are supported through a **measured compatibility route**, subject to live usage inventory, version negotiation, tests, and owner-approved removal. `src/framework-integration-runtime.mjs` already recognizes modern `2026-07-28` and legacy `2025-06-18`; do **not** delete its old handshake branch before clients and tests have migrated. Streamable HTTP may still return request-scoped SSE: it is **legacy HTTP+SSE transport** that is deprecated. Local `stdio` remains a valid transport for local-only MCP; a remote-only policy must not remove it.
- New tool wrappers must declare schema, identity, resource fence, effects, cost, error modes, limits and readback. Native Hatchable MCP transport must be independently probed; `[mcp] enabled = true` alone does not prove remote-version compatibility.
- A2A is an **optional interoperability boundary for independently deployed agents** (e.g., Mahoraga or authorized external peer), not a mandatory replacement for the internal Council or a means to share credentials. Require authenticated AgentCards, version/capability negotiation, bounded delegate authority, correlation IDs, idempotency, timeout/recovery and independent peer evidence. See #190.

See the [MCP source-versus-live conformance matrix](MCP-CONFORMANCE-MATRIX.md) for observed and unresolved compatibility evidence under #348.

**Primary references:**
- https://blog.modelcontextprotocol.io/posts/2026-07-28/
- https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/changelog.mdx
- https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/transports/streamable-http.mdx
- https://github.com/a2aproject/A2A/blob/main/docs/specification.md

## 3. Hybrid code and tool analysis

- Preserve current deterministic issue routing, source fences, policy engine, CI, and fixed protected release checks. **Proposed**, not currently demonstrated as a full engine: incremental Tree-sitter AST index; semantic source/sink inventory; cross-file call/dependency graph; bounded taint/flow analysis; and SARIF export.
- Use static candidate filtering *before* expensive or model-assisted review. If static analysis produces no flow, report uncertainty and use an **opt-in, policy-approved zero-flow fallback**, never an automatic safe verdict. LLM findings are hypotheses requiring evidence; no direct model-created repository write without usual gates.
- Target measurable outcomes: baseline false-negative rate, known taint benchmark recall, end-to-end latency, dollar/tokens per case, and producer/consumer coverage. The supplied blueprint's **80–95%** token saving is an **unverified aspiration**, not a measured Ultron result or a release criterion.
- Validate machine-readable model output using the language-appropriate schema validator (Node JSON Schema or equivalent in this JS repo; Python/Pydantic only in a Python component). Retries must be bounded, charged against a $0 paid budget, and leave uncertain mutation effects unresolved until readback. See #173, #189, #204.

## 4. Collective memory, reusable skills and evaluation

- Existing `src/experience.mjs` and `src/learning.mjs` select from independently verified outcomes; current PostgreSQL receipts remain authoritative. A future **Trajectory Hub** should index *redacted* action/outcome fingerprints and provenance rather than copy secret-bearing raw transcripts into a second privileged store.
- **HOT memory** is a revocable, versioned cache over authoritative records, not a new grant or source of truth. Record source SHA, owner/tenant scope, artifact version, receipt ID, retention/expiry and invalidation fingerprints; prevent stale or cross-tenant retrieval.
- Recurrent patterns may become **candidate** skills, but candidates remain sandboxed and non-executable until independent held-out evaluation, explicit owner authorization, exact-head CI, capability classification and rollback evidence. Skill distillation cannot silently mint tools, credentials or active privileges. See #193, #222 and #204.

## 5. Component lifecycle and deletion controls

The companion [Retirement Register](RETIREMENT-REGISTER.md) is the explicit owner of **KEEP / MODERNIZE / DEFER / RETIRE-CANDIDATE** decisions. No batch deletion based on a generic framework label or external developer profile. Before deprecating anything, collect:
1. Exact source paths, deployed route/consumer inventory, current usage, version and owner.
2. Contract replacements and backward compatibility; tests for old/new client behavior and failure paths.
3. Canary in approved isolated environment, fresh exact-main CI, production parity, independent readback and zero-paid-spend verification.
4. Backout plan (source/DB/API/client), rollout/expiry window and an independently verified post-change check.
5. Owner-authenticated release decision and separate deployment receipt. Do not rewrite evidence or erase immutable historical ledgers.

No hardcoded immediate removal of `Mcp-Session-Id`, legacy SSE, custom wrappers, business workflow state, local stdio, GitHub Pages fallback or older vendor integrations is authorized by this document alone. Current evidence must establish that an actual target exists and the alternate is operational.

## 6. Governance changes and review gates

A proposed architecture change is **not** runtime authority. Record a linked issue, source snapshot, affected components, current-vs-target difference, compatibility matrix, security/cost impact, negative cases, migration plan, rollback, and closure receipts. Follow standard branch → exact-head tests → technical review → owner-authorized squash merge → *separately verified* deployment. Use #204 for reusable evidence fields, #187 for actual authorization code, and #182 for the roadmap.

**Operational readiness states** must be reported separately: `proposed`, `sandbox`, `authorized`, `canary`, `active`, `revoked`, plus `blocked` and `reconcile-required` for outcomes. Never infer `active` from present config, an advisory Council vote, a PR merge or a one-off mocked test.

**Source provenance:** The November 9 user-provided Gemini architectural blueprint motivated this governance policy. Its unrelated claim about a developer's astrophysics profile is not supported by the connected repository and is excluded. This document reconciles that *proposal* with observable Ultron code and primary MCP/A2A specifications.

## 7. Owner-authorized admin and browser implementation boundary (2026-11-09)

The additional [owner-admin/browser execution governance addendum](OWNER-ADMIN-BROWSER-EXECUTION.md) translates the latest user-supplied administrative MCP/Playwright blueprint into the existing Hatchable/PostgreSQL authority, GitHub worker, owner P-256 grant and browser adapters. It identifies shell-injection hazards in proposed workflow inputs, insufficient signature-presence tests, unsafe global cookie restoration, regex-only "taint" claims, unverified `_meta` authorization, and DOM-only completion claims. It is **not** a second executor or a production activation.

Adopt the existing #169/#187/#192/#204/#225 contracts, require provider-side independent write readback and preserve #351's protected workflow failure gate. No mass code replacement, permissions widening, new secret, second required human approval, or paid provider activation is justified by example code alone.
