# Hybrid autonomous release authorization

Primary: canonical Cloudflare watch events wake the signed Hatchable dispatch endpoint only when CI and Council are independently verified and a receipt is missing. The endpoint independently rechecks the same main SHA, uses durable nonce and 15-minute SHA-window admission, and reuses the existing GitHub App with repository-scoped Actions write and Contents read. Neither Cloudflare nor the App decides eligibility.

Backup: successful canonical main push verification and hourly GitHub scheduling trigger the same OIDC workflow. Manual dispatch defaults to shadow. Automatic dispatch uses auto mode: disabled or absent owner policy means decision-only; an enabled policy still requires all independent eligibility checks and an atomic receipt/claim. Concurrency and immutable unique keys prevent duplicate receipts. No new paid service or credential is introduced.

Authorization discovers the live Hatchable version and computes its digest from authenticated provider manifest bytes, compares independent source inventory, and checks the live version again. It never takes target, digest, file count, or changed files from workflow inputs. The watchdog recognizes exact standing-policy grant-bound receipts.

Deployment sequence: apply migration 0054 and sync Hatchable from merged main, then deploy the Cloudflare Worker. Verify both launch paths while owner policy is disabled, verify app Actions permission and production-autonomous-release environment settings, and enroll/enable only with owner passkey. First baseline release and any sensitive changes require owner handling. No production claim is made from PR tests. A denied or failed dispatch is retried by the next bounded wakeup or native schedule.
