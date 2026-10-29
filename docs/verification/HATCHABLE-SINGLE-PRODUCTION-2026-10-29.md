# Ultron.MW — single active Hatchable runtime (2026-10-29)

## Canonical topology

- **Source authority:** [GitHub main](https://github.com/michaeljwilliams0123/Ultron.MW) at `596f37f33b84244325e17e3cb97642913eb587b8` (PR #149); exact-source Verify, Pages and GitLab mirror succeeded before consolidation.
- **Owner's primary UI:** [Ultron GitHub Pages](https://michaeljwilliams0123.github.io/Ultron.MW/).
- **Only active Hatchable cloud service:** [Ultron MW Cloud Brain](https://ultron-mw-cloud.hatchable.site/) (`proj_A6GCXRSKizko`) v18.
- **Retired experimental project:** `proj_TcBub9teRzv1`, v14, renamed **Ultron.MW — Retired Experiment**. Its HTML landing page redirects to the production cloud; it is not a second active UI or scheduled brain.

The production adapter `lib/mahoraga-actions.js` was imported byte-exact from the protected canonical source and matched the experiment's previous live v13. All 39 tracked project files matched before the production deployment. Production has one hourly scheduler (the existing `/api/brain/tick` at `17 * * * *`); experiment has **zero** scheduled jobs. The experiment's owner execution control was durably paused at version 6 (receipt 107). This retires the duplicate cloud work without throwing away rollout history or restarting its pending actions.

## Independently verified production v18

| Check | Readback |
| --- | --- |
| Deployed API handlers | 8 |
| Admin owner-control GET | HTTP 200; `paused=false` |
| Admin tasks GET | HTTP 200; recent 30 tasks readable |
| Anonymous admin-control GET | HTTP 401 |
| Anonymous scheduler POST | HTTP 404 |
| Production Mahoraga action ledger | 2 observed; 1 prepared; 1 uncertain |
| Experiment cron inventory | 0 active |
| Experimental execution control | `paused=true`, version 6 |
| Experiment landing HTML | Fixed production redirect; does not forward URL query, credential, or browser context |

Production continues to use its original owner-managed fine-grained PAT through the backward-compatible `auto` mode. Production credential values, administrative grants, task history, and uncertain external actions were **not copied, rotated, replayed, or overwritten**. Experimental `brain_tasks` are test evidence, not production work; none were imported into production.

## GitHub App authentication: real outcomes, not implied acceptance

The owner-created key, which remained on the authorized Windows computer, was successfully used in an **ephemeral** RSA-signed GitHub App JWT:

- App: **Mahoraga Native PR Operator**, App ID `5187100`, installation ID `167855618`.
- Initial installation access token restricted to Mahoraga repository ID `1343333190`, with read permission on Contents, Issues and Actions. GitHub returned HTTP 200 for repository, issue, workflow and installation repository reads.
- Second token restricted to the **same repository**, with `issues:write`, `contents:read`, `actions:read`. The owner-authorized one-time [Mahoraga issue #1183](https://github.com/michaeljwilliams0123/mahoraga/issues/1183) was created, independently read back, and closed as **`mahoraga-native-pr-operator[bot]`**. The issue's unique marker prevented blind duplicate submission. The canary pinned Mahoraga main at `5f584f43341c62696bbc4ece1b392062632a654f`.
- Neither private key nor installation access tokens were printed, persisted, or committed.

**Important separation:** the previous **Hatchable-hosted** experiment action attempted to authenticate in `app` mode but returned `app-signing-configuration-invalid` **before sending any external write**. The experimental action remains `prepared`. Local signing and real GitHub App writes prove that the newly downloaded key and granted GitHub identity work, **not** that Hatchable's previously saved experimental key has a valid PEM value. This hosted experiment is now paused. Production PAT execution remains the accepted service route, and production App-only execution has **not** been asserted.

## Operational policy

1. Route all new hosted Ultron tasks, event readbacks, and UI links to production. Do not schedule anything on the retired project.
2. Keep the production stop/retry/authorization controls; don't force-replay `sent` or `uncertain` external actions.
3. Run `.github/workflows/live-acceptance-audit.yml` against GitHub, Pages and **production only**. Removing the archived-experiment public probe saves one network request per run and permits eventual deletion of that retired project.
4. Retain experiment history solely as a rollback/evidence archive. **The project record has not been deleted:** deletion or final permanent closure requires a separately authorized owner-side Hatchable project-management operation, not an invented MCP endpoint.
5. If native App-only hosting becomes necessary, verify an owner-supplied valid PEM in protected **production** Setup and repeat independent App-token read/write and revocation acceptance. Do not transfer the invalid experimental Setup value or replace the working PAT merely to satisfy a parity statistic.

## Remaining issue contracts

- [#65](https://github.com/michaeljwilliams0123/Ultron.MW/issues/65): private browser approvals, MFA and real external transfers.
- [#66](https://github.com/michaeljwilliams0123/Ultron.MW/issues/66): real worker crash, external-write response loss and recovery, budget.
- [#67](https://github.com/michaeljwilliams0123/Ultron.MW/issues/67): hosted App-only authority, two independent providers, revocation and uncertain-write readback.
- [#68](https://github.com/michaeljwilliams0123/Ultron.MW/issues/68): demonstrable held-out learning improvement.
- [#69](https://github.com/michaeljwilliams0123/Ultron.MW/issues/69): residual route-consumer audit and any source cleanup only after evidence-backed parity.

**Disposition:** one active Hatchable backend and one canonical cloud interface; separate historical experiment retained safely, with no active scheduler. No claim of full autonomous production acceptance.
