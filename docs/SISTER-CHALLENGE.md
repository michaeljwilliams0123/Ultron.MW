# Sister Challenge — authorized Ultron ↔ Mahoraga read-only audit

## Purpose and security boundary

Ultron challenges its older sister through **authorized GitHub API metadata reads**, not credential bypass, production penetration, GitHub permission escalation or unapproved API/MCP creation. Mahoraga is private while Ultron is public. No private code, configuration contents, raw API response, commit SHA, access token, personal data or working exploit may be copied into Ultron PR text, artifacts or console logs.

This is an independent challenge. It does not import Mahoraga source into Ultron and does not alter Ultron's existing read-only/council action catalogue. The council labels reflect *four independent review concerns*, not evidence of autonomous agents executing live attacks.

## Run on an authorized owner machine or isolated trusted runner

Use an owner-provided **fine-grained read-only** GitHub token under environment variable ULTRON_SISTER_READ_TOKEN, with least-privilege access to both repositories and the relevant ruleset / workflow-run API reads:

    node scripts/sister-challenge.mjs

The script runs GET requests only, confines the endpoint to GitHub, rechecks the target main SHA to reject source races, and prints a fixed-vocabulary sanitized findings report. A missing credential, API permission, target identity, complete ruleset list or exact head fails closed. A repository-local GITHUB_TOKEN from public Ultron Actions must **not** be assumed to have access to private Mahoraga. Never inject the credential into pull_request jobs or third-party runners.

Run focused tests:

    node --test test/sister-challenge.test.mjs

## Baseline observations — 2026-10-22, metadata only

- Ultron main is publicly hosted on GitHub. Its ruleset-list query returned no rulesets; branch-protection read returned 403, so this is **not proof of an unprotected main branch**.
- Mahoraga is private, with an active main ruleset whose required checks are Verify (ubuntu-latest) and Verify (windows-latest), strict exact-head policy enabled, PR-required, deletion blocked, and non-fast-forward updates blocked.
- Mahoraga's observed ruleset includes an always-bypass integration and a pull-request bypass actor. It requires zero approving reviews. This merits governance review but must not be described as an authentication bypass or confirmed vulnerability.
- Ultron's existing browser acceptance PRs #72 and #74 do not establish independent real-account execution authority. This audit does not replace that acceptance.
- Recent scheduled / candidate workflows require independent status evaluation. Pending, skipped and synthetic test outcomes are never evidence of successful real end-to-end execution.

## Patch backlog for the council

| Priority | Patch target | Acceptance |
| --- | --- | --- |
| P0 | Authenticated Ultron browser execution | Owner-session, independent application readback, revoked-session refusal, no unsafe replay |
| P1 | Ultron exact-head main enforcement visibility | Attest both rulesets and branch protection using a suitably permitted independent read before claiming enforcement |
| P1 | Dedicated sister read connector | Short-lived, repository-restricted read-only credentials with no writes or private source publication |
| P1 | Private/public evidence isolation | Automated negative tests verify sensitive target payloads never appear in public logs / reports / PRs |
| P1 | Verified CI state | Latest exact-main required Ubuntu/Windows jobs measured, not historical successful unrelated runs |
| P2 | Mahoraga governance exception review | Document intended always-bypass principals, zero-approval rationale, and test protected-path merge behavior |
| P2 | Council decisions as implementation PRs | Each accepted finding produces a separately tested source patch and exact-head check, not a speculative Issue |

## What this first challenge proves and does not prove

It provides reproducible metadata interrogation, deterministic prioritized findings, and safe handling of private-to-public project boundaries. It does **not** simulate network attacks, brute-force credentials, access another owner's resources, exercise Mahoraga's live production runtime, attest a private repo CI run without a scoped token, or grant Ultron control over Mahoraga.

Keep this PR draft until repository-specific reads and CI checks have genuinely executed. No merge, deployment, security-rule relaxation or membership purchase is requested.
