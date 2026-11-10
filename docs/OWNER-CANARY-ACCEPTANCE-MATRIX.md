# Expanded Owner Actions Canary Acceptance Matrix

Repository: `Ultron-MW/Ultron.MW` (fixed numeric repository ID `1424939667`).
Execution identity: `github-actions[bot]` through GitHub’s per-job `GITHUB_TOKEN`, dispatched by owner `michaeljwilliams0123`.

## Modes and independently checked outcomes

| Mode | Permission | Verifications | Side effects |
|---|---|---|---|
| `inspect` (default) | `contents:read` | Current main SHA, repository ID, branch ref pinned to original SHA | GET only |
| `marker` (distinct approval) | `contents:write` | Main SHA, untouched isolated branch, absent marker file, Git tree/commit parent, fast-forward ref, exact one-file diff, remote file bytes/blob SHA | One synthetic marker commit on previously created canary branch |
| `verify` | `contents:read` | Reads marker commit, exact parent/tree, marker content/blob SHA, one-file diff, branch ref and unchanged main | GET only |

All modes require the original `target_run_id` and `expected_sha` matching the workflow’s actual main SHA. `marker` additionally requires the new approval phrase `APPROVE_ONE_CANARY_MARKER_COMMIT` and a GitHub workflow dispatch by the primary owner; it cannot reuse the prior `APPROVE_ONE_OWNER_ACTIONS_CANARY` approval. `verify` requires `marker_run_id` from the separately executed marker run.

### Exact existing baseline

The live branch from run `42827178057` is `ultron/canary-owner-actions-42827178057`. It originally pointed to `dab0248b0257481542244feed08c45be1a9d19e4`, identical to protected main. Read-only `inspect` can confirm its current state without any further mutation.

### Fixed write scope

The only permitted added file is `docs/canary/owner-actions-<target-run-id>.json` on that existing isolated branch, with deterministic provenance metadata; no PR, protected main, workflow files, secrets, release, or Hatchable records may be changed. The marker workflow can be stopped by setting `ULTRON_OWNER_CANARY_STOP=true` as a GitHub Actions repository variable; missing values do not grant other capabilities. A mismatch or existing marker aborts rather than overwriting.

The runner creates a Git tree and commit object and then attempts **one** branch-ref PATCH with `force:false`. If GitHub times out or the response is ambiguous, it records a held/uncertain result and never retries the write. The post-condition verifier independently checks GitHub's commit parent and tree, exact synthetic file bytes, single-file comparison, and both branch and main refs. Creating unreachable Git objects by itself is not considered a verified branch mutation.

### What passing does and does not prove

Passing read-only `inspect` or `verify` proves the specified GitHub provider-side observations. A passing owner-approved `marker` proves an isolated GitHub Actions ref update and readback. **None** establishes an Ultron Coordinator installation-token principal, seven independent Council agents, cryptographically signed Task 1–5 approval, or a persisted Hatchable PostgreSQL recovery receipt. Those remain separate release criteria, including open [PR #374](https://github.com/Ultron-MW/Ultron.MW/pull/374) and migration `0040`.

### Tests

Run `node --test test/owner-canary-matrix.test.mjs` for focused cases and `node scripts/verify.mjs` for the complete repository verification. The suite covers owner/actor spoofing, target injection, stop mode, branch races, missing marker content, altered blob content, extra file diffs, lost acknowledgment, replay denial, and read-only independent verification.
