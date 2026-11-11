# Council self-repair loop

**Status:** draft, staged, report-only by default. This is the Grok Bots
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

## Why the workflow is staged

The file is `.github/workflow-lanes/council-self-repair.yml`. The box token has
no `workflow` scope, so it can't push it into `.github/workflows/` yet. To activate it:
`git mv .github/workflow-lanes/council-self-repair.yml .github/workflows/`, then
push with a token that has the `workflow` scope. At the 26 → 8 cutover it folds
into the ops-audit lane (Sentinel).

## Relation to the existing repair engine

`src/autonomous-repair-loop.mjs` is the bounded patch engine
(`ultron/repair-*` branches, ledgered). This loop is the trigger and triage
front end. A later phase can route Builder handoffs into that engine instead
of an outside agent.
