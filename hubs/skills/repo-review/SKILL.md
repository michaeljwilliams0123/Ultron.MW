# Skill: Repository Evidence Review

## Inputs
- Exact GitHub repository: `michaeljwilliams0123/Ultron.MW`
- An exact source SHA and the matching independent GitHub CI result

## Procedure
1. Read the canonical protected `main` SHA directly from GitHub.
2. Compare an unmerged candidate's head with independent Verify at that SHA.
3. Report uncertainty for pending, unavailable, or stale results.
4. Propose repairs through the existing PR route; documentation itself grants no execution authority.

## Fail-Closed Rules
- Never treat `action_required`, skipped, canceled, timeout, or unknown as a passing check.
- Do not embed credentials or user-confidential notes in public GitHub, GitLab replicas, or a GitBook-synced source.
- Do not alter branch protection, paid usage, or provider authorization from Markdown.

## Test Evidence
- Existing native Node suite: `test/git-hubs.test.mjs`
- Existing required CI: `.github/workflows/verify.yml`
