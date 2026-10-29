# Approved live Mahoraga response-loss acceptance — October 29, 2026

The owner explicitly approved the bounded production test in the conversation
before execution. The test used the existing Hatchable production project
`proj_A6GCXRSKizko`, deployment **v22**, and its existing PAT connection.
No credential value was displayed or persisted by the test; credential
configuration was not changed.

## Reviewed runtime and exact target

| Field | Independently checked value |
| --- | --- |
| Ultron source commit | `ab7ac5404626d3be03a419528cab4d3a5d4174f4` |
| Adapter file | `cloud/hatchable/lib/mahoraga-actions.js` |
| Adapter SHA-256 | `0e71b359c1eab1b778f60eb48ca2e0c0b8625c8183a6679bbd819908c5a1cfd3` |
| Production file hash | Exact match to the reviewed adapter |
| Target repository | `michaeljwilliams0123/mahoraga` |
| Pinned target main | `5f584f43341c62696bbc4ece1b392062632a654f` |
| New action key | `ultron:approved-response-loss-20261029-v1` |
| Durable action / task | **5 / 382** |
| Admission time | **1:53:49 p.m. EDT**, October 29 (`2026-10-29T17:53:49.346581Z`) |
| Harmless test issue | [Mahoraga #1184](https://github.com/michaeljwilliams0123/mahoraga/issues/1184) |
| Independently observed GitHub actor | `michaeljwilliams0123` |

The action key was absent before admission. The execution wrapper restricted
requests to the exact repository, the approved issue title/body and at most one
issue-creation POST. The credential wrapper selected only the existing PAT;
GitHub App fallback and unrelated credential keys were unavailable to the test.
The immutable source was hashed before loading. No route, deployment or
persisted credential configuration was added for fault injection.

## Real provider acknowledgement loss

The live adapter durably admitted the action and entered its send checkpoint.
GitHub accepted the single issue-creation POST with HTTP **201**. The test wrapper
then deliberately discarded that acknowledgement before the adapter received it.
The adapter returned `uncertain`, action **5**, task **382**.

A separate native PostgreSQL read confirmed `state=uncertain`, `result=null`,
the exact pinned target SHA and one `mahoraga-admitted` receipt. The independent
GitHub connector read issue **1184** and verified its exact title, complete body,
action marker, creation timestamp and real actor.

A fresh invocation of the deployed admin `/api/brain/mahoraga` route, with the
same immutable request, reconciled the existing issue and returned **HTTP 200,
`state=observed`**, referencing the same action, task and issue. It did not
re-admit a second action.

| Follow-up | Observed result |
| --- | --- |
| Identical request after reconciliation | HTTP 200; same IDs and `reused=true` |
| Changed title under the same action key | HTTP 409; `idempotency-key-conflict` |
| Independent GitHub marker inventory | Exactly one issue; returned descending page covered the entire test creation window |
| Independent database inventory | One action row, one linked task row and one admission receipt |

## Real observation database acknowledgement loss

The same owned canary record also exercised the fix merged in PR #155. This
phase allowed **external GETs only** and permitted one observation update to
action **5** with its exact already observed provider result. It did not revert
the action to `sent` or `uncertain` and did not admit another action.

The production PostgreSQL observation update committed. The test driver then
raised the approved synthetic acknowledgement-loss error instead of returning
the committed reply. The reviewed reconciliation function issued exactly **one
independent readback**, matching action ID, task ID, key, operation, complete
JSONB request and complete JSONB result. It returned:

```json
{
  "ok": true,
  "state": "observed",
  "id": 5,
  "taskId": 382,
  "readback": "committed"
}
```

The instrumented counts were **one external GET, one database observation update,
one independent readback, and zero permitted external writes** in this phase.

## Cleanup and preserved state

The independent GitHub connector closed only test issue **1184**, with
`state_reason=completed`. A subsequent read verified `state=closed` and an
unchanged title/body/marker. This was the one cleanup mutation after the one
issue-creation POST; no duplicate issue was created.

Final independent database reads retained `observed`, the exact issue result,
one action, one task and one admission receipt. Production now has **3 observed,
1 prepared and 1 uncertain** Mahoraga actions: this test added the one observed
record. Existing uncertain actions were not replayed. Owner control remained
`paused=false`, version **1**.

## Acceptance boundary

These are actual production PostgreSQL commits and an actual GitHub issue,
separate from the loopback fixtures in CI. Loss was deliberately injected after
a real acknowledgement; it was not an observed physical network outage.
Reconciliation used a fresh hosted invocation, not a killed production process.

This proves the bounded existing-PAT write, independent readback, response-loss
reconciliation, same-key reuse, conflict rejection and cleanup. It does not
prove intended GitHub App installation identity/grants, credential revocation,
generalized two-provider broker authority, owner-authenticated browser/MFA,
hardware-device-offline operation, abrupt production worker death, or an agreed
budget/retention/SLA contract. Issues **#66 and #67 remain open** for their
respective remaining criteria.
