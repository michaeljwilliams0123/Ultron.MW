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

`.github/workflows/artifact-compatibility-canary.yml` runs only on same-repo
PRs changing that workflow. It uploads identical synthetic public evidence
with v6 and v7, uses the existing pinned download consumer for each, checks
SHA-256 manifests and exact PR source identity, and compares all bytes.
Both artifacts request seven-day retention and unique head/attempt names.
Independent REST artifact metadata and ZIP download must also be checked
before accepting the result. A retention setting is not proof of future
seven-day availability.

The workflow has contents-read permission, no checkout, no secrets, no model
calls, no deployment and a five-minute timeout. It uses a standard public
repository hosted runner. It does not upgrade existing upload steps or
authorize paid usage. Rollback is removal of this isolated canary; existing
production evidence uploads remain on v6.

Status at authoring: live canary pending. This document is a test plan and
compatibility assessment, not a completed execution receipt or acceptance.
