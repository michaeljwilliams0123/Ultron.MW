# Ultron.MW

Ultron is an independent, single-owner execution platform with a GitHub-hosted read-only runtime, one shared interface, optional device inference, and evidence-gated routing improvements. Its capability and release decisions are defined by this repository. Mahoraga is historical reference material only; Ultron has no runtime dependency on it.

**Console:** https://michaeljwilliams0123.github.io/Ultron.MW/

## Current capabilities

| Capability | Environment | Implemented behavior | Evidence boundary |
|---|---|---|---|
| Read-only objectives | GitHub Actions | Read-only commands, at most three steps; hosted issue receipts | `/repo inspect` observed on issue #10 at the reviewed baseline; other paths have automated coverage |
| Hourly self-scan PR | GitHub Actions | At minute 17 scans current `main` and creates or refreshes one report PR only when findings change | No Issues; skipped cron runs are not evidence of health |
| Local tools | Loopback Node | Same shared commands, persisted objectives and receipts | Automated HTTP coverage; owner-device acceptance outstanding |
| Model responses | Optional Ollama or browser WebGPU | Bounded, unverified generated text | Provider availability is checked at activation; no hosted cloud LLM |
| Browser memory | Opt-in encrypted vault | History, feedback, plans, encrypted import/export | Device-local; manual transfer rather than automatic synchronization |
| Routing improvement | Shared core and local ledger | Fixed held-out routing evaluation and rollback | Policy selection, not model training or general intelligence |
| Experience suggestions | Local owner-action ledger | Verified, rated outcomes inform suggestions | Minimum 16 distinct outcomes; chronological holdout; no new action authority |
| Cognitive governance | Local planning | Fixed GrokBot council, metacognition, counterfactual simulation and dissent-preserving synthesis | Deterministic, zero-credit and advisory; no new action authority |
| Owner actions | Paired local Node | Bounded notes; optional documentation draft adapter | Draft adapter disabled by default; no shell, merge, or deployment permission |

The deterministic tool catalogue is defined once in [`docs/core/capabilities.mjs`](docs/core/capabilities.mjs). Router, local executor and cloud executor consume it. `/help` includes the cloud manifest; local `GET /api/capabilities` includes the local manifest. `implemented` describes source support; `liveReadiness: not-probed` explicitly avoids claiming a deployment or connected provider was verified.

## Run a GitHub-hosted task

1. For read-only tasks enter `/help`, `/system status`, `/repo inspect`, or `/learning status`. For an actionable source scan use the **Self scan → PR** action.
2. **Run in GitHub cloud** opens an Issue for the other read-only commands. **Self scan → PR** instead opens the dedicated authenticated Actions workflow, without creating an Issue.
3. For self-scans, select **Run workflow** on GitHub; the runner inspects canonical `main`, writes `reports/self-scan/current.md` on a separate branch, and opens or updates a PR targeting `main` when material evidence changes.
4. Read the findings and suggested repairs in the PR plus the workflow receipt. Identical findings produce no new PR, and merged identical findings remain suppressed. Other read-only tasks retain their Issue receipts.

**Public data:** this repository, task issues, issue comments and Pages source are public. Do not add credentials, client information, personal details, or confidential objectives. The canonical-command filter reduces accidental disclosure through the console; it is not a secret scanner and cannot prevent someone manually editing an issue on GitHub. Changing visibility later cannot retract copies of earlier public content. Pages never receives a GitHub API token.

The cloud lane needs no personal PC, localhost service, Ollama, Cloudflare, or paid model provider. Every job must prove that its executor SHA equals current GitHub `main` before execution. Issue tasks reread the live issue and require the same open owner-authored title and body; immediately before posting a receipt, they recheck both the issue snapshot and current `main`. `/repo inspect` separately reads authoritative GitHub `main`, not the runner's checkout. `/system status` describes the current runner; `/learning status` explicitly reports that cloud learning evidence is not connected.

## Receipts and recovery

A receipt records its schema, task digest, issue number, timestamp, run ID/link, run attempt, executor commit SHA, command statuses, source-authority observations, and independently inspected repository SHA where applicable. Admission and pre-receipt observations must equal the executor SHA. The SHA inspected by `/repo inspect` remains separate command evidence.

