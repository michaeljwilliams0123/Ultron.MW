# Owner-dispatched GitHub Actions canary — independent fallback

The Ultron Coordinator App's JWT was verified on run #42815900260, but its installation for \`Ultron-MW/Ultron.MW\` was not visible. This alternative uses the **repository's built-in per-job \`GITHUB_TOKEN\`** through manually owner-dispatched GitHub Actions, rather than Coordinator credentials.

## Read-only mode (default)
Manually dispatch \`.github/workflows/owner-actions-canary.yml\` on \`main\` with mode \`read\`. The job has \`contents:read\` and verifies the owner actor and triggering actor, GitHub main ref, exact source SHA, repository full name and numeric ID \`1424939667\`, and GitHub's observed main HEAD. It performs only GET requests, retains a seven-day sanitized artifact and never claims any Coordinator or Council role identity.

## One isolated branch, separate opt-in
Select mode \`create\`, supply the exact 40-character current main SHA, and explicitly type \`APPROVE_ONE_OWNER_ACTIONS_CANARY\`. Only this separate job has \`contents:write\`. A valid dispatch checks the same preconditions, rejects preexisting branches, then issues **exactly one POST** to create \`ultron/canary-owner-actions-<run-id>\` from the exact pinned \`main\` commit. Independent GitHub GETs verify the new branch ref and recheck \`main\`. Unknown outcomes and reruns hold for reconciliation; they never blindly repeat a write. No PR, deploy, source-code, administrative, or protected-main mutation is permitted.

## Provenance and limitations
Execution is by **\`github-actions[bot]\`**, authorized by owner \`michaeljwilliams0123\` through a manual \`workflow_dispatch\`. This is **not** a cryptographically signed Task 1–5 owner grant, **not** an Ultron Coordinator installation-token operation, **not** one of seven independently authenticated personas, and **not** a Hatchable PostgreSQL execution or nonce receipt. A verified branch ref is a real provider effect, but is not proof of the broader autonomous executor's acceptance. The remote branch survives, whereas GitHub Actions artifacts are retained for seven days. No new PEM key, App installation, external runner, or paid API is required.

PR #374's source migration and tracked migration 0040 are separate pending release controls. This fallback does not relax or claim satisfaction of their acceptance criteria.
