# Ultron-Mahoraga-Connection1026

Tracked by Ultron Issue [#95](https://github.com/michaeljwilliams0123/Ultron.MW/issues/95).

## Token connection

The owner-generated **fine-grained PAT** is a user credential, not a GitHub App
installation token. Never paste its value into issues, source files, chat,
CI logs, browser URLs, plugin configuration examples, or public artifacts.

This integration uses the ASCII-only secret variable name
`ULTRON_MAHORAGA_CONNECTION1026`, matching the friendly connection label
`Ultron-Mahoraga-Connection1026`.

**One secure GitHub Actions paste location:**

[Open New Ultron.MW repository secret](https://github.com/michaeljwilliams0123/Ultron.MW/settings/secrets/actions/new)

- Name: `ULTRON_MAHORAGA_CONNECTION1026`
- Value: paste the PAT directly into GitHub's protected **Secret** field
- The PAT must be scoped to only the private `michaeljwilliams0123/mahoraga` repository, with Contents read/write. The optional issue and Actions acceptance paths need their corresponding GitHub permissions.
- No expiration was observed on the user's token; schedule rotation and revoke if exposed.

After merging this PR, open
[the Ultron Mahoraga Connection1026 workflow](https://github.com/michaeljwilliams0123/Ultron.MW/actions/workflows/mahoraga-connection1026.yml)
and select **Run workflow → read**. The runner verifies the private repository ID
and main SHA without printing the token. Then deliberately choose
**write-canary** to create `mahoraga/ultron-conn1026-<run_id>`
and `docs/ultron/connection-canary-<run_id>.md` on that isolated branch,
independently read back its content and check protected main was unchanged.
The canary is a real Git write, not a claim that Ultron can override repository
protections or permanently administer a repo.

**Hatchable hosted runtime** has a *separate* protected secret store:
[Ultron cloud project](https://hatchable.com/console/projects/ultron-mw-cloud).
The source declaration `cloud/hatchable/hatchable.toml` also names
`ULTRON_MAHORAGA_CONNECTION1026`. If direct Hatchable-origin tasks are required,
the owner must separately save this same PAT in Hatchable's secure Setup.
A GitHub Actions secret is not automatically accessible inside Hatchable and
must never be transferred through a public webhook or browser.

The Mahoraga action adapter supports a configured PAT and retains its existing
GitHub App installation-token mode as a fallback. Its current operation
allowlist permits **issue.create** and **verify.dispatch** under exact-source
checks and durable reconciliation. Git push canary is run by GitHub Actions;
generalized production code pushes are a separate tested and authorized
operation, not silently added to the privileged cloud adapter.

Do not merge or deploy merely because test fixtures pass; require CI,
Hatchable runtime deployment parity, and real credential-backed readback
before closing #95.
