# Changelog

This file records notable work under `docs/`. It was added on November 10, 2026 because the repository did not already have a changelog in this folder.

## November 10, 2026

Tonight's merged work on `main` (evening of November 10, 2026, America/New_York):

### [PR #401](https://github.com/michaeljwilliams0123/Ultron.MW/pull/401) — Classify missing Verify jobs as `unknown-missing` (refs #351)

**What changed.** Ultron now classifies a Core Verify run from the jobs GitHub actually created. If an expected root job is missing or skipped, the result is `unknown-missing` (never treated as green, and never treated as a test failure). A real job failure stays `red`. Partial or mismatched input is `invalid`. The change also pins the expected Verify job graph in tests and adds a read-only diagnostic script, plus an evidence note at `docs/verification/ISSUE351-MISSING-PR-JOBS-2026-11-10.md`. No workflow, required check, job name, ruleset, secret, or env name was changed.

**Why it matters.** After the November 9, 2026 GitHub Actions incident, missing jobs could be misread as product or workflow failures. The classifier separates service-side job-creation gaps from real test failures. Issue #351 stays open (owner acceptance items 4–5 remain).

**Root cause of the November 9 Actions outage.** Every failing PR #350 run that afternoon (1:11:54–1:21:30 PM ET / 18:11:54–18:21:30 UTC) carried a run-level “Internal server error” annotation. The missing jobs were always root jobs without `needs:`, and the window matches GitHub’s critical [Incident with Actions and Checks API](https://stspg.io/7yw63xl9ztrv) (1:12:37–1:59:32 PM ET / 18:12:37–18:59:32 UTC). This was a GitHub Actions service-side job creation failure, not a workflow or source defect.

Merged at 11:08 PM ET.

### [PR #402](https://github.com/michaeljwilliams0123/Ultron.MW/pull/402) — Refresh acceptance status from November 10 evidence

**What changed.** `docs/ACCEPTANCE-STATUS.md` was rewritten from the previous November 2, 2026 register so it reflects a week of merged work. The refresh keeps the existing structure and tone, cites evidence, and distinguishes **source merged** (including GitHub `completed` closes) from **live-proven** runtime acceptance. Historical October 31 sections are unchanged. This pull request did not change product code, workflows, or repository settings, and it should not be treated as production acceptance.

**Why it matters.** The acceptance register had lagged behind main. The updated document records later trackers and live receipts already cited elsewhere, and it keeps unmet live gates visible, without closing or commenting on other issues or pull requests.

Merged at 11:12 PM ET.

### [PR #403](https://github.com/michaeljwilliams0123/Ultron.MW/pull/403) — Council of Ultron Phase 1

**What changed.** Phase 1 foundation for the Council of Ultron landed: a roster (Ultron Core plus the seven existing Council roles), per-member and shared memory, a skills hookup, a lane router, and a Companion reply draft, with docs at [`docs/COUNCIL-OF-ULTRON.md`](./COUNCIL-OF-ULTRON.md). The work is additive source plus documentation only. Council output is advisory: it does not post a status, cast a release vote, or gate a merge.

**Why it matters.** This gives the Council a documented Phase 1 shape — one lead brain with specialized member bots around it — without changing workflows, secrets, env names, endpoints, rulesets, or GitHub App bindings, and without executing live writes.

Merged at 11:17 PM ET.

A short plain-language introduction is in [`docs/MEET-THE-COUNCIL.md`](./MEET-THE-COUNCIL.md).
