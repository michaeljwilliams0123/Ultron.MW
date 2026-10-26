# Issue #68 seeded held-out acceptance contract

## Purpose

This contract supplies the held-out evaluation that the CodeRabbit review-count
proxy deliberately cannot supply. It does not turn CI into release authority.
The final council result remains advisory and deployment remains separately
owner-controlled.

## Pre-registration and separation

Before the final independent review, one unedited owner comment freezes:

- the baseline SHA and candidate PR/head SHA;
- the Git blob SHAs of `heldout-cases.js` and the dispatch workflow;
- the ten case-family IDs and evaluator version;
- `github.run_id` as the seed source for exact case values.

The review identity is the pinned CodeRabbit GitHub bot. The evaluator identity
is the later GitHub Actions workflow run. They are distinct. The workflow cannot
run from the candidate branch: it is dispatched from `main` only after the
reviewed candidate tree is merged unchanged. Therefore the exact seed and case
values do not exist while the candidate can still change.

## Comparable evaluation

The evaluator uses the same generator, seed, case order, fixtures, and pass/fail
rules for both immutable revisions. The cases cover valid source binding,
manifest immutability, all three reviewer identity fields, numeric request
types, stale source, ambiguous reviews, requested-changes handling, and
persisted-assessment tampering. Baseline and candidate get separate task IDs and
separate observed-event receipts for every case. The baseline lacks the adapter;
that absence is recorded as a failed capability rather than skipped or scored as
zero risk.

Success requires candidate score improvement, all ten candidate cases passing,
zero candidate failures, and zero critical regressions. The case report is an
Actions artifact, but the runtime does not trust the artifact alone.

## Runtime readback

The deployed adapter independently verifies all of the following:

1. current `main` is the candidate PR's merge commit and has the reviewed head's
   exact tree;
2. the frozen comment is owner-authored, unedited, unique, and matches the PR;
3. the generator and workflow blobs still match their frozen Git SHAs;
4. exactly one successful dispatch has the exact baseline/candidate title,
   current-main SHA, held-out job, and evaluation step;
5. regenerating the run-ID-seeded cases from GitHub source reproduces the scores;
6. one PostgreSQL statement commits the frozen manifest, twenty tasks, twenty
   observed outcomes, and the evaluation event, with exact idempotent readback.

Every council run performs the GitHub and Actions reread again before trusting
the stored evaluation. Hand-authored rows, same-reviewer counts, edited comments,
different dispatch inputs, duplicate runs, stale source, incomplete pagination,
or receipt conflicts cannot set the trusted evaluation signal.

## Evidence boundary

The seed is externally assigned and post-freeze, but the generator is public and
reviewable rather than secret. This is a deterministic property-based held-out
evaluation, not a claim of blinded human research or model generalization. A
fresh exact-head independent review must validate the generator and adapter
before merge. Production acceptance additionally requires the workflow dispatch,
Hatchable deployment, migration, owner-authenticated admission, and council
readback on the resulting exact `main` SHA.
