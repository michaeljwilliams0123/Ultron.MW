# Ultron.MW Hatchable v119 source and deployment parity (2026-11-16)

## Observed provenance

- Repository: `michaeljwilliams0123/Ultron.MW`, authored source under `cloud/hatchable/`.
- GitHub main SHA inspected: `8d79cf1d1bc8ae08e8ca6f03d0734a6d362f109b`.
- Hatchable project: `proj_A6GCXRSKizko`; live version `119` (deployed 2026-11-16 14:12:43 UTC).
- Live manifest contains **238** nonvirtual files. Authored files were hashed independently on Windows using SHA-256 over file bytes.
- Observed: **214 byte-exact**, **16 differ only by a final LF**, **6 substantive differences**, **2 deployed files missing in authored source**. Additionally **2 authored deployable files are not deployed**.
- Deterministically sorted manifest fingerprint SHA-256: `3a0e0a821fe9a89022b1fbde2d78a6f45cc23b496dc0db495c5b15aaed7b96c4`. This is a file-list integrity fingerprint, **not a signer attestation**.

## Substantive differences requiring review

| File | Observed distinction |
| --- | --- |
| `api/brain/council-ledger.js` | Comment wording; no identified behavior change |
| `api/brain/github-pr-comment-canary.js` | Authored source has a bounded `permissionHint` field absent in live return |
| `lib/council-ledger.js` | Comment wording; no identified behavior change |
| `lib/council-oidc.js` | Comment wording; no identified behavior change |
| `lib/github-app-installation-proof.js` | Authored source verifies installation permissions equality; live code lacks that check |
| `lib/github-pr-comment-canary.js` | Authoring includes allowlisted GitHub permission signals and `denied_no_effect` logic; live implementation retains a broader provider diagnostic representation |

Do **not** overwrite authored security-hardened modules with older live code merely to make hash counts green. Review the runtime behavior and ship the intended version through the normal protected deployment workflow.

## Missing and source-only files

This PR captures live files that were absent from authored source:
- `api/brain/local-workbooks.js`
- `migrations/0048_github_pr_comment_denied_no_effect.sql`

Two additional authored deployable files are absent from live v119:
- `api/brain/composio-v3.js`
- `lib/composio-v3-policy.js`

Those source-only files require an explicit deployment decision. Do not silently delete them or claim they are active.

## Repeatable evidence check

Acquire the current Hatchable deployment manifest from the owner-authorized project readback. Save it outside Git and run:

```shell
node scripts/hatchable-source-parity.mjs /secure/path/live-manifest.json cloud/hatchable
```

The audit classifies final-LF-only differences separately from actual changes and rejects duplicate, unsafe or unhashed manifest entries. **Exit code 0 means byte-exact source-manifest equality only**. It never means a Council decision, authorized production release, successful OAuth inference, or a signed deployment receipt. After any proposed merge/deploy, independently re-read the GitHub exact-main commit, Hatchable file manifest, and release check, then obtain a genuine owner-signed or trusted signing-service receipt binding the same source and deployed digest.

Current `api/brain/release-proof.js` intentionally supplies no deployment receipt, so the production release remains `verified:false` even when source CI and Council source lineage are present. This limitation must be resolved before full acceptance.
