# Admin App secret isolation and Council release configuration

## Scope of this source audit

Run `node scripts/audit-secret-isolation.mjs`. It checks Git-tracked and local untracked source for
valid private-key PEM blocks, token-like strings, tracked dotenv/key files, symlinks and unreadable source.
Only paths and finding categories appear in errors; credential values are never printed.

This check CANNOT attest that credentials are absent from Git history, runner logs, GitHub Actions
secrets, an external vault, or previous releases. Use GitHub secret scanning and access reviews as well.

## CI enforcement

The existing `.github/workflows/verify.yml` runs the scanner before dependency installation
for pull requests and main-branch verification, binding failures to the required `test` job.
The repository intentionally retains its eight-workflow consolidation contract; a redundant
ninth standalone secret-audit workflow is not added. This is a source audit, not a secret-custody proof.

## Actual Council Gate configuration (unverified until App registration)

The dedicated Council Gate GitHub App is separate from the secondary-owned Admin App.
Only verified settings from the registered Council Gate App should populate these Actions variables:

- `COUNCIL_GATE_APP_ID` -- real numeric App ID.
- `COUNCIL_GATE_APP_CLIENT_ID` -- real client ID from the App settings, not the App ID.
- `COUNCIL_GATE_APP_SLUG` -- registered App slug.
- `COUNCIL_GATE_APP_PRIVATE_KEY` -- corresponding PEM in an Actions secret, never source.

Required Council App permissions: Checks read/write, Pull requests read, Metadata read.
Install it only on `michaeljwilliams0123/Ultron.MW`, subject to the trusted mainline contract.
Do not use illustrative identifiers `app_client_ultron_mw_01928374` or `ac_ultron_admin_primary`.
Neither has been authenticated as an actual GitHub or Composio identifier.

## Secondary Admin credential custody

The production repo previously listed `ULTRON_SECONDARY_ADMIN_PRIVATE_KEY` as an Actions
secret, which this source scan CANNOT inspect or remediate. Do not delete or rotate the
working secret until an isolated secondary-controlled environment is provisioned, the
exact installation-token canary succeeds, all consumers are migrated, and independent
readback confirms the cutover. Source scanning alone does not clear the custody blocker.

## Fail-closed release conditions

The Trusted Council must produce authentic exact-head evidence with seven legitimate role
verdicts, model-backed requirements, owner intent and any required signed exception.
No script in this PR creates Council approvals, changes rulesets or makes a production
Admin operation. Owner passkey authorization is also a separate live security gate.

Run locally:

    node --test test/secret-isolation-audit.test.mjs
    node scripts/audit-secret-isolation.mjs
