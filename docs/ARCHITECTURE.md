# Ultron architecture

## Identity and execution authority

Ultron.MW is the authoritative repository and release boundary. Ultron has one owner, one interface and one coordinator. Historical predecessor repositories confer no runtime permissions and supply no required infrastructure. New adapters must justify their scope with executable acceptance evidence.

The [dated acceptance summary](ACCEPTANCE-STATUS.md) links the current issue
contracts. The live #65 body governs its remaining supervised browser workflow;
historical design plans and public-audit labels do not expand that milestone.

The owner's objective is input data. Models, prior conversation, issue text and learned suggestions cannot grant authority. Deterministic code owns identity checks, command admission, bounded planning, state transitions, receipt validation and rollback.

## Current execution lanes

| Lane | Entry | Authority | Persistence |
|---|---|---|---|
| GitHub cloud | Owner-authenticated marked issue, manual dispatch, or fixed schedule | Four read-only commands; receipt comment write | Public issue/comment; Actions run and summary |
| GitHub source proposals | Admitted owner issue/PR request or self-scan | Bounded branch/PR writes with exact-head verification | Repository commits, PR and Actions receipts |
| Hatchable backend | Owner-gated API and configured scheduler | Bounded tasks, owner stop and scoped Mahoraga issue/Verify actions | PostgreSQL tasks, actions and event receipts |
| Local Node | Loopback UI and same-origin requests | Four read-only commands; separately paired owner actions | Atomic plaintext local state and bounded notes |
| Supervised local browser | Owner-operated terminal and isolated Playwright | Per-action local consent, fixed origins and verifiable postconditions | Private checkpoints; #65 acceptance pending |
| Browser model | Explicit WebGPU activation | Unverified text only | Ephemeral by default; opt-in encrypted vault |
| Local model | Explicit Ollama setting and observed readiness | At most one allowlisted read-only tool per response | Plaintext local conversation and separate tool receipt |

Pages is the primary console. It hosts no server, API token, background worker or privileged transport. A cloud task leaves Pages for GitHub confirmation. Optional local Node serves the same files; neither cloud tasks nor Pages need the owner's PC online. No authenticated remote bridge to the local runtime is implemented.

## Shared capability contract

`docs/core/capabilities.mjs` owns the versioned deterministic command catalogue. Its entries identify command, description, environment, read-only authority, implementation readiness, environment-specific scope and regression evidence. `docs/core/cycle.mjs` routes and plans; `src/operations.mjs` and `src/cloud-cycle.mjs` execute their own environment's semantics using that catalogue. Local `/api/capabilities` and cloud `/help` publish its machine-readable view.

A manifest is implementation metadata, not proof of a running deployment. `liveReadiness: not-probed` remains explicit. Optional model and owner-action readiness are checked by their existing adapters rather than inferred from a catalogue entry.

## GitHub issue-task lifecycle

The console validates a single line of at most 1,000 characters, preflights every step with the shared router, and submits only canonical command names. Unknown or mixed unsupported objectives never open a submission URL. Manually created issues still require the fixed marker, owner identity, exact title and supported plan before any command executes. Raw issue text is never evaluated as shell code.

The GitHub issue-task workflow is limited to Ultron's repository. Owner identity is required for issue and dispatch events; scheduled input is a hardcoded repository inspection. The executor must match freshly observed GitHub `main` before any task runs. Issue execution additionally requires a live, open issue whose owner, title and body still match the triggering event. Current `main` and that issue snapshot are checked again immediately before the receipt-comment mutation. Per-issue concurrency serializes issue runs; jobs have a three-minute timeout. This lane has no automatic retry scheduler. The separate Hatchable worker uses the durable PostgreSQL queue, bounded eligible retries and readback-only reconciliation for sent/uncertain external actions.

Before execution, replay audit scans no more than ten pages of 100 comments. Only parsed bot-authored receipts matching issue identity and task digest affect the lifecycle. Success suppresses execution, a block is terminal, and failed or partial outcomes may consume at most three distinct Actions attempts. Duplicate receipt comments for one run attempt count once. An incomplete audit fails closed. Receipt v2 records attempt ordinal, limit, timestamps and retry disposition while the parser preserves v1 replay compatibility. A new receipt is posted and reread by its exact comment ID; the author and full body must match before success returns. Post-write uncertainty requires operator reconciliation. All current commands are read-only, so a bounded manual retry does not repeat repository mutations.

