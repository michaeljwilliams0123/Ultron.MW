# Ultron Architecture Component & Retirement Register — 2026-11-09

**Status:** proposed decision inventory under #346; evidence-based, **not** authorization to decommission. Classification is about the listed scope, not the entire codebase. Owner approval, tested replacement, runtime postcondition and rollback are mandatory before **RETIRE-CANDIDATE → RETIRED**.

| Component / inspected path | Evidence / distinction | Decision | Follow-up owner / acceptance |
| --- | --- | --- | --- |
| `src/framework-integration-runtime.mjs` | Supports modern MCP `2026-07-28` metadata, `server/discover`, and legacy `2025-06-18` `initialize` fallback; no evidence of long-lived `Mcp-Session-Id` in this file | **KEEP + MODERNIZE interoperability** | #348 / #346; test actual HTTP/stdio client matrix, headers, auth, version negotiation and fallback. Retire old branch only when client usage and tests justify |
| `src/framework-builder.mjs` and `docs/FRAMEWORK-BUILDER.md` | Generates restricted status/CI stdio MCP and HTTP PR-scoped connectors, not a general persistent remote server | **KEEP, audit generated specs** | #189; preserve stdio for local tooling, add conformance checks if generated adapter behavior diverges |
| Native Hatchable `cloud/hatchable/hatchable.toml` | `[mcp] enabled = true` and cloud configuration; this alone cannot certify version negotiation or token permissions | **KEEP, PROBE** | #348/#187/#194; live authorized client conformance without disclosing credentials |
| `cloud/hatchable/lib/brain-core.js`, task/event ledger, C01 migrations and hourly `/api/brain/tick` | Durable task, lease, readback, scheduling and recovery state are business/application data, not MCP transport sessions | **KEEP — protected source of truth** | #183/#184/#204; no task/event deletion as part of stateless MCP migration; preserved retry, dedupe, reconciliation and release evidence |
| `src/self-scan-pr.mjs`, existing static checks | Deterministic inspection exists; current repository searches did not locate full Tree-sitter/IR/interprocedural taint implementation | **MODERNIZE by benchmarked addition** | #349 / #173; characterize false positives and misses before choosing parser; avoid unsupported 80–95% savings claims |
| `src/experience.mjs` and `src/learning.mjs` | Existing verified-outcome filtering and candidate skill/harness evaluation | **KEEP, EXTEND by evidence** | #193/#222; propose redacted fingerprints, HOT cache, staged skills and held-out evaluation, never a second authority store |
| Existing agent orchestration and `cloud/hatchable` worker code | One orchestrator/Hatchable-led execution is already used; no verified A2A runtime implementation from inspected source searches | **KEEP internal, DEFER A2A** | #190; use A2A 1.x only for independently authorized external agents after replay, auth and cross-peer acceptance |
| `src/operations.mjs`, local loopback paths and local stdio consumers | Optional local functions and local transport serve distinct usage; local stdio is not the deprecated HTTP+SSE path | **KEEP unless explicitly superseded** | #167/#170; no PC dependency for cloud core, but do not break optional local adapter without parity |
| `docs/ARCHITECTURE.md`, `docs/ACCEPTANCE-STATUS.md`, GitHub Pages fallback | Dated diagrams/descriptions remain useful historical evidence but some primary UI wording is behind current Hatchable configuration | **MODERNIZE index, RETAIN history** | #170/#194; link new decision; retire Pages separately after owner UI, auth, mobile, stop/recovery and rollback pass |
| Ad-hoc provider-specific wrappers and generated connectors | Existence of wrappers alone does not show exponential M×N duplication or faulty security | **AUDIT, NO BLANKET RETIREMENT** | #189/#187; consolidate only after inventory, contract equivalence, egress, error/identity/cost compatibility and actual live canary |
| Legacy SSE/initialized routes in unknown external clients | 2026 MCP deprecates *protocol* sessions; no exhaustive inventory of external consumers has been produced | **DEFER** | #348; gather clients, versions, traffic/error data, published window and fallback tests before deprecation |
| Third-party SaaS sessions and browser state | Authentication/session ownership is required for actual authorized third-party browser actions; this is not an MCP session header | **KEEP required security state** | #192/#285; independent SaaS effect readback, revoked-session denial, no credential laundering |
| Existing GitHub App credentials, HMAC keys and Vault | Security-sensitive protected configuration; presence does not prove provider rights; not technical debt to delete | **KEEP with scoped identity reviews** | #169/#342–#345; owner consent and step-up for privileged changes, no self-escalation |

