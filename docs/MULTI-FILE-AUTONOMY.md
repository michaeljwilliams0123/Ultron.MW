# Ultron general-purpose multi-file source generation

Use an owner-authored PR comment:

    @ultron implement files docs/a.md, src/b.mjs: improve the shared behavior in both files

This route runs a pinned, free CPU model once per existing source file (with a bounded corrective retry if needed), preflights every proposed edit, commits **all** changes in one exact-head GitHub transaction, and dispatches the full Verify suite. If exact-head Verify independently fails, the existing PR brain attempts one atomic inverse commit and verifies the restored head. Pending verification is never reported as passed.

For now the route supports **2–4 explicitly named existing files** with a combined source context budget of 18 KB. A missing, ambiguous, or unsafe source path aborts before any mutation. New code modules and API/MCP connector files are created through existing separate generator commands. This is broadening code generation, not unrestricted authority, unattended root shell, arbitrary third-party credential creation, or proof that a small model reliably solves all development objectives.

CI on a PR branch must independently confirm functional correctness. No inference response alone counts as execution evidence.

## Semantic acceptance

When the owner states an explicit single-word request such as 'from pending to verified', Ultron checks that the old marker decreases and the new marker increases **in every edited file** before committing. If a model misses the instruction, an unambiguous Markdown source line can be repaired deterministically from the owner's exact substitution; the receipt explicitly discloses the corrected paths. Generated JavaScript is never silently rewritten this way. Other objectives are marked semantically unscored and require acceptance tests beyond syntax and CI.

## Corrective model prompting

For an explicit `from OLD to NEW` request, select the unique source line that contains OLD, prompt with the exact requested edit, and retry the model once with targeted correction when the first valid-looking patch misses the objective. An anchored `AFTER:` response is parsed without relaxing source/path guards. The existing deterministic Markdown-only substitution remains an explicitly disclosed last resort. All commits still require exact-context preflight, atomic GitHub writes, independent full Verify, and inverse rollback where appropriate.
