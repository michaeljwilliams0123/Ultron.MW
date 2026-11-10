# Distinguishing an installed App from an inaccessible repository

The Coordinator GitHub App is App ID 5633654. Its signing secret is currently stored under \`ULTRON_BUILDER_PRIVATE_KEY\` and its App client ID under \`ULTRON_BUILDER_CLIENT_ID\`. No key is copied or printed.

The read-only Council workflow now checks \`GET /app\` using an in-memory RS256 App JWT first. It separately checks \`GET /repos/Ultron-MW/Ultron.MW/installation\`, then runs the pinned official GitHub App token action and the existing scoped repository-ID proof. On failure before the token exchange, \`artifacts/council-app-installation-diagnostic.json\` is still uploaded using \`if: always()\`.

- \`coordinator-app-jwt-rejected\`: actual GitHub App JWT authentication failed. Verify App credentials and revocation through GitHub; no other assumptions.
- \`coordinator-app-identity-mismatch\`: the key resolved to an unexpected App.
- \`coordinator-organization-installation-not-visible\`: the key successfully authenticated Coordinator, but Coordinator cannot see an installation for the organization's repository. This can mean missing installation or insufficient repository selection.
- \`installation-observed\`: the Coordinator App and repo installation were both visible to GitHub. **Not yet one authenticated scoped principal**; the existing metadata-only token/repository proof must still succeed.

No GitHub writes, approvals, installation permissions, tokens, or keys are persisted by this diagnostic. A separate organization installation is not required for ordinary writes from authorized user connections; it *is* required to attribute writes to Coordinator's installation principal.

Note: the signed Tasks 1–5 canary path and migration 0039 still reference the old repository name; they need a separate reviewed canonical-repository migration before any live write canary.
