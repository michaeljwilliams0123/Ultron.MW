# Owner-authorized GitLab branch execution: Hatchable cloud dispatcher

The `api/brain/gitlab-branch.js` endpoint and Mission Control panel provide
a **cloud-first transport** for the same `gitlabBranchWrite` provider engine
as the native MCP `ultron_gitlab_branch_write` tool. This avoids depending
on the *local Codex OAuth client* to run the provider operation.

## Trust / execution boundaries

- Hatchable requires an authenticated `admin` session and the sole owner
  handle `michaeljwilliams0123`. Cross-site browser POSTs are denied.
- `prepare` is side-effect-free and returns the exact provider-bound grant
  request (actor, operation, objective, resource hash and profile/stop versions).
- The owner signs the prepared request with their **existing owner-controlled
  P-256 private key outside the Hatchable runtime**, adding a SHA-256 policy
  digest. The production owner *public* JWK verifies the envelope.
- `submit` uses `lib/gitlab-branch-write.js` without alternative SQL,
  direct provider POST handlers or an authorization bypass. It enforces current
  PostgreSQL profile, stop/pause, one-shot dispatch claim, exactly one provider
  effect, GitLab CI runner policy, $0 and GitHub source parity.
- `reconcile` never POSTs to GitLab; it can only read a claimed outcome and
  persist independently verified evidence. If an HTTP write response is lost,
  **do not submit a second time**. Use the existing key and grant ID to reconcile.
- Client-side UI text uses `textContent`, does not persist grant envelopes
  in local/session storage and never loads the private key. The only required
  manual action is owner authorization; actual provider execution is cloud-hosted.

## Operate after the reviewed source is deployed

1. Open `https://ultron-mw-cloud.hatchable.site/`, sign in as the owner, then
   find **GitLab branch canary** under Mission Control.
2. Enter an unused idempotency key and exact 40-hex GitHub/GitLab commit SHA.
   Select **Prepare signed operation**. It reads the owner profile/stop version
   from Hatchable and creates the exact provider-bound request.
3. Copy the prepared request and sign it from **any owner-controlled trusted
   signing device** with `scripts/owner-grant.mjs`. Only the signed envelope
   is supplied to Hatchable. The private key remains offline or protected on
   that device; no second human co-signer is needed.
4. Paste the envelope into the owner UI and press **Submit once**. Review the
   intended project and branch. The UI locks subsequent submits even if an
   acknowledgement is lost; the durable server-side claim also prevents replay.
5. For uncertain outcomes, use **Read back existing grant** with the same key
   and grant ID. Independently verify GitLab branch SHA, no unapproved pipelines,
   and the durable `brain_mcp_provider_writes` / `brain_authority_grants`
   receipts before reporting production acceptance.

## Not yet zero-touch owner authorization

This removes the **local Codex MCP client** as a provider execution dependency.
It **does not** eliminate the owner-signature step: the existing signing key
is deliberately not copied into Hatchable, GitHub Actions or a generic agent.
Future fully cloud-first owner step-up should use a separate reviewed,
phishing-resistant passkey/owner session or an owner-enrolled key vault under
sole-owner control, without letting provider workers mint their own approvals.
Do not relax the current signature/stop/one-shot checks to speed up release.

## Release evidence

Test the route and UI as well as existing MCP implementation:

```sh
node --test test/hatchable-cloud-gitlab-branch-route.test.mjs test/hatchable-cloud-gitlab-ui.test.mjs test/hatchable-mcp-gitlab-branch-write.test.mjs
node scripts/verify.mjs
```

Source green is **not** proof of live OAuth, owner session or provider write.
Deploy only an exact, reviewed source version, then perform an authenticated
owner `prepare` (no GitLab effect) before one signed provider canary.
