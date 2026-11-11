# Ultron Council — mandatory 7/7 release gate

## Release contract

Default: **seven of seven** distinct Council role verdicts must be `proceed` on the
exact live PR source SHA. Every role must be present exactly once, with evidence,
no unresolved unknowns or dissent, and the governor must also proceed. Missing,
stale, duplicated, failed, or unparseable evidence **HOLDS**. An advisory model
response does not override deterministic holds. Seven role labels are **not**
seven independently authenticated GitHub App identities.

Owner exception: a comment authored by the canonical owner
`michaeljwilliams0123` (GitHub user ID 308995719) on the exact open PR:

```text
/council override HEAD_SHA BASE_SHA -- Specific reason of at least twenty characters
```

Use the full 40-character current PR head SHA and 40-character current base SHA.
The comment must be unedited, at most 24 hours old, and the reason must be
20–240 printable characters. A normal "approved", earlier-chat authorization, a
Council vote, or a bot comment is **NOT** an override. A new commit, base change,
or comment edit invalidates the exception. The evaluation publishes
`owner-overridden` with the actual failing role count and an audit comment ID.
This exception affects **only** the Council gate; it never overrides repository
checks, high-risk external-write signatures, replay protection, or deployment
controls.

## Trusted GitHub commit status (recommended ruleset check)

`.github/workflows/council-required-status.yml` is defined on default `main`
and runs on **completed Council workflow runs**, or on the owner's exact override
comment. It checks out only `main`; it never executes PR code with privileged
credentials. It re-fetches the current PR head and base, evaluates the seven
roles using the trusted source implementation, then publishes the exact
commit-status context:

`ultron/council-7of7`

Use a **required status check**, not seven GitHub reviewer accounts, for this
logical Council. Also keep the existing required `test` check and strict
up-to-date base requirement. Require the expected source `GitHub Actions`
when offered. Keep the ruleset bypass list empty; the owner uses the
authenticated exception comment so every exception has a visible record.

GitHub settings for the public personal repo:
`https://github.com/michaeljwilliams0123/Ultron.MW/settings/rules`
→ New branch ruleset → target default branch `main` → Active →
Require status checks → add **ultron/council-7of7** and **test** →
Require branches to be up to date → save. Do not delete existing branch
protection or other required checks.

**Deployment prerequisite:** This ruleset must only be activated *after*
the trusted status workflow has landed on `main` and has emitted a status
at least once, or GitHub may not list the check in its selector. Until
then, source-level tests do not constitute repository-wide enforced policy.
GitHub connection APIs in this environment do not currently expose a
ruleset mutation operation. A full-admin owner session must activate it.

`council-debate.yml` remains an advisory review workflow; it does **not** run the newly added release-gate script before that script exists on trusted `main`. This avoids a self-deadlocking bootstrap (PR CI checking out main cannot import unmerged policy code). The trusted `ultron/council-7of7` status is the release enforcement surface; a green advisory Council workflow alone must **never** be used as the release requirement. The trusted workflow reacts both to Council workflow completion and to a fresh exact-head owner-override comment, so no manual re-review trigger is necessary.

## Review → repair → verify → re-review

The Council currently posts an advisory report. The PR brain accepts
owner-authored comments; the autonomous repair core expects a trusted
installation token, owner grant, durable ledger, and a pre-existing bounded
repair branch. Merely giving each role a `will do` action is not equivalent
to executing a patch. Its model-backed deliberation is presently limited to
three public/free-tier reasoning roles; seven logical role votes remain a
deterministic screen.

The correct repair controller should:

1. Collect exact-head Council findings and CI failures into specific
   reproducible cases, not repeat the same title/body keyword classification.
2. Classify each finding as in-scope, false/obsolete, or independently blocked.
   Convert only in-scope findings into concrete restricted manifests.
3. Invoke the existing bounded autonomous repair core with an **authenticated,
   least-privilege App adapter and an owner standing/step-up grant**. Only
   modify an eligible non-main branch; restrict files to source/tests, never
   alter workflow, secrets, approvals or governance in a repair loop.
4. Independently read back each patch's GitHub commit and exact SHA,
   run required checks, and feed observed failures into another repair round.
5. Repeat **up to three genuine changed-head rounds**. Automatically
   re-evaluate the Council on every committed change. Keep the check red
   until all seven roles accept or an explicit exact-head owner exception
   is observed. Never fabricate success, issue blanket tokens, or self-merge.
6. When three repair attempts are exhausted or credentials are missing,
   persist the evidence and hold, without creating a duplicate external write
   after an uncertain outcome.

**Current blocker:** The Council's advisory report is not itself a source
patch, and the trusted patcher/adapters have not yet been connected to the
Council workflow with verified App installation write authority. Additional
workflow retries without changed evidence are **not** genuine repairs. That
integration requires separate review and live acceptance. No paid inference.

## Verification and status

Use `node --test test/council-release-gate.test.mjs` and the repository
`verify.yml` suite. Verify the trusted status from GitHub's commit-status API
and its source App, not merely a green advisory Council workflow. Confirm
the owner exception works only on an exact head+base, and an older head or
a non-owner comment cannot mark the current commit successful.

Relevant official documentation:
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- https://docs.github.com/en/actions/concepts/security/github_token
- https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target
