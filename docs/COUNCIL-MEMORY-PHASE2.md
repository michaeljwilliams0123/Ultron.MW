# Council of Ultron — Phase 2 memory

Owner decision (Nov 10, 2026): council memory lives on **Hatchable PostgreSQL**.
The owner also has GitLab and GitBook, so they serve as mirrors through the
pipelines that already exist. Status: source-only, **default OFF**, advisory.

## Layout

| Layer | Where | Role |
| --- | --- | --- |
| Primary store | Hatchable PostgreSQL, migration `0043_council_memory.sql` | Append-only entries, verified snapshots, scorecard generations |
| Store library | `cloud/hatchable/lib/council-memory.js` | Pure functions taking a db client (Hatchable, PGlite, or a Node worker) |
| Owner route | `GET/POST /api/brain/council-memory` (admin, owner handle) | Export, append, import, snapshot. Returns `council-memory-disabled` unless switched on |
| Adapter API | `src/council-memory-store.mjs` | `snapshot` (default) and `hatchable-postgres` adapters, plus disabled mirror adapters |
| Export format | `ultron.council-memory.v1` (`createCouncilMemory().snapshot()`) | Unchanged. The Postgres export is byte-identical, and the hash is the same `snapshotSha` |
| GitLab mirror | `evidence/council-memory/<sha256>.json` committed by PR | Carried to GitLab by the **existing** `gitlab-mirror.yml` after Verify |
| GitBook | `gitbook/council-journal.md` committed by PR | Published by the **existing** GitBook Git Sync of `gitbook/` |

No adapter writes to GitLab or GitBook directly. `mirrorAdapter(...).write()`
always throws `mirror-direct-write-disabled`. GitHub `main` stays the single
source of truth, as `gitbook/sync-and-disaster-recovery.md` requires.

## Design rules (from the Predictor's L7 mesh lessons)

1. **Keep prior state until the new one verifies.** All three tables are
   append-only (triggers reject UPDATE and DELETE). A newer fact row wins on
   export. `hatchable-postgres.save()` works in this order:
   1. Import the entries.
   2. Export them again.
   3. Restore into a scratch memory and compare hashes.
   4. Only then store the snapshot and a new scorecard generation, in one
      statement. The previous generation stays current until the new one exists.
2. **Hash plus schema version on every snapshot.** `verifySnapshot` refuses a
   wrong `schema` or `sha256` on import, store, read-back and mirror planning.
3. **Restore is tested as a round trip.** `test/council-memory-phase2.test.mjs`
   runs on PGlite with the real migration. It exports, imports, exports again,
   restores into scratch, and deep-diffs the memory and the scorecard.
4. **One writer per key-space**, enforced by database CHECKs as well as the
   library:
   - A member writes only its own `council/<role>` facts and journal.
   - Shared facts must carry `by = member`.
   - Only `ultron-core` (the routing lead) records outcomes.
5. **Sequence IDs, bounded batches.** All IDs are `BIGSERIAL`. Writes are capped
   at 500 entries per statement, and a scorecard generation at 8 × 8 rows. No
   queue table is added.
6. **Scorecard column contract** is `SCORECARD_COLUMNS` in
   `src/council-of-ultron.mjs`, produced only by `scorecardRows()`. The migration
   and the store are tested against it.

## Security hardening (Skeptic review of #403)

- **Keyed seal.** The plain `sha256` only shows that something changed; anyone
  can recompute it. Snapshots that leave or enter the store are therefore
  wrapped as `ultron.council-memory.sealed.v1`, with an HMAC-SHA256 under
  `ULTRON_COUNCIL_MEMORY_HMAC_KEY`. The stored snapshot row keeps the
  `hmac_sha256`.
  - Import, read-back and mirror planning all refuse a missing or wrong seal.
  - With no key configured, the store stays closed.
- **Validate on every load.** Every load or restore re-runs the write-path
  validators, even for a correctly sealed snapshot. That covers strict
  snapshot shape, member allowlist, fact-key pattern (so no `__proto__`),
  credential patterns and exact entry key sets.
  - The adapter restores only through `validatedRestore`.
  - The Postgres export builds memory in `Map`s.
- **Verified outcomes only.** The persisted scorecard counts only outcomes
  with `evidenceVerified === true` (`verifiedScorecard`). Phase 1 records every
  outcome as unverified, so no scorecard rows are written until an independent
  verifier exists.
- `src/council-of-ultron.mjs` changes here are limited to the
  `SCORECARD_COLUMNS` / `scorecardRows` contract. The Skeptic's own PR fixes
  `restoreCouncilMemory` itself.

Credential-like text (`ghp_…`, `github_pat_…`, `glpat-…`, `sk-…`, PEM keys) is
rejected, as in Phase 1. Evidence links must be Ultron.MW/mahoraga GitHub URLs,
`sha256:` or `receipt:` references.

## Setup steps for Michael (nothing happens until you do these)

1. Review and merge this PR.
2. Finish the Hatchable migration-ledger reconciliation described in
   `cloud/hatchable/README.md` (production was observed through `0028`). Then
   apply `0043_council_memory.sql`. It is additive and only creates three new
   tables.
3. Deploy `lib/council-memory.js`, `api/brain/council-memory.js` and the
   updated `hatchable.toml`.
4. **Two new Hatchable Setup values:**
   - `ULTRON_COUNCIL_MEMORY_MODE` = `postgres`. This is a switch, not a
     credential. Unset or any other value keeps memory off.
   - `ULTRON_COUNCIL_MEMORY_HMAC_KEY` = base64 of at least 32 random bytes, for
     example `openssl rand -base64 32`. This one is a secret: owner-only
     protected setup, never in source or logs. Without it the route answers
     `council-memory-hmac-key-missing`.
5. Read back while signed in as the owner:
   - `GET /api/brain/council-memory` returns `ok:true` and a `sealed`
     envelope around an empty `ultron.council-memory.v1` snapshot.
   - `POST {"op":"snapshot"}` stores it.
6. Optional mirrors (no new secrets):
   - **GitLab:** set the existing repo variable `ULTRON_GITLAB_MIRROR_ENABLED=true`
     and the existing secret `ULTRON_GITLAB_MIRROR_TOKEN` if you haven't already.
     To mirror a snapshot, save the `sealed` object from
     `GET /api/brain/council-memory`, then run
     `ULTRON_COUNCIL_MEMORY_HMAC_KEY=… node scripts/council-memory-export.mjs <sealed.json> --write`
     and open a PR with the files. The script refuses to run without the key.
   - **GitBook:** connect Git Sync to `gitbook/` on `main`, as already
     documented. The generated `gitbook/council-journal.md` publishes on merge.

To turn memory off, unset `ULTRON_COUNCIL_MEMORY_MODE`. The data stays and
nothing is deleted.

## Decisions for Michael

- Should snapshots be mirrored on a routine (for example, a weekly PR opened by
  a Council routine), or only when you ask? The default is only when you ask.
- Should `gitbook/council-journal.md` be added to `gitbook/SUMMARY.md` once the
  first snapshot exists?
