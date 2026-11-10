# Canonical GitHub identity and Codex enrollment

Current configuration, 2026-11-10. Tracking: [issue #379](https://github.com/michaeljwilliams0123/Ultron.MW/issues/379).

| Identity | Purpose | Immutable GitHub ID |
|---|---|---|
| `michaeljwilliams0123/Ultron.MW` | Sole canonical source repository | `1424939667` |
| `michaeljwilliams0123` | Repository owner and owner-only authorization actor | `308995719` |
| `michaeljwilliams0123ultron` | Dedicated contributor used by this Codex | `354634860` |

The repository was transferred to `Ultron-MW` and returned to Mike. The retired organization ID `354776009`, its repository path and its immutable OIDC subject must not authorize current operations. Redirects do not prove canonical identity. Never use `michaeljwilliams0123ultron/Ultron.MW` as the source repository merely because the contributor authenticates a request.

Canonical immutable main subject:

```text
repo:michaeljwilliams0123@308995719/Ultron.MW@1424939667:ref:refs/heads/main
```

OIDC configuration on GitHub must independently match this subject template. A source change does not configure GitHub's OIDC settings or update a deployed Hatchable service. Existing owner-only dispatch guards stay owner-only; allowlisted contributor login/ID pairs in receipt verifiers do not grant release or administrative authority.

## Observed connection and remaining enrollment

The connected GitHub API authenticated `michaeljwilliams0123ultron` and reported read/push access, with no admin access, to Mike's repository. Organization memberships returned empty. This proves this connection's GitHub identity and repository access; it does not attest a separate OpenAI account, Hatchable OAuth connection, background delivery or production execution.

`ultron-codex` and `destiny-codex` identify the same executor. The stable internal ID remains `destiny-codex` to preserve task digests, historical receipts and event title filters. Its display name is Ultron's Codex; all previous Destiny aliases remain valid. Mike's author is unchanged.

On 2026-11-10 the existing automation was renamed Ultron's Codex, enabled, and instructed to select only the dedicated contributor connection and verify its login/ID before executor mutations. No schedule or event filters were changed. SHA-256 of the actual stored automation ID independently matched the existing registry route fingerprint `1278bdf842ec4108ae053fa3656cc38fde798c7eabb10f19834ee74969ebdfbd`. Raw automation and private session identifiers are omitted. This verifies enrollment metadata, not separate OpenAI account ownership or successful event execution.

To verify live delivery, submit one bounded owner-authored read-only task through the real Issue-to-PR route, using `/codex destiny-codex ...` (or the Ultron alias after this update merges). Observe the independent event run, create-only claim and completion receipt, contributor GitHub actor, exact source/head lineage and required CI. The existing exact owner-authored `/codex run destiny-codex` comment remains the explicit trigger when needed. Do not create a second automation or replace delivery with polling.

Mark live execution verified only in a subsequent reviewed evidence update citing the actual run. Failed or unknown delivery remains blocked or reconcile-required; this interactive setup must not write its own webhook receipt. This session can update and enable the existing event automation, but exposes no interface to create or inspect its event-filter configuration. Successful delivery must therefore be verified with a real task.

## Audit, migration and rollout

The correction covers current source, Actions guards, Hatchable API targets and public UI, receipt policy, App installation lookup, OIDC identity checks and regression fixtures. Historical transfer reports are labeled superseded. Migration `0040_ultron_org_transfer.sql` remains unchanged: it already permits both historical and current repository names while preserving immutable rows. New runtime operations accept only the canonical personal repository; historical organization grants and receipts are not rewritten into current authorization.

No production database rewrite is required for the repository-name constraint. Reconcile queued organization-scoped operations explicitly rather than replaying them under the new name. Deploy Hatchable source through the existing owner-authorized release process, then independently verify identity, repository, OIDC and provider readbacks. Rollback is a normal reviewed source revert; do not erase historical receipts or broaden both namespaces into active authorization.