Issue replay scans up to 1,000 comments and suppresses execution only for a bot-authored, parsed successful receipt for the same task digest. Incomplete audits fail closed. Failed and partial read-only attempts may be manually rerun up to a three-attempt budget; duplicate comments for one Actions attempt count once. A blocked objective is terminal and cannot be replayed into execution. Ultron never schedules automatic retries. Each v2 receipt records the attempt ordinal, budget and retry disposition, while replay remains compatible with v1 receipts. Each posted receipt is reread directly by comment ID and checked for exact content and bot author. If a post may have succeeded but read-back fails, inspect the issue before retrying.

Actions are asynchronous, quota-limited and ephemeral. An hourly heartbeat is not a durable queue or an always-running reasoning agent. Issue closure does not cancel a running workflow; use GitHub Actions cancellation and inspect whether a receipt was already posted. A missing scheduled run is unknown, not a success. No cloud code-editing worker or autonomous merge pipeline is implemented.

## Optional local runtime

Requires Node.js 20+; no npm install is needed. CI uses Node.js 22.

```bash
node src/server.mjs
```

Open http://127.0.0.1:4782/. The server binds only to loopback, validates Host and write Origin, and serves the same UI source as Pages. Slash commands create deterministic receipts; ordinary text is saved as a draft unless an optional model is ready. State writes are serialized and atomic. Local state and note files are plaintext.

Local endpoints include `GET /api/health`, `/api/capabilities`, `/api/state`; `POST /api/objectives`, `/api/execute`, `/api/think`; objective-plan and learning endpoints; and owner-key-protected `/api/owner/*` endpoints. The startup pairing key changes on restart. The action gateway persists preparation and execution leases before side effects, independently rereads results, and marks uncertain work `reconcile-required` instead of automatically replaying it.

| Setting | Default | Purpose |
|---|---|---|
| `ULTRON_PORT` | `4782` | Loopback UI port |
| `ULTRON_ENABLE_LOCAL_MODEL` | Disabled | Set to `1` to enable local Ollama |
| `ULTRON_OLLAMA_MODEL` | Select an installed model | Optional explicit local model selection |
| `ULTRON_OLLAMA_THINK` | Disabled | Set to `1` to request deeper optional reasoning |
| `ULTRON_ENABLE_GITHUB_DRAFT` | Disabled | Set to `1` to enable the restricted local documentation draft adapter |

Ollama is contacted only at `127.0.0.1:11434`. A response uses at most two model calls and one allowlisted read-only tool call. Generated narrative remains separate from deterministic execution evidence. The local runtime retains up to 24 conversation exchanges as bounded, untrusted context, never as system instructions.

## Optional on-device AI and memory

**Enable on-device AI** explicitly loads WebLLM from `https://esm.run/@mlc-ai/web-llm@0.2.86` and model artifacts from its model ecosystem. Nothing loads automatically on page visit. The default SmolLM2 360M quantized model needs WebGPU, substantial download/cache capacity, and compatible device memory. This experimental CDN dependency is version-pinned but is not a reviewed, bundled production supply chain. Do not enter secrets.

Browser inference provides unverified text without tools. By default it is ephemeral. Unlocking the opt-in encrypted vault enables saved history and bounded conversational context; encrypted export/import allows manual device transfer. There is no passphrase recovery, automatic cross-device chat sync, or background inference after the browser closes.

## Learning boundaries

The shared router evaluates immutable `routing-v1` and `routing-v2` against labeled held-out fixtures. Adoption requires at least five percentage points of measured improvement, no newly incorrect cases, and no critical regression. Rollback preserves the audit trail.

Promotion has a separate incumbent-governed commit receipt. The currently accepted routing policy runs the fixed evaluator, names the rollback version, proves the measured threshold and records that capability authority is unchanged. A candidate cannot approve itself or reuse the receipt after the accepted version changes. This is a policy-artifact commit boundary, not permission to promote code, deploy, merge, or train model weights.

Every locally saved plan and every GitHub cloud outcome also carries a deterministic GrokBot deliberation receipt. Three fixed cognitive profiles—Builder, Skeptic and Steward—calibrate evidence, simulate uncertainty and preserve material dissent. The receipt records zero model invocations and zero credit cost and remains non-executable. These structures are an inspectable operational self-model; they are not evidence that Ultron is sentient, conscious or generally intelligent.

