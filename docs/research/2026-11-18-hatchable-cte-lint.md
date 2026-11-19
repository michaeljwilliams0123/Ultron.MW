# Hatchable SQL CTE false-positive investigation (2026-11-18)

**Status:** Verified deploy-time false positives; vendor correction pending. **Tracking:** [Ultron.MW issue #499](https://github.com/michaeljwilliams0123/Ultron.MW/issues/499) and Hatchable platform feedback **#2637**. **Environment:** existing production project `proj_A6GCXRSKizko`, Hatchable v132. Source/runtime SQL was not changed.

## Primary-source findings

[PostgreSQL WITH documentation](https://www.postgresql.org/docs/current/queries-with.html) defines Common Table Expressions as temporary query-scoped relations. [PostgreSQL SELECT documentation](https://www.postgresql.org/docs/current/sql-select.html) explicitly permits referencing a CTE name as if it were a relation within that SQL statement. These names must **not** be required to exist in the persistent table catalog.

[Hatchable's deployment rules](https://hatchable.com/docs/developers/restrictions) and [MCP developer documentation](https://hatchable.com/docs/developers/mcp) distinguish deployment-time warnings from hard validator errors and document dry-run validation. The observed `lintMissingTables` validator produces `query_references_missing_table` warnings for legal `FROM`/`JOIN` references to CTE names. The issue is a platform analyzer defect, not grounds for new schema migrations.

## Reproduction and evidence

A fresh `dry_run_deploy` returned `ok: true`, no blocking errors, and the following **first ten visible warnings**:

| Hatchable project path | CTE names falsely reported as missing tables |
| --- | --- |
| `lib/brain-runner.js:37` | `control`, `autonomy` |
| `lib/mahoraga-actions.js:431` | `profile` |
| `lib/security-adjudicator.js:195,200,252,269` | `authority`, `gate`, `passkey`, `existing` |
| `lib/owner-autonomy-control.js:109` | `moved`, `receipt` |
| `lib/mcp-mahoraga-grant.js:57` | `policy` |

Relevant source files live in the repository under `cloud/hatchable/lib/` and the same project paths are deployed on Hatchable.

An isolated **SELECT-only** PostgreSQL experiment succeeded:

```sql
WITH probe_cte AS MATERIALIZED (SELECT 17 AS marker),
     second_cte AS (SELECT marker + 1 AS marker FROM probe_cte)
SELECT p.marker, q.marker AS second_marker
FROM (TABLE probe_cte) AS p
CROSS JOIN (TABLE second_cte) AS q;
-- Returned: marker=17, second_marker=18
```

A reversible project-draft experiment changed one CTE join site in `lib/brain-runner.js` to `CROSS JOIN (TABLE control) AS control CROSS JOIN (TABLE autonomy) AS autonomy`. The next dry run ceased flagging those two names, but newly displayed `control` in `mahoraga-actions.js` and `current_policy` in `owner-passkey-authorization.js`, still listing ten warnings total. This is evidence of a likely display cap; it does **not** establish the total number of false-positive warnings. The original source was restored, and no deployment occurred.

A project function-log search for `does not exist` within seven days returned no matches. This is not a blanket runtime-health guarantee; HTTP 503s on unrelated routes were independently observed.

## Why not rewrite the queries

These affected SQL statements handle lease fencing, owner stop/autonomy controls, admission receipts, passkey verification, and authority checks. Changing them merely to dodge a faulty static analyzer adds unnecessary regression risk. **Do not** create tables named `control`, `autonomy`, `profile`, `gate`, `passkey`, `existing`, `moved`, `receipt`, or `policy` to silence warnings, and do not suppress genuine missing-table diagnostics.

## Upstream fix and verification contract

1. Teach the Hatchable validator to resolve CTE-scoped relations, including `MATERIALIZED`, nested/dependent CTEs, data-modifying `RETURNING` CTEs, and `FROM`/`JOIN`/`CROSS JOIN` references.
2. Keep warnings for genuinely unknown physical tables. Include a regression fixture where one missing relation still warns.
3. Report the true total number of warnings and a `truncated` indicator if only the first ten are shown.
4. Repeat `dry_run_deploy` against the **unchanged** source after upstream remediation; require zero CTE false positives and zero deploy errors.
5. Independently recheck runtime logs and affected owner-only APIs. Keep unrelated scheduler or provider errors out of the CTE disposition.

**Ownership boundary:** The actual validator implementation is controlled by Hatchable and cannot be repaired through code inside `Ultron.MW`. This note records source-of-truth evidence and the acceptance criteria; it is not a claim that the platform warnings have been cleared.
