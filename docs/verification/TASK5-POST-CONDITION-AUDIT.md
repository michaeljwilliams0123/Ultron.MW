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

Only explicit successful Task 4 statuses (`completed`, `success`, `succeeded`, `executed`, `applied`) are eligible for local Git inspection. If full base/head SHAs are present, the hook synchronously confirms the checkout HEAD equals `headSha`, base is an ancestor, and the exact pair changes at least one file. It uses fixed-argument `execFileSync`, not shell interpolation or the unrelated `HEAD~1..HEAD` fallback.

The artifact includes a SHA-256 digest of the exact JSON execution receipt but **not** its unrestricted `details` payload (which might contain tokens), a separate audit-content digest, timestamp, explicit refs, changed files, diff statistics, and these states:

- `LOCAL_DIFF_VERIFIED_REMOTE_UNVERIFIED`: exact local Git comparison passed; **remote effect unverified**.
- `REMOTE_READBACK_REQUIRED`: Task 4 reports a successful action but the pair of local Git SHAs was not available; no local verification is claimed.
- `EXECUTION_NOT_SUCCEEDED`: no successful Task 4 completion claimed.

`remoteReadbackVerified` always remains `false`. A local diff is not independent evidence of a GitHub remote write, branch, PR, deployment, or production release. This hook cannot replace the existing PostgreSQL checkpoint ledger, provider-side exact-SHA readback, GitHub Actions verification, or approval governance. It makes no polling or live acceptance claim. Production promotion requires separate, independently observed evidence.

## Integrity and replay

The idempotency key is restricted to safe filename characters; unsafe identifiers and active input objects/getters are rejected. Receipt JSON keys are sorted recursively before hashing, so ordinary key reordering does not generate a false replay conflict. Duplicate or contradictory commit identities at the root and within `details` fail closed. The receipt input must be bounded inert JSON. Local Git inspection uses NUL-delimited filenames and disables external diff drivers/text conversions; unusual filenames are not split at newline boundaries. The file is written to a same-directory temporary file, changed to read-only, fsynced, then published with an atomic non-clobbering hard link. Temporary files are cleaned up even when publication fails. Existing receipt-file symlinks are rejected. Read-only permissions limit accidental edits, not a privileged directory owner's ability to replace the file. Identical replays return the existing record, conflicting inputs are rejected, and altered records fail an integrity check. The digest is not a cryptographic signature, and users with filesystem write privileges may still alter both the record and its digest. Keep the directory protected; for stronger immutability, anchor its digest to the durable PostgreSQL ledger or an independently retained content-addressed store.

`receipts/` is gitignored and **ephemeral on GitHub-hosted runners**. Its presence must not be interpreted as persistent cloud storage. To record new proof after a pending receipt, use a separately keyed, append-only follow-up record in the durable cloud ledger, not overwrite the original audit artifact.

## Verification

```sh
node --test test/verify-post-conditions.test.mjs
node --check scripts/verify-post-conditions.mjs
# Repo-wide CI command after checkout:
node scripts/verify.mjs
```

Task 4's executor path is not on the baseline `main` at creation time; the integration call must be wired once its output shape and authorization boundary are available. This PR intentionally does not create a competing executor.
