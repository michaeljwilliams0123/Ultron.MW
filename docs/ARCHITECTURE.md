# Ultron architecture — decision 001

## Identity and authority
One operator, one cognitive coordinator, one responsive interface. Multiple model providers or workers are *adapters*, not personalities, separate control panels, or independent governing agents. The owner's explicit intent is the starting objective; the runtime distinguishes drafts, read-only inspection, reversible edits, and irreversible or costly actions.

## Host choice
1. **Default**: local Node runtime bound to loopback; UI served by the same process. Local persistent store and provider plugins are future modules.
2. **Portable display**: GitHub Pages hosts the same static UI, with no keys or privileged endpoints. It shows **disconnected** until an authenticated execution transport exists. GitHub Pages cannot run the brain.
3. **Remote execution**: only if cross-device, always-on execution is truly required, add a narrowly scoped authenticated HTTPS transport. This could be an existing provider, private overlay, or Cloudflare *only when needed*.
No GitLab mirror, second dashboard, public execution API, or duplicated routing stack by default.

## Universal learning (bounded, measurable and reversible)
```
Owner objective → Coordinator → Deterministic tools / selected model
      ↓                     ↓
 Interaction receipt ← Result + observed outcome
      ↓
  Feedback with evidence and objective-specific score
      ↓
  Candidate harness / prompt / policy / strategy (immutable identifier)
      ↓
  Replay on held-out regression cases, provider availability tests, time/cost checks
      ↓
  Compare baseline vs candidate under identical tasks and constraints
      ↓
  Commit versioned candidate only when evaluation passes hard constraints and score improves
      ↓
  Canary → observe → rollback on regression
```
Model-weight training is a later, separately provisioned capability; harness optimization is useful without GPUs. A claim of 'learning' requires a material, measured version change.

## Learning contract
- Receipts carry unique IDs, task IDs, a provenance label, score (0–1), timestamp, and evidence.
- Duplicate observation IDs are ignored. A failed or stale observation cannot masquerade as another successful run.
- Candidate evaluation must be independent of the candidate's own opinion: at least a fixed sample, explicit baseline/candidate scores, and a count of critical regressions.
- A candidate **does not auto-promote** merely because it has more positive votes. No update if baseline is missing, evaluator data invalid, sample insufficient, critical regression nonzero, or improvement below threshold.
- Promotion retains its parent, timestamp and evaluation receipt; rollback restores the previous accepted version.
- Store sensitive observations locally; redact before any optional remote telemetry.

## Simplest reliable control pattern
- Deterministic layer: identity, deduplication, authorization, state transitions, retries, timeouts, release evaluation and receipts.
- Single AI coordinator: decomposition, uncertain semantic interpretation, adaptive model/tool choice.
- Tool adapters: filesystem, repository, browser, and optional remote providers. Every adapter publishes actual capabilities and permission scope.
- No claims of autonomous tool execution until end-to-end receipts are validated.
- Reuse one execution ledger and one learning ledger; avoid orchestration-on-orchestration.

## Plugin contributions
| Source | Adopt in Ultron | Avoid |
|---|---|---|
| Agent Router | single-agent admission test and deterministic-workflow-first | speculative multi-agent swarms |
| Reef / CRIADOR | Serve, Observe, Grow, Commit with versioned artifacts and evaluation | pretending harness optimization equals weight training |
| Brancha | keep alternative UI/architecture directions in separate comparison nodes | running Brancha as a second required UI |
| Adaptive Task Routing | phase-aware context/model decisions at task boundaries | repeated unnecessary handoff loops |
| AI Psychiatry | observable evidence, finite completion criteria, bounded retries | recursive governance growth |
| Develoop | issue/PR traceability and regression evidence when changes are substantive | approval theatre for trivial edits |
| Context7 | verify API and build assumptions against library docs | fossilized snippets |
| GitLab | optional upstream comparison when a project actually exists | mandatory mirroring |
| Datadog | optional diagnostic traces only when installed and useful | mandatory third-party telemetry |
| Datadog Experiments | candidate flags only if already onboarded and justified | creating services for zero existing flags |

## Acceptance requirements (not yet satisfied)
1. Local UI reflects a real connected runtime and persisted objective receipt after refresh (automated Node integration coverage exists; actual owner-device/browser acceptance remains outstanding).
2. Tool capability manifest and one harmless authorized end-to-end read-only execution (implemented and integration-tested with loopback HTTP; device acceptance outstanding).
3. Learning case is recorded; bad candidate rejected; good candidate canary promoted, then rolled back with preserved evidence (synthetic deterministic benchmark tests only; trusted real-world evaluation not integrated).
4. Same UI runs locally and on phone without exposing secrets. If phone requires remote runtime, demonstrate authenticated transport.
5. GitHub Pages shell is optional, static, and non-secret. Cloudflare is absent until a specific unmet requirement demands it.

## Naming boundaries
- Historical: `mahoraga` and archived `mahoraga-baseline-20261018`.
- New system: `Ultron.MW` (product name Ultron).
- Do not rename or redirect the old production repository as part of bootstrapping.

## Review remediation tranche
Current local API: GET /api/health, /api/capabilities, /api/state and POST /api/objectives (draft only), POST /api/execute (four allowlisted read-only commands). The server binds exclusively to 127.0.0.1, validates Host and write Origin, uses no Cloudflare, and stores objective/receipt state with serialized atomic writes. GitHub Pages serves exactly the same UI source, but is disconnected from the local runtime until authenticated remote access is explicitly implemented. No arbitrary command or autonomous LLM execution is represented as available.
