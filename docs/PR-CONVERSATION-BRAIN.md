# Ultron PR Conversation Brain

## One thread, one native routing entrypoint

PR discussion is the persistent conversation record. **No Issues are created.** The existing owner-confirmed GitHub Actions pipeline receives new general PR comments and inline code review comments through `pr-brain.yml`, then dispatches the request to `src/pr-brain.mjs`. Responses appear on the PR itself, or as a reply to the inline review comment.

Ultron only reads and replies to comments authored by the signed-in repository owner on open, same-repository Ultron PR branches whose target is `main`. It re-reads the actual triggering comment, the PR head and its source report, and scans previous comments for reply-receipt markers before acting. Generated bot comments do not trigger another action.

## Conversation

Write one of these on an Ultron PR:

| Comment | Verified behavior |
| --- | --- |
| `@ultron help` | Explain available actions |
| `@ultron status` | Inspect exact current PR head, target and source findings |
| `@ultron findings` | Read source-report weaknesses on the same PR branch |
| `@ultron next` | Prioritize the first observed weakness |
| `@ultron address ci-head-unobserved` | Route a focused diagnosis and dispatch exact-head Verify; never claim tests passed before checking results |
| `@ultron address live-execution-unobserved` | Explain the needed end-user runtime evidence (not a false "resolved" status) |
| `@ultron verify` | Dispatch GitHub Verify for the PR branch |
| `@ultron rescan` | Trigger the existing self-scan-to-PR workflow on `main` |
| `@ultron patch` plus JSON | Apply an explicit atomic, exact-head source patch to that same PR branch and request Verify |
| `@ultron implement <objective>` | Run an on-runner public CPU language model to propose a scoped code patch, validate it against the actual PR head, commit it and dispatch Verify; invalid output fails without a commit |

For short, sequential follow-up comments after Ultron's bot reply (e.g. "and now?"), the previous PR discussion is used as context. Unsupported natural language is acknowledged with supported routes, rather than simulated open-ended intelligence.

The patch format is:

```text
@ultron patch
{
  "objective": "Repair missing routing behavior",
  "baseSha": "<exact current 40-character PR head SHA>",
  "changes": [
    {
      "path": "src/example.mjs",
      "before": "old exact substring",
      "after": "new replacement substring"
    }
  ]
}
```

Patches require 1–6 distinct and allowed source paths under `src/`, `docs/`, `test/`, or `scripts/`, preserve exact context, build one Git tree/commit, update the PR head using a non-force ref update and re-read the resulting source. GitHub Actions then requests Verify for that PR branch. Workflow edits, `main` direct mutations, automatic merges, privileged credentials, and deployments are not part of this capability. Owner-authored JSON remains the fully deterministic option. A new `@ultron implement` route can generate a proposed patch from natural language, using a pinned public CPU ONNX model on a GitHub-hosted runner if the repository remains public. The generated result is untrusted until the same exact-context source patch checks and independent CI have run. Model output is not a verified fix.

## Operational truth

This system is **deterministic conversational orchestration**, not evidence of sentience or a connected general LLM. Its state is repo source plus GitHub PR comments; self-observation can become more accurate when real outcomes are independently added. Completed Verify runs are now independently fetched by a native `workflow_run` observer and reported on the matching PR, with run ID, source SHA and actual conclusion. An outdated run is `stale`, never a current pass; bot-generated comments cannot initiate a feedback loop. Production and actual learning gains still require separate evidence.

The handler checks owner identity, branch origin, exact changed comment and PR state before mutations. It deduplicates retries by source comment ID. For inline reviews it responds through GitHub's inline reply endpoint; for general PR comments it responds through the pull request's issue-comment API (which does **not** create a GitHub Issue). The Actions code is checked out from trusted `main`, not a potentially untrusted PR head.

## Free CPU inference and scope

The public repository's standard GitHub-hosted Ubuntu runner can load a pinned ONNX copy of Qwen2.5-0.5B-Instruct through `@huggingface/transformers@3.8.1` for an explicitly owner-authored `@ultron implement ...` comment. It downloads public model files rather than calling a paid inference provider. No new API key, Copilot credit or cloud account is needed. This path is disabled when the repository becomes private, to avoid silently consuming billable runner minutes. It supports one source file per request with a bounded input context; ambiguous targets require an explicit path in the comment. CPU memory, model quality, download availability and latency are operational limitations, and failures produce a non-implementation reply rather than fabricated success. It is *not* equivalent to a high-tier general-purpose software engineering model.

Each model-generated patch uses the same `applyPrPatch` source verification: exact PR head, no workflow edits, unique source-context, a new immutable commit, non-force Git ref update and byte-for-byte readback. Verify is then dispatched and a separate observer confirms the actual run conclusion on the PR. No automatic merge, deployment, provider billing, or external app lane is introduced.

## Verified results without webhook dependence

The PR brain now runs a bounded observe-after-dispatch loop when handling `@ultron verify`, exact-head patches, or accepted on-runner code proposals. It records the pre-dispatch run ID, dispatches the Verify workflow, then queries the GitHub Actions run inventory for a **new** run on the same branch and exact SHA. If a completed run is independently returned, the original conversational reply includes GitHub's actual conclusion and linked run. If GitHub does not expose a terminal result within the bounded window, Ultron reports `pending` without inventing success. This path works even when GitHub suppresses a chained `workflow_run` event from its own bot token. The separate completion listener continues to handle unrelated pull-request-triggered Verify checks, and ignores default-branch push checks.

The source self-scan now independently queries the exact-`main` verification run. It records `success`, a true failing conclusion, or `not-probed` with explicit GitHub run evidence, and retains other runtime/provider/learning uncertainty. This means the `ci-head-unobserved` finding can actually be cleared by proof rather than permanently repeating a static unknown.

## Model generation recovery

A live owner-authored model invocation on PR #24 demonstrated that the first small CPU model could run but emitted malformed JSON; no source commit occurred. Ultron's upgraded repair worker now selects a relevant **existing exact source line**, asks for a minimal replacement rather than making a small model format nested JSON, and accepts a strictly scoped one-line answer, explicitly tagged before/after text or a valid JSON patch. It caches the on-runner model for **one bounded corrective retry** when the first answer is not parseable. Only a patch that still passes the exact-head source context and Git tree readback checks can reach the PR branch; a failed second attempt remains a public failure receipt, never a fabricated repair.

This broadens natural-language coverage without adding a paid inference provider or weakening permissions. Real quality is measured by accepted source commits and independently reported Verify success, not the mere fact that the CPU model was invoked.