Local experience suggestions require at least 16 distinct verified, owner-rated actions, positive/negative diversity and a chronological holdout. Candidates must improve by five percentage points without new held-out mistakes or unsafe recommendations. Suggestions cannot execute actions, enable an adapter, change permissions, or train model weights. With no qualified outcomes, Ultron reports insufficient evidence.

## Development and verification

```bash
node scripts/verify.mjs
bash scripts/lint-workflows.sh
```

Verification syntax-checks every JavaScript module in `src`, `docs`, `scripts` and `test`, then runs the regression suite. Workflow lint uses an official actionlint release with a committed SHA-256 digest. Every PR and every push to `main` runs verification without path filters; checkout uses the exact PR head, pinned action SHAs and no persisted Git credentials. PR checks validate the head, not a simulated merge result, so reverify after base-branch changes.

**Repository settings remain separate:** the reviewed `main` was unprotected. Workflow files cannot enforce branch protection. Required-check configuration, blocked force-push/deletion, and owner review policy need an administrative settings change and read-back before they can be claimed active. See [`docs/verification/BASELINE-2026-10-19.md`](docs/verification/BASELINE-2026-10-19.md) for the reviewed baseline, acceptance gaps, and next implementation order.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for current architecture and [`SECURITY.md`](SECURITY.md) for data boundaries and reporting. No license grant is declared pending the owner's license decision.

### Verified cloud evidence (read-only)
The GitHub-hosted `/learning status` command now reads existing public cloud-task
Issues and their bot-authored structured execution receipts directly from GitHub.
It deduplicates retries and counts at most one validated terminal outcome per
canonical task. To qualify as an observed cloud outcome, the receipt must match
the owner-created objective digest, issue number and exact-main admission and
pre-publication SHAs. Incomplete API pagination fails closed rather than silently
under-counting. It does **not** count generated council text, unauthenticated
comments, unverified historical receipts, or synthetic tests as learning.

Metrics deliberately separate **attested execution outcomes** from **owner-rated
learning evidence**: the latter remains zero until an authenticated feedback
mechanism is implemented, so no policy or model is promoted from mere GitHub
success receipts. This uses the existing cloud command and GitHub API access,
with no new provider, database, UI, or computer dependency.

## Cloud-native Create PR to main

Ultron's single GitHub Pages interface now offers **Create PR to main**, separate from read-only cloud commands. Enter a *public, one-line* objective and select that action (or submit an explicit "Create a PR ..." chat instruction). The page opens a prefilled GitHub Issue; **the signed-in repository owner must confirm the issue**. A dedicated GitHub-hosted Actions job then:

1. Verifies the Issue's owner, unchanged request, repository identity, and exact current `main` SHA.
2. Creates a uniquely named `ultron/issue-N` branch from current `main`.
3. Writes and independently rereads `docs/proposals/issue-N.md` containing the requested feature proposal.
4. Opens a **non-draft PR targeting `main`**, rereads the PR's source branch and target, and explicitly dispatches the existing exact-head Verify job.
5. Posts the new PR link and verification request back to the owner Issue with independent comment read-back.

**What this proves:** Ultron has a real cloud write action capable of creating a branch, committing a file and opening a PR against `main` without a specific PC or API token in Pages. **What it does not prove:** It cannot implement arbitrary application source from a natural-language request, deploy or auto-merge the PR, or circumvent the required CI check. This first write action creates reviewable documentation proposals only. Code implementation remains a separately reviewed task.

The default GitHub Actions token stays read-only. Only `.github/workflows/cloud-pr.yml`, running for owner-created marked PR Issues, requests `contents: write`, `pull-requests: write`, `issues: write`, and `actions: write`. GitHub's repository setting allowing Actions-created PRs must be enabled; the combined setting also technically allows workflow PR approvals, but no Ultron workflow requests or submits one. Public Issues and proposals must not contain private data. No Cloudflare, hosted LLM subscription, local Ollama, SD009WC7, or ports 4782/4792 are required.

## Cloud owner feedback and measured recommendation learning

GitHub Issues are the durable cloud record. An owner can rate a successfully executed **single-command** v2 task by replying to the bot's receipt comment with the exact three-line format:

```text
ULTRON_FEEDBACK_V1
run:<numeric-actions-run-id>:<run-attempt-number>
rating:helpful
```

