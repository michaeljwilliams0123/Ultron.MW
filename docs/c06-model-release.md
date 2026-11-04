# C06 genuine model-generated release canary (#245)

This implementation adds a **live model-origin test**, not a simulation or a claim that autonomous production deployment has already happened.

## Admission and execution

The repository owner manually dispatches `.github/workflows/c06-owner-model-release.yml` on public protected `main` with the fixed objective `owner-effect-gate`. Both jobs refuse an unrecognized actor, repository, private-repository status or objective.

The initial `generate` job runs with **contents:read** and no runtime credentials. It downloads a quantized **Apache-2.0** `onnx-community/Qwen2.5-Coder-1.5B-Instruct` CPU model at immutable Hub revision `774cc908b6c2be23bc4e8d4e401e4f8b8fba7daf`. It cannot select the research-only Qwen2.5-Coder-3B model, an OpenAI paid inference endpoint, Hugging Face Jobs or any GPU runner.

The model independently proposes (1) a complete JavaScript `fix(input)` **provider-outcome classifier**; (2) **6–10 synthetic, model-authored regression vectors** that exercise `held`, `reconcile` and `verified`; and (3) documentation explaining the owner/pause/$0/provider-readback contract. A separate, independently authored and regression-tested wrapper enforces strict owner approval, unpaused stop state and integer zero paid spend **before** calling model-authored provider code; the model cannot modify or bypass that wrapper through its output. Each output is the actual model return, with a SHA-256 raw output hash; deterministic module and test wrappers are disclosed rather than misrepresented as model output. A failure remains held after at most three model attempts per artifact. No deterministic replacement source or substitute model is permitted.

The **combined** frozen authority fence and generated provider function is accepted only when all **15 frozen, separately authored** reference cases pass. Provider-only cases verify that model output, not a deterministic fallback, actually distinguishes observed-and-receipted effects from unknown/timeout and invalid outcomes. Syntax, source shape and forbidden APIs are checked before executing the synthetic pure function in a fresh Node VM with a bounded timeout. **Node VM is not a hardened security boundary**. This is permitted only in the ephemeral public `generate` job without credentials or live application inputs. Invalid or malicious model code fails closed. The model never sees actual credentials, owner private information or live production data.

The immutable receipt pins the original GitHub source SHA, run ID, model+revision, license, paid-cost declaration, the raw source/test/docs output digests, normalized file hashes and per-case pass count. The workflow uploads a success receipt or a failure-only artifact (7-day retention).

## Separation of duties

The distinct `publish` job has `contents:write` and `pull-requests:write`, **but does not execute any generated source code**. It checks the artifact hashes, exact main SHA, owner actor, source lineage and idempotent branch naming before pushing one `ultron/c06-model-<run-id>` branch and attempting one PR creation. If GitHub denies PR creation or an acknowledgement is uncertain, the workflow reports a **hold**, preserving the feature branch and evidence for reconciliation; it must not issue blind retries or duplicate PRs.

If a model-generated PR is created, it still requires ordinary exact-head CI, independent review eligibility, a non-draft protected squash merge and independent post-merge source readback. This workflow itself **never merges**, enables paid services or modifies credentials, branch protection or the only Hatchable owner console.

## Deployment acceptance beyond PR generation

Issue #245 can only close after the verified source is deployed to **the existing** Hatchable project, the deployed bytes match the merged GitHub source, a gated live **non-note** runtime action executes, and both an independent external postcondition and durable database receipt confirm the effect. Negative tests must establish owner stop, stale versions, invalid input, conflict and replay behavior.

A green synthetic model generation is necessary but **not sufficient** evidence of production capability. Missing PR authorization, failed model outcomes, CI errors, unresolved reviewer states, or unreconciled deployment are explicit hold states. Parents #188/#193/#204/#195 remain separately scoped.


## First real model-generation attempts and corrective model-case strategy

