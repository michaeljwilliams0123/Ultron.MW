# Ultron architecture

## Identity and execution authority

Ultron.MW is the authoritative repository and release boundary. Ultron has one owner, one interface and one coordinator. Historical predecessor repositories confer no runtime permissions and supply no required infrastructure. New adapters must justify their scope with executable acceptance evidence.

The owner's objective is input data. Models, prior conversation, issue text and learned suggestions cannot grant authority. Deterministic code owns identity checks, command admission, bounded planning, state transitions, receipt validation and rollback.

## Current execution lanes

| Lane | Entry | Authority | Persistence |
|---|---|---|---|
| GitHub cloud | Owner-authenticated marked issue, manual dispatch, or fixed schedule | Four read-only commands; receipt comment write | Public issue/comment; Actions run and summary |
| Local Node | Loopback UI and same-origin requests | Four read-only commands; separately paired owner actions | Atomic plaintext local state and bounded notes |
| Browser model | Explicit WebGPU activation | Unverified text only | Ephemeral by default; opt-in encrypted vault |
| Local model | Explicit Ollama setting and observed readiness | At most one allowlisted read-only tool per response | Plaintext local conversation and separate tool receipt |

Pages is the primary console. It hosts no server, API token, background worker or privileged transport. A cloud task leaves Pages for GitHub confirmation. Optional local Node serves the same files; neither cloud tasks nor Pages need the owner's PC online. No authenticated remote bridge to the local runtime is implemented.

## Shared capability contract

`docs/core/capabilities.mjs` owns the versioned deterministic command catalogue. Its entries identify command, description, environment, read-only authority, implementation readiness, environment-specific scope and regression evidence. `docs/core/cycle.mjs` routes and plans; `src/operations.mjs` and `src/cloud-cycle.mjs` execute their own environment's semantics using that catalogue. Local `/api/capabilities` and cloud `/help` publish its machine-readable view.

A manifest is implementation metadata, not proof of a running deployment. `liveReadiness: not-probed` remains explicit. Optional model and owner-action readiness are checked by their existing adapters rather than inferred from a catalogue entry.

## Cognitive governance and model providers

Optional local model adapters (Ollama, Hugging Face Transformers via `@huggingface/transformers`) and the browser WebGPU path accept bounded user/assistant history as untrusted context. Selection is governed by `docs/core/providers.mjs`; readiness is probed at runtime. The deterministic GrokBot council never invokes these providers and records `modelInvocations: 0` on every deliberation receipt. See `docs/GROKBOT.md`.

Ollama and browser model adapters accept bounded user/assistant history as untrusted context. Model-generated answers are never successful tool evidence. Browser activation is opt-in; Ollama is off by default and loopback-only. General cloud model inference, encrypted cloud chat sync, code-writing workers and a sub-agent workforce remain unimplemented.

## Learning and release evidence

Shared routing-policy evaluation uses versioned labeled fixtures and explicit rollback. Local experience learning requires 16 distinct verified, rated outcomes, diverse training labels, a chronological holdout, at least five percentage points improvement, zero new errors and unsafe-fixture rejection. Promotion changes suggestions, not action authority or model weights. Synthetic tests prove algorithm behavior, not general capability gains.

See also `docs/GROKBOT.md` for the full GrokBot council pipeline and authority boundary.
