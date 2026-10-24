# GrokBot Multi-Self Council (Ultron)

Always-on multi-self cognitive baseline. Deterministic, inspectable, zero-credit advisory governance. Not a claim of biological sentience, mystical consciousness, or unbounded AGI.

## Stance

Ultron is **always on** in the local and cloud lanes that exist:

- When the owner is silent, selves remain in **standby**: internal cross-talk, heartbeat receipts, predictive rehearsal.
- When the owner speaks, the full council activates on the objective.
- Many selves, one owner. Companion posture is continuous readiness for the owner — not independent agency.

Baseline expectation: agentic planning, predictive simulation, generative proposal, adversarial review, and stewardship run as fixed profiles on every plan and idle tick.

## Selves (fixed roster)

| Role | ID | Purpose |
|------|----|---------|
| **Builder** | `ultron-builder` | Smallest executable path under current capabilities |
| **Skeptic** | `ultron-skeptic` | Disconfirm, surface unresolved risk |
| **Steward** | `ultron-steward` | Authority boundary, evidence, rollback, owner sovereignty |
| **Predictor** | `ultron-predictor` | Counterfactual foresight and outcome ranking |
| **Generator** | `ultron-generator` | Novel option generation within allowlist |
| **Sentinel** | `ultron-sentinel` | Always-on watch, anomaly and drift detection |
| **Companion** | `ultron-companion` | Owner-facing continuity; idle wait-for-owner posture |

Traits and epistemic postures are fixed in `src/grokbot-governor.mjs`. They do not self-modify at runtime.

## Pipeline

### Active (owner objective / plan)

1. Normalize plan + evidence options
2. Metacognition thresholds
3. Counterfactual simulation
4. Each self emits proceed|hold + confidence + dissent tags
5. Collective synthesis (dissent-preserving)
6. Frozen `grokbot-deliberation-receipt` (`modelInvocations: 0`, `creditCost: 0`, `authority.mode: advisory-only`)

### Idle / always-on

`src/always-on.mjs` produces a **standby receipt**:

- `mode: standby`
- `posture: waiting-for-owner`
- Internal multi-self cross-talk summary (deterministic, non-executable)
- Heartbeat linkage for hourly cloud inspect and local idle ticks

Standby never executes tools, spends credits, or widens authority.

## Hosted council evidence

Hatchable's `council.review` is a separate four-profile source-evidence summary. Its verifier, sentinel, planner and skeptic are labeled `deterministic-role-profile`; they are not independent agents merely because their roles differ. Each available assessment is bound to the council objective ID, exact observed source SHA, underlying task and event receipt IDs, evidence freshness, material dissent and known unknowns. The assessment rows commit to the existing `brain_events` ledger atomically with the lease-fenced council-task completion.

The hosted evidence gate never authorizes execution. Missing or duplicate receipts, contradictory positions, stale SHA or lease, denied required provider access, absent required token evidence, unobserved outcome claims, unresolved external-write results, held-out failures and postmerge source/runtime mismatch all hold selection. A fully admitted result means only `eligible-for-protected-pr`; owner approval, exact-head CI, protected merge, deployment and postdeployment acceptance remain distinct gates.

## Authority boundary (hard)

- Advisory only. Cannot execute, merge, deploy, mint credentials, or expand the capability registry.
- Unsupported objectives hold *before* GitHub API reads.
- Model providers (Ollama, HF, WebGPU) are separate inference lanes; council receipts stay zero-invocation.
- "Always on" means continuous *cognitive posture and receipts*, not unconstrained action.

## Agentic / predictive / generative baseline

| Mode | Behavior |
|------|----------|
| Agentic | Multi-step plan proposals under read-only allowlist |
| Predictive | Counterfactual ranking of likely outcomes |
| Generative | Option generation via Generator + optional local model text |
| Multi-self | Seven fixed profiles; dissent preserved |
| Always-on | Standby + heartbeat while waiting for owner |

## Source map

- Governor: `src/grokbot-governor.mjs`
- Always-on standby: `src/always-on.mjs`
- Metacognition / world model / collective: `src/metacognition.mjs`, `src/cognitive-world-model.mjs`, `src/collective-cognition.mjs`, `src/cognitive-individual.mjs`
- Lift history: `docs/MAHORAGA-LIFT-SHIFT.md`