## Controlled retirement procedure

A candidate is eligible for a removal PR only after a completed `inventory → contract → replacement → canary → rollout → postcondition → rollback readiness` record. The implementing PR must state: exact file/route/consumer and current-main SHA; old/new protocol compatibility matrix; owner approval and timing; expected operation-level identity; dedicated negative, replay and chaos tests; actual $0 paid-spend readback; independent provider postcondition; fallback and deployment rollback; and issue links.

Unknown consumers, stale docs, uncertain writes, missing runtime conformance or nonzero unapproved paid cost are **HOLD**, never implicit removal approval. A successful unit test is not a production decommission receipt.

## Follow-up implementation mapping

- **Protocol and transport compatibility:** #348 (MCP conformance), #346 (governance) and #189 (adapter factory); no immediate code deletion.
- **Hybrid AST/IR and machine-readable analysis:** #349 (measured AST/IR), #173 (evaluation) and #204 (evidence).
- **Collective memory / candidate skills:** existing #193 and #222.
- **A2A peer interoperability:** existing #190, behind #184's independent scheduler readiness gate.
- **Credentials, owner step-up and authorization:** existing #169, #187, #225, #342–#345.
- **Live external outcome test and CI release:** existing #192, #204, #285 and #195.
- **Single command center and legacy console retirement:** existing #170, #194.
- **Cross-cutting architecture governance:** #346 and this register.

**Evidence quality:** User-provided Gemini blueprint is a useful proposal, but its claims of an inaccessible repository and astrophysics-related developer profile are not connected-Ultron facts. The 80–95% savings figure is also not a measured Ultron baseline. The official 2026 MCP protocol gives migration and backward-compatibility rules, not a blanket order to delete all sessions or software wrappers.

## Addendum — administrative and browser execution inventory

The [owner-admin/browser governance decision](OWNER-ADMIN-BROWSER-EXECUTION.md) reconciles the additional November 9 proposal against Ultron source. These are **KEEP / HARDEN**, not retirement orders:

| Existing component | Decision | Required before any proposed replacement |
| --- | --- | --- |
| `.github/workflows/council-worker.yml`, `scripts/council-worker.mjs` | **KEEP** one bounded GitHub worker | Prove a replacement respects the Hatchable ledger, owner scope, environment handoff and no source-to-shell interpolation (#187/#204) |
| `src/browser-action.mjs` | **KEEP** isolated DOM-only action path | A proposed authenticated multi-site path must preserve origin/egress controls and separately attest provider effects (#192) |
| `src/browser-external-write.mjs` | **KEEP** internal service write canary | Do not conflate one validated Hatchable readback with arbitrary SaaS login/write capability (#192/#285) |
| `docs/OWNER-SOLE-AUTHORITY.md`, existing owner P-256 grants | **KEEP** existing step-up authority | No arbitrary `humanApprovalSignature` presence check or second admin grant authorizer (#169/#225) |
| New `admin-execution.yml`, `governance-gate.yml` proposed by external blueprint | **DEFER** competing dispatcher | Require proven capability gap, isolated design review and parity against one current executor; do not create merely to match a sample file tree (#169/#187) |
| Proposed regex-only `taint_engine.ts` | **DEFER** as AST/IR replacement | Demonstrate measured parser/flow recall and false negatives; regex alone is not a taint engine (#349) |

The snippet's suggested `BROWSER_STORAGE_STATE` serialized workflow secret and direct `github.event.inputs.payload_json` shell interpolation are **not** accepted as baseline patterns. Any real provider session requires expiry/revocation, redaction, tenant/origin binding and independent provider readback before promotion.
