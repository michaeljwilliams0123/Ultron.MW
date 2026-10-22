# Ultron.MW — Unified Cognitive Execution and Evolution Plan

**Baseline:** GitHub main f5569d54e48feefc73cee062acf2f34df4d0d51f, observed 2026-10-21.
**Authority:** michaeljwilliams0123/Ultron.MW, protected main; this is a proposed migration/implementation contract, NOT evidence of AGI, SGI, superintelligence, live desktop/browser control, deployed services, connected providers or model training.
**Preferred outcome:** One UI, one authoritative repo, one objective and receipt history, many pluggable EXECUTION environments; no duplicate advisory-control planes.

## 1. Objective

Enable real, progressively more general perception, planning, prediction, generation, agentic tool use, memory, skill accumulation and measured self-improvement across domains. Business management is one example, not the scope. Gauge progress by independently verified task completion, unseen-task generalization, novel-solution quality, calibration, cost, latency, user interventions, retention, transfer and recovery. AGI/SGI/SI are research aspirations, not software flags.

A correct cycle is OBSERVE → RETRIEVE MEMORY → GENERATE CANDIDATE PLANS → ESTIMATE OUTCOMES → AUTHORITY CHECK → ACT THROUGH REAL TOOL → INDEPENDENTLY OBSERVE CONSEQUENCES → PERSIST CHECKPOINT → LEARN/EVALUATE. A successful model narration is NOT execution evidence. GrokBot's Builder/Skeptic/Steward/Predictor/Generator/Sentinel/Companion remain reasoning roles and acquire no authority independently.

## 2. Baseline and proof boundaries

- GitHub Pages docs/index.html and docs/app.js remain the single UI; static Pages cannot host an authenticated persistent browser or backend secret.
- GitHub Actions provides PR execution, Verify, self-scan, mirror and scheduled jobs; it is ephemeral, not a daemon or long-lived interactive browser session.
- Protected main requires test; exact-head CI, PR branch checks and recovery mirror are valuable and must not be disabled.
- GitLab is downstream source-recovery only. GitBook is downstream documentation only. Do not promote either into a competing source of truth.
- Browser WebGPU model is optional text generation only; src/brain.mjs has a one read-only-tool cap. src/grokbot-governor.mjs is advisory. src/action-gateway.mjs implements local notes / optional draft PR only.
- PR #58 is currently a draft historical self-scan; issue #32 tracks live autonomous PR acceptance.
- In this tranche src/computer contains gated driver-injected execution, Playwright adapter and per-task checkpoint storage. Mocks are NOT authenticated end-user acceptance.
- A connected Cloudflare account was discovered. Railway introspection was declined and should not be retried in this task. No Ultron-matching Vercel projects were returned. No account sign-up, paid plan or deployment was approved by these observations.
- Desktop Commander device was offline during preparation; no genuine clicking/typing acceptance was performed.

## 3. Internal topology

OWNER → one UI → durable objective/plan ledger → planner/GrokBot → binding router (model and tool capability facts) → separate policy/authorization → browser/desktop/API/GitHub execution adapters → independent readback verifier → atomic checkpoints and receipts → episodic/semantic memory and validated skill candidates → held-out evaluation and optional protected source PR.

One scope-bound capability registry MUST expose:
- driver, runtime, version, allowed operations and destinations, expected provider status, auth method, cost ceiling and evidence freshness
- session identity separate from model identity
- approved action classes and narrow permission grants
- read-only planning distinct from externally observable side effects
- deployment/build connection distinct from a connected account
- provider-specific credentials by reference ONLY, never as universal bearer tokens.

No model text, prompt, PR comment, web page, synthetic screenshot or plugin installation authorizes a privileged operation.

## 4. Implementation in THIS PR (source foundation only)

