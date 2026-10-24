# PR Brain: foreign review comment recovery (October 24, 2026)

## Reproduction from the actual hosted failure

GitHub Actions run [40071975762](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/40071975762), job `converse`, failed in `Route PR comment through Ultron brain`. Source validation and optional model detection both passed. The original owner-authored comment was `@coderabbitai full review` on recovery PR #99, whose branch began `framework/` rather than the explicitly managed `ultron/` prefix.

`src/pr-brain.mjs` correctly refuses to grant mutation authority to non-`ultron/` branches, but it surfaced the expected refusal as a **failed GitHub Actions job** instead of a benign unrelated-agent command. It also spent a GitHub Actions job on a message intended solely for CodeRabbit.

## Recover the intent, not the permissions

- Preserve `admitPrTurn`'s owner, event, repository, comment ID and PR-only requirements.
- Drop CodeRabbit-directed comments at the GitHub Actions `jobs.converse.if` gate, *before* allocating a runner. The runtime also recognizes a foreign leading `@mention` and returns an explicit `ignored-foreign-mention` no-op without even requesting GitHub PR metadata.
- Treat **open but unmanaged branch** comments as `ignored-unmanaged`, with no writes, execution, generated model text or success assertion; keep strict validation for managed `ultron/` PRs, source SHA and admitted manifest.
- Preserve actual owner `@ultron` commands and followups that do not begin with an unrelated tag. Keep closed PRs ignored; do not route review instructions to the model.
- Map ignored variants to skipped telemetry, never fabricated provider success.

## Mahoraga and Ultron source lessons

Mahoraga [PR #1104](https://github.com/michaeljwilliams0123/mahoraga/pull/1104) established that natural-language action routing must not fall through and invent external execution. Mahoraga [PR #806](https://github.com/michaeljwilliams0123/mahoraga/pull/806) established that late or rejected routing must not be misclassified as failed cognition. Ultron [PR #99](https://github.com/michaeljwilliams0123/Ultron.MW/pull/99) and [#100](https://github.com/michaeljwilliams0123/Ultron.MW/pull/100) restored durable recovery and independently checked learning contracts. This repair is **about routing truth**, not expanding capabilities.

## Acceptance and real canary

1. RED: two new tests fail against the prior source for unrelated-bot and unmanaged-branch inputs; GREEN: all focused tests pass after the selective no-op and workflow gate.
2. Run `node scripts/verify.mjs` and required exact-head hosted Verify.
3. After protected squash merge, post `@coderabbitai review` on an owner PR; the Ultron PR brain job should be skipped at admission rather than fail.
4. On an admitted `ultron/framework-*` PR with an explicit `@ultron status` owner comment, independently verify an actual GitHub Actions bot reply and source-bound receipt; this is separate from fixture tests.
5. Do not bypass GitHub review protections, grant new credentials, enable paid inference or replace GitHub Pages/Hatchable.

Reviewers should check the skip rule is not overbroad: a CodeRabbit command should not run Ultron, but a genuine explicit `@ultron` command and its short, authenticated followup must remain routable.
