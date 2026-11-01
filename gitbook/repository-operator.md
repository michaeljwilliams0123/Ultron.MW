---
description: "Accepted target for a Hatchable-first, self-repairing repository operator."
---
# Repository Operator target

Ultron's accepted target is one cloud-first operator that can diagnose a
repository failure, prepare an isolated repair, open and maintain a pull
request, observe exact-head verification, and recover from failed or uncertain
attempts. This is a target architecture, not a claim that the operator or its
GitHub App principal is already deployed.

## Authority map

* **Hatchable** becomes the sole owner-facing operational UI after a gated
  cutover; PostgreSQL owns task, action, event and reconciliation state.
* **GitHub** remains canonical for source, PRs, CI evidence, review and the
  protected merge boundary.
* **One Ultron GitHub App principal** supplies a stable installation identity.
  Each operation receives a newly down-scoped, short-lived repository token;
  broad installation grants are not a runtime session.
* **Routine repair and observation** require a bounded plan and revocable
  standing grant, while workflow state, repository settings and webhooks
  require a fresh independent owner step-up for one exact plan.
* **Protected release** still requires exact-head CI and an independent review.
  The App cannot review or merge its own work.
* **Local execution** is an opt-in adapter with isolated credentials, timeouts
  and recovery; it cannot silently become the core or widen authority.

## One lifecycle

Every capability follows intake → plan → authorize → execute → verify →
persist → learn. Deterministic policy controls effects. Possible external
writes are persisted before dispatch, uncertain outcomes are reconciled by
independent readback, and learning can propose candidates but cannot approve
itself or change permissions.

## Execution order

1. Correct architecture/current-state documentation.
2. Deliver the repository-scoped repair loop through the unified principal.
3. Add separately authorized high-impact step-up operations without creating an
   omnibus admin session.
4. Cut over the owner workflow to Hatchable after live feature/security parity,
   owner acceptance and rollback.
5. Retire only specifically proven superseded routes in a distinct cleanup PR.

The canonical [execution tracker](https://github.com/michaeljwilliams0123/Ultron.MW/issues/167)
and its child issues own implementation acceptance. The full
[decision record](https://github.com/michaeljwilliams0123/Ultron.MW/blob/main/docs/ULTRON-REPOSITORY-OPERATOR.md)
records the baseline reconciliation, unified-principal policy, evidence boundaries and
deferred decision frontier.