Change `rating:helpful` to `rating:not-helpful` if the result was not useful. The Actions receipt supplies the exact run ID and attempt. Only a comment from the configured repository owner, on that owner-created task Issue, later than a matching bot-authored receipt, can qualify. Any other comment, forged digest, mismatched exact-main evidence, unverified attempt, unsupported or multi-step outcome does **not** become a training label. Public Issues/comments should contain no private or client data.

An owner feedback comment starts the **existing** GitHub Actions workflow, which evaluates the existing ledger and writes results to that run's summary; the workflow does **not** create a code change, merge anything, dispatch shell commands from comments, or grant new action authority. The optional `/learning status` command uses that same evidence. Workflows remain ephemeral and quota-limited.

The evaluator compares a cautious command-recommendation policy against baseline using the latest chronological quarter as holdout. A candidate needs at least **16 distinct owner-rated tasks**, six positive and four negative older training labels, positive/negative later labels, at least five percentage points measured improvement, **zero new wrong cautions**, and no broadened permission. Insufficient, unchanged, invalid or regressing evidence causes no validated suggestion. An accepted *suggestion* is recomputed from GitHub history, not trained model weights or a self-editing model; it never blocks or runs a tool. The cloud ledger is public and mutable, so this is owner-reported usefulness, not independently adjudicated outcome quality.

**One system, no extra infrastructure:** the old local-only experience evaluator remains for explicitly paired local tests. Cloud feedback uses existing Issues, one cloud evaluator and the same Pages interface. It does not create another agent, SaaS plan, database, browser login, paid AI provider, or SD009WC7 dependency.

## Native code-implementation PR routing

The same **Create PR to main** action accepts a structured, owner-authored JSON manifest and opens a GitHub Issue headed `[Ultron PR] Implement code`. Unlike a plain-language objective, this route **commits real source files** and opens a normal PR against `main` using the existing GitHub Actions executor. No separate API service or PC is required.

```json
{
  "objective": "Improve a routing heuristic",
  "baseSha": "<current 40-character main commit SHA>",
  "changes": [
    {"path": "src/brain.mjs", "before": "<exact original substring>", "after": "<replacement substring>"}
  ]
}
```

Up to eight distinct source-file edits or creations (`{"path":"src/new.mjs","create":"<complete contents>"}`) are supported. The JSON must be submitted **as public text** through the authenticated owner Issue. The executor checks current `main` against `baseSha`, rereads source, applies each exact once-only context replacement, creates a single atomic tree/commit, independently verifies the resulting branch/PR/files, dispatches head verification, and posts a receipt. A changed `main` or ambiguous patch fails instead of silently applying an incorrect edit. Branch names are unique per Issue and are not force-updated.

**Boundaries:** The route executes already-authored source changes; neither GitHub Pages nor GitHub Actions generates code from an arbitrary English objective. Optional browser/local inference or a connected coding agent can author the manifest, but must not be confused with authenticated GitHub publication. No permissions are self-granted, no security gate is bypassed, no automatic merge or deployment is performed, and verification remains observable. Reward and learning loops should score measured task completion and successful recovery, **not** the evasion of access controls or test failures. This is an implementation route, not a claim of AGI.

## Operational self-awareness (self-observation, not consciousness)

