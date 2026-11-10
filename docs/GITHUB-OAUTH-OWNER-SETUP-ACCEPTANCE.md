# Ultron.MW — owner OAuth setup and live-execution acceptance

**Single change review:** [PR #372](https://github.com/michaeljwilliams0123/Ultron.MW/pull/372) includes the repository-transfer fixes, synced Hatchable v85 connector source, regression suite, and these owner instructions. This is the historical setup PR; consult current PR state and the [identity contract](CANONICAL-GITHUB-IDENTITY.md) before applying its transfer-era settings. The Hatchable cloud app is not deployed from a GitHub PR automatically.

## A. Activate the native Hatchable OAuth read path

1. **Sign in as the Hatchable project owner** at https://hatchable.com/console/projects/ultron-mw-cloud. Use `michaelj.williams0123@gmail.com`, and enter a *fresh* Hatchable email PIN only in the currently displayed Hatchable sign-in dialog. An expired sign-in card or the ChatGPT Gmail connector does not authenticate a separate browser session.
2. **Create or locate the GitHub OAuth application** while signed in as your primary GitHub account (`michaeljwilliams0123`), which owns the canonical personal repository. Registration: https://github.com/settings/applications/new . You may register under an organization you administrate; do not transfer the source repository again.
3. Set application name `Ultron MW Cloud Brain Operator`, homepage `https://ultron-mw-cloud.hatchable.site/`, and exact authorization callback `https://hatchable.com/connect/callback`. Click *Register application*. Generate a Client Secret in GitHub's protected developer settings; never put it in GitHub issues, PRs, code, chat, or a plaintext note.
4. **Configure `github_operator`** in Hatchable's protected [project Setup](https://hatchable.com/console/projects/ultron-mw-cloud). Paste OAuth Client ID and Client Secret into the connection's protected fields, then select *Connect*.
5. In the GitHub consent window authenticate **`michaeljwilliams0123ultron`** (user ID `354634860`), not the owner login. Approve only the displayed requested scopes you accept. Current `github_operator` asks for `read:user` and `public_repo`.
6. **Confirm repository access:** grant the dedicated account collaborator access to `michaeljwilliams0123/Ultron.MW`. Organization membership or organization OAuth approval does not establish access to this personally owned repository.
7. **Verify:** https://ultron-mw-cloud.hatchable.site/connectors.html → *Refresh read-only checks* and *Run extended checks*. Expect the dedicated account, repository owner `michaeljwilliams0123` (ID `308995719`), repo `Ultron.MW` (ID `1424939667`), current main SHA, and separate GET checks for issues, PRs and Actions. A partial read failure stays partial, never `productionAccepted`.

## B. Distinct scope for eventual owner-approved writes

- `public_repo` is **not repository-scoped**; it grants read/write capability across public repositories the connected account may access. The native OAuth connection is **observation-only in Ultron's current implementation**. GitHub repo permission hints and OAuth login never replace a signed owner grant, stop/revoke checks, bounded operation, durable nonce, or independent provider effect receipt.
- For fine-grained execution, register/install a GitHub App under owner control and limit its installation to `michaeljwilliams0123/Ultron.MW`. Personal-account installed Apps: https://github.com/settings/installations . A GitHub App installation, ID, signing key, and token exchange are **separate** from the OAuth user connection. Hatchable's current isolate cannot produce GitHub App RSA JWT signatures; the trusted signer must live in an approved signing-capable worker, not in the owner browser.
- GitHub Actions repository protected secrets: https://github.com/michaeljwilliams0123/Ultron.MW/settings/secrets/actions ; variables: https://github.com/michaeljwilliams0123/Ultron.MW/settings/variables/actions . The exact identity workflow must be authorized and configured before promotion. Never copy a PIN into Actions secrets or use a Mahoraga-only key for Ultron without installation-scope verification.

## C. Required accept/reject tasks

| ID | Test task | Expected result |
| --- | --- | --- |
| OA-01 | Correct bot user, immutable IDs, canonical main, all three GET endpoints | Authenticated read coverage complete, no write |
| OA-02 | Other user, wrong numeric user ID/type, revoked token | Fail closed, no repository claim |
| OA-03 | Old personal-account repo alias, unexpected org, wrong repository ID | Reject before any operator action |
| OA-04 | Missing consent, expired PIN/session, OAuth 401/403, rate limit 429 or 5xx | Actionable setup/error, never synthetic success |
| OA-05 | Missing/invalid/tag/uppercase commit SHA or wrong ref | Reject unverifiable head |
| OA-06 | Issues/PR/Actions read denied or malformed | Partial coverage, no full acceptance |
| OA-07 | OAuth token includes apparent push capability | `executionAuthorized:false` until separately owner-signed |
| OA-08 | Unknown ACK, replayed nonce, expired grant or stop/revoke | No duplicated external write; durable reconciliation before retry |
| OA-09 | Owner-authorized canary under the new organization | Exact remote parent/tree/SHA + receipt readback + exact-head CI |
| OA-10 | Historical old-org ledger rows during migration 0040 | Preserve immutable history; never silently reauthorize |

**Evidence boundaries:** The synced Hatchable connector has 26 deterministic in-runtime simulated cases, supplemented by an expanded Node scenario matrix. These mocks are not live provider-write acceptance. One scoped owner-approved production canary and independent evidence under issues #167, #204, and #285 are still required. Paid incremental spend remains $0 without further approval.

Official GitHub guidance: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app ; https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps ; https://docs.github.com/en/organizations/managing-oauth-access-to-your-organizations-data/approving-oauth-apps-for-your-organization