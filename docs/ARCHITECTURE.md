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

## Cloud task lifecycle

The console validates a single line of at most 1,000 characters, preflights every step with the shared router, and submits only canonical command names. Unknown or mixed unsupported objectives never open a submission URL. Manually created issues still require the fixed marker, owner identity, exact title and supported plan before any command executes. Raw issue text is never evaluated as shell code.

The hosted workflow is limited to Ultron's repository. Owner identity is required for issue and dispatch events; scheduled input is a hardcoded repository inspection. Per-issue concurrency serializes issue runs; jobs have a three-minute timeout. There is no automatic retry scheduler or general task queue.

Before execution, replay audit scans no more than ten pages of 100 comments. Only parsed bot-authored successful receipts matching issue identity and task digest suppress execution. An incomplete audit fails closed. A new receipt is posted and reread by its exact comment ID; the author and full body must match before success returns. Post-write uncertainty requires operator reconciliation. All current commands are read-only, so manual retry does not repeat repository mutations.

Receipts distinguish executor SHA, run attempt and run link from the inspected main SHA. Outcomes are `succeeded`, `partial`, `failed`, or `blocked`; only succeeded/already-processed return a zero CLI exit code. Replay reports reference the previous run. Actions summaries are operational evidence, not a continuous availability guarantee. Missing runs remain unknown.

## Storage and trust boundaries

| Data | Location | Audience/protection | Retention/deletion |
|---|---|---|---|
| Canonical cloud task and receipt | GitHub Issues | Public repository audience; no confidentiality | GitHub issue/comment lifecycle; deletion cannot retract prior copies |
| Hosted status and logs | GitHub Actions | Repository visibility and GitHub access rules | Repository-configured Actions retention |
| Local objectives, receipts and chats | `.local/state.json` | Plaintext; local file permissions | Bounded ledgers; owner can stop runtime and remove local state |
| Local owner notes | Fixed local notes directory | Plaintext; owner filesystem access | Owner-managed files |
| Browser history, ratings and plans | Opt-in browser vault | Passphrase-derived authenticated encryption | Bounded history; explicit vault deletion and encrypted import/export |
| Browser model cache | Browser storage/model ecosystem | Device/browser controls; external CDN code | Browser cache controls; separate from deleting the vault |

The console filter is not DLP. Do not place credentials or confidential data in public issues, local plaintext, or experimental CDN-loaded model context. Encryption does not prevent a compromised live browser from reading unlocked data. Losing a vault passphrase has no recovery path.

## Local actions and model boundaries

The Node server binds to `127.0.0.1`, validates Host and request Origin, and exposes only fixed public modules and API routes. Owner endpoints additionally require a session key generated at startup. Local notes use fixed paths. The optional single-repository documentation draft adapter is disabled unless explicitly enabled. No arbitrary shell, merge, deployment, or secret-management endpoint exists.

The owner-action lifecycle is `prepared → running → verified | reconcile-required`. Durable leases precede side effects; independent read-back precedes successful receipts. Uncertain operations do not auto-replay. Learning joins only verified receipts and matching owner ratings.

Ollama and browser model adapters accept bounded user/assistant history as untrusted context. Model-generated answers are never successful tool evidence. Browser activation is opt-in; Ollama is off by default and loopback-only. General cloud model inference, encrypted cloud chat sync, code-writing workers and a sub-agent workforce remain unimplemented.

## Learning and release evidence

Shared routing-policy evaluation uses versioned labeled fixtures and explicit rollback. Local experience learning requires 16 distinct verified, rated outcomes, diverse training labels, a chronological holdout, at least five percentage points improvement, zero new errors and unsafe-fixture rejection. Promotion changes suggestions, not action authority or model weights. Synthetic tests prove algorithm behavior, not general capability gains.

CI runs for all PRs and main pushes. It checks exact-head syntax and regression tests, validates all workflow syntax with checksum-pinned actionlint, and pins external actions to immutable SHAs. Verification has read-only repository permissions and no persisted Git credentials. Branch rules, merge enforcement and deployment activation are administrative/runtime states requiring separate read-back; configuration in source alone is not proof.

Device/WebGPU/Ollama acceptance, sustained heartbeat reliability, an enforced failing-PR merge gate, real-task benchmark quality and deployment at the final merge SHA remain separate acceptance work. The dated baseline document tracks these boundaries.
