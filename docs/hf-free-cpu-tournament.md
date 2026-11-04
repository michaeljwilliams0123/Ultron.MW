# Hugging Face free-tier CPU tournament for Ultron.MW

**Scope:** model candidate evaluation feeding the existing PR-brain, not an independent autonomous release authority.

## Execution topology

- **One owner surface:** Hatchable remains the control plane for approved work. This workflow does not create another UI, public API, permanent agent or external token.
- **One source of model identity:** `src/hf-free-compute.mjs` names all evaluation candidates. `src/pr-brain-model.mjs`, `src/pr-brain-inference.mjs` and `src/pr-brain-multifile.mjs` reference the same production baseline.
- **Advisory parallel evaluation:** manually dispatch `.github/workflows/hf-free-cpu-tournament.yml` from the public repo's Actions tab. Three model profiles × two non-overlapping shards = six short-lived jobs, **max four concurrent**, each `ubuntu-24.04` standard public runner with 4 virtual CPUs / 16 GB RAM. Peak aggregate is up to 16 vCPUs and 64 GB, **not** a single shared-memory machine.
- **Bounded evaluation:** every shard runs two fixed code-edit tests with at most 128 generated tokens per task. A model's public Hub revision is resolved to an immutable 40-character SHA before download. The output JSON contains case-level pass/fail, actual revision, GitHub source SHA, timing, `paidCents:0` and a digest. Results are uploaded as seven-day GitHub artifacts. Code changes or merges are never performed by this workflow.
- **One source of release eligibility:** protected main, exact-head Verify, independent evidence and external readback remain unchanged. No candidate is automatically promoted because it scored higher on four smoke cases.

## Models

| Key | Public Hub model | Role |
| --- | --- | --- |
| `baseline` | `onnx-community/Qwen2.5-0.5B-Instruct` | Existing immutable PR-brain production baseline |
| `coder-small` | `onnx-community/Qwen2.5-Coder-0.5B-Instruct` | Code-specialized candidate at similar resource demand |
| `coder-medium` | `onnx-community/Qwen2.5-Coder-1.5B-Instruct` | Higher-capacity code-specialized CPU candidate |

All models use the repository's locked `@huggingface/transformers` dependency, `q4` quantization and explicit `device:'cpu'`. Candidate model metadata can change on Hugging Face; each run resolves and records its SHA before it loads the model. **Model weights are not uploaded as public artifacts.** On model/download/runtime failure the job fails visibly; there is no automatic paid-provider fallback.

## Actual free GPU limits and eligibility

The standard GitHub-hosted Ubuntu runners above **do not have GPUs**. Changing the label to a large/GPU runner would introduce paid hardware, so the admission policy rejects it.

Hugging Face **ZeroGPU** is a different, quota-limited mechanism for eligible Gradio Spaces. Its November 2026 documentation lists a free personal account in good standing (verified email and older than 30 days) as eligible to host up to two ZeroGPU Spaces, with a **5-minute per-day** free GPU quota; this is shared GPU time, not five minutes of guaranteed dedicated continuous workload. Space hosting and quota must be independently confirmed before adding a ZeroGPU adapter. The current Hugging Face connector has read-repository/Jobs OAuth scopes but has not established writable Space hosting. Do not create or charge a Space as a side effect of this CPU workflow.

Hugging Face **Jobs** CPU and GPU hardware is separately billed per minute. The Jobs tool's availability is **not** proof of free billing. This project retains a **$0 permitted paid spend** and does not invoke Jobs, paid Inference Providers, large GitHub runners, self-hosted resources or subscription upgrades.

## Promotion gate

1. Run CPU tournament from `main` after this PR passes exact-head checks and merges.
2. Inspect all six receipts, model downloads, failure logs, runtime and per-case scores. Preserve the baseline comparison. A missing/failed shard is not evidence of model superiority.
3. Repeat a stronger held-out multi-file task evaluation using #245/#204 contract before selecting a candidate.
4. Promote only by a separate source PR pinning the **exact evaluated model SHA**, with source regression, resource/latency budget, rollback, and protected merge. Never silently switch to a mutable Hub `main`.
5. Record the chosen model and signed provenance in Hatchable only when a real authenticated cloud data path exists. Do not report CI artifacts as Hatchable runtime evidence.

## Failure/recovery rules

- Private repo, unrecognized model, paid cost, GPU label, or increased concurrency fails admission.
- Model unavailable or quota/network error: record failed job; no alternative paid inference.
- No scheduled triggers, no repeated speculative dispatch on unknown GitHub outcome, no external issue/PR writes, no secret required, no branch-policy changes.
- Keep #245 open until Ultron *itself* demonstrably generates a coordinated 3+ file PR and it reaches a verified production effect.

References: GitHub hosted-runner docs https://docs.github.com/en/actions/reference/runners/github-hosted-runners ; Hugging Face ZeroGPU https://huggingface.co/docs/hub/en/spaces-zerogpu ; Hugging Face Jobs pricing https://huggingface.co/docs/hub/jobs-pricing .
