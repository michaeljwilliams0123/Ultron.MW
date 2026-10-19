# Ultron operational self-model — Mahoraga lessons, 2026-10-19

## Evidence and scope
Mahoraga remains a historical research source, **not a live runtime dependency**. Ultron's single existing cloud lane and local read-only command surface are the only execution paths. This design provides reproducible source-state introspection, not consciousness or generalized autonomous intelligence.

| Mahoraga evidence | Observed defect or reusable contract | Ultron response |
| --- | --- | --- |
| [cognitive-loop](https://github.com/michaeljwilliams0123/mahoraga/blob/main/src/cognitive-loop.mjs) | Perception → memory → deliberation → prediction → evidence-bound decision | One source-bound, inspectable self-model with observations, uncertainty, weaknesses, predictions, and next actions |
| [metacognition](https://github.com/michaeljwilliams0123/mahoraga/blob/main/src/metacognition.mjs) | Confidence must reflect evidence coverage and unknowns | Source coverage measured separately; runtime, providers, CI and learning remain **not probed** |
| [PR #680](https://github.com/michaeljwilliams0123/mahoraga/pull/680), [issue #679](https://github.com/michaeljwilliams0123/mahoraga/issues/679) | Source-green cannot establish deployed runtime health | Never infer a healthy runtime from file inventory, CI fixtures or local shell status |
| [Issue #314](https://github.com/michaeljwilliams0123/mahoraga/issues/314) | Missing source commit prevents drift diagnosis | GitHub cloud scan binds exact main SHA, tree SHA, each inspected blob SHA and post-scan main SHA |
| [Issue #536](https://github.com/michaeljwilliams0123/mahoraga/issues/536) | Ready capabilities without empirical live cognition remain unproven | A scan is source observation, not an executed live model interaction |
| [PR #1104](https://github.com/michaeljwilliams0123/mahoraga/pull/1104) | Natural execution instruction fell into generic cognition and invented an execution receipt | Deterministic `/self scan` and narrow phrase routing; structured tool receipt only |
| [PR #1061](https://github.com/michaeljwilliams0123/mahoraga/pull/1061) | Duplicate objective IDs corrupted cognitive dependency lookup | Duplicate file paths or ambiguous inventory reject scans, no silent overwrite |
| [PR #1094](https://github.com/michaeljwilliams0123/mahoraga/pull/1094) | Asynchronous reads invalidated earlier freshness snapshots | Read GitHub main before and **after** content inspection |
| [PR #838](https://github.com/michaeljwilliams0123/mahoraga/pull/838) | Predictions needed comparison against realized outcomes | Predictions are explicitly `unvalidated` until an independent outcome receipt proves or refutes them |
| [PR #1107](https://github.com/michaeljwilliams0123/mahoraga/pull/1107) | Admin execution errors mixed with brain health, obscuring root causes | Report source, provider, runtime, CI and learning as distinct evidence dimensions |

## Runtime contract

- **On demand:** `/self scan` via GitHub-hosted issue or local deterministic executor.
- **Scheduled:** the preexisting hourly GitHub Actions objective runs `/self scan` as a zero-model-call read-only job. Scheduled result goes into its Actions run summary; a scheduled run is not an always-on agent or durable state.
- **Cloud evidence:** independently fetch exact GitHub main, commit/tree metadata and seven bounded route files; bind each file blob SHA to tree; repeat main read after traversal. Fail if the data is missing, inconsistent or changes mid-scan.
- **Local evidence:** bounded symlink-resistant traversal of explicit repository folders, with a source-content digest; never claim the local checkout is current GitHub main.
- **Self-model:** file inventory, static route link observations, gaps/weaknesses, predictions, next actions, evidence completeness, and unresolved runtime/provider/readiness statuses. Immutable fingerprint identifies the specific report.
- **No mutation:** self-observation does not modify source files, open PRs, grant permissions, deploy, or promote itself. Its diagnostic recommendations may be separately routed into an owner-authorized code PR.

## Acceptance boundaries

A cloud scan succeeding proves **the specified source inventory was read and cross-checked**, not the readiness or quality of the intelligence. To establish live readiness, record an independent authenticated task and durable result tied to a commit; to establish model learning, measure held-out performance and later real outcomes. An unfulfilled prediction is not scored as a success. A failed scan or stale source lease must produce a failed task receipt, not optimistic status.

Future extension can add live execution attestation and confidence calibration to the same self-model schema without introducing a duplicate agent, service, UI, Cloudflare runtime or additional approval system.
