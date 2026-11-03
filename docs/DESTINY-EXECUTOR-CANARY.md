# Destiny Codex Cloud — separate execution lane and evidence canary

**Status: SOURCE-ONLY / OWNER REPORTS CODEX CLOUD ENVIRONMENT PUBLISHED AND CREDITS AVAILABLE / LIVE EXECUTION NOT YET VERIFIED.**
Tracking: [issue #185](https://github.com/michaeljwilliams0123/Ultron.MW/issues/185), [C01 #183](https://github.com/michaeljwilliams0123/Ultron.MW/issues/183), [acceptance #204](https://github.com/michaeljwilliams0123/Ultron.MW/issues/204).

## Which cloud integration?

**No separately registered GitHub App is required.** The desired resource is an **OpenAI Codex Cloud environment** in the intended ChatGPT account, with that account's existing authorized GitHub connection. Codex Cloud tasks, ChatGPT Work event-triggered tasks, and GitHub App installations are **three distinct products and identities**. Do not substitute one for another.

Official guidance:
- [Create and publish a Codex Cloud environment](https://learn.chatgpt.com/docs/environments/cloud-environments)
- [Using Codex Cloud](https://help.openai.com/en/articles/20001545-using-codex-cloud)
- [ChatGPT scheduled/event-triggered tasks](https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt)

### Account-side activation (requires the account owner in Codex Cloud)

1. Sign in to the **intended** ChatGPT account (not Mike's if independent account provenance is required).
2. Choose **Work in → Cloud → Select environment → Create environment**, or **Settings → Codex Cloud → Environments → Create environment**.
3. Select `michaeljwilliams0123/Ultron.MW` using that account's connected GitHub identity and authorized repo access.
4. Prepare, inspect and test the environment. Use Node 22 and the existing repo verification command:
   `node --test test/destiny-executor-attestation.test.mjs && node scripts/verify.mjs`.
5. Review setup and **Publish**. Record an independently observed environment ID *fingerprint* (SHA-256; not raw private identifier), owning workspace/account observation, actual GitHub actor, and setup/test evidence. Do **not** declare account authentication from a GitHub username or environment label.
6. Start a new **read-only** cloud task that checks `docs/core/codex-authors.mjs` from current `main` and reports `mike-codex` and `destiny-codex` registration state. No write, merge, credential access, or model-API paid fallback.
7. If hands-free trigger from GitHub PR events is needed, create a **separate Work event-triggered task** from the same account with the GitHub plugin connected, and validate its trigger/condition/prompt against the trusted current-main contract. Merely publishing a Codex Cloud environment does **not** auto-subscribe it to GitHub events. Keep any earlier Work route registry as historical until proven active.

**Important:** The GitHub connector available to this chat can edit the repository but cannot publish Codex Cloud environments, enable a different ChatGPT account, transfer GitHub OAuth authorization, or query another account's cloud task runs. Use the account-side environment setup UI for those steps; do not forge proof in the repository.

## Evidence model

```text
C01 immutable outbox (authoritative DB readback)
  ↓ immutable task/request/source/route/delivery digests
GitHub task PR (owner-authorized, pinned head)
  ↓ account-side Codex Cloud task OR separately enrolled Work GitHub event task
Actual read-only cloud execution
  ↓ independently controlled Ed25519 signer produces signed completion receipt
Authenticated GitHub write/event readback (observed actor)
  ↓ pinned environment fingerprint + receipt verification
C03 independently persisted completion and no-replay readback
```

`config/destiny-executor-trust.json` starts **unconfigured**: `githubActor`,
`environmentFingerprint`, `keyId` and `publicKeyPem` remain `null`.
Only a separately authorized setup may pin them after independent readback.
Do not mint a test signing key and register it as a real cloud executor.

The v2 `src/destiny-executor-attestation.mjs` verifier:
- checks a strict Ed25519 receipt with immutable intent/task/delivery/request/source/route identity;
- checks the observed GitHub commit/event actor against independently pinned trust (which may be a human owner; a separate GitHub username is **not** mandatory);
- checks the cloud environment fingerprint, key ID, read-only effect and zero-paid budget;
- rejects forged, stale, future-dated, mutated, unconfigured and conflicting receipts; and
- always returns `workAccountAuthenticated:false` and `productionAccepted:false`. Account provenance and actual external execution must be proven **independently**.

An ACK is *not* completion: `cloud/hatchable/lib/continuum-ack.js` verifies an authenticated delivery acknowledgement only. The C03 receiver must not self-register routes. A lost write response requires readback reconciliation and never blind re-execution. Replaying a delivery may be safe only after authoritative evidence of no prior external execution and a separately authorized new attempt. Do not paste credentials or ChatGPT sessions into issues, PRs or workflow logs.

## Safe canaries and release gates

### Canary 0: repository source

```sh
node --test test/destiny-executor-attestation.test.mjs
node scripts/verify.mjs
```

These are deterministic local/CI tests, **not real cloud connectivity**.

### Canary 1: actual Codex Cloud

From the independently authenticated account and published environment:

```text
Inspect trusted current main docs/core/codex-authors.mjs. Report the two callable author IDs and which lanes are enrolled or unverified. Read-only, no merge, no credential access and no paid API fallback.
```

Capture the actual Codex Cloud task link/ID, account-side execution record, selected repo/environment, observed head SHA, test output and repo readback. A GitHub issue/comment alone is not a completed cloud task.

### Canary 2: Work GitHub event and C03 bridge (only if that lane is enabled)

- Use a **new owner-authored** issue and task PR pinned to current main; verify the Work trigger and task's immutable routing fingerprint **independently**.
- Confirm `accepted → published → acknowledged → running → result-recorded → verified` through real provider/account observations and DB receipts.
- Validate no duplicate run on a repeated notification, plus wrong actor, forged signature, wrong environment, wrong delivery/route SHA, stale source, key rotation, expired timestamp, lost ACK, incomplete write, and zero-credit cases.
- Separate **CI green**, **Codex Cloud task success**, **Work event delivery**, **bridge ACK**, and **production acceptance**. They are not interchangeable.
- Never grant admin, protected-main bypass, PR self-approval or external paid usage just to make the canary pass.

### Completion register

| Requirement | Current evidence | State |
| --- | --- | --- |
| Source verifier + synthetic negative tests | PR #216 branch & exact-head CI | Check CI after edits |
| Account-owned cloud environment published | Owner reports environment published and credits restored; no independently verified environment ID | **Reported, not attested** |
| Real account/GitHub repo binding | GitHub connector alone cannot attest Work/Codex account | **Blocked** |
| External signer independently bound | No pinned authorized key | **Blocked** |
| One live read-only cloud task | One task now feasible in published environment; no task URL/execution receipt yet | **Pending external task** |
| C01/C03 persisted end-to-end result and replay | Missing live receiver and completion proof | **Blocked** |
| Production release | No positive live acceptance; `productionAccepted=false` | **Not accepted** |

## Published environment: one live read-only canary (owner update 2026-11-02)

The owner reports **the Codex Cloud environment has been published and
Codex credits are available again**. This removes two *owner-reported
setup blockers*, not the independent task execution or C03 receipt gates.

For this **Codex Cloud** canary (not a Work/GitHub webhook test), open
Codex in the **intended ChatGPT account**, choose the **published**
environment for `michaeljwilliams0123/Ultron.MW`, and submit **one**
read-only task:

```text
Run one read-only Codex Cloud identity/connectivity canary against
michaeljwilliams0123/Ultron.MW. Inspect trusted current main and
docs/core/codex-authors.mjs; report the observed main commit SHA,
the two registered author IDs and their actual configured binding/live
execution fields. Confirm repository access and list what you actually
observed. Make NO edits or commits, PRs, deployments, new tasks,
credential reads, paid API fallbacks, route registration, or merges.
Clearly distinguish this cloud run from any GitHub-triggered Work lane.
Return a task link and inspectable execution/test evidence; do not claim
account authentication, signed C03 completion, replay safety or
production acceptance from this read-only inspection.
```

Capture the actual **Codex Cloud task URL** and independently read back
the current GitHub main SHA after execution. If no task URL or account-side
record can be inspected, mark `cloud-execution-unverified`; do not
manufacture a receipt or rerun blindly. A task transcript shows the
executor's observations but **does not itself prove an independent
OpenAI account identity**.

After the read-only task, separately enroll/verify the Work GitHub
event trigger if an unattended issue/PR bridge is wanted. Publishing
Codex Cloud does not enable that trigger. A full C03 acceptance still
requires a separately controlled execution signer, immutable outbox/route,
actual provider receipt, and authoritative database+GitHub reconciliation.
Keep the $0 incremental paid-spend policy, no bypass and one attempt per
request. All previously uncertain deliveries remain reconcile-required,
not replay candidates.

## Recovery

On receipt conflict, unknown write, revoked/expired signer, mismatched main SHA or unsupported account access, **hold and reconcile**. Never delete or rewrite an existing receipt to hide ambiguity. Preserve all evidence. Roll back by disabling routing in its authorized control plane and revoking executor access outside Git; no credential keys are stored in this PR.

## What this PR may be merged as

At most this is a source-only contract and guided account-side setup for a Codex Cloud identity. **Do not describe it as live Cloud enabled, Work account proven, C03 authenticated end-to-end or production accepted.** Merge eligibility is separately determined by exact-head CI, review and repository protections; the external acceptance gates in #185 remain open until real observations exist.
