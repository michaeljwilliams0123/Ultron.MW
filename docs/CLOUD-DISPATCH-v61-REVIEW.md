# Ultron.MW v61 — Brancha + Review pressure test

**Review date:** 2026-11-08
**Baseline:** merged cloud dispatcher PR #320, main `3adcd1826d3c56f1d22e8e35a8d5776a0324bc12`
**Target:** owner-authenticated Hatchable API and Mission Control client, shared signed
GitLab provider engine, owner grant signer, PostgreSQL ledger and GitLab OAuth.
**Brancha scenario tree (owner PC only):**
http://127.0.0.1:9519/projects/774c07f3210b

## Review: Standards axis

| Finding | Severity | RED proof | Disposition |
|---|---|---|---|
| Stale async preparation could sign the wrong target after an input edit | Medium | Browser-behavior harness observed old SHA reaching prepare after edit | **Fixed** using a request revision snapshot and explicit owner/profile/source checks after async reads |
| Browser accepted mismatched signed policy provenance | High (audit integrity) | Test forwarded a different policy SHA to the cloud submit boundary | **Fixed in UI and shared provider**: trusted provider derives digest from immutable binding and verifies it after signature verification, before ledger claim |
| Editing inputs after uncertain POST lost the grant ID and reconciliation path | Medium | Reproduction cleared the prior grant and unlocked prepare | **Fixed**: target remains locked and the original grant ID is retained for readback |
| Existing UI tests were primarily source-pattern assertions | Medium (test coverage) | Source test passed while real in-flight user-input race failed | **Fixed** by executing UI event listeners in a Node VM with controlled async fetch responses |
| CSRF Origin guard accepts absent Origin on an otherwise authenticated admin request | Low residual risk | Source inspection, not a demonstrated exploit | Documented; platform admin identity and valid owner signature still required. Confirm Host/Origin/SameSite behavior in an actual browser security review |
| Reconcile handle can be lost on browser refresh/tab close after uncertain effect | Medium residual operational risk | State held only in current browser JS variables; durable ledger remains intact | **Open follow-up**: add authenticated read-only recovery by action key; do not store private keys in browser or retry provider POST |

## Review: Spec axis

The owner asked to move Ultron execution into Hatchable so the provider dispatcher
does not depend on a local Codex MCP client. This is implemented as an owner-protected
cloud endpoint that invokes the **same signed provider library** as native MCP.

- **Verified in deployed v61:** anonymous POST rejected (401), member POST rejected
  (403), owner `prepare` succeeded (200), profile v6 / stop v5, zero-paid-spend policy.
- **Not yet verified in production:** signed GitLab `submit`, durable provider write
  ledger receipt, GitLab exact SHA readback and zero-runner evidence after a real POST.
  Therefore **do not** label live signed-provider execution production accepted.
- **Accepted architecture boundary:** owner signing key remains separate from generic
  Hatchable workers. This removes *local Codex MCP OAuth* as the provider execution
  dependency, **not** the owner-controlled P-256 signing step.

## Regression matrix

| Branch | Cases | Expected outcome |
|---|---|---|
| A. Authentication and malformed input | Anonymous/member/foreign Origin; unknown request fields | Reject before provider access |
| B. Signature and version | Wrong digest; wrong actor/source/resource; profile/stop drift; expiry | No ledger admission or provider POST |
| C. External write and replay | Lost provider ACK; corrupted source receipt; 12 concurrent submit calls | At most one provider POST; reconcile independently |
| D. UI state transitions | Slow owner response, target edit during prepare, ambiguous submit, edit after submit | No stale signable state or duplicate UI dispatch; preserve grant ID |
| E. Production claims | Owner cloud prepare and negative unsigned submit, ledger and GitLab readback | No falsely reported live write acceptance |

Tests added:
- `test/hatchable-cloud-gitlab-ui-behavior.test.mjs`
- Additional policy-digest binding, negative authorization and concurrent submit cases
  in `test/hatchable-mcp-gitlab-branch-write.test.mjs`

Local PGlite migrations `hatchable-live-schema-drift-0029-0032` and
`hatchable-partial-migration` passed with zero skipped. Focused test execution
passed after four deliberate RED regression failures were addressed.
The full repo verification result and exact-head CI should be recorded on the
pull request before merging.

## Release constraints

1. Keep existing production v61 unchanged during pressure testing and code review.
2. Require exact-head Core/Reef/Council automated verification; there is no second
   required human signer.
3. On merge, do a byte-exact Hatchable draft mirror and deployment dry run before
   deploying any correction. No credential or OAuth scope changes.
4. Re-test anonymous/member/owner preparation before any signed provider action.
5. A **real signed GitLab branch creation and independent ledger/readback** remain the
   outstanding production acceptance milestone; never repeat a POST on ambiguity.
6. Paid execution ceiling stays **$0**.
