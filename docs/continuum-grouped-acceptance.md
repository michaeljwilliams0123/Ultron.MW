# Continuum grouped acceptance: C01–C03 and evidence

Run `node --test test/continuum-grouped-acceptance.test.mjs` for the focused cross-module cases, then `node scripts/verify.mjs` for the canonical full suite. The grouped test is included automatically by Verify. It uses an in-memory SQL boundary and a test HMAC key; all results are **simulated source evidence**. No test here authenticates a deployed receiver or certifies production acceptance.

| Group | Issues | Executable case | Source assertions | Remaining live acceptance |
| --- | --- | --- | --- | --- |
| Durable recovery and bridge | #183, #184, #185, #204 | `OR-02/03/08 + C03` | Lost database INSERT response is read back, duplicate reservation reuses one intent, missed tick fences the expired intent once, repeated signed ACK stores one receipt. | Real PostgreSQL transaction/process death, external lost ACK discovery (OR-04), deployed scheduler recovery, authenticated execution and independent completion receipt. |
| Denial and fencing | #183, #185, #187, #204 | `OR-05/06/07 + C03` | Conflicting request, stale lease and positive paid cost cannot create a receipt. | Real provider identity, resource fence, budget admission and authoritative external readback. |
| Revocation and route | #184, #185, #204 | `C02/C03` | Revocation stops reconciliation; a signed ACK for a different registered receiver fails closed. | Deployed pause/revoke readback and authorized route registration. |
| Evidence assessor guard | #173, #185, #204 | `EV assessor` | The locally stored bridge receipt is linked to task, delivery, route and source, but claimed readback and reviewer metadata still yield `productionAccepted: false`. | Independent provider receipt and reconciliation across Hatchable/GitHub/executor, actual independent reviewer, protected release and monitored pilot. |

These cases do not check off the live criteria in the linked issues. OR-09/10 and PA-09 require actual 24-hour and seven-day observation windows. GH, browser, integration and generated-capability families require separate live fixtures and authorized canaries. A source test or a GitHub PR cannot replace those observations.
