# Task 5 — Synchronous post-condition audit

This standalone source-only hook consumes Task 4's **execution receipt** and writes a create-once JSON artifact at `receipts/{idempotencyKey}.json`. It does not merge or deploy and has no cloud- or browser-credential dependency.

## Contract

```js
import { verifyPostConditionsAndStoreReceipt } from './scripts/verify-post-conditions.mjs';

const artifact = await verifyPostConditionsAndStoreReceipt({
  idempotencyKey: 'ultron-task-123',
  status: 'completed',
  details: { baseSha: '<40-character lowercase Git SHA>', headSha: '<40-character lowercase Git SHA>' },
});
```

Only explicit successful Task 4 statuses (`completed`, `success`, `succeeded`, `executed`, `applied`, `reconciled_success`, `recovered_success`) are eligible for local Git inspection. If full base/head SHAs are present, the hook synchronously confirms the checkout HEAD equals `headSha`, base is an ancestor, and the exact pair changes at least one file. It uses fixed-argument `execFileSync`, not shell interpolation or the unrelated `HEAD~1..HEAD` fallback.

The artifact includes a SHA-256 digest of the exact JSON execution receipt but **not** its unrestricted `details` payload (which might contain tokens), a separate audit-content digest, timestamp, explicit refs, changed files, diff statistics, and these states:

- `LOCAL_DIFF_VERIFIED_REMOTE_UNVERIFIED`: exact local Git comparison passed; **remote effect unverified**.
- `REMOTE_READBACK_REQUIRED`: Task 4 reports a successful action but the pair of local Git SHAs was not available; no local verification is claimed.
- `EXECUTION_NOT_SUCCEEDED`: a definitive failure status (`failed`, `failure`, `error`, `rejected`, `blocked`, `cancelled`, `canceled`).
- `RECONCILE_REQUIRED`: an unknown, pending, or otherwise unrecognized execution outcome; do not treat a potentially committed remote write as a safe retry.

`remoteReadbackVerified` always remains `false`. A local diff is not independent evidence of a GitHub remote write, branch, PR, deployment, or production release. This hook cannot replace the existing PostgreSQL checkpoint ledger, provider-side exact-SHA readback, GitHub Actions verification, or approval governance. It makes no polling or live acceptance claim. Production promotion requires separate, independently observed evidence.

## Integrity and replay

The idempotency key is restricted to safe filename characters; unsafe identifiers and active input objects/getters are rejected. Receipt JSON keys are sorted recursively before hashing, so ordinary key reordering does not generate a false replay conflict. Duplicate or contradictory commit identities at the root and within `details` fail closed. The receipt input must be bounded inert JSON. Local Git inspection uses NUL-delimited filenames and disables external diff drivers/text conversions; unusual filenames are not split at newline boundaries. The file is written to a same-directory temporary file, changed to read-only, fsynced, then published with an atomic non-clobbering hard link. Temporary files are cleaned up even when publication fails. Existing receipt-file symlinks are rejected. On POSIX runners, existing receipt directories must not be group/world writable, because another principal could unlink or replace a mode-0400 file; Windows ACL integrity is not established by POSIX mode bits. Read-only permissions limit accidental edits, not a privileged directory owner's ability to replace the file. Multi-process concurrent writers for a shared key are reconciled through the non-clobbering file link: identical inputs see one record, different inputs yield a conflict. Identical replays return the existing record, conflicting inputs are rejected, and altered records fail an integrity check. The digest is not a cryptographic signature, and users with filesystem write privileges may still alter both the record and its digest. Keep the directory protected; for stronger immutability, anchor its digest to the durable PostgreSQL ledger or an independently retained content-addressed store.

`receipts/` is gitignored and **ephemeral on GitHub-hosted runners**. Its presence must not be interpreted as persistent cloud storage. To record new proof after a pending receipt, use a separately keyed, append-only follow-up record in the durable cloud ledger, not overwrite the original audit artifact.

## Verification

```sh
node --test test/verify-post-conditions.test.mjs
node --check scripts/verify-post-conditions.mjs
# Repo-wide CI command after checkout:
node scripts/verify.mjs
```

The regression suite additionally covers concurrent same-key writers, conflicting writers, symlinked or group/world-writable audit directories, oversized inputs, recovered statuses, and unknown write outcomes.