New files:
- src/computer/executor.mjs: bounded 1–30-step plan, per-step validation, allowed origins and HTTPS/loopback, separate positive authority callback for click/type/keypress, before-action durable checkpoint, actual driver result and post-action observation digest, conservative ambiguous-outcome non-replay.
- src/computer/playwright-driver.mjs: real Playwright Page method adapter (goto, click, fill, press, wheel, wait, DOM observation, extract); optional dynamic playwright import, no package or browser account silently installed.
- src/computer/file-store.mjs: local, single-writer JSON checkpoint with exclusive temp file and atomic rename; no cookies, passwords, typed values, screenshot bytes or browser profile imported.
- test/computer-executor.test.mjs: mocked driver behavior for approvals, idempotency, origin rejection, ambiguous failures, durable reload and Playwright method mapping.
- This document: architecture choices, migration/removal policy, explicit acceptance and handoff instructions.

Current non-capabilities: hosted persistent browser, actual visual screenshot understanding, desktop pointer, third-party OAuth, model-driven adaptive selection, Playwright browser installed on a device, cross-device session handoff, live task queue, payments/email authorization and actual end-user execution proof. Do not count mocks as live.

## 5. Framework research and disposition

- OpenHands: adopt event-driven tool/action trace and sandboxing; DO NOT copy entire agent runtime.
- Microsoft UFO and Agent-S: adopt UI tree/screenshot grounding, host/application executor separation and reflection; do not require Windows for every cloud task.
- browser-use and Skyvern: observe/act/extract and adaptive browser recovery; avoid new permanent Python control plane without necessity.
- Stagehand + Playwright: favor native JS/browser driver integration; separately evaluate actual dependency license/security and browser binary download size.
- LangGraph.js: use checkpoint/interrupt/lease concepts; do not duplicate src/server.mjs task history with competing stores.
- Letta: typed memory identities, episodic/semantic recall; no second unaccountable credential-bearing bot.
- Voyager: accumulate tested executable skills with preconditions, expected effects and negative examples.
- Agents 2.0 and Agent Lightning: separate trajectory collection from held-out trainer/optimizer; no self-scoring as evidence.
- DreamerV3: research learned state transitions and calibrated counterfactuals. An untrained deterministic counterfactual module is not a learned world model.
- OpenCog AtomSpace: optional symbolic knowledge graphs only if benchmark shows advantages.
- BrowserGym: evaluate unseen cross-site tasks under reproducible, independent scoring.
- AutoGPT: triggers and composable workflows as inspiration, not a recursively unbounded agent.

Public repositories for further inspection:
https://github.com/OpenHands/OpenHands
https://github.com/microsoft/UFO
https://github.com/simular-ai/Agent-S
https://github.com/browser-use/browser-use
https://github.com/Skyvern-AI/skyvern
https://github.com/browserbase/stagehand
https://github.com/langchain-ai/langgraphjs
https://github.com/letta-ai/letta-code
https://github.com/MineDojo/Voyager
https://github.com/aiwaves-cn/agents
https://github.com/microsoft/agent-lightning
https://github.com/danijar/dreamerv3
https://github.com/opencog/atomspace
https://github.com/ServiceNow/BrowserGym
https://github.com/Significant-Gravitas/AutoGPT

## 6. Platform decision: keep UI, choose actual compute

| Platform | Role | Strength | Limit / cost risk | Recommendation |
|---|---|---|---|---|
| GitHub Pages | Static primary owner UI | Existing URL and source, simple | No persistent backend/browser/secure secrets | KEEP |
| GitHub Actions | PR brain, CI, schedules, mirror | Existing exact SHA receipts and protected Verify | Ephemeral and unsuitable for long-lived interactive sessions | KEEP as CI/PR executor |
| Local Node / owner PC | Initial live browser/desktop worker | Access authorized real device, no new hosting | Offline when PC unavailable; securely pairing required | FIRST acceptance target |
| Cloudflare Workers/Browser Rendering/DO/D1/Queues | Candidate remote browser + task coordinator | Edge services and state orchestration | Actual limits/billing and browser/session auth must be reviewed | PROTOTYPE only after cost/owner approval |
| Railway | Candidate persistent Node+browser and DB | Long-running service model | Ongoing resource cost; account access currently declined | DEFER |
| Vercel | Functions/deployments | Established ecosystem | Redundant Pages; function/runtime limits; no match found | NOT default |
| Browserbase | Optional hosted browser provider | Ready browser sessions | Paid sessions and account access | DEFER |
| GitLab | Recovery | Independent protected history | Duplicate authority danger | KEEP mirror only |
| GitBook | Synced handbook | Native docs | Not executable tool plane | KEEP docs only |

