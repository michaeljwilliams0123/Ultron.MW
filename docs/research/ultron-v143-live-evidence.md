# Ultron MW v143 — independent provider manifest and release evidence

**Evidence snapshot:** 2026-11-21 UTC. This is an independently reproducible source-parity observation, **not** final release acceptance or a permission to bypass any production gate.

## Scope and provenance

- Repository: `michaeljwilliams0123/Ultron.MW`
- Source commit observed on `main`: `2939b97324ee6baf7537cc4872516238933791eb` (squash merge of PR #521)
- Hatchable project: `proj_A6GCXRSKizko`
- Production deployment: **v143, live**, 268 files, 59 API functions, zero deployment warnings
- Provider evidence: authenticated Hatchable `get_deployment(project_id, version=143)` returned the full immutable per-file hash manifest captured in `ultron-v143-manifest-sha256.json`
- Source readback: a clean, detached checkout of current GitHub `main`, verified with the existing offline Node verifier
- Exact artifact digest: `sha256:3a8abfc20e9f16f1dc4b796013bdeccae0f467c264f8836f22faf4f7a3186625`

## Reproduce

```sh
node scripts/verify-deployed-source-parity.mjs docs/research/ultron-v143-manifest-sha256.json cloud/hatchable
```

Expected at the observed commit: `verified:true`; `manifestFileCount:268`; `matched:268`; `missing:0`; `different:0`. The verifier checks byte-level SHA-256 per path, rejects duplicate/traversal paths and verifies symlink containment. It does not contact Hatchable or generate a signature.

## Independent checks and remaining acceptance boundaries

- The v143 deployment's authenticated GitHub readback now uses the existing `github_operator` OAuth proxy rather than the exhausted 60-requests/hour anonymous GitHub quota. Local focused regression suite 38/38 and fast smoke 63/63 passed for PR #521; the merged PR's core exact-head CI and attested-receipt checks passed.
- **Council:** PR #521 was squash-merged before a genuine dedicated Gate App `ultron/council-7of7` verdict was observed on its final head. Seven advisory model recommendations are not an authenticated Gate App acceptance. This draft evidence PR is deliberately kept unmergeable until its own current-head CI and dedicated Council check pass.
- **Owner authorization:** no owner-signed `hatchable-v143` P-256 deployment receipt has been independently observed. A prior v140 receipt cannot authorize v143.
- **Hatchable manifest authentication:** the application runtime's configured Hatchable bearer credential currently receives `HTTP 401 invalid_token` on the provider `/mcp` endpoint; external agent-authenticated provider readback is not equivalent to a continuous, in-app authenticated readback.
- **Current release status:** `/api/brain/release-proof` remains `verified:false`. Only signed owner authority, independently verified live provider readback, exact-main CI and genuine Council status can clear it.

## Boundaries

This file and frozen manifest are documentation/evidence only. They do not contain tokens, private keys, passkeys, personal credentials or paid-model calls. They do not authorize a GitHub mutation, alter production authorization, supply a signature, or silently convert an unresolved gate into a pass. Any future source SHA or Hatchable deployment version requires new evidence and a fresh acceptance decision.
