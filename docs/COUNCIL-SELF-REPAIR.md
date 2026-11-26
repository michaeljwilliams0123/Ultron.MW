# Council self-repair loop

**Status:** draft, report-only by default. This is the Grok Bots
pattern applied to CI: a lead routes the work, background workers bring back
drafts, and anything consequential becomes an approval card for the owner.

| Step | Council role | What it does | Writes? |
| --- | --- | --- | --- |
| Diagnose | Sentinel | Classifies a completed run on `main` or on an owner-authored same-repo PR. It reuses `src/ci-job-presence.mjs` for Verify, so GitHub losing jobs (#351) is never treated as a test failure. | No |
| Route | Ultron Core | Turns the diagnosis into allow-listed, role-attributed actions (`planRepair`). | No |
| Repair | Builder | Opens or updates **one** labeled diagnosis issue per failure signature. It can hand that issue to the Copilot coding agent for a **draft** fix PR. It updates stale owner drafts that are behind main using GitHub's update-branch (a merge, never a force-push), then dispatches Verify on the branch. | `act` mode only |
| Review | Skeptic | Fix PRs stay drafts until there is a falsifying test and the exact head is green. The council debate already runs on PRs. | No |
| Escalate | Steward | If a failure touches workflows, credentials, permissions or release paths, or a rerun is still missing jobs, it adds the `needs-owner` label and creates an approval card. It never auto-fixes these. | Label only |

The loop never plans `pr.merge`, `release.publish`, `deploy.production`,
`secret.write`, `permission.change` or `repository.settings`. It checks
against `OWNER_ONLY_OPERATIONS` from `src/council-of-ultron.mjs`, and a test
enforces this.

## Configuration (repository variables; none exist yet)

- `ULTRON_SELF_REPAIR_MODE`:
  - unset or `report-only` (default): diagnose and write a step summary. No writes.
  - `act`: allow the writes listed above.
  - `off`: do nothing.
- `ULTRON_SELF_REPAIR_AGENT=copilot`: assign diagnosis issues to the Copilot
  coding agent. This needs a new **optional** secret, `ULTRON_COPILOT_ASSIGN_TOKEN`:
  a fine-grained user PAT with Actions, Contents, Issues and Pull requests set to
  write on this repository only. GitHub refuses Copilot assignment from
  `GITHUB_TOKEN` and from App installation tokens. Without the secret, the
  issue is still opened and assignment is skipped.
- The Codex path stays owner-triggered (`/codex run` from Michael). The loop
  does not impersonate the owner.

## Triggers and cost

- `workflow_run` runs when "Ultron core verification" completes. Its job-level `if` skips
  successes and other people's PRs, and skipped jobs use no minutes.
- `schedule` runs every 6 hours. It sweeps failed `main` runs from the last 6 hours and
  stale owner drafts.
- `workflow_dispatch` takes an optional `run_id`.

## Where it lives

`.github/workflows/council-self-repair.yml`. `workflow_run` and `schedule` only
fire from the default branch, so nothing runs before merge. At the 26 → 8
cutover it folds into the ops-audit lane (Sentinel).

## Relation to the existing repair engine

`src/autonomous-repair-loop.mjs` is the bounded patch engine
(`ultron/repair-*` branches, ledgered). This loop is the trigger and triage
front end. A later phase can route Builder handoffs into that engine instead
of an outside agent.

## Council HOLD remediation (exact-head)
The trusted release gate now publishes a bounded diagnostic route separately from the verdict. It never changes the verdict, grants new authority, or imports PR code. Security-sensitive changes still require the signed owner exception; a model outage is not a code vulnerability.

The existing ops-audit lane scans canonical open PRs hourly at :19 UTC, or via owner-only ops_task=council-hold-remediation. It reads the latest completed dedicated Council Gate App check, exact PR head/base and the pinned gate workflow ID. It rechecks before a write. A transient provider outage or missing role evidence can rerun that exact trusted workflow once, after 15 minutes and within 48 hours. Real dissent is investigated rather than re-voted; non-transient credential or input-policy problems are diagnosed. An unresolved hold gets at most one bot-owned investigation issue for the exact PR/head/base. Existing CI self-repair continues to handle independently observed failed tests and bounded draft fixes. Model suggestions are unverified hypotheses, not commands or proof of defects.

Set ULTRON_COUNCIL_REMEDIATION_MODE=act for automatic rechecks and investigation records only. Default is report-only; off disables the job. Global ULTRON_SELF_REPAIR_MODE=off also stops it. The separate mode does not activate existing broader CI repair permissions, Copilot assignment, paid inference, merging, deployment or owner-exception signing. Maximum five admitted writes per hourly scan; incomplete inventories and moved heads deny writes. Legacy checks without trusted remediation metadata are reported only until the next exact-head trusted recheck. Verify on main before claiming live acceptance.