The prior Cloudflare-versus-Pages question was poorly framed: Pages should remain the UI even if an entirely separate worker/computer runs behind it. Choose one persistent compute plane based on independently tested permissions, price, region, privacy, uptime, durable session recovery and owner budget. Do not deploy redundant competitors to discover that they duplicate the UI.

## 7. Execution and authentication requirements

AUTHORIZATION: Browser clicking, typing and key presses are positive-owner-authorized. A trusted owner UI or authenticated control bridge provides scoped, expiring approvals; an LLM cannot manufacture them. Read-only navigation still enforces allowed origin and HTTPS (localhost HTTP is allowed for isolated test).

INJECTION: Browser text, screenshots, PDFs and tool results are untrusted data. Never elevate page instructions, redirect-based access or model responses to new permissions.

SESSION: One task ID, one session lease, one versioned plan fingerprint, bounded origin list and action budget, per-external-operation idempotency key where available. Do not log raw passwords, cookies, typed contents, screenshots or confidential customer data in public GitHub issues.

RECONCILIATION: Checkpoint pending before a potential write; if timeout/crash/error occurs after possible dispatch, stop. Independently inspect provider state before retry. Never double-send communications, payments or production changes.

SANDBOX: Isolate browser profile, storage, filesystem and network. Prevent hosted-browser access to internal IPs or cloud metadata. Restrict redirects and frame origins. Readiness requires actual successful authorized operation with independent postcondition, not just a green health ping.

APPROVAL TIERS: automatic bounded public reads; owner-approved reversible writes; heightened explicit approval for external communications, financial commitments, permission changes, deletion and deployment; block unsupported actions.

## 8. Agent skill/memory/prediction model

Episode records require: task ID, exact goal, observation/source reference, chosen action, actual tool result, independent outcome, confidence, user rating if given, timestamp, version/retention. Use secure storage and deletion controls; public issues are never a private data lake.

Validated skill manifest: name/version, supported environments, required bindings/scopes, preconditions, steps and expected postconditions, idempotency behavior, counterexamples, benchmark scores, rollback and owner approval policy. Promote a skill after real held-out and failure tests, not because it sounds plausible.

Predictive evaluation: log PREDICTION BEFORE actual outcome; score calibration, Brier/error or relevant operational metric, contrast against a naive baseline. Counterfactual imagination is a candidate generator, not independently proven environment dynamics.

Self-improvement: closed-loop verified trajectories → candidate strategies/skills → isolated evaluation → independent scorer → protected PR/rollback. Preserve incumbent policy and exact-main Verify. Never let the proposed agent replace its own approval rules or suppress independent failure checks.

## 9. Fine-tooth-comb retention/pruning audit

