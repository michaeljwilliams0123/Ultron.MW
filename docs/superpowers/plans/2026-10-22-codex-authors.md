# Named Codex Authors Implementation Plan

> Execute inline with Superpowers executing-plans; use a fresh final reviewer.

**Goal:** Display and call two explicit Codex author records with honest binding status.
**Architecture:** Shared browser registry, existing owner Issue-to-PR launcher,
strict Node request/receipt validators and a narrowly filtered Work event lane.
**Tech stack:** Existing Node ESM, browser JavaScript, GitHub and Work tools.
**Spec:** ../specs/2026-10-22-codex-authors.md

## Global constraints
- Preserve current CI and owner authority; no new dependency or paid provider.
- No raw private identifiers; no account inference from shared GitHub login.
- Mike stays unbound until independently enrolled from his account.
- Binding enrollment and successful live delivery are separate facts.

## Review focus
- Changed or duplicate owner requests must not execute twice.
- A forged author/automation fingerprint must fail validation.
- Unbound and unknown names must never fall back to another author.
- Existing ordinary proposal requests must retain their behavior.
- Stale main and uncertain prior attempts must stop, not silently replay.

## Task 1: Identity and call contract
- [x] Add failing tests to test/codex-authors.test.mjs for aliases, strict task
  parsing, fingerprints, stale main, owner request linkage and receipt binding.
- [x] Run the tests and observe expected failures before implementation.
- [x] Add docs/core/codex-authors.mjs and src/codex-call.mjs. Export
  resolveCodexAuthor, parseCodexObjective, buildCodexCall, parseCodexCall,
  validateCodexAdmission, buildCodexReceipt and validateCodexReceipt.
- [x] Run focused tests to green and commit.

## Task 2: Existing launcher and console
- [x] Add failing integration cases to test/cloud-pr.test.mjs.
- [x] Extend src/cloud-pr.mjs and docs/core/cloud-pr-submit.mjs with named calls.
- [x] Render names, fingerprints and readiness in docs/index.html/docs/app.js;
  route named composer input through the same GitHub handoff.
- [x] Enroll the Destiny-only webhook, record its hashed binding, document
  execution/claim rules in docs/CODEX-AUTHORS.md and update README.md.
- [x] Run focused tests and the full scripts/verify.mjs suite.

## Task 3: Protected delivery and real test
- [ ] Fresh review, address material findings, open PR and await required CI.
- [ ] Squash merge the exact verified head without bypassing protection.
- [ ] Submit a live Destiny call and inspect PR, webhook run and receipt.
- [ ] Confirm Mike fails explicitly while unbound; report proof and gaps.