- [Run #41769819025](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/41769819025) (source `048d9552209fef741e0008536ef357108fde8f75`) failed independently checked owner/spend/provider function synthesis; `publish` correctly skipped. Held artifact `13294720700`.
- [Run #41770666005](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/41770666005) (source `f7426a2d32458199f5a5cc50aec0fd3226874a58`) used the previous model's bounded raw code plus failed independent vectors for corrective feedback; still failed the source gate and skipped publication. Held artifact `13294931480`.
- [Run #41771806146](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/41771806146) (source `a1b20027a4bb458edde7b00407f829eb5e9cca5b`) **passed the genuine model-authored provider source gate** with a separately authored owner/pause/zero-spend wrapper, but the generated bulk JSON regression case suite failed. The `publish` step remained skipped. Held artifact `13295132191`.

**Follow-up:** Retain the valid model-generated provider source and try the full 6–10-case suite once. If the bulk JSON is rejected, request **seven distinct single-case JSON objects from the model**, each targeting a separate independently validated scenario: verified observed receipt; unknown reconciliation; timeout reconciliation; paused held; unauthorized held; paid-spend held; observed but unverified held. No scenario is filled, rewritten or fabricated by deterministic fallback. Each response is a real pinned Hugging Face CPU inference, tested against the independent provider function and the fixed owner guard, with a raw-output hash in the source receipt. Any invalid or duplicated case holds generation; the write-capable publisher remains blocked.

A successful model-generated PR is still not a completed #245 runtime deployment or independent live provider postcondition. Preserve required CI, protected merge and the existing single Hatchable owner console.

## Fourth generation success and subsequent documentation hold

- [C06 run #41775191071](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/41775191071), source SHA e2dda037f6d0512abf66d5a9666f98c1d62f2f92: **generation succeeded**, the publishing job succeeded and GitHub Actions (not a manual assistant commit) created [model-origin PR #272](https://github.com/michaeljwilliams0123/Ultron.MW/pull/272) with runtime source, regression vectors, docs and an immutable provenance receipt. The 15 independent behavior cases passed.
- Independent review found that PR #272 invented a project-manager owner application process and ended mid-sentence. PR #272 remains draft and must not be treated as production-approved.
- PR #273 hardened documentation checks for the five exact input field names, protected PR review, complete sentences and absence of invented human approval processes. [C06 run #41775971062](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/41775971062) then failed safely at documentation length after three tries; publisher skipped. This run has a held receipt only, not a replayable successful artifact.
- The next fix preserves these validation gates while allowing complete technical documentation up to 2,800 characters and restricting model output to 320 tokens per document attempt. Bad model responses remain held, not repaired through assistant-authored substitution.

**Issue #245 remains OPEN.** Required evidence: a truthful model-origin candidate PR, exact-head checks, protected squash, byte-exact deployment to the single existing Hatchable project and independent non-note live runtime postcondition.

## Fifth held output and bounded model-authored document sections

Owner-authorized [run #41848081022](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/41848081022) executed source SHA b8ae786eef5a3e4c8c5ab099198c4065fb134e89 with the shorter 320-token documentation stage and improved length range. Its model remained unable to supply every required outcome term: final failure `c06-model-docs-rejected: missing-outcome-contract`. The generated candidate was held and publishing skipped; the run produced a failure-only artifact (13334610089).

A safe fallback is not substitute text. Instead, when the first complete model-authored document fails and the production admission permits three attempts, the **same pinned free CPU model** must generate three smaller technical paragraphs independently: owner/stop/spend; provider/receipt/outcome; protected PR/external independent verification. Every paragraph has exact mandatory token checks, completeness and anti-hallucination gates, with up to two corrective model attempts per section. The complete model-authored text is then revalidated by the full documentation contract. Its receipt records distinct full versus sectioned model-generation modes and SHA-256 digests of the raw model responses. Failed sections hold publication rather than prompting an assistant to fill gaps.

These changes do not grant a model approval, GitHub write privileges, model promotion or live deployment; issue #245's external postcondition still must be separately proven.
