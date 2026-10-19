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

Patches require 1–6 distinct and allowed source paths under `src/`, `docs/`, `test/`, or `scripts/`, preserve exact context, build one Git tree/commit, update the PR head using a non-force ref update and re-read the resulting source. GitHub Actions then requests Verify for that PR branch. Workflow edits, `main` direct mutations, automatic merges, privileged credentials, and deployments are not part of this capability. The user/connected code author must supply actual edits; a narrative alone does not generate code.

## Operational truth

This system is **deterministic conversational orchestration**, not evidence of sentience or a connected general LLM. Its state is repo source plus GitHub PR comments; self-observation can become more accurate when real outcomes are independently added. Successful dispatch means a tool was requested, not that the check, fix, or production acceptance succeeded.

The handler checks owner identity, branch origin, exact changed comment and PR state before mutations. It deduplicates retries by source comment ID. For inline reviews it responds through GitHub's inline reply endpoint; for general PR comments it responds through the pull request's issue-comment API (which does **not** create a GitHub Issue). The Actions code is checked out from trusted `main`, not a potentially untrusted PR head.
