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
and timestamp order. Before publishing, it re-runs full admission against the
final PR and Issue snapshots and rechecks exact main and PR-head identity.
Missing/incomplete data never
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


## Portable policy core (PR #84)

The evaluator is policy-driven without changing Ultron's deployed defaults.
Trusted callers can use `createCodexPolicy({ repository, owner, baseBranch,
branchPrefix, prTitlePrefix, issueTitle, issueMarker, trustedPrActors,
workflowName, jobName, authors })` and pass its result to
`buildCodexCall`, `formatCodexCall`, `validateCodexAdmission`, and
`assessCodexLane`. Non-default registries must carry their own registered,
enrolled callable authors. Ambiguous aliases, duplicate author fingerprints or
route bindings, malformed repository names/branches, duplicate trusted actors,
and unbounded metadata are rejected. **Only the trusted deployment or account
configuration may supply this policy.** Never load a security policy from the
untrusted PR being evaluated.

The repository namespace may be a GitHub organization; `owner` is the
independently trusted GitHub user authorized to submit the owner Issue and
comment trigger, not necessarily the repository namespace. The shipped CLI
remains an Ultron-specific, read-only wrapper. The request owner need not be a
trusted PR publisher; a deployment may admit only its builder bot in
`trustedPrActors`. Configurable
core behavior is not permission for cross-repository GitHub access, a new
credential, independent ChatGPT Work identity, or a bypass of CI/merge gates.

Durable claim and completion files must be create-only with distinct commits.
The receipt's `claimHeadSha` must equal the claim-creation commit. Its
`headSha` is the tested head immediately before receipt creation. If source
work was committed after claiming, a complete, bounded, first-parent GitHub
compare chain from the claim commit to tested head is required; merge commits,
forks and missing ancestry fail closed. The GitHub CLI collects this chain
read-only and verifies it with `src/codex-lane-evidence.mjs`. Invalid or
cross-repository workflow run links do not count as proof of a green check.
Workflow inventories must be complete, and each applicable run needs a valid
ID and creation time. The reported URL must carry that same selected run ID.
Multiple owner triggers are investigated, never retried automatically.

## PR #87 identity-canary disposition (2026-10-23)

PR #87 is a single-proposal task from owner Issue #86. The real PR-triggered
Verify run completed successfully at original head
`8d1c1c1c4f2902800616437ad363c0b6b19e04cd`.
The owner posted the one-time trigger, but no independent Work-authored
claim or completion receipt has been verified. The task is now stale against
the newer `main` tip, so **do not rewrite its canonical envelope, forge an
execution receipt, replay the trigger, or merge #87 as identity evidence**.
PR #84 must likewise remain subject to real executor and review gates
rather than claiming that a green source test attests a separate Work account.
The October 24 read-only audit still found it unclaimed and stale against
current main. PR #87 and Issue #86 were closed without replay; their history
remains available for review.

## PR #90 receipt and fresh canary (2026-10-24)

Owner Issue #89 produced PR #90. Its claim and completion receipt are distinct,
create-only commits linked by the recorded claim SHA. The receipt reports the
two callable author names and Destiny's selected fingerprint, and the PR's
exact-head GitHub Verify passed. The read-only lane audit reports
`replayDisposition: already-completed`, but also
`executionState: completion-receipt-unattributed` and
`signedWorkAccountAttested: false`. The source SHA is now stale against main.
The shared GitHub author of the record cannot prove which ChatGPT Work account
executed it; an OpenAI API key or a Descope role would not prove that either.

Owner Issue #92 created fresh canary PR #93 from the then-current main. Treat
its proposal as pending until a genuine create-only claim, completion receipt,
exact-head PR check, and independent Work-account provenance are observed.
Do not copy #90's records, silently rebase its task, or count event enrollment
as account proof. PR #84 remains a source-only evidence evaluator while that
identity gate is unresolved.

## Verification and non-overlap

    node --test test/codex-lane-evidence.test.mjs
    node scripts/verify.mjs

Negative coverage includes mismatched author, branch, source SHA, stale
workflow run, bot-spoofed trigger, action_required, incomplete test job,
uncertain claims, orphan receipts and false Destiny account proof.

This work is deliberately on a separate source PR. PR #83 is closed as a
historical stale task; its product-source prohibition and absent executor
receipt must not be rewritten into a successful run.
