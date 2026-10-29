# Issue #66 — bounded completion-response-loss reconciliation

## Scope and evidence boundary

Source branch `fix/issue66-committed-completion-readback` updates the existing Hatchable `runOne` worker in `cloud/hatchable/lib/brain-runner.js`. It does **not** introduce another runtime, new secret, provider, subscription, external write, browser session or dependency on the owner's local machine. The only new operation on a database-driver completion exception is a **read-only** query to the existing production database.

## Exact behavior

The original worker performed a fenced, atomic SQL transition to `done` and an `observed` event. If the database committed that SQL but the client lost its response, the worker returned `completion-uncertain` despite the objective already being committed. An unverifiable completion is appropriately uncertain; an **independently verified, committed** completion need not remain ambiguous.

The updated receipt attaches `fencingGeneration` alongside the existing objective and source. If the first completion query raises an exception, one subsequent query demands **all** of these predicates simultaneously:

- The identical `brain_tasks.id` is in `done` state.
- Its `fencing_generation` matches the original worker claim.
- Its JSONB `last_result` equals the exact completed result.
- Its `brain_events` contains an `observed` receipt for that same task with the exact objective and fencing generation.

Only then may the worker return `status: done` with `readback: committed`. If any predicate fails, or the readback is unavailable, it returns `completion-uncertain`. The reconciliation does not mutate state, grant new authority or invoke the objective a second time.

## Regression coverage

`node --test test/hatchable-fencing-v1.test.mjs` covers:
1. Lost completion SQL response **after** commit: independently read back and accept only a matching result and receipt.
2. Lost response **before** commit: remain uncertain; do not replay.
3. Independent readback unavailable: remain uncertain.
4. Fenced generation stored in the completion receipt.
5. Existing paused-worker, heartbeat-fencing, stale-owner and attempt-limit cases.

The exact readback SQL is also exercised against **ephemeral PostgreSQL 16** in `test/hatchable-completion-readback-postgres.test.mjs`, added to the protected Verify workflow. It validates the committed row-and-receipt match and rejection of a stale fence, wrong result/objective, tampered receipt, unfinished task and missing receipt. This test uses an isolated CI schema, never the production database.

## Unfinished release acceptance

This source improvement and green CI **do not** demonstrate an actual production database outage, a true process crash, an external provider write with uncertain response, independent site readback, or owner-device-offline execution. They must be exercised under #66's existing production-safe acceptance contract with a single bounded task, zero unapproved spend, independent durable readbacks and no replay of existing `uncertain` Mahoraga actions. Do not mark #66 complete based on this PR alone.
