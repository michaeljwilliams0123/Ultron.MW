# Ultron mutation advancement contract (v1)

## Owner directive

Functional, tested customization is an **asset**, not automatic technical debt.
Do not delete a working feature merely to reduce code size, abstract away a
distinct capability, or make the implementation resemble another system.

**Preserve -> extend -> verify -> retain.** A mutation is an advancement when
new working behavior is added without breaking the measured baseline.

## Checked-in rules

The native Node test suite includes `test/mutation-evolution.test.mjs`, which:
- Keeps the owner workbench, outer-loop session, capability broker, API/MCP
  integration builder, and their existing tests importable and usable.
- Treats unchanged passing cases as `PRESERVED`, not a reason for deletion.
- Treats a new passing case with no baseline regression as `ADVANCEMENT`.
- Treats restored formerly failing capabilities as `recovered` advancements.
- Tracks newly failing and still-failing candidate cases in `failed` and
  reports `INCONCLUSIVE` rather than claiming the system is healthy.
- Rejects empty or unmeasured case sets as proof of preservation.
- Treats missing or failing formerly passing cases as `REGRESSION`, even
  when other new features work.
- Treats missing evidence pointers as `INCONCLUSIVE`, never as proof.
- Records `releaseEligible: false`: classification does not approve merging,
  independent review, credentials, payments, or production changes.

The classifier `src/mutation-evolution.mjs` accepts externally measured
`baseline` and `candidate` arrays of `{id, passed, evidenceId}`. The
`evidenceId` is a traceable pointer only, **not verified evidence by itself**.
Callers must independently validate test identity, source SHA, environment,
receipt integrity, independence, and expiry before using any external result.

## Evolution boundaries

- An intentional replacement is not automatically permitted to silently
  remove an old capability. Map every existing passing case to an equivalent
  or superior demonstrated behavior, then retire it with owner-visible scope
  and regression coverage.
- New capability implementations can be multi-file and specialized where
  useful; code size is not the optimization target.
- Keep the trusted evaluator isolation issue #201 separate from a scorecard
  that only labels functional progress.
- Keep the unified-principal operation authorization in PR #199 independent
  of an attractive functional score.
- No paid spending or production credential changes are implied by this policy.

The CI `Ultron core verification` runs these tests automatically via
`node scripts/verify.mjs`. Nothing in this document bypasses protected branch
rules, independent review, or live acceptance.