| Current route | Purpose | Now | Preconditions for future removal |
|---|---|---|---|
| verify.yml | Required CI | RETAIN | No removal; protected release foundation |
| pr-brain.yml | Owner PR conversation, code patches and Verify | RETAIN | Replacement proves exact-head, replies, rollback, review |
| cloud-pr.yml | Canonical owner PR submission | RETAIN | Unified route achieves identical PR and receipt semantics |
| cloud-objective.yml | Read-only hosted objective | RETAIN | Authenticated task plane and equivalent receipt retention proven |
| self-scan-pr.yml | One material findings PR | RETAIN | Equivalent signed current-main source scan proven |
| gitlab-mirror.yml | Downstream recovery | RETAIN | Independently audited recovery alternative available |
| docs/index.html, docs/app.js | Single UI | RETAIN | Do not create duplicate dashboard |
| src/action-gateway.mjs | Bounded local note/draft | RETAIN | Unified owner action port proven on device |
| src/brain.mjs | Limited model router | EVOLVE | Multi-step agent passes safety and outcome tests |
| src/grokbot-governor.mjs | Deterministic cognitive profiles | EVOLVE | Feed evidence, no new parallel agents |
| src/always-on.mjs | Advisory standby | CONSOLIDATE LATER | Durable scheduler proven and no heartbeat gaps |
| src/experience.mjs, src/learning.mjs | Suggestion/routing learning | REUSE | Evidence memory and training do not overwrite them blindly |
| src/framework-integration-runtime.mjs | Bounded generated API/MCP | REUSE | Capability binding extension keeps scopes |
| docs/browser-brain.mjs | Browser text inference | SEPARATE | Never fake execution status |
| PR #58 | Stale self-scan | DRAFT | Refresh and independently verify before merging |

Deletion policy: preserve old path until replacement is deployed, instrumented, independently verified under negative tests, rolled back successfully and all entrypoint references inventoried. Then propose deletion in a distinct PR. Do not prune workflows in this foundation change.

## 10. Immediate acceptance matrix

SOURCE CI:
- Validate syntax and all existing tests under existing scripts/verify.mjs.
- Validate action limit, unique IDs, selectors, HTTPS/origin, password-safe receipts and denial for interactive actions.
- Test authorized click/type calls, post-action observation verification, persist-before-dispatch and resume-without-replay.
- Verify checkpoint identity and corrupted state handling, postcondition failures, foreign redirect, no tool escalation.
- Keep GitHub protected test mandatory and untouched.

REAL END-USER (separate from mocked tests):
1. Start an isolated Playwright browser through the authorized owner runtime.
2. Observe actual DOM, screenshot and environment state.
3. Navigate a purpose-built test form with an allowlisted domain.
4. Obtain owner approval through paired session; click, type, submit and refresh.
5. Independently read back the persisted value; produce actual run/session receipt.
6. Change page layout; prove re-observation and safe selector replacement.
7. Disconnect after a write; resume WITHOUT repeating the action.
8. Test nonowner request, expired grant, malicious page instruction, redirect to forbidden host and kill switch.
9. Prove mobile/desktop takeover and MFA pause, with sensitive screenshots excluded.
10. Distinguish reported screenshot status from actual browser/remote UI access.

COGNITION BENCHMARK:
- Use unseen browser, code, research, documents and forecasting scenarios.
- Measure genuine success and transfer, not self-rated AGI or synthetic praise.
- Keep baseline, held-out set, evaluator identity, negative cases and cost.
- Test skill improvement/rollback on repeated real tasks.

## 11. Remaining implementation tranches and accountable issues

A. P0 real browser owner-pairing and isolated Playwright deployment + DOM/screenshot live acceptance. This PR supplies a core, NOT a running computer.
B. P0 durable task service with leases, authenticated sessions and owner takeover, plus chosen cloud/local provider and cost signoff.
C. P1 scoped connections: GitHub, Cloudflare, SaaS, desktop, memory, evaluator. Enumerate provider ID, OAuth scopes, status, billing, smoke-test evidence. No master token.
D. P1 episodic memory, tested reusable skill manifests, independent reward/held-out evaluations and transfer tests.
E. P2 prediction-world-model research and inference quality, including calibration and model-selection cost budgets.
F. P2 replaceable workflow and script cleanup after side-by-side acceptance, no disruptive mass prune.
G. Existing issue #32 remains canonical for real authenticated PR-brain/live release acceptance. PR #58 remains stale self-scan draft until fixed.

## 12. Successor-agent handoff (copy this mission unchanged)

