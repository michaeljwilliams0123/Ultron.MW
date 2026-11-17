# Issue 334: artifact v7 compatibility canary

Baseline inspected: `e52f244cb3970d77ff7c94f0c37bff39387d0509`.

The issue's v4 inventory is historical. Current source has 19 upload steps in
seven workflow files, pinned to upload-artifact v6.0.0
`b7c566a772e6b6bfb58ed0dc250532a479d7789f`, and one download step in
`lane-lab-evidence.yml`, pinned to download-artifact v7.0.0
`37930b1c2abaa49bbe596cd826c3c89aef350131`.

Upload consumers: `verify.yml`, `lane-ops-audit.yml`,
`lane-governed-task.yml`, `council-debate.yml`, `lane-owner-canary.yml`,
`council-required-status.yml`, and `lane-lab-evidence.yml`.
Existing names, retention, attestation and
failure handling remain unchanged by this canary.

## Primary sources and candidate

- [v7.0.0 release](https://github.com/actions/upload-artifact/releases/tag/v7.0.0):
  ESM conversion and optional direct single-file uploads. `archive:false`
  ignores the supplied artifact name and rejects multiple files. That mode
  would change existing multi-file receipt/bundle contracts and is not used.
- [v7.0.2 release](https://github.com/actions/upload-artifact/releases/tag/v7.0.2):
  artifact dependency v6.3.1 and HTTP 429/Retry-After handling.
- Candidate immutable commit, resolved through GitHub's tag API:
  `cf430e030ddbb5b0abf93d22962f4752f3646cd9`.
  Its `action.yml` uses Node 24 and defaults `archive:true`.
- The existing pinned download v7 README specifies Node 24 and runner
  minimum 2.327.1. The canary uses GitHub-hosted Ubuntu 24.04; successful job
  setup and action execution provide the actual runner compatibility proof.
  No self-hosted or GHES support is asserted.

## Live test

`evidence/artifact-v7/compatibility-canary.yml` preserves the disposable
canary run at commit `69ca5ad68be55439965fa7825e4f12be86b52c6b`. It ran only
on a same-repo PR changing its workflow. It uploaded identical public evidence
with v6 and v7, uses the existing pinned download consumer for each, checks
SHA-256 manifests and exact PR source identity, and compares all bytes.
Both artifacts request seven-day retention and unique head/attempt names.
Independent REST artifact metadata and ZIP download must also be checked
before accepting the result. A retention setting is not proof of future
seven-day availability.

The workflow has contents-read permission, no checkout, no secrets, no model
calls, no deployment and a five-minute timeout. It uses a standard public
repository hosted runner. It does not upgrade existing upload steps or
authorize paid usage. The experiment has been removed from active workflows after execution to
preserve the repository's fixed lane inventory. The archived YAML is evidence,
not an active or auto-dispatched workflow. Existing uploads remain on v6.

## Execution receipt — November 17, 2026

- [PR #483](https://github.com/michaeljwilliams0123/Ultron.MW/pull/483),
  original exact head `69ca5ad68be55439965fa7825e4f12be86b52c6b`.
- [Canary run 44095699026](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/44095699026),
  roundtrip succeeded in 10 seconds.
- v6 artifact `14334575251`, ZIP SHA-256
  `2bededa913c954cf577e5951ad527839d7859e9b374090b2bb540c097437098d`.
- v7 artifact `14333916803`, ZIP SHA-256
  `58fbc40fb467f540dbee9e3a7aa47654330d009d64df379a1577f4f356e1e6d1`.
- Independent GitHub API metadata and connector ZIP downloads verified both
  archive digests, all file hashes, identical extracted bytes and exact source
  binding. Both archives are 579 bytes; expiry metadata is November 24, 2026.
- Research linkage: task 1285 / review task 1286. This developer-run test is
  not a newly claimed Hatchable worker execution.

The first full local suite correctly rejected the experimental tenth workflow:
2904 passed, 3 failed, 18 skipped (2925 total). All three failures belonged to
workflow inventory/scenario tests. Archiving the disposable workflow restored
the inventory; all 31 tests in those two files then passed, without changing
any test expectation. No production source was changed.

Disposition: zipped v7.0.2 is compatible with this bounded test and the existing
pinned download consumer. Keep production v6 until an independently reviewed
upgrade is justified; this evaluation PR preserves evidence only. No actual
HTTP 429 retry or unzipped-mode compatibility is claimed. Final exact-head
engineering checks and review remain separate from this immutable canary receipt.
