# Ultron Held-out Code Repair Evaluation (C06 / EV / C11)

This is a **behavior-scored synthetic benchmark**, not an autonomous release or a held-out independent human evaluator. It expands the four-case string-replacement smoke test in PR #247 without promoting either coding model.

## Design

- 16 synthetic broken **multi-line JavaScript functions** modeled on real Ultron engineering failure classes: owner pause, stale grant, SHA pinning, paid cost rejection, unknown write acknowledgments, leases, external provider readback, duplicate side effects, merge gates, per-call advancement budget, idempotency, permission scope, rollback, receipt consistency and HTTP errors.
- Each case has **three or four** distinct input/output vectors and a reference function. The model sees the broken source and the repair instruction, **never** the reference function or the expected vectors.
- The scorer rejects malformed, oversized, unscoped, unsafe or unexecutable model responses. A successful source proposal must pass **every** behavior vector for a given case. Errors/failures produce explicit failed case receipts and do not make the GitHub job fail on ordinary incorrect model output.
- The isolated Node VM context has no process, filesystem, network or credential variables. It enforces a 150-ms execution timeout per vector; unsafe token patterns are rejected before execution. **Node VM is not a hardened security boundary** and may not safely execute arbitrary adversarial code. This workflow uses only synthetic public cases on throwaway, read-only public GitHub runners.
- The immutable-format receipt identifies source SHA, actual Hub model revision SHA, frozen corpus SHA-256 digest, eight ordered case decisions per shard, passed count, inference duration, paidCents:0 and a SHA-256 receipt digest.

## CPU deployment

Dispatch `.github/workflows/hf-heldout-cpu.yml` manually on **protected main** after the source PR merges. It runs three allowlisted ONNX model profiles x two disjoint shards, `max-parallel: 4`, on standard `ubuntu-24.04` runners, with 20-minute timeout per job. Peak per-runner resources are 4 vCPU / 16 GiB RAM, up to 16 vCPU / 64 GiB aggregate across four concurrent runners. Models are quantized q4 and inference runs on **CPU only**. The existing workflow's six-job tiny smoke test remains available separately.

All model results remain **advisory**. A score improvement on these 16 synthetic functions does **not** establish capability to coordinate a three-file feature, reliably fix a production bug, independently pass Reef, or authorize a model promotion. Larger pinned case sets, real candidate PRs, strict exact-head acceptance and independently observed deployment/runtime effects remain required by #245/#204/#193/#173.

## Restrictions

- $0 paid-spend ceiling; no HF Jobs, Inference Providers billing, GitHub large/GPU runners, subscriptions, private-repository compute, scheduled jobs or new credentials.
- Owner authorization and protected branch rules remain unchanged.
- One separate, opt-in ZeroGPU capability is tracked as #248; this suite makes **no GPU usage claim**.
- No generated source is committed, no PR is opened by model output, no model changes its evaluator, no commit reaches main except the normal protected merge for this reviewed evaluator.
- Corpus changes require a new PR and produce a different digest. Store every run's source/model/corpus hashes; **do not compare scores across different corpora without explicitly accounting for the changed data.**

## Recorded evidence

After successful workflow dispatch, attach the actual run URL, six artifact IDs and case-level pass counts to #249 and the parent acceptance issues. Until then, source CI passing validates only the **benchmark implementation**, not live inference or compute concurrency.

## First real held-out evaluation: November 4, 2026 UTC

**Reference:** [owner-dispatched GitHub Actions run #41759330401](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/41759330401) · protected source `c621134dcf7f1893b047463ecc8945807354a720` (squash PR #250) · frozen corpus digest `f544c3fc6366959d6def15bc1cb191ff583ee9bc73c284c10cbd1e4bb2817fdd`.

All **six** CPU evaluation jobs completed successfully (two shards per model), and **six** JSON artifacts were uploaded. These are execution successes, **not** successful repairs. Every shard independently reported `paidCents:0`; no GPU, paid Inference Providers or Hugging Face Jobs were used.

| Model / immutable revision | Shard 0 | Shard 1 | Fully correct functions | Conclusion |
| --- | --- | --- | --- | --- |
| Qwen2.5-0.5B baseline · `516c8d04add8a80c5228f32102b57953b8d421a9` | 0 / 8 | 0 / 8 | **0 / 16** | Not qualified |
| Qwen2.5-Coder-0.5B · `604bb1988ff789d5024d589c63cf9ae81c0c8ab5` | 0 / 8 | 0 / 8 | **0 / 16** | Not qualified |
| Qwen2.5-Coder-1.5B · `774cc908b6c2be23bc4e8d4e401e4f8b8fba7daf` | 1 / 8 | 1 / 8 | **2 / 16** | Not qualified |

The 1.5B model solved `owner-pause` and `lease-expiry` fully; several other proposals matched only part of their expected behavior. Both 0.5B models frequently returned invalid complete-function formats, so zero scores are **not** proof of an absence of any underlying coding capability. The former four-case simple-literal smoke test (Coder 0.5B **4/4**) is insufficient evidence of substantive code-repair readiness.

**Artifact readbacks:** `13288884735`, `13289866945` (baseline); `13289662666`, `13290325205` (Coder 0.5B); `13289008654`, `13289931834` (Coder 1.5B). They retain per-case results and source/model/corpus SHA receipts.

**Cross-system continuity:** A separate owner-scoped Hatchable native observation recorded the verified aggregate result as `brain_notes.id=9` and `brain_events.id=997`, independently joined from PostgreSQL. Same-key replay returned HTTP 200 `reused:true` without an additional note or event. This is an **observation**, not autonomous release execution.

**Consequence:** do **not** promote either coding model based on this benchmark. Continue #245 with source-isolated response-format diagnosis, stronger open CPU candidates where actual resource budgets permit, and a true model-attributable 3+ file code/test/docs repair; keep #193, #204, #173 and the C06/C13 production gates open. The initial benchmark outcome fulfills the bounded evaluation scope of #249, not those parent issues.
