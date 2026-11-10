# Canonical repository transfer — signed canary scope (PR #374)

> Historical transfer-era record. Superseded for current configuration on 2026-11-10: the canonical repository is `michaeljwilliams0123/Ultron.MW` (ID `1424939667`), owned by `michaeljwilliams0123` (ID `308995719`). Organization paths below describe historical observations, not current authorization. See [current identity contract](CANONICAL-GITHUB-IDENTITY.md).

The single repository formerly at \`michaeljwilliams0123/Ultron.MW\` now belongs to the \`Ultron-MW\` organization, canonical full name \`Ultron-MW/Ultron.MW\`. Its immutable GitHub repository ID remains \`1424939667\`.

This change updates the shared \`ULTRON_REPOSITORY\` identifier. Task 1 identity factory, Task 2 signed authorization and nonce scope, Task 4 durable executor, the GitHub operation policy and Task 1–5 conductor now agree on the **new full name and the same repository ID**. The conductor imports the canonical policy rather than defining a separate string. All matching Task 1–5 test fixtures are updated. The original signer is still the owner account \`michaeljwilliams0123\`; this changes the repository target, not who is authorized to sign.

**Security behavior:** The previously signed \`ultron:github:michaeljwilliams0123/Ultron.MW:\` resources and owner-grant payloads do NOT silently become grants for the new repository. Grants for the current canonical repository must be freshly signed. The original 0037 nonce table and owner approval checks remain active.

**Production database:** Forward-only migration 0040_ultron_org_transfer.sql replaces both old repository CHECK constraints with dual historical/current acceptance while preserving immutable original rows and receipts. New writes are restricted to Ultron-MW/Ultron.MW by canonical application authorization checks. Unlike the earlier strict-only draft, migration must NOT reject historical rows or rewrite receipt identity.

**Release hold:** This is a security scope/governance change. Do not deploy migration 0040 or activate a write canary without owner review and approval. After source review and passing exact-head CI, apply the checked-in migration via Hatchable's **existing** tracked migration deployment, read back columns/constraints and existing trigger, then execute the signed Task 1–5 canary only with a valid Coordinator installation or a separately owner-authorized backend principal. Verify remote commit lineage, durable completion, replay safety and stop/revoke behavior. Do not treat a personal GitHub connector write as a successful Coordinator App token proof.

**Separate blockers:** Coordinator App JWT is verified live by PR #373's diagnostic, but organization installation is not yet visible. Workflow run #42815900260 returned \`appJWTVerified:true\`, \`repositoryInstallationVisible:false\` — no scoped installation token minted. This PR does not install the App, grant new permissions, or claim seven independently authenticated Council roles.
