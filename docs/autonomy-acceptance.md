# Ultron autonomous acceptance canary

This file is a controlled non-production target for GitHub-hosted PR conversation testing.

Acceptance label: MODEL_PROPOSED

Tests to perform using actual owner-authored PR comments:
- @ultron regress: full Verify, exact-head dispatch and result receipt
- @ultron build api acceptance: generated source, tests and CI receipt
- @ultron build mcp acceptance: generated source, tests and CI receipt
- @ultron credentials: metadata-only self-owned token capability without secrets
- @ultron implement docs/autonomy-acceptance.md: update one exact line using local CPU inference, with rollback if failure
- @ultron patch: follow-up comment corrects an exact-context source line on this branch

Evidence must link to GitHub commit SHAs, actual workflow runs and independently read-back comments. A generated source module is not proof of a hosted endpoint. External provider account credentials cannot be self-issued.
