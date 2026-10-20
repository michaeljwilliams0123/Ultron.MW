---
description: "Known unknowns, safeguards and readiness for GitBook publication."
---
# Known limitations and next steps

## Separate implemented from proven

* The public Pages site cannot directly host backend credentials or authenticate to local Node.
* GitHub Actions are ephemeral; cron schedules and successful deployments do not mean the brain is always running.
* The browser vault is device-local and opt-in; do not imply cross-device automatic sync.
* A private GitLab recovery project was imported and matched GitHub on October 20; an automatic ongoing mirror has not yet been verified.
* The 11:59 PM nightly ChatGPT task is active, but must disclose inability to write GitLab if no supported transport exists.
* GitBook site/org and Git Sync have not yet been created; documentation source being prepared is not a published site.
* An authenticated graphical Pages end-user acceptance is still required for Issue #32.

## Checklist to publish this handbook

1. Create or select a GitBook organization and confirm the exact organization name.
2. Confirm a free/basic single-space site and desired visibility before public changes.
3. Merge the GitHub docs preparation PR after exact-head checks.
4. Create an empty site (no default template) and configure GitHub Git Sync in the GitBook UI.
5. Set the project directory to `gitbook/`, source branch `main`, and initial direction Git → GitBook.
6. Verify page navigation/links and that GitBook contains the same documented revision.

Until then GitHub source documentation remains authoritative.
