# C06 genuine model-generated release canary (#245)

This implementation adds a **live model-origin test**, not a simulation or a claim that autonomous production deployment has already happened.

## Admission and execution

The repository owner manually dispatches `.github/workflows/c06-owner-model-release.yml` on public protected `main` with the fixed objective `owner-effect-gate`. Both jobs refuse an unrecognized actor, repository, private-repository status or objective.

The initial `generate` job runs with **contents:read** and no runtime credentials. It downloads a quantized **Apache-2.0** `onnx-community/Qwen2.5-Coder-1.5B-Instruct` CPU model at immutable Hub revision `774cc908b6c2be23bc4e8d4e401e4f8b8fba7daf`. It cannot select the research-only Qwen2.5-Coder-3B model, an OpenAI paid inference endpoint, Hugging Face Jobs or any GPU runner.

The model independently proposes (1) a complete JavaScript `fix(input)` function; (2) **6–10 synthetic, model-authored regression vectors** that exercise `held`, `reconcile` and `verified`; and (3) documentation explaining the owner/pause/$0/provider-readback contract. Each output is the actual model return, with a SHA-256 raw output hash; deterministic module and test wrappers are disclosed rather than misrepresented as model output. A failure remains held after at most three model attempts per artifact. No deterministic replacement source or substitute model is permitted.

The generated function is accepted only when all **15 frozen, separately authored** reference cases pass. Syntax, source shape and forbidden APIs are checked before executing the synthetic pure function in a fresh Node VM with a bounded timeout. **Node VM is not a hardened security boundary**. This is permitted only in the ephemeral public `generate` job without credentials or live application inputs. Invalid or malicious model code fails closed. The model never sees actual credentials, owner private information or live production data.

The immutable receipt pins the original GitHub source SHA, run ID, model+revision, license, paid-cost declaration, the raw source/test/docs output digests, normalized file hashes and per-case pass count. The workflow uploads a success receipt or a failure-only artifact (7-day retention).

## Separation of duties

The distinct `publish` job has `contents:write` and `pull-requests:write`, **but does not execute any generated source code**. It checks the artifact hashes, exact main SHA, owner actor, source lineage and idempotent branch naming before pushing one `ultron/c06-model-<run-id>` branch and attempting one PR creation. If GitHub denies PR creation or an acknowledgement is uncertain, the workflow reports a **hold**, preserving the feature branch and evidence for reconciliation; it must not issue blind retries or duplicate PRs.

If a model-generated PR is created, it still requires ordinary exact-head CI, independent review eligibility, a non-draft protected squash merge and independent post-merge source readback. This workflow itself **never merges**, enables paid services or modifies credentials, branch protection or the only Hatchable owner console.

## Deployment acceptance beyond PR generation

Issue #245 can only close after the verified source is deployed to **the existing** Hatchable project, the deployed bytes match the merged GitHub source, a gated live **non-note** runtime action executes, and both an independent external postcondition and durable database receipt confirm the effect. Negative tests must establish owner stop, stale versions, invalid input, conflict and replay behavior.

A green synthetic model generation is necessary but **not sufficient** evidence of production capability. Missing PR authorization, failed model outcomes, CI errors, unresolved reviewer states, or unreconciled deployment are explicit hold states. Parents #188/#193/#204/#195 remain separately scoped.
