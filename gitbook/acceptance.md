---
description: "Evidence standards, protected release gates, current scoped acceptance, and historical receipts."
---
# Release acceptance and evidence

## Current scoped acceptance — October 30, 2026

The [current issue-disposition summary](https://github.com/michaeljwilliams0123/Ultron.MW/blob/main/docs/ACCEPTANCE-STATUS.md)
links the authoritative live contracts. [#65](https://github.com/michaeljwilliams0123/Ultron.MW/issues/65)
completed its scoped four-step owner-run local-fixture acceptance. #66/#67 are
closed within their documented runtime/PAT scopes, #68 is not planned, and
#69's no-safe-deletion audit is complete. Historical paragraphs below preserve
what was observed at their dates; they do not add current closure requirements.

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

## Historical baseline limits

Authenticated interactive browser/mobile acceptance of the Pages console was not independently completed at that historical baseline. Issue #65 later completed its narrower supervised local-fixture contract; that does not retroactively prove historical Pages interaction or broader browser authority. Any future claim of learning improvement still requires independent evaluation; code, simulated cognitive receipts or green CI cannot substitute for that measurement.

Candidate evaluation reports Accepted, Rejected, Blocked or Inconclusive. Accepted is only a selection result: protected GitHub publication and live post-release proof remain separate. Reef-assisted work is Blocked when plugin guidance exists without the actual Reef runtime and interaction record.

Permanent evidence: [release gate](https://github.com/michaeljwilliams0123/Ultron.MW/blob/main/docs/verification/RELEASE-GATE-LIVE-2026-10-20.md) and [Issue #32 adoption](https://github.com/michaeljwilliams0123/Ultron.MW/blob/main/docs/verification/ISSUE32-ADOPTION-RECOVERY-2026-10-20.md).

## October 28 live acceptance recheck

The current-source [live acceptance Action](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/40806324720), added in [PR #146](https://github.com/michaeljwilliams0123/Ultron.MW/pull/146), observed nine successful public readbacks against the same GitHub main SHA. Its `observed-healthy` label covers public GitHub/Pages/Hatchable surfaces only; `productionReadiness` remains `not-accepted`.

A separately authenticated GitHub CLI account and Playwright 1.62.1 on an owner-authorized Windows host completed live Chrome 154 public-page navigation, including a real Learning-tab click, exact Pages SHA readback and production Hatchable link observation. Those public observations did not establish the owner-approved transfer and independent persisted readback that [Issue #65](https://github.com/michaeljwilliams0123/Ultron.MW/issues/65) later completed under its narrower controlled-app scope. Private-account MFA remains separate. See the [sanitized historical evidence record](https://github.com/michaeljwilliams0123/Ultron.MW/blob/main/docs/verification/OWNER-HOST-CLOUD-PARITY-2026-10-28.md).

A separate [held-out evaluation run #40807976542](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/40807976542) scored the frozen baseline and candidate identically at 1.0 across 10 cases. The Action correctly failed the improvement gate; this is **not** evidence of new learning.

The private Ultron Technical Handbook's eight authenticated page Git-object IDs independently matched all eight GitHub `main` source blob IDs. The handbook remains a documentation consumer, not a release or code authorizer. These are prior-to-this-document-update observations; after merging this change, independently check GitBook's new page blob and Git Sync operation before calling the webhook healthy.
