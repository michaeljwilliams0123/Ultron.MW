# Ultron.MW administrator identity — observed access and activation boundaries

**Snapshot:** 2026-11-14. **Canonical owner/repository:** `michaeljwilliams0123` / `michaeljwilliams0123/Ultron.MW` (repository ID `1424939667`). **State:** admin execution is **NOT production accepted**. This document is not a permission change or owner approval.

## Real, independently observed identity access

| Principal | Verified evidence | Does not prove |
| --- | --- | --- |
| Primary owner `michaeljwilliams0123` | GitHub collaborator permissions readback: `admin` | No approval of any specific secret/ruleset mutation |
| Machine contributor `michaeljwilliams0123ultron` | GitHub collaborator permissions readback: `write` | Owner status, admin repo settings, passkey or personal account delegation |
| Coordinator App `ultron-coordinator` (App ID `5633654`, installation `179066535`) | Hatchable owner-only POST `/api/brain/github-app-proof`: authenticated installed App, canonical repo readback, Contents write observed and a **down-scoped Metadata read token** proved | Actions write, Administration write, Workflows write, permission-bounded Admin Executor, admin mutation, or trusted Council authority |
| Secondary Admin App | GitHub Actions has **names only** for `ULTRON_SECONDARY_ADMIN_APP_ID`, `ULTRON_SECONDARY_ADMIN_INSTALLATION_ID` variables and `ULTRON_SECONDARY_ADMIN_PRIVATE_KEY` secret | Valid installed App identity, effective permission scopes, isolated credential custody, owner step-up, executable deployment |
| Council Gate App | Required `COUNCIL_GATE_APP_ID`, `COUNCIL_GATE_APP_CLIENT_ID`, `COUNCIL_GATE_APP_SLUG` variables and `COUNCIL_GATE_APP_PRIVATE_KEY` secret not present at latest names-only inventory | Independent `ultron/council-7of7` check publisher; see issue #455 |

**Important:** A personal-account repository has one owner and collaborators, not a second independently assignable owner. The goal is **equivalent authorized operations**, never shared private credentials or spoofing the owner's human identity.

## The implemented read-only permission inventory

This change extends the existing **owner-only** authenticated installation proof, preserving its read-only result, exact repository and installation checks, and scoped token `{repository_ids:[1424939667],permissions:{metadata:'read'}}`. It adds a static allowlist of fields with levels `none`, `read`, or `write` for: Metadata, Contents, Administration, Actions, Issues, Pull requests, Checks, Workflows, Secrets, Variables, and Webhooks.

Untrusted or unknown provider permission values are normalized to `none`. No raw App response, App JWT, installation token, private key, session cookie, or unallowlisted field is surfaced. `administrationWritePermissionObserved` and `actionsWritePermissionObserved` are **observation flags**, not credentials or approvals. `adminOperationVerified` stays `false` even if those permissions exist. Existing unauthenticated access remains `401`.

Source/mirror: `src/identity/github-app-installation-proof.mjs` and `cloud/hatchable/lib/github-app-installation-proof.js` remain byte-for-byte identical; regression tests use injected mock installation permissions and cannot themselves assert the production App has admin rights.

## Operation-level administrative capabilities to activate

| Work class | Permission required | Trust/approval scope |
| --- | --- | --- |
| Plan/patch branches, issue & PR changes | Contents/Issues/Pull requests write | Allowlisted repo, task/branch/PR and exact-head policy |
| Trigger, rerun or cancel safe GitHub Actions | Actions write | Short-lived downscoped App token; approved workflow/run, precondition and durable receipt; no blanket cancellation |
| Enable/disable approved workflows | Actions write | Fresh one-use owner step-up, reversible plan and independent readback |
| Narrow reversible repo settings | Administration write | Fresh owner step-up for each exact-plan mutation; no implicit delete/transfer/visibility/ruleset powers |
| Edit workflow YAML | Workflows write or supported user-OAuth workflow scope | Protected PR and CI, not silent direct main edits |
| Read/publish checks | Checks read/write, as separately needed | Genuine publisher provenance; Council Gate identity must remain separate |
| Change secrets, variables, collaborators, branch rules or installation permissions | Separate GitHub rights (often Secrets/Variables/Administration) | **Not granted by this audit**; new explicit owner authorization, trusted source and rollback before any mutation |

GitHub's App installation scopes must be set on the App registration and approved by the primary repository owner. Their presence is insufficient: `src/admin-executor.mjs` still requires a trusted isolated credential service, per-operation short-lived token and verified owner authorization, atomic reservation, no-replay, pre/postcondition and rollback. The Admin App source is not an authenticated live service.

Do not broaden the **Council Gate App** to perform administration or give the Council itself the owner's signing authority. Maintain `$0` paid usage and separate the GitHub principal from the human owner.

## Remaining production acceptance

1. Read the newly added permission fields from the **live deployed**, owner-authenticated Coordinator proof. Explicitly classify each permission; never assume an unobserved scope.
2. Identify actual **Admin App** registration and effective installation, verify primary canonical repo scope and custodian without exposing private key. Prefer the one-principal operation-downscoping architecture from closed historical #169; keep privileged token access isolated.
3. If an App needs new scopes, modify *Permissions & events* and approve the pending installation update as owner. No API or source edit grants its own permissions.
4. Only after a trusted Admin credential service and WebAuthn step-up work, execute one independently approved **reversible** administration canary, verify exact GitHub after-state, deny wrong-actor/stale/replayed/revoked grants, and demonstrate rollback.
5. Independently address Council Gate identity in #455. Its check-publication identity cannot be replaced by the Admin/Coordinator App without a reviewed security decision.

**No repository owner transfer, account clone, ruleset enable/bypass, secret rotation or administrative write is part of this change.**
