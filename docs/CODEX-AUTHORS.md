# Callable Codex authors

Ultron has two author records. These are application identities, not additional
GitHub accounts or claims that two separate OpenAI accounts were authenticated.

| Author | Callable name | Current binding |
|---|---|---|
| Mike's Codex | `mike-codex` (alias `mike`) | Not enrolled; no fallback |
| Destiny's Codex | `destiny-codex` (alias `destiny`) | Work GitHub event lane enrolled |

## Call from the console

Enter a public task, select an author, and click **Call selected Codex**, or type:

```text
/codex destiny-codex Inspect README.md and report the project name.
```

The existing owner-confirmed GitHub Issue launcher creates a task PR. Its title
names the author, and the same strict envelope appears in the PR body and
`docs/proposals/issue-N.md`. A matching Work event invokes the enrolled lane.
If no run appears, the owner can comment exactly `/codex run destiny-codex` on
that PR. This explicit event is useful where bot-created PR delivery is not
supported. Neither PR creation nor webhook enrollment proves execution.

Mike's command deliberately fails until Mike enrolls a separate event task
from his own authenticated Work account. Do not copy Destiny's binding to Mike.
Create a Mike-only trigger with the same contract and the title regex
`^\[Ultron Codex\] mike-codex · issue [0-9]+$`; pin SHA-256 of its returned
automation ID in Mike's registry entry via a normally verified PR. Only enable
comments as an additional event family. No periodic schedule is needed.

## Fingerprints and the setup session

`docs/core/codex-authors.mjs` is the authoritative registry. Author fingerprints
are SHA-256 of `ultron:codex-author:v1:<callable-name>` and remain stable when a
route changes. Route fingerprints hash the automation ID returned by the Work
service. The Destiny record also embeds SHA-256 observations of this setup
session's environment and thread IDs. Raw IDs, credentials and private keys
are not published. A thread is a conversation identifier, not a remote account
endpoint. These hashes are correlation metadata, not cryptographic proof of
the human or OpenAI account operating the executor.

## Executor contract

Read these instructions and `src/codex-call.mjs` from trusted current `main`,
never from the candidate to decide its own authority. Work executor startup
must verify its installed automation ID against the enrolled route fingerprint.
An unavailable automation ID is a blocker; do not infer it from the task.

1. Accept only an opened/ready PR event, or an exact owner-authored
   `/codex run <author-id>` comment. Ignore closed/merged PRs and other events.
2. Fetch the live PR, its source Issue, `docs/proposals/issue-N.md` from the
   exact PR head, and current main SHA. Normalize connector responses into the
   GitHub shape required by `validateCodexAdmission`. Pass `pr`, `issue`,
   `proposalText`, `mainSha` and the installed lane's `bindingFingerprint`.
   The validator checks the author, route, canonical digest, same-repository
   branch/base, owner Issue, unchanged request and source SHA.
3. Use `codexRecordPaths(call)` to inspect claims and receipts on the task
   branch. `codexReplayDisposition` returns `already-completed` only for
   a valid matching claim and receipt, `reconcile-required` for a prior claim,
   or `unclaimed`. Check record Git history at the exact PR-head commit and
   validate create-only commits, parents, and the receipt-to-claim SHA link.
   Omit a property only when its file does not exist. A present JSON `null`,
   empty, malformed or conflicting record is never permission to retry.
4. For an unclaimed task, create the claim path once with
   `buildCodexClaim(call, {headSha: observedPrHead, claimedAt: ISO_TIME})`.
   Do not supply a replacement SHA or overwrite a claim. Reread the exact file
   and commit before proceeding. A losing concurrent create must stop. Persist
   the claim commit SHA for the completion receipt.
5. Perform only the owner's bounded public repository task on this branch.
   Before each mutation, reread current main, Issue, and PR. Reject changed
   requests and unrelated head changes; advance the expected head only after
   independently verifying this attempt's own writes. Source changes need
   focused tests and the normal exact-head CI gate. No automatic merge,
   deployment, private-data access, credential transfer or paid fallback.
6. After actual verified execution, create the receipt path once using
   `buildCodexReceipt(call, {headSha: testedHead, claimHeadSha, completedAt, result})`.
   `result` is one public line of at most 2,000 characters. Read it back and run
   `validateCodexReceipt(receipt, call)`. Do not manufacture a receipt in the
   interactive setup session to claim webhook delivery.

A task pinned to an obsolete main SHA cannot execute. Keep the original audit
trail and create a fresh owner Issue and PR instead of rebasing the task or
weakening source admission. If the Work event automation is paused, enable it
in the separately enrolled Work account before triggering a new canary.

There is one attempt per request. An incomplete claim survives a crash and
requires explicit reconciliation. Close the Issue and PR to withdraw a queued
request; cancellation of an already running Work task is separate. An owner
can forge public repository evidence, so these records are an audit trail,
not tamper-proof account attestation.

## Mahoraga lessons applied

The current `src/codex-connection-identity.mjs`,
`config/destiny-trigger-trust.json`, the Destiny bridge scripts and event
delivery documentation informed this design. Shared GitHub credentials do
not distinguish Mike from Destiny. Registration, event delivery, execution,
CI, merge and deployment are different evidence. Hash private identifiers,
reject source/identity drift, persist claims before effects, and never replay
an uncertain attempt or silently select a different account. Ultron remains
independent: no Mahoraga runtime, credentials or private task data were copied.

## Live acceptance

After the feature PR is squash merged, submit a harmless named inspection
through the real Issue-to-PR route. Observe the Work run and its independently
written branch receipt. Keep `liveExecution: not-verified` in static registry
metadata until a separate reviewed evidence update cites a successful run.
Tests prove source behavior; they do not establish webhook delivery.