Use **Self scan → PR** or enter `/self scan` in the console to open the native GitHub Actions self-scan workflow (owner presses **Run workflow**). Source observations create or update a single actionable report PR targeting `main` rather than an Issue. The hourly schedule runs the same publisher. Each report binds current `main`, source tree, observed route-source blobs and a fingerprint, then explicitly identifies **unknown** live runtime, provider and independent-learning readiness. On local Node the report uses a local content digest rather than pretending to know the canonical Git commit. A self-scan is not autonomous code generation, live inference, subjective awareness, or proof that AI intelligence improved. See [Mahoraga's source-grounded failure lessons](docs/MAHORAGA-SELF-OBSERVATION-LESSONS.md).

## Self-scan findings PR lifecycle

- Workflow: [Ultron self-scan to PR](https://github.com/michaeljwilliams0123/Ultron.MW/actions/workflows/self-scan-pr.yml). This is the only scheduled self-scan publisher; the legacy issue-based hourly schedule is removed.
- Verified source snapshot: scan compares exact GitHub `main` SHA, source-tree SHA, route-file blob SHAs, and rechecks `main`. Report includes the observed SHA, timestamp, check results, material gaps and proposed follow-ups.
- Publication: creates `reports/self-scan/current.md` in a separate `ultron/self-scan-*` branch, creates a non-draft PR with base `main`, and dispatches the existing Verify workflow.
- Noise control: identical material findings generate no new branch or PR, an open scan PR is refreshed with changed findings, and identical findings already merged on `main` are not republished. The generated report file is excluded from the scan inventory fingerprint so its own merge cannot trigger a recurring loop.
- Credentials: GitHub Actions grants contents/pull-requests/actions write only to this workflow; GitHub Pages receives no API token. The scan never creates Issues, never auto-merges, and does not pretend the scan is a software repair or AGI proof.

## Ultron PR conversation brain

Ultron PRs now support owner-authored `@ultron` conversation comments on ordinary PR threads and inline review comments, powered by the existing GitHub Actions runtime. Commands include `@ultron status`, `@ultron findings`, `@ultron next`, `@ultron address <finding-code>`, `@ultron verify`, `@ultron rescan`, and an explicitly supplied exact-head `@ultron patch` manifest to commit source fixes on the current PR branch and run Verify. Replies are posted on that PR; no Issues, new services, hosted model charges, or automatic merges are needed. It stores context in GitHub comments and will not describe unverified model activity as intelligence. See [PR Conversation Brain](docs/PR-CONVERSATION-BRAIN.md).

## Closed-loop PR cognition (GitHub native)

Comment `@ultron implement src/target.mjs: <description>` on an open Ultron PR to request a source-grounded code patch from a pinned public Qwen2.5-0.5B-Instruct ONNX model running on the hosted Actions CPU. The model does **not** use a paid inference API; it runs only for explicit implementation requests on public repositories, and its output must pass the same exact-head source-patch validation before a commit is created. Ambiguous context, oversized files or invalid code suggestions are rejected rather than committed. The small CPU model is experimental, not an assurance of autonomous coding competence.

After `@ultron verify`, explicit patch or accepted model-generated change, the existing Verify workflow runs. The original PR conversation worker reads the newly launched exact-head Verify run, waits for its terminal result within a bounded window, and replies with the independently observed conclusion and run URL (or marks it pending). GitHub PR comments hold the conversation and CI receipts; no new Issues, private external services, forced pushes, autonomous merges or production rollout.

See [PR Conversation Brain](docs/PR-CONVERSATION-BRAIN.md) for commands and boundaries.

## Exact-head CI closure and self-evidence

Ultron does not rely solely on GitHub chaining a `workflow_run` event after its own GITHUB_TOKEN dispatch. During `@ultron verify`, a valid source patch, or an accepted CPU model edit, the PR brain correlates a newly started Verify run to its precise branch and commit. It polls for an independently read-back terminal result, then replies with the actual conclusion and Actions run URL, or explicitly reports pending. The redundant completion-webhook feedback workflow was retired after a permissions failure; the direct PR conversation polling route is now authoritative.

The hourly self-scan now also reads exact-current-main Verify metadata and distinguishes observed passing/failing CI from missing evidence. This can actually eliminate the `ci-head-unobserved` finding after an independently checked run; it does **not** imply production/runtime/learning readiness. See [PR Conversation Brain](docs/PR-CONVERSATION-BRAIN.md).

## Bounded self-healing for model-generated changes

The native PR brain now rejects CPU-generated invalid JavaScript before committing, with an independent syntax-only Node check, and protects capability proof references against unverified rewrites. After a model-generated commit, an independently observed failing exact-head Verify triggers **one auditable inverse source commit and a second Verify** on the restored PR head. Outcomes are explained in the same PR conversation, without a forced ref update, direct `main` mutation or paid model usage. This addresses a real live-model regression observed on PR #24 and preserves the no-automatic-merge boundary.

## Native API/MCP framework generation and regression tests

From an owner comment on a supported open PR, use `@ultron regress`, `@ultron build api <slug>`, `@ultron build mcp <slug>`, or `@ultron credentials`. The deterministic generator commits read-only source, tests and docs to the PR branch and dispatches exact-head GitHub-hosted verification.

Ultron can create short-lived **self-owned** bearer tokens when running in an authorized deployment. It cannot fabricate third-party provider credentials or authorize OAuth grants; no secrets are ever committed to the public repository. Generated API modules require a separately authorized host and a protected signing key.

See [framework builder authority and acceptance](docs/FRAMEWORK-BUILDER.md).
