# Ultron Council: mandatory 7/7 release gate (trusted v2)

v2 rebuilds the #397 gate after the Skeptic review of head `045f5af8`.
Findings C1, C2, H1, H2, H3 and M4 are addressed below.

## Release contract

By default, all **seven** Council role verdicts must be `proceed` on the exact
live PR head. Every role must be present once, with evidence, no unresolved
unknowns or dissent, and the governor must also proceed. Builder, Skeptic and
Sentinel also need real model-backed `proceed` verdicts with no open
disagreements. Missing, stale, duplicated or unparseable evidence **HOLDS**.
Seven role labels are **not** seven independently authenticated accounts.

**Security-sensitive changes** need more than 7/7. A change is sensitive when
GitHub's changed-file list for the PR (renames included) touches `.github/`,
gate code (`src/council-release-gate.mjs`, `src/council-trusted-gate.mjs`,
`src/council-members.mjs`, `src/council-publication.mjs`,
`src/council-reasoning.mjs`, `scripts/enforce-council-acceptance.mjs`,
`scripts/council-debate.mjs`, `scripts/council-act.mjs`), `config/`,
`src/security/`, files whose names mention auth, credential, secret, token,
signing, permission, ruleset, admin, OIDC or passkey, the package manifests,
or the verify scripts. An incomplete file list counts as sensitive.

- For these changes, only a **signed owner exception** can turn a 7/7 into a
  pass. Green CI never lifts a security hold (H1).
- The classification comes from the file list, never from PR title or body
  keywords, so PR text cannot remove a hold (H2). Text keywords can still
  *add* holds inside `scripts/council-debate.mjs`.

**Owner** means GitHub user `michaeljwilliams0123` (ID 308995719, type User)
and nobody else. Delegated or bot accounts, including
`michaeljwilliams0123ultron`, are never the owner (H1). Owner intent for the
Companion/Steward roles is satisfied by an owner-authored PR or by an owner
**APPROVED review on the exact head commit**. After approving, comment
`/council recheck` to re-run the gate.

## Owner exception (signed)

The owner posts an unedited comment, no older than 24 hours:

```text
/council override PR_NUMBER HEAD_SHA BASE_SHA NONCE_32_LOWER_HEX -- REASON
signature:p256:BASE64URL_DER_ECDSA_SIGNATURE
```

The signature is P-256 ECDSA/SHA-256 over this payload, which ends in a newline:

```text
ULTRON-COUNCIL-OVERRIDE-v1
michaeljwilliams0123/Ultron.MW
PR_NUMBER
HEAD_SHA
BASE_SHA
NONCE_32_LOWER_HEX
REASON
```

The public verification key is **pinned in source** at
`config/council-owner-signing-key.json` on `main`. It is no longer read from
the repo variable `ULTRON_OWNER_SIGNING_PUBLIC_JWK` (H3), so changing the key
takes a reviewed PR to `main`. That variable is now unused; it was not deleted
or renamed. While `publicJwk` is `null`, the exception is unavailable and the
gate stays closed. CRLF line endings are normalised before verification (M4).

## Trusted evaluation (C1)

`.github/workflows/council-required-status.yml` triggers on
`pull_request_target` and on owner `issue_comment` (`/council override` and
`/council recheck`). For both triggers, GitHub takes the **workflow definition
from `main`**. The job checks out `main` only and never fetches the PR head or
its merge ref. The PR's title, body, changed files, reviews and comments are
read through the API and written to JSON or text files as data. The job then
runs `scripts/council-debate.mjs` and `scripts/enforce-council-acceptance.mjs`
from `main`.

Evidence is no longer downloaded from a `pull_request` run of
`council-debate.yml`. That run's YAML comes from the PR branch, so its
artifacts could be forged. `council-debate.yml` stays an advisory reviewer
only.

The job's `GITHUB_TOKEN` is read-only, with no `statuses` or `checks` write.

## Dedicated publishing identity (C2)

The result is a **check run** named `ultron/council-7of7`, created with an
installation token for a dedicated GitHub App. The previous approach was a
commit status from integration 15368, and any GitHub Actions workflow can
post one of those. Before publishing, the workflow re-reads the PR and refuses
to publish if the head or base moved. It also checks that the minted token's
App slug equals the configured slug.

**Fail closed:** if the App is not configured, nothing is published. The job
fails with an explicit error, and a ruleset that requires the check keeps the
PR blocked.

### Setup Michael must do (not done by any agent)

1. Create a GitHub App, for example **Ultron Council Gate** (slug
   `ultron-council-gate`), under your account:
   - Repository permissions: **Checks: Read and write**, **Pull requests:
     Read-only**, **Metadata: Read-only**. Nothing else.
   - No webhook is needed.
   - Install it on `michaeljwilliams0123/Ultron.MW` only.
2. In the repo settings, add Actions **variables** `COUNCIL_GATE_APP_ID`,
   `COUNCIL_GATE_APP_CLIENT_ID` and `COUNCIL_GATE_APP_SLUG`, and an Actions
   **secret** `COUNCIL_GATE_APP_PRIVATE_KEY` holding the App's private key PEM.
   These are new names. No existing secret or variable is renamed or removed.
3. Optional: generate an owner P-256 key pair offline and keep the private key
   off GitHub. Open a PR that sets `publicJwk` in
   `config/council-owner-signing-key.json` to the public JWK only
   (`kty`, `crv`, `x`, `y`).
4. Merge this PR. Then open a test PR and confirm that a `ultron/council-7of7`
   check run appears from the App, not from GitHub Actions.
5. Only then, edit ruleset 26999141 (currently disabled): require
   `ultron/council-7of7` **with the source set to the Council Gate App**, keep
   `test` and the up-to-date rule, then enable it.
   - Mind M2 (lockout): Dependabot and bot PRs need an owner APPROVED review
     plus `/council recheck`.
   - A model-provider outage will hold every PR. Keep the signed exception
     available, or leave the ruleset in evaluate mode first.

Until steps 1 and 2 are done, the gate is code only and blocks nothing.
No agent enables or edits the ruleset or branch protection.

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

Run `node --test test/council-trusted-gate.test.mjs test/council-release-gate.test.mjs`
and the full `node scripts/verify.mjs`. Verify live results from the
check-runs API, confirming `app.slug` is the Council Gate App. A green advisory
`council-debate` run is never the release requirement.

Relevant official documentation:
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository
- https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/making-authenticated-api-requests-with-a-github-app-in-a-github-actions-workflow
- https://docs.github.com/en/rest/checks/runs#create-a-check-run
