# Council release verification reference

This is a read-only procedure, not an approval or deployment trigger.

## Exact-commit review

1. Identify the open PR, its exact head commit, and the current base commit.
2. Check `test`, `fixed-comparison`, and `attested-receipt` against that head. A pending, failed, or older check is not evidence of success.
3. Read the `ultron/council-7of7` check from the dedicated `ultron-council-gate` GitHub App. The result must match the same PR and exact head.
4. Examine the seven role-verdict artifact and its signature verification. Seven logical roles signed by one controller are not seven independent human reviewers.
5. Confirm actual model results and open findings. Do not turn an unresolved finding into agreement.
6. For any production claim, also require the deployed source, artifact digest, durable receipt, and independent readback.

## Acceptance test

This document changes no runtime behavior. The test is falsifiable: a wrong-head check, missing evidence, or a failed check must remain a HOLD; a complete clean PR can be accepted only when the trusted gate says so.

Track outstanding work in [Council acceptance issue #455](https://github.com/michaeljwilliams0123/Ultron.MW/issues/455).
