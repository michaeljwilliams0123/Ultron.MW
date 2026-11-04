# Credentialless Hugging Face workflow evidence bridge

## Purpose
Avoid the manual secret-pairing blocker in #269 while retaining the old GitHub HMAC webhook as a separate, **disabled until configured** option. This path uses GitHub's existing OIDC identity service, short-lived tokens and read-only API calls. It adds **no** Hugging Face paid jobs, model inference, long-lived tokens, new hosting service or owner account.

## Protocol
- GitHub [OIDC](https://docs.github.com/en/actions/reference/security/oidc) permits a trusted Actions job with `id-token: write` to request a short-lived RSA-signed JWT from GitHub. This permission does **not** grant GitHub repository write access.
- `.github/workflows/hf-oidc-bridge.yml` runs after owner-triggered, completed `hf-heldout-cpu.yml`, `hf-free-cpu-tournament.yml`, or `c06-owner-model-release.yml` executions, and has an owner-only manual replay route for an already-completed run. Its code checks out **only** the default branch and does not download/execute another workflow's untrusted artifacts.
- The publisher builds exactly `{schema,runId,runAttempt,deliveryId}` with a fresh UUID, requests a GitHub OIDC token with audience `ultron.hf-oidc.v1:sha256:<sha256 of exact JSON body>`, and submits both via TLS to `/api/brain/hf-oidc-event`. The JWT is never logged, stored in PostgreSQL or sent to a browser.
- The public Hatchable route accepts only a JWT authenticated to GitHub's hardcoded issuer `https://token.actions.githubusercontent.com`, RSA-SHA256 and pinned JWKS URL, and audience bound to the exact request bytes. It verifies the signed claims: exact repository and stable repository ID, owner, public visibility, immutable owner/repository-ID-bound main branch subject (`repo:michaeljwilliams0123@308995719/Ultron.MW@1424939667:ref:refs/heads/main`), `hf-oidc-bridge.yml@refs/heads/main` workflow identity, owner actor, allowed `workflow_run` or owner `workflow_dispatch` event, and strict short lifetime. An arbitrary bearer, expired/surrogate token, wrong signed body or foreign workflow cannot write any receipt.
- Only **after** JWT validation does Hatchable read GitHub's canonical `GET /actions/runs/<id>`, requiring the exact owner actor, completed status, allowed workflow file, main branch and matching attempt. It then reuses the already deployed `hf_github_receipts` deduplication and scheduler worker, which independently verifies the GitHub run again and fetches bounded archive digest metadata.
- The owner-only Model Lab consumes independently verified receipts via its existing PostgreSQL overlay and Hatchable native realtime invalidations. No incoming model-generated code executes at any stage of this path.

## Testable failure boundaries
1. No JWT, forged signature, wrong `kid`, issuer/claim/ref, or changed body → **403** and no write.
2. Valid GitHub identity but incomplete/unallowed/source-mismatched run → **422** and no write.
3. GitHub API outage/rate-limit after authenticating → **503** with no invented success; bounded retries by the sender preserve the same request identity.
4. Same signed run delivered twice → original receipt, no duplicate worker execution; a different run ID/attempt must be independently verified.
5. Verified receipt → durable pending row, event notification, scheduler reconciliation, and owner-only Lab source readback. Neither a successful workflow nor an archive metadata digest is automatically a promoted model or full production acceptance.

## Acceptance plan
- RED/GREEN Node JWT tests with real RSA signatures and fake GitHub JWKS, plus repository full CI and workflow lint.
- Deploy exact merged source to the **existing** Hatchable app, no new project or cron. Probe anonymous/invalid bearer = 403.
- Owner-dispatch `hf-oidc-bridge.yml` against already successful public model-run `41775191071`. Collect actual GitHub Actions run ID/job conclusion and independently query `hf_github_receipts` + `/api/brain/hf-lab` for the expected source/attempt/digest. Test an owner browser session when available; signed-out pages must not expose private receipts.
- Only after a real successful delivery may #269 mark its **OIDC route** as operational. The separate HMAC route remains unconfigured, and #245's full independent autonomous release remains open.

This is a short-lived **identity proof and bounded readback**, not a credential with admin permissions, not a secret, and not an authority to merge PRs.
