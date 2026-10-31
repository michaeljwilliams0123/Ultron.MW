# B — Recovery-first evolution

**Hypothesis:** Restoring a formerly failing feature is meaningful advancement even when no new capability name is introduced.

## Executed contract in PR #202

- `false → true` with measured baseline and candidate is `ADVANCEMENT` and appears in `recovered`.
- `false → false` is explicitly `failed` and therefore `INCONCLUSIVE`, not a clean preserved health claim.
- A previously failed baseline case omitted from the candidate remains `unverified`, not recovered.
- `true → false` with verified observations is `REGRESSION` even if an unrelated feature is added.
- An actual verified regression wins over recovery and addition in the same candidate.
- The deterministic two-feature matrix already covers 36 combinations of baseline and candidate working / failed / absent status.

## Next evolutionary expansion

1. Record a three-version recovery lineage (baseline → repair → next mutation) without conflating snapshots.
2. Add behavior-specific receipts for rollback and unobserved external write reconciliation.
3. Keep each known fixed bug as a permanent regression test, not as a pretext to remove functionality.

**Boundary:** This module classifies supplied observations only; it does not independently execute GitHub writes, fix a broken cloud runtime or attest production resilience.
