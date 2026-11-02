# Destiny's Codex — dedicated executor App and live canary handoff

**Status: SOURCE-ONLY / NOT CONFIGURED / NO LIVE DESTINY EXECUTION PROVEN.**
Canonical tracker: [Continuum C03 #185](https://github.com/michaeljwilliams0123/Ultron.MW/issues/185).
Supporting: [#183](https://github.com/michaeljwilliams0123/Ultron.MW/issues/183) C01 outbox, [#187](https://github.com/michaeljwilliams0123/Ultron.MW/issues/187) $0 policy, [#204](https://github.com/michaeljwilliams0123/Ultron.MW/issues/204) evidence contract, [#168](https://github.com/michaeljwilliams0123/Ultron.MW/issues/168) repair, and [CODEX-AUTHORS](CODEX-AUTHORS.md).

## Intent / what this PR delivers

Prepare a distinct **`ultron-destiny-executor` GitHub App** as the public receipt/branch-write actor for a **separately authenticated Destiny Work/Codex** event executor. The App must not be confused with a new ChatGPT identity, a second controller, a new Hatchable deployment, the existing `ultron-github-app` or a second human account. One durable task owner remains Hatchable/PostgreSQL, with GitHub handling versioned source/CI.

This PR ships:
1. `config/destiny-executor-trust.json`: deliberately `unconfigured`, no credentials, App IDs or public signing key invented.
2. `src/destiny-executor-attestation.mjs`: a small read-only Ed25519 completion verifier. It correlates an immutable trusted outbox intent and exact event actor to one signed, zero-paid, **read-only** result. It cannot dispatch tasks, grant authority, install an App or mutate a DB.
3. `test/destiny-executor-attestation.test.mjs`: positive signature and negative forged-owner, wrong actor, source drift, bad route/delivery, stale timestamps, replay and paid/action escalation cases.
4. An explicit owner/Destiny activation and evidence checklist.

`cloud/hatchable/lib/continuum-ack.js` currently verifies a separately keyed `destiny-work` bridge **ACK**, not actual execution completion. `cloud/hatchable/migrations/0014_continuum_receipts.sql` requires prior authorized durable receiver/route registration. This PR does **not** replace that contract or pretend a signed completion file can automatically advance production state.

## Identity and trust diagram

```text
Ultron/Hatchable C01 task+outbox (trusted database readback)
             |
             v
GitHub Issue -> task PR/event  [source/head/route/delivery digest]
             |
             v
Destiny's own authenticated Work event task (must be enabled in that account)
             |
             v
Signed read-only result (signing key controlled by authorized executor runtime)
             |
             v
Dedicated Destiny GitHub App creates branch receipt / exposes GitHub actor
             |
             v
Ultron verifies GitHub event actor + Ed25519 + outbox fields + exact SHA
             |
             v
C03 durable independent readback -> task result, held or reconcile-required
```

**Two distinct independent checks are necessary.** A GitHub App bot account attests which *App installation* wrote a commit; it cannot, by itself, attest which **ChatGPT Work account** actually ran the job. A signed receipt attests possession of the executor signing key, but establishing which Work account controls that key needs a separately verified account-side enrollment/installation observation. Until that independent binding exists, `workAccountAuthenticated=false` and `productionAccepted=false` are mandatory even for a cryptographically valid receipt.

Do not mint an arbitrary key in this repository and declare it Destiny's. Register a key only after an authenticated Destiny executor provisioner has generated it with the **private** key retained exclusively in a separately authorized runtime. Pin the public key/key ID and exact App installation identifiers through a reviewed trusted-base configuration update. Never store secrets, session cookies, client secrets, PEM private keys, access tokens, account IDs or Work transcripts in public GitHub issues, source or CI logs.

## Proposed GitHub App installation

Owner action, **not performed by this PR**:

1. From GitHub **Settings → Developer settings → GitHub Apps → New GitHub App**, create `ultron-destiny-executor` (or a unique available name recorded in the approved trust manifest).
2. Restrict installation to **`michaeljwilliams0123/Ultron.MW`**. Capture trusted App ID, installation ID, expected bot login by authenticated readback; don't infer identity from the proposed name.
3. Request only repository **Metadata: read** (automatic), **Contents: read/write on task branches** (repository-wide grant fenced by application policy), **Pull requests: read**, **Issues: read**, **Actions: read**. App installation permissions cannot natively restrict writes to specific paths; enforce allowed task/receipt paths in trusted code and protect `main` with branch rules.
4. No Administration, Secrets, Members, Deployments or Workflows write grants; no bypass/auto-merge/self-review. Rotate and revoke App credentials independently. Private key and signing key are different security materials.
5. Set an explicit single receiver source `destiny-work` with authorized C01 outbox/route registration, versioned route digest and independently held signing key. Do **not** provision secret material from GitHub issues or code generated by an untrusted PR.
6. In **Destiny's own authenticated ChatGPT Work account**, inspect the enrolled GitHub event task, verify repo/event rules, route fingerprint, enabled state, and zero-approved-paid-usage behavior. App installation **does not** create or enable that Work task.
7. If that Work event cannot securely bind the private attestation key or cannot run with $0 approved incremental paid spend, report `not-ready` and stop. The App-only setup may still be used as a transport smoke test but not as authenticated Destiny acceptance.

## Canary 0 — local source regression (this PR)

```sh
node --test test/destiny-executor-attestation.test.mjs
node scripts/verify.mjs
```

These tests generate an ephemeral test-only Ed25519 key pair in-process, exercise signature/correlation constraints and **never** invoke Destiny, connect to a live App, mint credentials or incur model usage.

## Canary 1 — safe live request (Destiny to finish)

**After authenticated setup**, use a *new owner-authored* Issue and task PR created from **then-current main** through the documented [CODEX-AUTHORS](CODEX-AUTHORS.md) flow:

```text
/codex destiny-codex Inspect trusted current-main docs/core/codex-authors.mjs and report the callable author IDs. No product-source modification, merge, credential access or paid fallback.
```

Use a *new* immutable task/delivery ID. Prior #83/#87/#90/#93/#116/#117/#180/#181 PRs are historical artifacts, not reusable canaries after main has advanced. Obtain an exact-head PR-triggered `test` check; an owner comment `/codex run destiny-codex` is a trigger hint only, **not** an execution receipt. Do not post repeated wake-up comments or retry an uncertain write blindly.

Destination-scoped receiver must first consume a legitimate C01 outbox item and a separately registered immutable C03 route. A receipt payload must match exact task/delivery/request/source/route, include a cryptographically signed `completed` result digest, `maxPaidCents=0`, `effect=read`, a bounded expiry, pinned key ID and the expected App login. Verify the **creating commit's actual actor** with GitHub API; do not accept an actor merely supplied in JSON. Persist signed receipt with create-only semantics, then read it back; conflicting IDs or unknown writes enter `reconcile-required`.

### Required acceptance table

| Gate | Acceptance evidence | Owner |
| --- | --- | --- |
| A1 | Dedicated App ID/installation/repo scope verified and least-authority policy enforced | Owner + Destiny |
| A2 | Real **Destiny-authenticated Work** event task is enabled; installation/route fingerprint checked independently | Destiny |
| A3 | A uniquely provisioned Work-bound signing key is held outside Git; pinned public key and key ID independently reviewed | Destiny |
| A4 | Exact-main immutable owner task, target PR and current C01 outbox/registered C03 route all agree | Ultron |
| A5 | One live trigger, one Work accepted claim, one actual harmless repository inspection and one signed completed result | Destiny |
| A6 | GitHub actor/readback, Ed25519 proof, full request SHA, task/delivery/route/source/CI exact head and timing reconcile | Ultron |
| A7 | Forged owner ACK, wrong App, modified payload, stale SHA, expired/rotated key, duplicate delivery and lost ACK all fail closed | Ultron |
| A8 | No local PC, unauthorized credential changes, autonomous release, unrelated writes or additional paid spend | Owner + Ultron |

Positive A5/A6 must reference independently observable **executor and provider** receipts; a static JSON fixture or a manual GitHub owner comment cannot satisfy them. Initial canary can be reported as `verified-executor-receipt` only; production acceptance and separately authenticated Work-account proof require the full independent A1–A8 evidence chain.

## Risks, unresolved decisions and rollback

| Priority | Blocker / risk | Decision / test |
| --- | --- | --- |
| P0 | Work task not actually enabled in Destiny's account | Confirm separate account-side event subscription; no fabricated enrollment |
| P0 | Shared owner GitHub identity masquerades as Destiny | Require observed dedicated App actor **and** externally provisioned key verification |
| P0 | Work environment cannot securely sign with a separate private key | Hold identity acceptance; do not pretend GitHub bot is Work |
| P0 | No authorized C03 receiver/route or independently verifiable callback | Finish route registration and Hatchable deployment under #185 |
| P0 | Missing ACK vs result confusion | Maintain separate `acknowledged` and `completed` evidence |
| P0 | Ambiguous writes/duplicate delivery | Reconcile immutable IDs by authoritative readback; no blind replay |
| P0 | $0 approved paid spend/Work credit eligibility unknown | Probe without model use where possible; require owner authorization for costs |
| P1 | App permission compromise / malicious PR instructions | Narrow grants, protected main, exact trusted-base policy and path fences |
| P1 | Owner-authored PR workflow works, App-created PR may not wake checks | Exercise event-origin matrix; don't substitute workflow_dispatch for external Work delivery |
| P1 | Live telemetry and identity/key rotation | Expose redacted readiness, last-success, revoked state, age and no-ACK reasons |
| P1 | No Work-identity attestation standard | Keep `workAccountAuthenticated=false` until independently validated evidence exists |
| P2 | Additional UI/control plane causes duplicated state and spend | Keep one Hatchable runtime, GitHub as source, same C01/C03 ledgers |

**Rollback:** Revoke the App installation/access token and executor signing key, mark trusted destination `disabled`, block new C03 delivery, preserve immutable readbacks, and reconcile any in-flight/unknown side effects. Never delete or reassign an old delivery to suppress ambiguity. This PR does not activate App credentials or alter deployed SQL.

## Destiny completion checklist for this draft PR

- [ ] Independently inspect current main vs this branch and confirm no conflict with PRs #198/#199/#207/#213.
- [ ] Run focused and full tests, address material code/security findings.
- [ ] Use real Destiny account (not an assumed bot) to create/verify persistent Work event trigger.
- [ ] Create and install the dedicated App with minimal grants; record real App and installation identity in reviewed configuration.
- [ ] Provision signer in Destiny's authorized runtime and add independently verified trust key **public portion only**.
- [ ] Connect signed result delivery to C03 through a separately authorized producer/receiver, no self-registered route.
- [ ] Prove exact-main positive canary and negative/no-replay/revocation tests with durable independent readback.
- [ ] Update #185 and #204 with actual evidence links; mark the blocked gates complete only when measured.
- [ ] Keep this PR draft and source-only until signed-off integration criteria are established; do not silently merge or deploy.
