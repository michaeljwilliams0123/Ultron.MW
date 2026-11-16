# Council Gate post-CI race — primary-source investigation (2026-11-16)

## Evidence
- PR #464 exact head 51c65ff5: dedicated Council App HOLD at 21:22:47 UTC, GitHub core `test` success at 21:25:58 and `attested-receipt` success at 21:26:24 UTC. Source: [Council run 43959308670](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/43959308670) and [core verification run 43959312395](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/43959312395).
- PR #471 exact head cda2a9c0: Council HOLD 20:55:35 UTC, `attested-receipt` success 20:58:56 UTC. Source: [core run 43954592918](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/43954592918).
- PR #479 exact head 317029f8: Council HOLD 21:27:59 UTC, `attested-receipt` success 21:31:31 UTC. Source: [core run 43960235436](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/43960235436).
- Original trusted workflow fired on `pull_request_target`, `issue_comment` and owner `workflow_dispatch`, but not on `workflow_run: completed`. Its exact-head CI read could be incomplete and still publish a terminal FAILURE.
- An earlier owner-triggered post-CI reevaluation legitimately changed #475/#476 to 7/7 App acceptance *without code changes*. This proves reevaluation is possible; it does not prove model-backed reviews or signed exceptions are unnecessary.

## GitHub documentation
- [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows): `workflow_run: completed` triggers from the default-branch workflow; **downstream jobs can have elevated permissions**, so no PR branch checkout or execution is allowed.
- [Troubleshooting required status checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks): required checks must match the latest SHA; skipped entire workflows can stay pending. A GitHub App external check is independent of the event used for Actions job check evaluation.
- [Status checks](https://docs.github.com/en/pull-requests/reference/status-checks): incomplete and completed check states differ; a completed failure is not pending CI.
- [GitHub webhook events](https://docs.github.com/en/webhooks/webhook-events-and-payloads): validate `workflow_run` origin and payload; `workflow_run.name` is the configured run-name (PR title in this repo), **not** proof of the workflow identity.

## Design chosen
1. Preserve original PR/owner-comment/manual triggers and hard checks while **deferring any Gate App verdict** until the latest full set of `test`, `fixed-comparison`, `reef-runtime-probe`, `attested-receipt` is completed successfully by the expected Actions App on the exact PR head.
2. Add `workflow_run: completed` for **Ultron core verification**, pin the actual GitHub workflow ID `388875616`, the repository ID `1424939667`, successful PR run, unique same-repository PR, exact head and base SHA; retain trusted `main` checkout and App-signed check creation only.
3. If CI is missing, in progress, failed or unreadable, **publish no passing Gate App check** and skip model review; branch protection keeps the PR blocked by the separate required `test` and `ultron/council-7of7` checks. The normal completion event rechecks automatically, but no automatic security exception or model approval is fabricated.
4. The whole `workflow_run` event payload is data, never executable PR code or PR-supplied shell input. The dedicated Council Gate App and pinned main policies remain required.
5. No branch-protection bypass, unconditional success, signing-key change, private credential export, paid inference or Codex credit spending.

## Validation contract
Run the four new negative/positive event-and-CI regression tests and the preexisting trusted Council gates. Then run exact-head CI, verify a real GitHub App check fires **after** the completed core CI run on a *fresh* PR head, and confirm missing/failed evidence cannot create a green check. A source PR merge alone is not production acceptance.
