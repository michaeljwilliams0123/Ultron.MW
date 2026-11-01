# Ultron Council: seven GitHub App identities (source-only)
Issue #186 · Candidate PR #208 · no registration or production authorization performed.

## Build / inspect

```sh
node scripts/council-app-manifests.mjs --profile=scoped
# Requested owner-like profile for manual review ONLY:
node scripts/council-app-manifests.mjs --profile=owner-requested
# Optional private terminal use: export COUNCIL_NOTIFICATION_MAILBOX=your-gmail-address
```

The script emits seven private App **blueprints** and declares `NOT_REGISTERED`.
It does not POST to GitHub, issue credentials, expand installations, connect workers,
or modify production. Registration uses GitHub's official
[GitHub App settings](https://github.com/settings/apps/new). A GitHub App
manifest requires an interactive POST + protected redirect/code exchange: a
simple GET query string is **not** equivalent to completed registration.
Do not publish manifest-exchange codes, private keys, webhooks or passwords.

## Seven roles

Builder, Skeptic, Steward, Predictor, Generator, Sentinel, Companion.
App names are `ultron-mw-<lowercase role>` and can be adapted if names are
already registered globally. Gmail `+Role` addresses are mail routing aliases,
not independent GitHub users or credentials. No personal mailbox appears in
committed source or default CLI output.

## Permission boundary

- The default `scoped` App manifest requests read: metadata, contents, checks,
  Actions; write: issues and pull requests. Webhooks and event subscriptions
  are disabled until an authenticated, reviewed receiver exists.
- The `owner-requested` blueprint expresses the owner's broader desired
  permissions (administration, Actions, workflows, contents, issues, PRs and
  checks). It is **not** the account-owner role or a credential grant; installation
  requires a separate GitHub approval and repository-level scope.
- A real installation must be independently read back, identify its exact app
  and intended repository, and authenticate via its own short-lived installation
  token. Source labels and alleged actor names do not authenticate anything.
- The authorized operation gate in source permits scoped observation and
  evidence comments/proposals only. Protected merges, self-approval, admin,
  secret changes and deployments need separate policy-gated authorization.
- Do not give seven App identities the same signing key, use the owner's PAT,
  or treat cooperative bots as truly independent security reviewers.

## Capacity and spending

App installation API rate-limit buckets are not AI inference credits. They
do not increase GitHub Actions compute minutes or Copilot/model entitlements.
Standard hosted Actions are free on public repositories, subject to service
limits. The C04 `$0/day` paid-inference budget is enforced at the dispatch
boundary before any model-backed execution is enabled. A separate agent
worker/provider and signed evidence are still needed for independent reasoning.

## Acceptance gates

1. Seven GitHub registrations completed by the owner, each with unique App IDs.
2. Seven installations scoped to the intended repository, with permission
   readbacks and no shared private keys; no credentials in GitHub PR comments.
3. Authentication tests from each distinct bot identity, including wrong-role,
   expired-token, wrong-repository, revoked-installation and replay rejection.
4. Each role independently records its own evidence and dissent with an
   attributable signed receipt. A synthesized role summary does not qualify.
5. The PR owner does not self-approve; a separately eligible reviewer validates
   exact-head CI. No privileges, merges, deployed receivers or paid credits
   are activated by this PR.

## Expanded C04 engineering role profile

Generate seven role-specific registration proposals with:

```sh
node scripts/council-app-manifests.mjs --profile=engineering-autonomy
```

Builder and Generator request Contents write and can prepare code changes on their own `ultron/council-<role>-` branches. Skeptic and Steward may contribute reviews and request changes. Predictor and Companion may contribute issues and comments. Sentinel may dispatch the existing `verify.yml` workflow on `main`. Each role requests Issues and PR write for its bounded functions.

The operation policy requires an authenticated App identity, exact source SHA, zero paid cost, and scoped attempts. It cannot authorize a direct `main` update, an administrative change, or a merge. This is an implementation proposal and does not activate the proposed permissions. Actual App installation, execution service and release testing remain separate acceptance tasks.
