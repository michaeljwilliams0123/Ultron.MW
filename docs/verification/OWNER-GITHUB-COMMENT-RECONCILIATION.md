# PR #85: Owner-browser comment publishing and checkpoint reconciliation

## Triage: confirmed bug

Category: bug. State: implemented in a draft PR, pending independent review.
The real SD009WC7 owner-approved GitHub canary was posted at
2026-10-23T04:30:05Z, but the browser worker wrote an uncertain checkpoint
for `owner-approved-publish`. An earlier DOM observation was unable to prove
the new comment had finished rendering after the click. Browser UI text is
not a sufficient durable acknowledgment for an externally authenticated write.

The canary was `ULTRON_BROWSER_WRITE_CANARY_PR85_20261022_B`.
The exact persisted comment is GitHub #6357408672, in PR #85, created
by the authenticated owner account.

## Why this happened

The executor previously observed the DOM exactly once immediately after
`page.click()` resolved, requiring both an observable UI change and a
postcondition match. A network-accepted GitHub comment can appear later than
the single observation, or outside the first 10,000 observed characters.
The executor correctly recorded uncertainty rather than retrying, but lacked
a separately authenticated, exact-match readback reconciliation path.

Other hypotheses tested: actual write blocked (false; GitHub REST lists the
comment); duplicate side effect (false; one exact match); wrong actor
(false; exact owner account and GitHub URL); checkpoint persistence failure
(false; failurePhase explicitly `postcondition-verification`).

## Two independently protected fixes

1. **Bounded passive browser observation:** after a completed `click`,
   re-observe at most four times, 200 ms apart. Recheck origin after every
   observation. Never repeat the click or grant any new authority. This
   reduces transient postcondition races but is not provider readback.
2. **Provider-backed exact-match reconciliation:** only for a GitHub PR
   comment canary with an immutable plan fingerprint and an existing
   `reconcile-required` pending click. Enforce a precisely scoped owner,
   repository/PR URL, a verified preceding type action, an exact full-body
   match and exactly one comment from the GitHub authenticated REST API.
   Check comment ID, URL, owner identity and creation timestamp after the
   typed receipt (maximum ten minutes). Ambiguous/missing/duplicate/stale
   evidence and provider outages leave the checkpoint untouched.

Before applying, the CLI creates an **exclusive, non-overwritable copy** of
the original checkpoint. The atomic update appends a verification receipt
for the once-dispatched action, clears pending and marks completed, keeping
the earlier uncertain outcome in the structured reconciliation metadata.
Reusing the same plan returns already-completed without opening Chrome or
dispatching any browser action.

## Operator instructions

To check a reconciliation without changing anything:

```powershell
$env:ULTRON_COMPUTER_GITHUB_OWNER = 'michaeljwilliams0123'
node scripts/reconcile-github-browser-comment.mjs 'C:\Users\MikeWilliams\.ultron-mw\plans\github-owner-write-canary-pr85-20261022-b.json'
```

Only when independent readback returns `reconciliation-ready`, use the same
command with `--apply` to create the exclusive backup and reconcile. No
credential, token, MFA data or typed message is saved in the checkpoint.

This CLI is intentionally **not** a general OAuth bridge or automatic replay
service. It is not authorized to reconcile unrelated actions, deployments,
uploads, file downloads or text not confirmed by the provider API. It never
submits a new GitHub comment.

## Validation on SD009WC7, October 23, 2026

- Failing-first test: the delayed page-render scenario reported
  `reconcile-required` before the bounded passive retry change, then
  `completed` with exactly one performed click afterward.
- Targeted tests: four reconciliation cases and repeated refusal conditions.
- Full local Verify: **366 passed, zero failed** on final rerun. An initial
  separate run observed an intermittent unrelated short-lived-token test
  failure; the test and complete suite passed on independent rerun, without
  modifying credential code.
- Live owner checkpoint: dry-run readback confirmed GitHub comment
  `6357408672`, while leaving checkpoint unchanged.
- Live `--apply`: **completed**, five verified receipts, five completed
  steps, no pending action. Repeating reconciliation returned
  `alreadyReconciled=true`; original checkpoint preserved in
  `owner-github-live-write-pr85-20261022-b.pre-github-reconciliation.json`
  in the same private checkpoint directory. No browser click was replayed.
- Live GitHub API: exactly one matching comment.

## Release boundary

Issue #65 remains open for other browser and OS multi-window acceptance
requirements. PR #85 stays stacked on PR #72 and draft. PR #76 production
parity is independent, and no Hatchable deployment or secrets were changed.
