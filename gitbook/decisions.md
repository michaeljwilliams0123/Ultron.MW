---
description: "Growth decisions that prevent script and governance sprawl."
---
# Growth decisions and lessons

## Why this project stays small

Mahoraga demonstrated that multiplying scripts, roles, branch policies and providers faster than they can be reconciled undermines confidence in what is actually deployed. Ultron therefore favors deepening existing script responsibilities and removing proven duplicates over opening new authority planes.

## Retain

* One protected GitHub `main` and required exact-head `test`.
* Owner identity, bounded source mutation, safe preflight and restored-head verification.
* One self-scan findings publisher that suppresses non-material PR churn.
* Separate confidence levels for source capability, CI, deployment and actual user execution.
* Zero-required-paid inference by default; third-party credentials require explicit authorized setup.

## Avoid

* Blindly merging legacy feature branches whose checks no longer match current main.
* Advisory-pass CI that returns success on failure, timeout or `action_required`.
* Duplicating PR brains, self-scan writers, provider identity systems or GitBook/GitLab deployment workflows.
* Treating a source heartbeat, static language-model output or documentation page as a production action.

## Decision record

PR [#54](https://github.com/michaeljwilliams0123/Ultron.MW/pull/54) consolidated scripts and pruned historical branches; PR [#55](https://github.com/michaeljwilliams0123/Ultron.MW/pull/55) unified rollback and selectively adopted throughput and bounded standby evidence. The three historical divergent feature branches were intentionally preserved for comparison, not promoted wholesale.

Source record: [script consolidation](https://github.com/michaeljwilliams0123/Ultron.MW/blob/main/docs/verification/ISSUE32-SCRIPT-CONSOLIDATION-2026-10-20.md).
