# GitLab signed write execution — integration and release controls

## Implemented source, not live permission

`ultron_gitlab_branch_write` is an admin-only **write** MCP tool, not a repository
observer. It implements `prepare → submit → reconcile` for an exact GitLab
branch create. The branch is always `ultron/task-<key>` in private project
87884831; the source must already exist in both the canonical public GitHub
Ultron.MW repository and the private GitLab mirror at the identical SHA.

The tool never accepts a user-chosen GitLab project, endpoint, HTTP method,
pipeline variable, branch prefix, private key, arbitrary ref or token.

### Dispatch contract

1. `prepare` returns a canonical `gitlab.branch.create` grant request, with
   resource fingerprint covering the source SHA, branch key and versioned
   owner profile and stop state. It has **zero external writes**.
2. An independently administered signer must approve the exact operation and
   return a short-lived signed grant; the Hatchable runtime holds only the
   pinned **public** P-256 verification key.
3. `submit` verifies the signed envelope, current stop/profile versions,
   zero paid-spend ceiling, fixed project identity, GitLab commit and GitHub
   commit, plus branch absence. The PostgreSQL ledger atomically consumes the
   grant and claims the one-shot resource before any provider POST.
4. Only if the post-claim admission still passes does the tool call
   `POST /api/v4/projects/87884831/repository/branches` exactly once.
   Subsequent attempts, including a timeout or unknown acknowledgment, do
   **not** re-POST. The tool reads the exact branch and commit through GitLab
   before persisting an observed execution receipt.
5. `reconcile` can finish an uncertain prior claim from independent GitLab
   branch readback. It cannot issue POST or bypass the source/claim checks.
6. A new branch under `ultron/task-` does not match the current GitLab
   `verify/*` CI workflow. It does not trigger GitLab shared runner minutes.

### Source and runtime dependencies

- `0032_gitlab_signed_branch_create.sql` expands the existing provider
  ledger operation check and increases the profile catalog ceiling from 21
  to 22. It must only follow full, independently verified reconciliation of
  the known production `0029`–`0031` partial migration. **Do not deploy
  0032 over unreconciled production state.**
- The operation is recognized in the source security catalog and can be
  selected into a future versioned owner profile, but it is **not** selected
  by default and is not presently runtime-authorized.
- The optional `gitlab_write` Hatchable API broker requests GitLab OAuth
  `api` scope, **separately** from the read-only `gitlab` `read_api`
  connection in PR #315. On GitLab.com Free, project access tokens are not
  available; generic OAuth `api` grants broad account-level API access.
  For production, use an independently administered gateway or otherwise
  provably restrict the egress credential to this fixed operation. An
  admin-only MCP input schema alone does **not** restrict a compromised
  application that possesses a broad OAuth token.
- No GitLab OAuth client ID, secret, private key, bearer token, protected
  settings, production profile, policy, migration ledger or deployment is
  changed by this source PR. Owner consent and authentication are separate.
- Test fixture signatures are **ephemeral synthetic ECDSA keys**, not
  production authorization. A green test is not a valid live signer receipt.

### Verified live provider capability

On November 8, 2026, the connected GitLab integration created and separately
read back a real private branch at `ultron/canary-write-20261108`, pointing
to `531544828c4e28dc391fc119c7029c950a22f87a`. GitLab listed **zero**
pipelines for that branch. This validates provider-side write access only;
it does not validate the Hatchable production MCP or independent signer.

## Future write adapters

Add more executionary operations as discrete catalog entries, not generic
`HTTP POST`: GitHub PR patch/dispatch, GitLab `verify/*` CI dispatch
(with explicit remaining-free-minute guard), and approved external
applications. Each must have its own operation-typed grant, unique
idempotency target, post-claim stop check, no automatic uncertain-write
retry and actual provider readback. Never use the deterministic Council's
agreement as an independent signed authorization or as evidence of the
external action's effect.
