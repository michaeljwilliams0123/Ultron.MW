# GrokBot Cognitive Council (Ultron)

Deterministic, inspectable, zero-credit advisory governance. Not a live xAI Grok integration and not a claim of sentience.

## Roles

| Role | ID | Purpose |
|------|----|---------|
| **Builder** | `ultron-builder` | Smallest executable path supported by current capabilities |
| **Skeptic** | `ultron-skeptic` | Challenge completeness, evidence gaps, unsupported capability |
| **Steward** | `ultron-steward` | Calibrate confidence against metacognition; protect authority boundary |

Fixed traits and epistemic postures are defined in `src/grokbot-governor.mjs` via `createCognitiveIndividual`. They never change at runtime.

## Pipeline (every plan / cloud outcome)

1. **Normalize** plan + options (evidenceCoverage, calibratedConfidence, knownUnknowns, materialConflictCount).
2. **Metacognition** (`assessMetacognition`) — proceed only if evidence and calibration clear fixed thresholds.
3. **Counterfactual** (`simulateCounterfactual`) — uncertainty on blocked/ready steps under attempted action.
4. **Positions** — each role emits conclusion (`proceed`|`hold`), confidence, evidence refs, assumptions, dissent tags.
5. **Collective synthesis** — dissent-preserving merge; material conflict keeps `hold`.
6. **Receipt** — frozen `grokbot-deliberation-receipt` with `modelInvocations: 0`, `creditCost: 0`, `authority.mode: advisory-only`.

Decision is `proceed` only when plan is complete, capability-safe, metacognition allows, and collective decision is proceed. Otherwise `hold`.

## Authority boundary

- Advisory only. Cannot execute steps, widen capability registry, spend credits, invoke models, deploy, or merge.
- Receipt attaches to local saved plans and GitHub cloud outcomes (including hourly heartbeat).
- Unsupported / mixed-unsafe objectives hold *before* any GitHub API read.

## Live model providers (separate lane)

Council remains deterministic. Optional inference providers are selected by `docs/core/providers.mjs` and never grant action authority:

- **Ollama** — loopback, env-gated (`ULTRON_ENABLE_LOCAL_MODEL=1`)
- **WebGPU / WebLLM** — browser, explicit activation
- **Hugging Face Transformers** — local Node adapter (`ULTRON_ENABLE_HF=1`), uses `@huggingface/transformers`

Model output is unverified text. Brain allows at most two model calls + one allowlisted read-only tool per turn. Council receipts stay zero-invocation.

## Source map

- Governor: `src/grokbot-governor.mjs`
- Metacognition: `src/metacognition.mjs`
- World model: `src/cognitive-world-model.mjs`
- Individuals / collective: `src/cognitive-individual.mjs`, `src/collective-cognition.mjs`
- Lift history: `docs/MAHORAGA-LIFT-SHIFT.md`
