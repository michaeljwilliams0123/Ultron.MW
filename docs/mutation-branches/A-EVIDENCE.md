# A — Evidence integrity / adversarial measurement

**Hypothesis:** A mutation is an advancement only when identical primitive string case IDs and traceable, nonblank observation references support the comparison.

## Executed contract in PR #202

- Reject `id: ['owner.workbench']`, boxed string IDs, objects with `toString()` and numeric IDs. JavaScript regular expressions coerce these to strings, while a Map compares object identity; permitting this can fabricate a regression or conceal case equivalence.
- A passing baseline with a missing/blank evidence ID is not proof of regression when the candidate case disappears.
- A candidate claiming `passed:false` with no evidence ID is not a proven regression; classify the uncertainty as `INCONCLUSIVE`.
- A candidate claiming `passed:true` with no evidence ID does not prove preservation.
- A recovered case must have measured failure on the baseline and measured success on the candidate.
- Verified regression takes precedence over a separate inconclusive case; preserving both labels avoids hiding real faults.

## Falsification and acceptance

The RED run for these cases is `41245704456` (five confirmed failing tests). The GREEN implementation is the strict primitive-ID and symmetric evidence-precedence patch on PR #202. Confirm the latest exact-head `test` status and the complete native test logs, not the earlier baseline.

**Boundary:** A well-formed evidence ID can still be fabricated. PR #200 / issue #201 must independently authenticate evaluator identity, source, lineage, sandbox and held-out cases before release.