Task 4's executor path is not on the baseline `main` at creation time; the integration call must be wired once its output shape and authorization boundary are available. This PR intentionally does not create a competing executor.

## Task 5 source-acceptance criteria (owner review / squash-merge handoff)

**Scope:** This PR adds a deterministic local post-condition **audit hook**, its tests, this verification contract and a `.gitignore` rule. It does not activate Task 4, grant GitHub permissions, prove a remote effect, merge a PR, or deploy Ultron MW Cloud Brain.

### Accepted implementation requirements — demonstrated in source and focused tests

- [x] **Task 4 shape:** Export `verifyPostConditionsAndStoreReceipt(executionReceipt)`; accept a bounded JSON receipt with an idempotency key, execution status and optional exact base/head SHAs, and write `receipts/{idempotencyKey}.json`.
- [x] **Provenance:** When both commit SHAs are supplied with a successful status, inspect the *specified* range only; require current HEAD to match the supplied head SHA, base to be an ancestor, and a nonempty changed-file set. Do not substitute `HEAD~1` or a fabricated remote-dispatch diff.
- [x] **Status fidelity:** Successful/reconciled/recovered outcomes without both local SHAs are `REMOTE_READBACK_REQUIRED`; an exact local diff is only `LOCAL_DIFF_VERIFIED_REMOTE_UNVERIFIED`; known terminal failures are `EXECUTION_NOT_SUCCEEDED`; unknown/pending/ambiguous outcomes are `RECONCILE_REQUIRED`. In every case, `remoteReadbackVerified` remains `false`.
- [x] **Replay and integrity:** Canonically hash the bounded, inert receipt; exclude raw `details` from the artifact; create once without clobbering; replay identical input without changing timestamp or digest; reject conflicting same-key input and modified on-disk artifacts. SHA-256 is an *integrity checksum*, not an independently trusted signature.
- [x] **Filesystem hardening:** Validate key/path shape, reject symlinked audit files and directories, reject group/world-writable audit directories on POSIX, use owner-read-only receipt files, clean temporary files on publish failure, and avoid leaking credentials into JSON. A directory owner can still replace files; do not claim OS-level immutability.
- [x] **Safe Git parsing:** Use fixed Git arguments (no interpolated shell), disable external diff/textconv, and parse NUL-delimited filenames, including names with newlines.
- [x] **Concurrent behavior:** Eight independent writers with identical input converge on a single complete artifact; two writers with different inputs sharing a key result in one accepted writer and one rejected conflict; no temporary files remain in the tested fixture.
- [x] **Regression suite:** Run all 21 Task 5 tests, repository-wide verification and existing PostgreSQL acceptance checks with zero failures on the exact reviewed PR head; record CI URLs and final SHA in the PR, not as a mutable claim about `main`.

### Explicitly deferred — NOT prerequisites for merging this source-only PR

- [ ] **Task 4→5 runtime wiring:** Compose this hook behind the approved Task 4 executor, once its final receipt shape and trusted caller are installed. This PR must not invent a competing Task 4 or bypass owner grants.
- [ ] **Durable external evidence:** Store a corresponding immutable / append-only execution record in authoritative Hatchable PostgreSQL; independently query GitHub for exact remote branch/commit/PR/postcondition and reconcile unknown writes before retries.
- [ ] **Production acceptance:** Verify an owner-authorized end-to-end operation, exact-head CI and provider readback with $0 paid spend; assess under [#204](https://github.com/michaeljwilliams0123/Ultron.MW/issues/204) and [#285](https://github.com/michaeljwilliams0123/Ultron.MW/issues/285). Neither should be closed by merging this hook alone.
- [ ] **Integration canary:** [PR #367](https://github.com/michaeljwilliams0123/Ultron.MW/pull/367) is explicitly TEST ONLY / DO NOT MERGE; it is synthetic-provider evidence, not a release dependency or proof of live provider acceptance.

**Owner closeout:** Keep this PR open for the owner's review and squash merge to `main` after checking the **final head** and required passing CI. No second human reviewer is required by the current sole-owner policy in #204; preserve authorization, security checks and post-condition evidence. The local audit's success status must never be upgraded to a live external-effect claim by this source merge.
