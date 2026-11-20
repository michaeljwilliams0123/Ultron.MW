# Issue #499: Hatchable CTE production acceptance

Observed **2026-11-20, America/New_York**. The deployed application workaround passes the issue-specific checks below. **The upstream issue is not fixed and must remain open.** Overall application production acceptance also remains blocked by separate readiness evidence.

## Source and deployment

- Repository inspected: `25fc48c944ad4bcefd603acdedbe95ac677777f1`.
- Workaround: [PR #501](https://github.com/michaeljwilliams0123/Ultron.MW/pull/501), merge `868724fbc416dd9486f80503c9dfe1324d49698b`; review baseline `1cc758d65611aed49843e2c0dc7da09ade66cbc2`.
- Existing Hatchable project `proj_A6GCXRSKizko`, live **v136**, deployed November 19 at 10:14:47 AM ET.
- All **24** runtime files changed by PR #501 match SHA-256 hashes in the v136 deployment manifest, both at the workaround merge and at the inspected repository head.
- All **253** nonvirtual project files match the live manifest. No pending source drift was observed before validation.
- No deployment, production query mutation, migration, credential change, privilege change, or paid inference call was performed for this acceptance check.

Structured tool results, exact probe source, and per-file hashes are preserved in [the evidence JSON](issue499-hatchable-cte-evidence-2026-11-20.json). It is an observation record, not a signed deployment attestation.

## Acceptance results

| Check | Observed result | Disposition |
| --- | --- | --- |
| Clean production-equivalent draft | `ok:true`, `errors:[]`, `warnings:[]` | Workaround passes |
| Runtime source parity | 24/24 changed runtime files match live v136 and merged source | Pass |
| Admin readiness GET | HTTP 200; no missing readiness tables; spend ceiling USD 0 | Read-only route works |
| Anonymous/member readiness GET | HTTP 401 / 403 | Admin boundary preserved |
| Broader readiness | `readyForProduction:false`, `releaseApproved:false` | Separate production acceptance remains open |
| Seven-day relation-error search | `query:"does not exist"`: 0 results, `truncated:false` | No matching logged errors; not proof of all paths |
| 24-hour 5xx search | One GET `/api/brain/owner-passkeys` 503 at 5:52:10 PM ET, no error text | Unclassified; no evidence tying it to CTEs |
| Native materialized/dependent CTEs | Two false missing-table warnings | Upstream failure reproduced |
| Native recursive CTE with column list | One false missing-table warning | Additional upstream failure reproduced |
| Unknown physical relation | Correct missing-table warning | Negative control passes for tested case |
| Warning overflow | 12 distinct missing-table inputs return 10 entries, no total/truncation metadata | Upstream acceptance fails |
| Cleanup | Temporary probe removed; 253/253 paths and hashes restored; clean dry run again | Pass |

The readiness blockers returned were `independent-executor-unverified`, `web-egress-adapter-unverified`, `mahoraga-receipt-unverified`, and `live-release-review-unverified`. They are not CTE failures. The 503 likewise remains unclassified: its log entry has no diagnostic error text, so it cannot establish a missing relation or any other root cause.

## Vendor reproduction

An unused `lib/issue499-validator-probe-20261120.js` was temporarily added to the existing draft. Only `dry_run_deploy` scanned it; its function was never invoked or deployed. Existing files were not rewritten. The exact source and responses are in the evidence JSON.

This valid query produced warnings for both CTE names:

```sql
WITH issue499_materialized AS MATERIALIZED (SELECT 17 AS marker),
     issue499_dependent AS NOT MATERIALIZED (
       SELECT marker + 1 AS marker FROM issue499_materialized
     )
SELECT p.marker, q.marker AS next
FROM issue499_materialized p CROSS JOIN issue499_dependent q;
```

This valid query produced a warning for `issue499_recursive`:

```sql
WITH RECURSIVE issue499_recursive(n) AS (
  VALUES (1)
  UNION ALL
  SELECT n + 1 FROM issue499_recursive WHERE n < 3
)
SELECT n FROM issue499_recursive;
```

The same fixture also included plain, nested, quoted, and data-modifying CTE examples. Those tested forms produced no warnings; this does not establish general scope correctness. The entire fixture produced four warnings: three false positives plus the deliberately unknown physical table `issue499_missing_physical`.

A second version of that temporary file contained 12 literal `db.query('SELECT id FROM issue499_absent_NN')` calls for `NN=01..12`. Only `01..10` were returned. The response had exactly `ok`, `errors`, `warnings`, and `would_deploy` at the top level, with no warning total or truncation indicator. The later two diagnostics were not exposed; do not treat a ten-warning response as an exhaustive report.

All six positive SQL fixtures were independently executed with **PGlite 0.5.15** in a disposable local database and returned the expected rows, including the zero-row data-modifying fixture. The unknown physical relation was rejected with PostgreSQL SQLSTATE **42P01**. This validates the SQL examples, not Hatchable's implementation.

The probe was then deleted after readback confirmed it was still this session's file. The complete draft path/hash set matched the original set, and a final dry run returned zero errors and warnings. Production remained v136.

Hatchable follow-up feedback **#2676** was filed successfully with these minimal reproductions and a reference to original feedback **#2637**. The platform validator source is not in this application repository, and the connected Hatchable tools cannot patch it.

## Regression and review evidence

[PR #501 Verify run 44444593085](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/44444593085) was independently read back: `test`, `fixed-comparison`, and `attested-receipt` all succeeded. The `test` job's PostgreSQL-backed acceptance replay/conflict step also succeeded. These are historical checks on PR head `9838b54961b08dbc1fee7f7331a7c826989297f3`, not a new local concurrency test.

The existing `test/hatchable-cte-table-parity.test.mjs` covers paused and allowed data-modifying `UPDATE ... RETURNING` / `INSERT ... RETURNING` chains and dependent materialized CTE joins. A fresh local run passed all three cases. Its synthetic cases do not certify every production query or concurrent locking behavior.

Independent source review of the fixed PR #501 diff found **zero Standards findings** and **zero workaround defects**. Reversing the explicit `TABLE` wrappers reproduced all 24 original runtime files exactly, preserving aliases, authorization predicates, locks, fencing, receipts, and physical-table references. The Spec review retained two completion gaps: native validator correctness/diagnostics and independent acceptance of unchanged native SQL. Neither is satisfied by the application workaround.

## Remaining gate for closing #499

1. Hatchable corrects its own parser and supplies vendor-side regression results covering local scope, dependency order, materialization modifiers, recursive/column-list forms, nested scope and shadowing, data-modifying `RETURNING`, and nested `JOIN`/`CROSS JOIN` references. Never globally exclude a name just because it appears in some `WITH` clause.
2. Negative cases continue to warn: genuinely unknown physical relations, an unknown physical relation inside a CTE body, out-of-scope CTE names, and schema-qualified physical names that happen to match a CTE alias.
3. Warning overflow reports a true total and explicit truncation state (or returns the complete list). The 12-case probe must expose all 12 warnings or accurately report the omitted two.
4. Independently revalidate the original native SQL against the corrected scanner, preserve zero hard errors, and recheck owner-only routes and logs. Perform any temporary draft probes without deployment, with full restoration verification; do not replace the working production workaround just to test the vendor.
5. Record the upstream version/receipt and test evidence before closing #499. A clean dry run of the explicit `TABLE` workaround alone cannot close this upstream issue.

Do not create phantom tables, suppress genuine warnings, change live authority/lease SQL, or classify unrelated 5xx responses as CTE failures. Broader production acceptance must separately resolve the readiness evidence and investigate the unclassified 503.