Receipts distinguish executor SHA, run attempt and run link from the inspected main SHA. Outcomes are `succeeded`, `partial`, `failed`, or `blocked`; only succeeded/already-processed return a zero CLI exit code. Replay reports reference the previous run. Actions summaries are operational evidence, not a continuous availability guarantee. Missing runs remain unknown.

## Storage and trust boundaries

| Data | Location | Audience/protection | Retention/deletion |
|---|---|---|---|
| Canonical cloud task and receipt | GitHub Issues | Public repository audience; no confidentiality | GitHub issue/comment lifecycle; deletion cannot retract prior copies |
| Hosted status and logs | GitHub Actions | Repository visibility and GitHub access rules | Repository-configured Actions retention |
| Hosted tasks, external attempts and control receipts | Hatchable PostgreSQL | Declared owner/admin or scheduler access by route | Persisted evidence; actual platform retention/billing remain unverified |
| Local objectives, receipts and chats | `.local/state.json` | Plaintext; local file permissions | Bounded ledgers; owner can stop runtime and remove local state |
| Local owner notes | Fixed local notes directory | Plaintext; owner filesystem access | Owner-managed files |
| Browser history, ratings and plans | Opt-in browser vault | Passphrase-derived authenticated encryption | Bounded history; explicit vault deletion and encrypted import/export |
| Browser model cache | Browser storage/model ecosystem | Device/browser controls; external CDN code | Browser cache controls; separate from deleting the vault |

The console filter is not DLP. Do not place credentials or confidential data in public issues, local plaintext, or experimental CDN-loaded model context. Encryption does not prevent a compromised live browser from reading unlocked data. Losing a vault passphrase has no recovery path.

## Local actions and model boundaries

The Node server binds to `127.0.0.1`, validates Host and request Origin, and exposes only fixed public modules and API routes. Owner endpoints additionally require a session key generated at startup. Local notes use fixed paths. The optional single-repository documentation draft adapter is disabled unless explicitly enabled. No arbitrary shell, merge, deployment, or secret-management endpoint exists.

The owner-action lifecycle is `prepared → running → verified | reconcile-required`. Durable leases precede side effects; independent read-back precedes successful receipts. Uncertain operations do not auto-replay. Learning joins only verified receipts and matching owner ratings.

Ollama and browser model adapters accept bounded user/assistant history as untrusted context. Model-generated answers are never successful tool evidence. Browser activation is opt-in; Ollama is off by default and loopback-only. The owner-only PR lane performs bounded CPU inference and exact-context single-file or 2–4-file patch proposals on admitted same-repository `ultron/*` branches. General remote cloud chat inference, encrypted cloud chat sync, unrestricted code-writing workers, autonomous merge/deployment, and a sub-agent workforce remain unimplemented.

## Learning and release evidence

Shared routing-policy evaluation uses versioned labeled fixtures and explicit rollback. Local experience learning requires 16 distinct verified, rated outcomes, diverse training labels, a chronological holdout, at least five percentage points improvement, zero new errors and unsafe-fixture rejection. Promotion changes suggestions, not action authority or model weights. Synthetic tests prove algorithm behavior, not general capability gains.

The continual-improvement lifecycle is explicitly separated into four evidence domains:

1. **Serve** — the existing deterministic planner, read-only executor and optional local/browser model surfaces handle requests without changing their authority.
2. **Observe** — task receipts, independently verified owner-action results and explicit ratings become bounded evidence; drafts and generated prose do not.
3. **Grow** — routing or suggestion candidates are evaluated against fixed or chronological held-out cases. Candidate output cannot supply its own scores.
4. **Commit** — the incumbent routing policy emits a promotion receipt only after the current benchmark passes with the required improvement, no new regressions and a named rollback version. The receipt becomes stale when the accepted version changes.