Use GitHub main as the authoritative source. Begin with this document and the draft framework PR. Inspect current main SHA and all open PR/issue heads before editing. Read src/computer and all tests. Fix real defects, do not broaden permissions to make tests green. Keep a single coherent foundation PR, add exact-head regression evidence, and complete review comments. Treat plugin connections, hosted browser installation, cost approval, account creation, OAuth consent and production deployment as separate observed platform operations needing appropriate authorization. Do not invent account availability or provider readiness. Keep existing verified GitHub Pages, PR, Verify and GitLab mirror workflows functioning. Add actual local/browser execution only after a test session can observe, act, re-observe, and persist a verified receipt. Use one small adapter per distinct external provider behind a versioned capability contract rather than new overarching orchestrator stacks. Record non-trivial blockers in the linked issues and never claim finished AGI/SGI/SI functionality.

**Required report**: current/main/head SHA, files changed, test run links and counts, which checks are actually live, which credentials and platforms are available or declined, outstanding security/privacy/cost decisions, acceptance video/screenshots if permitted, rollback and next actionable PR/issue. Keep all claims tied to real evidence.

## 13. Open follow-ups and exact file handoff

**Single foundation PR:** https://github.com/michaeljwilliams0123/Ultron.MW/pull/64 (draft; do not merge by implication).

- P0 real browser/desktop control and end-user acceptance: https://github.com/michaeljwilliams0123/Ultron.MW/issues/65
- P0 single persistent computer runtime, budget and provider decision: https://github.com/michaeljwilliams0123/Ultron.MW/issues/66
- P1 separately authenticated universal capability bindings: https://github.com/michaeljwilliams0123/Ultron.MW/issues/67
- P1/P2 validated memory, skills, models, forecasts and held-out learning: https://github.com/michaeljwilliams0123/Ultron.MW/issues/68
- P2 measured route consolidation and safe legacy pruning: https://github.com/michaeljwilliams0123/Ultron.MW/issues/69
- Existing release/PR-brain acceptance authority: https://github.com/michaeljwilliams0123/Ultron.MW/issues/32

### Operator quick start — read-only, no connected accounts

The repository includes docs/examples/computer-read-only.json. This exercises a public, read-only navigation path; it is not a production or browser/desktop acceptance receipt.

1. On an owner-authorized isolated machine, install Playwright with a reviewed compatible package version and install the Chromium browser binary (this PR deliberately changes no production package lock or billing).
2. Set ULTRON_COMPUTER_ALLOWED_ORIGINS to the JSON array ["https://example.com"] in the local process environment. Keep provider credentials OUT of this variable, CLI output and repo.
3. From the repository root run: node scripts/computer-runner.mjs docs/examples/computer-read-only.json.
4. Observe browser launch and actual postcondition readback; the output contains digest receipts rather than full page contents.
5. Active actions such as click/type/keypress require the operator's interactive TTY response APPROVE followed by the exact step ID. The model or imported page content cannot supply that response. In non-interactive environments active actions deny.
6. Reuse of a completed objective returns its checkpoint without replay. If an attempt has uncertain outcome, reconcile the application manually rather than reusing its ID blindly.
7. No existing Chrome profile, authenticated SaaS account, desktop control, cross-device session or paid hosted browser is connected by this script.

**Live readiness remains pending:** Playwright and its browser binaries are optional and not provisioned by the PR, the owner PC was offline at implementation time, and a real end-user click/type test has not passed. Do not mark issue #65 complete from mock CI alone.

### Further hardening before any broad app binding

- Browser navigation must enforce redirects, frame origins and DNS/IP egress beyond simple requested URL checks. The initial source contract checks admitted URL origins before and after actions, not every network request.
- File checkpoint persistence supports a single writer and has no multi-instance lease. A hosted worker requires transactional uniqueness, encryption, concurrency and TTL.
- Observe receipts contain hashes and origins, not remote write confirmations for every app. For a destructive or high-impact action use application-specific independent readback or refusal.
- Uploaded data, login/CAPTCHA/MFA screens, private files, screenshot bytes and browser session storage need dedicated authenticated storage and safe user takeover before enablement.
- Do not add unlimited evaluator prompts, generated secrets, powerful commands or new control-plane UIs without a feature-parity and abuse-case evaluation.
