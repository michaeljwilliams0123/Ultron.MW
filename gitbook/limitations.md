---
description: "Known unknowns, safeguards and readiness for GitBook publication."
---
# Known limitations and next steps

## Current boundaries and dated observations

* The public Pages site cannot directly host backend credentials or authenticate to local Node.
* GitHub Actions are ephemeral; cron schedules and successful deployments do not mean the brain is always running.
* The browser vault is device-local and opt-in; do not imply cross-device automatic sync.
* GitLab mirror workflow results are dated observations; inspect the exact source and destination SHAs before relying on a recovery copy.
* The [#69 closure record](https://github.com/michaeljwilliams0123/Ultron.MW/issues/69#issuecomment-6512838638) records authenticated GitBook Git Sync and matching handbook blobs on October 29. A later documentation edit needs a fresh sync/readback before claiming the new revision is published.
* [#65's four-step supervised local-fixture acceptance](https://github.com/michaeljwilliams0123/Ultron.MW/issues/65) is complete. Private-account MFA, broader sites and an always-on browser are separate capabilities.
* [Current dispositions](https://github.com/michaeljwilliams0123/Ultron.MW/blob/main/docs/ACCEPTANCE-STATUS.md) record accepted #66/#67 scopes and deferred learning research. Public health checks do not expand those scopes.

## Checklist after a handbook source change

1. Review and merge the source PR through protected checks.
2. Inspect the existing Git Sync operation for the intended repository, `main`, and `gitbook/` root.
3. Confirm the new handbook page blobs match that source revision.
4. Check navigation, links and the intended visibility; record the observed sync result.

GitHub source remains authoritative; a previous successful sync is not proof
that a later revision has already been published.