The reusable skill/harness disposition boundary additionally requires an exact source SHA, distinct baseline and candidate fingerprints, receipt lineage and disjoint development/held-out case identities. Missing independent terminal evidence is Inconclusive; an unavailable Reef runtime is Blocked; essential-invariant or critical held-out regression is Rejected. Accepted selects a candidate only. GitHub PR publication, protected merge, post-merge exact-main verification and measured end-user improvement remain later evidence domains.

The local status surface no longer maintains a second synthetic learning ledger. It summarizes the owner-action experience ledger and the routing-evaluation ledger that runtime operations actually update. Legacy state files containing the removed snapshot remain readable, but that snapshot grants no evidence or authority.

## Cognitive governance

Local plan creation and the scheduled or owner-confirmed GitHub cloud lane invoke a fixed, deterministic GrokBot council. Builder, Skeptic and Steward are cognitive profiles, not operational subagents: they own no credentials, tools, deployment rights or independent task loop. The planner records public role projections while private episodic references remain non-exportable except through an explicit promotion policy. Cloud receipts bind the advisory decision to the exact plan fingerprint while retaining the existing read-only allowlist.

The council combines four lifted and adapted Mahoraga contracts:

- metacognition that blocks overconfident or under-evidenced work;
- a counterfactual world model that propagates uncertainty without mutating observed state;
- stable cognitive identities whose traits never widen capability authority;
- collective synthesis that preserves high-confidence material dissent instead of majority-voting it away.

Each `grokbot-deliberation-receipt` is immutable, fingerprinted, zero-credit and advisory-only. A `proceed` decision means the plan is consistent with the currently implemented read-only allowlist and supplied evidence. It does not execute the plan or prove live readiness. A `hold` decision records the missing capability, evidence gap or conflict. See [`MAHORAGA-LIFT-SHIFT.md`](MAHORAGA-LIFT-SHIFT.md) for source-to-target provenance and deferred surfaces.

CI runs for all PRs and main pushes. It performs a script-disabled lockfile install, verifies that the production dependency graph exactly matches the graph last audited clean in [run 39706366720](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/39706366720), runs a fresh npm audit, smoke-tests the Transformers import, runs exact-head syntax and regression checks, validates all workflow syntax with checksum-pinned actionlint, and pins external actions to immutable SHAs. Dependency changes fail closed pending a fresh audit and baseline update; the fingerprint alone does not detect later advisories. Verification has read-only repository permissions and no persisted Git credentials. Repository protection is separately configured; its dated owner readbacks must be refreshed before a protected merge.

Device/WebGPU/Ollama readiness, sustained availability and real-task improvement claims need their own relevant live evidence. Current milestone dispositions follow [acceptance status](ACCEPTANCE-STATUS.md) and the live issue bodies; historical baseline limitations do not reopen completed scoped milestones.

Provider integrations use the versioned broker in `src/capability-bindings.mjs`. A binding records an opaque provider identity reference, exact origins, operations/effects/scopes, expiration, credential reference and cost ceiling. Registration is not readiness: an adapter must independently report the matching identity and all required scopes. Writes require separate authorization; every execution uses an idempotency key and independent observation, and an uncertain result is held for reconciliation rather than replayed. The broker stores digests and receipt metadata, not credentials or provider response bodies. Live evidence and remaining P0–P2 boundaries are recorded in [`verification/EXECUTION-PRESSURE-TEST-2026-10-21.md`](verification/EXECUTION-PRESSURE-TEST-2026-10-21.md).

## Optional local intelligence and standby

The existing local HTTP server remains the single runtime entrypoint (`src/server.mjs`); its prior state persistence, owner pairing, and read-only endpoints are preserved. The opt-in Hugging Face adapter is selected with `ULTRON_ENABLE_HF=1`. The seven-self GrokBot advisor is distinct from inference and does not create execution authority. With `ULTRON_ALWAYS_ON=1`, a 60-second local, zero-credit standby tick is exposed through `/api/health` and `/api/standby`; no cloud daemon or external provider is implied. See [GrokBot](GROKBOT.md).

Native PR conversation framework commands use the exact GitHub branch head, deterministic source templates, and independent CI evidence. They do not autonomously grant third-party credentials. See [Framework Builder](FRAMEWORK-BUILDER.md).
