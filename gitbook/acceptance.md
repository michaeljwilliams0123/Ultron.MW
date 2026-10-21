---
description: "Evidence standards, protected release gates, and outstanding Issue #32 acceptance."
---
# Release acceptance and evidence

## Acceptance hierarchy

1. **Source exists:** code in a branch is not execution proof.
2. **Exact-head Verify passed:** valid for that tested SHA, not a later branch head.
3. **Protected merge completed:** the expected head was squash-merged to GitHub `main` with the required checks.
4. **Pages deployment passed:** published workflow success at the merged SHA, not proof of browser interaction.
5. **End-user operation observed:** a real owner-authenticated UI action produced its intended persisted GitHub result.
6. **Improvement observed:** the same task performs measurably better after a receipt-linked candidate passes held-out comparison, protected publication and post-release repetition.

## Verified historical reference

The October 20 acceptance series established single- and multi-file source changes, stale-head rejection, automatic rollback after independent failing Verify, protected required-check failure blocking, and a separate restored-head passing Verify. See [Issue #32](https://github.com/michaeljwilliams0123/Ultron.MW/issues/32) for linked runs.

The production baseline after the recovery and heartbeat consolidation was `182cf7c6ab1ddf5f95be5626eb7786949593fc2c`, with passing [GitHub main Verify](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/39504364240) and [Pages deployment](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/39504363779). These are dated observations, **not automatically current status**. Always reread GitHub `main`.

## Still outstanding

Authenticated interactive browser/mobile acceptance of the Pages console was not independently completed at that historical baseline. Measured learning improvements also require independent evaluation; code, simulated cognitive receipts or green CI cannot substitute for that measurement.

Candidate evaluation reports Accepted, Rejected, Blocked or Inconclusive. Accepted is only a selection result: protected GitHub publication and live post-release proof remain separate. Reef-assisted work is Blocked when plugin guidance exists without the actual Reef runtime and interaction record.

Permanent evidence: [release gate](https://github.com/michaeljwilliams0123/Ultron.MW/blob/main/docs/verification/RELEASE-GATE-LIVE-2026-10-20.md) and [Issue #32 adoption](https://github.com/michaeljwilliams0123/Ultron.MW/blob/main/docs/verification/ISSUE32-ADOPTION-RECOVERY-2026-10-20.md).
