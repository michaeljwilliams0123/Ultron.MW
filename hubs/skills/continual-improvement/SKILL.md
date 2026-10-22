# Skill: Continual Improvement Evidence

## Inputs
- Exact GitHub source SHA and versioned baseline and candidate artifact fingerprints.
- Receipt-linked feedback from permitted, non-sensitive Ultron executions.
- Separate development and held-out cases with independently observed results.

## Procedure
1. Serve: bind the task, source SHA, artifact version, execution times, result and verification receipt.
2. Observe: join scored feedback to that exact receipt; separate successful, failed, incomplete and ineligible records.
3. Grow: create a native or Reef-assisted candidate outside production, preserving baseline lineage and rollback content.
4. Evaluate both artifacts on the same benchmark. Keep development case IDs out of the held-out set.
5. Commit only the selection disposition. Publish an accepted candidate through the ordinary protected GitHub PR path, then verify current main and repeat the user task.

## Fail-Closed Rules
- Plugin guidance is not a Reef runtime. A Reef-assisted candidate is Blocked without a verified runtime record.
- Missing, pending, stale, self-reported or unexecuted results are Inconclusive, not successful.
- Reject invariant failures and any critical held-out regression even when average score improves.
- Never infer cost savings when cost is unobserved; retain it as missing evidence.
- Candidate selection grants no merge, deployment, credential, provider or paid-inference authority.
- Do not put confidential conversations, credentials, client data or private memories into public evaluation artifacts.

## Test Evidence
- Candidate lineage and disposition policy: `test/learning.test.mjs`
- Hub admission and authority boundary: `test/git-hubs.test.mjs`
- Required exact-head verification: `.github/workflows/verify.yml`
