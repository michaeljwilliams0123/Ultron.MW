# Ultron generated API connector: mission-canary

Autonomously generated on a PR branch. This does not deploy a persistent server.
No local PC, paid inference provider, external secret, arbitrary shell, or workflow grant is required.
Operations: read-only status and CI from the fixed Ultron public GitHub repository.

## Credential boundary

Hosting requires ULTRON_<NAME>_SIGNING_KEY stored as a protected environment secret. Use issueCapabilityToken() from src/capability-credentials.mjs inside your approved runtime; do not print, commit or embed key material in the Pages UI.
The GitHub Actions GITHUB_TOKEN is ephemeral and must stay within the workflow.
Third-party provider tokens, OAuth consent and account secrets are not automatically issued by this generator.

## Regression acceptance

Generated api module and its generated test must pass node scripts/verify.mjs.
The original PR branch must pass the exact-head Verify workflow before merge.
A successful CI result is not proof of deployed endpoint availability.

Source generated from deterministic, allowlisted templates and reviewed GitHub authority.
