# Ultron live release-gate rehearsal — October 20, 2026

## Authority and scope
- Repository: [Ultron.MW](https://github.com/michaeljwilliams0123/Ultron.MW).
- Starting main: `05cadfd5d63205f52611e3e1d4c13dee16eb5487`.
- Exercise PR: [#50](https://github.com/michaeljwilliams0123/Ultron.MW/pull/50).
- Isolation: `ultron/framework-release-gate-acceptance`. This exercise does not write directly to main, use paid model inference, or create provider credentials.

## Live-positive model-assisted source change
1. Owner authored [PR comment 6300195403](https://github.com/michaeljwilliams0123/Ultron.MW/pull/50#issuecomment-6300195403) specifying two existing docs files and explicit word replacement.
2. [PR conversation workflow 39488103858](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/39488103858) succeeded.
3. Pinned public CPU model proposed an accepted single commit `ebffdc3ff6bd53c28867c1c3e5492abdf86bfb4b`, changing **both** `Alpha model status: pending` and `Beta model status: pending` to `verified`. No deterministic correction applied.
4. [Authenticated exact-head Verify 39488169107](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/39488169107) completed successfully at that model commit.
5. [Bot reply 6300214124](https://github.com/michaeljwilliams0123/Ultron.MW/pull/50#issuecomment-6300214124) provides the independent model, paths, semantic-assurance, CI and SHA receipt.

## Rejected source mutation
- The owner posted [comment 6300251782](https://github.com/michaeljwilliams0123/Ultron.MW/pull/50#issuecomment-6300251782) with a deliberately mismatched `baseSha`.
- [PR-brain run 39488500262](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/39488500262) failed as intended: `PR patch requires exact head, objective and 1-6 source edits`.
- Readback after the rejection still showed the accepted model commit `ebffdc3ff6bd53c28867c1c3e5492abdf86bfb4b`; no unauthorized source mutation was published.

## Fresh source self-scan
- [Self-scan run 39488314252](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/39488314252) succeeded, independently observing `main` at `05cadfd5d63205f52611e3e1d4c13dee16eb5487`.
- Outcome was `unchanged` for signature `386065a0cac6f5ac1dd05ea8ad5e194f27cc733763d10fdd17ba7b41e74fe0f0`; no duplicate PR created.
- This proves a fresh scan **ran**, but the last committed report under `reports/self-scan/current.md` still describes its prior material finding observation. A fresh physical report at this exact main SHA is **not** proven.

## Authenticated cloud execution
- Owner created [Issue #51](https://github.com/michaeljwilliams0123/Ultron.MW/issues/51), using the native `ULTRON_CLOUD_V1` issue marker and `/repo inspect` objective.
- [Hosted run 39488916999](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/39488916999) completed successfully from exact starting main.
- Bot [structured receipt 6300313970](https://github.com/michaeljwilliams0123/Ultron.MW/issues/51#issuecomment-6300313970) attested independently inspected GitHub main, task digest, run ID, source SHA, and terminal succeeded status.
- This is GitHub-native end-to-end execution evidence, **not** a complete phone or browser interaction test of Pages.

## Readback of main protection
- Required GitHub Actions `test` context (app ID 15368): enabled.
- Required up-to-date branch: enabled after this acceptance tranche.
- Enforce admin protection: enabled after this acceptance tranche.
- Force push / deletion: disabled.
- Required linear history: enabled.
- Required approving reviews: 0, consistent with owner-only review policy.
- Full branch protection read from the owner's authorized GitHub connection; not inferred from YAML.

## Exact-main core and supply-chain acceptance
- [Main Verify 39472407888](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/39472407888) passed 223 tests, 0 failures and 0 reported dependency vulnerabilities.
- [GitHub Pages 39472406213](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/39472406213) completed successfully at the same starting main commit.

## Open acceptance gaps
- An intentionally failing `test` check demonstrably blocking a disposable PR has **not** been independently witnessed.
- A policy-allowed source commit failing Verify followed by automatic one-step rollback has **not** been independently witnessed in this tranche.
- The `pull_request` event triggered by bot-authored commit reported `action_required`, whereas exact-head `workflow_dispatch` Verify was green; PR mergeability was reported `blocked`. Determine whether an owner-authored follow-up commit with a normal `pull_request` test resolves the gate before merging.
- Browser/mobile UI operation, sustained heartbeat, live provider failover and measured learning gain remain unverified.

All checks and run URLs above refer to actual evidence. Do not close Issue #32 until remaining explicit negative and end-user acceptance gates are witnessed.
