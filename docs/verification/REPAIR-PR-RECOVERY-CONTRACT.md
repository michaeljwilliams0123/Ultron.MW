# Repair App branch/PR reconciliation contract — Issue #168

This source-only integration provides branch and pull-request create-or-reconcile behavior under an admitted Repair App plan.

## Write sequence and durable state
1. Reserve an objective-specific key and SHA-256 plan fingerprint in a CAS ledger.
2. Record `branch-dispatch` **before** attempting to create the isolated branch. Reconcile from exact branch ref and base SHA; never blindly replay an uncertain write.
3. Record `branch-confirmed` only on readback. **Do not** dispatch `pr.create` on a base-only branch: an independently authorized code worker must prepare a real source commit first. The optional plan-bound `preparedHeadSha` must be a distinct 40-hex commit and match fresh branch readback. Without that commit, remain `reconcile-required` at `branch-confirmed`, without consuming a PR write attempt. This source-only precondition does not itself verify commit ancestry, changed paths, or external worker identity; those remain independent release gates. After preparation, record `pr-dispatch` **before** submitting a non-draft pull request to protected `main`. PR readback must include the exact prepared head SHA.
4. Read the PR from GitHub, matching repository, exact branch, base, non-draft state, objective-specific title and deterministic SHA-256 comment marker. Commit `complete` with the observed PR number.
5. On duplicate delivery or restart, retrieve the persisted state. An absent object after an unknown write remains `reconcile-required` and does not authorize a repeat mutation.

The PostgreSQL persistence adapter and source-only migration `cloud/hatchable/migrations/0012_repair_pr_attempts.sql` are included. The migration has not been applied to a live database and the adapter has not been connected to a live GitHub App.

## Independent Reef case set

[PR #177](https://github.com/michaeljwilliams0123/Ultron.MW/pull/177) introduced a protected-baseline execution grader and held-out negative cases. A follow-on PR uses that evaluator from the **base SHA**, rather than the candidate's own grader, to measure how the new coordinator handles duplicate tasks, lost response recovery, pause/identity controls, and forged readbacks. The real Reef runtime records the scored case feedback. These are **isolated test episodes**, not real owner-approved GitHub writes by the new Repair App.

## Still unverified for live acceptance

- Authenticated GitHub Repair App installation-token readback and standing repository grants.
- Actual external branch and PR writes under that identity, independent readback of exact head and review findings.
- Seeded test repair followed by bounded CI/review-loop remediation and true terminal observation.
- Production Postgres migration and restart across independent deployed workers.
- Independent PR reviewer, distinct held-out evaluator identity and Reef harness optimization.
- Permission denial at the real GitHub API for merge, main write, deployments and administration.

No credential changes, paid inference, protected main writes or deployment are authorized by these source-only components.

## GitHub App transport restrictions in this PR

`src/repair-github-adapter.mjs` is an explicit four-method allowlist over `createGitHubAppOperator.request`:
- `GET /git/ref/heads/ultron/repair-*` — authoritative branch ref and commit SHA readback; only genuine HTTP 404 is absence.
- `POST /git/refs` — create a restricted branch from an exact 40-character base SHA.
- `GET /pulls?state=all&head=...&base=main` — treat any unexpected, closed, draft, foreign, or duplicate PR readback as a conflict rather than recreating it.
- `POST /pulls` — create a non-draft PR, pinned to protected `main`, using a deterministic 64-hex-character repair marker.

The adapter exposes no generic `request`, protected-main update, merge, deployment, or GitHub settings operation. It uses the existing repository-scoped GitHub App transport, but does **not** independently mint installation tokens or prove the supplied operator was configured with a verified least-privilege grant. The real App token/permissions and live object readback must be observed by a separately authorized runtime before production use.

**Stale completion fix:** A persisted `complete` ledger state is not sufficient on its own. On re-entry the coordinator checks the exact branch SHA, PR scope and marker again; missing objects are uncertain and changed objects are rejected without replaying writes.
