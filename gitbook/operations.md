---
description: "Owner workflow, exact-head admission and bounded source rollback."
---
# Owner commands and recovery

## Read-only cloud tasks

Use the [Pages console](https://michaeljwilliams0123.github.io/Ultron.MW/) for `/help`, `/system status`, `/repo inspect`, and `/learning status`. Hosted tasks require an authenticated GitHub submission and leave durable GitHub receipts. A static UI click is not proof of execution.

## PR conversation workflow

On an open Ultron pull request, the owner can comment `@ultron status`, `@ultron verify`, `@ultron rescan`, `@ultron implement <objective>`, `@ultron implement files <explicit paths>: <objective>`, or `@ultron patch` followed by a validated JSON manifest.

The patch route requires an exact current branch head, permitted source paths, fixed before/after text and a safe PR branch. No route writes directly to protected `main` or bypasses the required `test` check. CPU-generated patches are proposals until observed Verify completes.

## Shared one-step rollback

Model-generated and owner-authored source changes use the same bounded recovery condition: only an independently observed `completed/failure` for the **exact candidate SHA** can initiate an inverse patch. Ultron writes one ordinary non-force commit on the PR branch and verifies the restored SHA independently.

Pending, action-required, skipped, canceled, or wrong-SHA outcomes are not treated as proven source failures. Successful restoration is not production acceptance.

**Live evidence:** [PR #56](https://github.com/michaeljwilliams0123/Ultron.MW/pull/56) and its [same-thread bot receipt](https://github.com/michaeljwilliams0123/Ultron.MW/pull/56#issuecomment-6302673670) show a failing owner patch and passing restored head.

## Throughput

The standard multi-file proposal supports up to four explicit files. An optional repository variable `ULTRON_CAPACITY=expanded` allows up to six explicit files without weakening safety admission or CI. This is capacity configuration, not a guarantee that the model can solve arbitrary six-file objectives.

Full operator contract: [PR conversation brain](https://github.com/michaeljwilliams0123/Ultron.MW/blob/main/docs/PR-CONVERSATION-BRAIN.md).
