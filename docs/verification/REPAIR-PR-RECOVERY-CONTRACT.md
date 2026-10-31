# Repair App branch/PR reconciliation contract — Issue #168

This source-only integration provides branch and pull-request create-or-reconcile behavior under an admitted Repair App plan.

## Write sequence and durable state
1. Reserve an objective-specific key and SHA-256 plan fingerprint in a CAS ledger.
2. Record `branch-dispatch` **before** attempting to create the isolated branch. Reconcile from exact branch ref and base SHA; never blindly replay an uncertain write.
3. Record `branch-confirmed` only on readback, and `pr-dispatch` **before** submitting a non-draft pull request to protected `main`.
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
