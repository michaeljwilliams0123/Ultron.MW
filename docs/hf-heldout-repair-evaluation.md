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
