# Codex execution evidence — Mahoraga lessons applied to Ultron

## Why dedicated lanes matter

Michael's connected GitHub account and Destiny's independently enrolled ChatGPT
Work lane may both create GitHub activity under the same owner or shared bot
identity. **That cannot identify the ChatGPT account performing execution.**
Named author labels and GitHub event receipts are routing records, not account
attestation.

Mahoraga introduced separate policies (Destiny-only, Mike-only, balanced,
overflow), trust readiness, replay-safe handoffs, and receipts. Ultron retains
an independent public registry without importing Mahoraga's private code,
credentials, opaque IDs, or conversation history. There is no silent fallback
between Mike and Destiny and no assumption that credits can be shared.

## Actual public PR #83 / Issue #82 evidence

- An authenticated owner Issue created a documentation-only Codex task PR.
- A workflow_dispatch ran tests successfully, but the PR's own pull_request
  workflow was blocked by GitHub with action_required and zero jobs.
- A repository owner approved that genuine GitHub run; the exact-head PR test
  then succeeded without bypassing the required check.
- The owner posted the documented trigger comment once:
  `/codex run destiny-codex`.
- No independently authored Destiny executor claim or completion receipt was
  visible on the PR branch during this audit. The status is NOT EXECUTED.

PR: https://github.com/michaeljwilliams0123/Ultron.MW/pull/83
GitHub verification: https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/39829603706
GitHub bot PR approval change, June 11 2026:
https://github.blog/changelog/2026-06-11-bot-created-pull-requests-can-run-workflows-if-approved/

## Read-only status inspection

With authenticated GitHub CLI configured, run:

    node scripts/codex-lane-status.mjs 83

This retrieves the owner Issue, canonical PR, source proposal pinned to the
observed exact PR-head commit, exact current main SHA, actual PR-event workflow and test jobs, separate workflow_dispatch,
owner-authored trigger comments, and optional branch claim/completion receipt.
For present claim/receipt files, it also validates create-only Git history,
record creation commits and their parents, the receipt's claim-commit link,
and timestamp order. It rechecks the owner Issue, main, and PR head afterward. Missing/incomplete data never
becomes a passing result. No secrets, transcript, API tokens, prompt bodies,
or credentials are emitted in the status output.

The new independent evaluator `src/codex-lane-evidence.mjs` separates:

1. **Identity-bound request:** PR, Issue, proposal and enrolled route match.
2. **Required PR check:** PR-triggered exact-head test success; manual dispatch
   never substitutes. An action_required workflow needs real owner approval.
3. **GitHub trigger transport:** exact owner-authored trigger comment, not an
   authenticated Destiny Work receipt; one trigger event, not multiple retries.
4. **Executor status:** unclaimed, claim requiring reconciliation, or verified
   matching v1 branch receipt; orphan/malformed receipts are invalid.
5. **Independent account identity:** remains unverified until a separately
   authenticated Work executor signs task-specific completion evidence with a
   pinned independent key, exact SHA, route, time and task digest.

Do not use a shared GitHub login, hashed session/thread metadata, the
chatgpt-codex connector bot, or the existence of a v1 receipt to claim Mike and
Destiny are separate authenticated Work accounts. A Work route's hidden
credential must stay in its own protected runtime, never in public GitHub.

## Swim lanes

| Lane | Function | Acceptance |
| --- | --- | --- |
| Owner → GitHub | Submit named Issue | Owner and exact digest admitted |
| GitHub builder | Create PR and request checks | Actual PR check green on exact head |
| Destiny Work | Separate enrolled Work route executes | Durable claim and result receipt |
| Mike Work | Separate enrolled Work route executes | Own binding and signed provenance |
| Reviewer / release | Evaluate current source and outcome | Protected checks and independent proof |

`mergeAccepted` remains false in this evaluator by design: a read-only status
check cannot authorize a merge or attest a cloud deployment.

A stale task pinned to an old main SHA is reported as stale, not executable.
Supersede it with a fresh owner Issue and task PR against current main; do not
rewrite the original request or weaken admission. GitHub cannot know whether
the separate Work event route is paused. Verify this within the enrolled Work
account before claiming successful event delivery.

A suspended PR workflow must not be presented as green because another
dispatch succeeded. A missed Work event cannot be repaired by fabricating a
completion receipt or borrowing another account's identity. Diagnose the
event subscription from the actual Work account and preserve incomplete
claims instead of blind re-execution.

## Verification and non-overlap

    node --test test/codex-lane-evidence.test.mjs
    node scripts/verify.mjs

Negative coverage includes mismatched author, branch, source SHA, stale
workflow run, bot-spoofed trigger, action_required, incomplete test job,
uncertain claims, orphan receipts and false Destiny account proof.

This work is deliberately on a separate source PR. PR #83 specifically
prohibits product source changes and asks only for an executor's genuine
claim and completion receipt; leave PR #83 open until that receipt exists.
