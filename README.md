# Ultron.MW

Ultron is an independent, single-owner execution platform with a GitHub-hosted read-only runtime, one shared interface, optional device inference, and evidence-gated routing improvements. Its capability and release decisions are defined by this repository. Mahoraga is historical reference material only; Ultron has no runtime dependency on it.

**Console:** https://michaeljwilliams0123.github.io/Ultron.MW/

## Current capabilities

| Capability | Environment | Implemented behavior | Evidence boundary |
|---|---|---|---|
| Read-only objectives | GitHub Actions | Four commands, at most three steps; hosted issue receipts | `/repo inspect` observed on issue #10 at the reviewed baseline; other paths have automated coverage |
| Hourly observation | GitHub Actions | Fixed inspection of current `main` at minute 17 | Ephemeral jobs; schedules can be delayed or missed |
| Local tools | Loopback Node | Same four commands, persisted objectives and receipts | Automated HTTP coverage; owner-device acceptance outstanding |
| Model responses | Optional Ollama or browser WebGPU | Bounded, unverified generated text | Provider availability is checked at activation; no hosted cloud LLM |
| Browser memory | Opt-in encrypted vault | History, feedback, plans, encrypted import/export | Device-local; manual transfer rather than automatic synchronization |
| Routing improvement | Shared core and local ledger | Fixed held-out routing evaluation and rollback | Policy selection, not model training or general intelligence |
| Experience suggestions | Local owner-action ledger | Verified, rated outcomes inform suggestions | Minimum 16 distinct outcomes; chronological holdout; no new action authority |
| Cognitive governance | Local planning | Fixed GrokBot council, metacognition, counterfactual simulation and dissent-preserving synthesis | Deterministic, zero-credit and advisory; no new action authority |
| Owner actions | Paired local Node | Bounded notes; optional documentation draft adapter | Draft adapter disabled by default; no shell, merge, or deployment permission |

The deterministic tool catalogue is defined once in [`docs/core/capabilities.mjs`](docs/core/capabilities.mjs). Router, local executor and cloud executor consume it. `/help` includes the cloud manifest; local `GET /api/capabilities` includes the local manifest. `implemented` describes source support; `liveReadiness: not-probed` explicitly avoids claiming a deployment or connected provider was verified.

## Run a GitHub-hosted task

1. Enter `/help`, `/system status`, `/repo inspect`, or `/learning status` in the console. Narrow recognized phrases and up to three commands joined by `and` are accepted.
2. Select **Run in GitHub cloud**. Ultron validates the whole objective and prefills an issue using canonical command names only. Unsupported input is refused before a GitHub URL is opened.
3. Review and submit the issue in GitHub using the configured owner's account. The hosted workflow checks repository and owner identity, executes the supported reads, and posts a structured receipt.
4. Read the issue receipt and associated Actions run. `succeeded`, `partial`, `failed`, and `blocked` are distinct. Only complete success or a verified successful replay leaves the job green.

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
