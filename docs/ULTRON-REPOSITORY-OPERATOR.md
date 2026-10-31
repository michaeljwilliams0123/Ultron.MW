# Ultron Repository Operator decision record

Status: **accepted target architecture; implementation pending**

Recorded: October 31, 2026

Canonical execution tracker: [#167](https://github.com/michaeljwilliams0123/Ultron.MW/issues/167)

## Outcome

Ultron will become one cloud-first repository operator that can diagnose a
repository failure, prepare an isolated repair, push a branch, open and maintain
a pull request, observe exact-head verification, and recover from its own
failed or uncertain attempts. Hatchable is the target owner-facing control
plane, PostgreSQL owns operational execution state, and GitHub remains the
canonical source, pull-request, CI-evidence, review, and protected-merge plane.

This record defines the target and its transition gates. It does not claim that
the operator, the new identities, or the Hatchable-only interface are deployed.
The current Pages interface and existing credential modes remain in place until
their separately evidenced cutovers.

## Confirmed GrillMe decisions

| Decision | Confirmed choice | Architectural effect |
| --- | --- | --- |
| Q1 | Cloud-first core with optional local extensions | Durable coordination does not depend on an owner PC. |
| Q2 | One lifecycle: intake → plan → authorize → execute → verify → persist → learn | Every capability enters the same state and evidence model. |
| Q3 | Hatchable/PostgreSQL owns execution state; GitHub owns source, PRs, and CI evidence | Operational and source authorities are explicit and reconcilable. |
| Q4 | Hatchable becomes the sole owner-facing Ultron UI; GitHub remains the development backend | Pages is transitional until a proven Hatchable cutover, then retires separately. |
| Q5 | One primary planner, specialized capabilities only when justified, and genuinely independent security/evaluation roles | Specialized roles do not become competing orchestrators or self-approvers. |
| Q6 | A separately authorized, opt-in local adapter with isolated credentials, timeouts, and recovery | Local execution is an extension, never an implicit authority path. |

## Reconciliation with the reviewed baseline

The reviewed architecture source contained eight named choices rather than an
authoritative 35-item decision register. They reconcile as follows:

| Reviewed choice | Disposition under Q1–Q6 |
| --- | --- |
| One modular Node.js coordinator | **Evolve.** Preserve one logical coordinator; move durable operational ownership to the Hatchable control plane instead of multiplying coordinators. |
| PostgreSQL durable database | **Retain.** It becomes the authoritative task/action/event ledger. |
| Unified capability broker | **Retain and deepen.** All Repair, Admin, local, and provider operations enter through versioned capability contracts. |
| Separate worker identities with narrow permissions | **Retain and make explicit.** Repair and Admin are separate GitHub Apps with different admission paths. |
| Event-driven work plus periodic reconciliation | **Retain.** Reconciliation may observe uncertain work but cannot blindly replay a possible mutation. |
| Models propose; deterministic authorization controls effects | **Retain.** Planner or learned output cannot mint authority or approve itself. |
| Measured candidate promotion | **Retain.** Learning consumes verified trajectories and remains behind independent held-out evaluation. |
| One verified production target | **Retain.** Hatchable is the target operational plane; GitHub is the protected source/release plane, not a competing runtime. |

The direct contradiction is the prior decision that GitHub Pages is the only
owner-facing UI. That statement remains true for the **current** interface but
is superseded as the **target** by Q4. Pages removal is not authorized by this
record: it requires live Hatchable feature/security parity, owner acceptance,
rollback, consumer inventory, and a distinct cleanup pull request.

## Operator identity split

The logical operator uses two separately installed GitHub App principals. A
single permanent admin credential would let an ordinary repair path change the
controls that judge its work, so it is not accepted.

| Principal | Normal availability | Intended authority | Explicitly excluded |
| --- | --- | --- | --- |
| Repair App | Standing, repository-scoped, revocable | Create/update `ultron/*` branches and PRs, comment on its work, observe checks, and dispatch only an admitted Verify workflow | Protected-main writes, merge, deployment, rules/settings, webhooks, installations, visibility, billing, and Admin App invocation |
| Admin App | Unavailable until fresh owner step-up | One exact, short-lived, version-checked repository administration plan with independent readback and rollback | General repair, scheduled use, planner escalation, broad cross-repository authority, and reusable omnibus admin sessions |

Source declarations or masked setup values do not prove either identity is
ready. Runtime admission requires the expected installation, repository, actor,
effective permissions, expiry, and revocation state to be independently read
back without exposing credential material.

## Canonical execution lifecycle

1. **Intake** — bind the owner objective, repository, current base SHA, privacy
   class, and requested outcome to one durable task ID.
2. **Plan** — produce a bounded plan with allowed paths/capabilities, expected
   postconditions, attempt/time/cost budgets, and rollback.
3. **Authorize** — deterministic policy admits the Repair App or requests a
   separately scoped Admin step-up. Model text never supplies authorization.
4. **Execute** — persist the intended operation and idempotency key before any
   external write, then dispatch within its declared scope.
5. **Verify** — independently observe GitHub object identity, branch/PR head,
   checks, review state, and the requested postcondition.
6. **Persist** — atomically record observations, outcome, remaining uncertainty,
   and the next eligible transition. Sent or uncertain writes are readback-only.
7. **Learn** — verified trajectories may propose candidates; independent
   evaluation and protected review decide promotion without widening authority.

## Execution priority

| Priority | Deliverable | Exit gate |
| --- | --- | --- |
| P0 | Decision/current-state correction | Documentation distinguishes present state, accepted target, contradictions, and transition gates. |
| P0 | [Repair App loop](https://github.com/michaeljwilliams0123/Ultron.MW/issues/168) | One seeded failure reaches an exact-head verified PR with bounded repair and no duplicate effects. |
| P1 | [Admin App step-up](https://github.com/michaeljwilliams0123/Ultron.MW/issues/169) | A reversible admin canary requires fresh step-up; every non-admin path is denied. |
| P1 | [Hatchable UI cutover](https://github.com/michaeljwilliams0123/Ultron.MW/issues/170) | Full lifecycle, identity visibility, owner stop, recovery, security negatives, and rollback pass live acceptance. |
| P2 | Route consolidation | Only specifically proven superseded routes retire; no safe deletions remains a valid outcome. |

## Evidence and release boundaries

- A source change is not a deployed operator.
- Passing exact-head CI is not a protected merge.
- A protected merge is not a Hatchable deployment or byte-parity observation.
- Configured credentials are not runtime App identity or effective-grant proof.
- One successful repair is not evidence of restart, response-loss, denial, stop,
  rollback, or admin-isolation behavior.
- An accepted candidate is not evidence of live improvement or permission to
  merge, deploy, or change authority.

Every mutating receipt must bind the task/objective, owner authorization,
repository, base/head SHA, capability and scope, attempt budget, idempotency key,
principal identity, dispatch result, independent observation, and any unresolved
uncertainty. Credentials, cookies, private keys, and token values never enter
the repository, public issues, PRs, or receipts.

## Decision frontier after implementation

The next choices are deliberately deferred until the Repair App supplies real
evidence: the exact minimum GitHub App grant set; which CI/review failures are
eligible for autonomous repair; the per-objective attempt/time/cost ceilings;
which repository administration operations justify Admin App support; and the
measured Hatchable/Pages parity window required before retirement. Those are
deployment and policy decisions, not permission to guess from source.
