# Admin App v1 — Executable GitHub administration

**Tracker:** [#169](https://github.com/michaeljwilliams0123/Ultron.MW/issues/169)
**State:** candidate implementation in PR #198; **not a connected/deployed Admin App**.

## Purpose
Give Ultron **actual executable** repository administration through GitHub REST API, rather
than an advisory council comment that pretends to be authorization. A server-side, separately
installed Admin GitHub App performs admitted operations. No model instruction, council
report, ChatGPT comment, runner log, or ordinary Repair App token grants Admin authority.

## Exposed capabilities

| Operation | GitHub permission | Authorization | Postcondition |
| --- | --- | --- | --- |
| `actions.dispatch` | Actions: write | scoped independently verified grant | dispatch accepted; async receipt required |
| `actions.rerun_failed` | Actions: write | scoped independently verified grant | dispatch accepted; async run readback |
| `actions.cancel` | Actions: write | scoped independently verified grant | cancel accepted; async run readback |
| `actions.enable` / `actions.disable` | Actions: write | fresh exact-plan owner step-up | workflow state independently read back |
| `repository.settings.update` | Administration: write | fresh exact-plan owner step-up | exact setting value independently read back |
| `webhooks.ping` | Webhooks: write | fresh exact-plan owner step-up | dispatch accepted; external receipt needed |

Only three trusted workflow names, main ref, and the named reversible repository settings
`delete_branch_on_merge` and `allow_squash_merge` enter the v1 contract. No arbitrary
workflow file, arbitrary repository, URL, protected-branch bypass, secrets, billing,
visibility change, workflow YAML edit, ruleset mutation, or token minting.

## Call chain

1. The trusted controller reads current stop/revoke state, accepted owner objective and
   exact task plan with expiry, zero-cost budget and idempotency key.
2. A **separate credential/identity service** reads the Admin GitHub App installation
   ID, repository ID, actor reference, grant permissions and expiration at runtime.
   Configured env var names alone do not prove identity.
3. An **independent owner authority service** validates an exact-plan digest.
   Standing grants may cover only bounded ordinary Actions operations. Workflow
   enable/disable, settings updates and webhook ping require fresh owner step-up.
4. The executor reads GitHub's exact precondition state and durably reserves the
   mutation before dispatch. The ledger must implement atomic unique reservation.
5. The authenticated transport executes a single allowlisted GitHub REST request.
   If a response may be lost, the ledger marks `reconcile-required`; it never
   repeats an uncertain external write.
6. Settings/enable-disable read back and verify the target state. Async Actions
   results remain `dispatched-unverified` until another observer validates
   the resulting run and task postcondition.

`src/admin-executor.mjs` supplies the tested admission/dispatch logic.
`src/admin-github-transport.mjs` supplies a strict authenticated request
adapter. Both require trusted runtime injection and are **not self-activating**.

### Integration requirements

- Deploy only after an authorized, separate Admin GitHub App is installed with
  effective grants read back. Never reuse the Repair App credential or an
  owner personal access token as an unstated fallback.
- Store secrets only inside the separate authenticated credential service, never
  in issue/PR text or the model's input. Token material must not enter receipts.
- Use Hatchable/PostgreSQL to provide atomic `ledger.reserve`, `ledger.mark`,
  `control.read`; a separately authenticated owner approval verifier supplies
  `authority.verify`.
- Run a reversible, owner-approved canary against a specifically named target,
  verify the exact owner approval, actual installation identity, request and
  independent GitHub after-state. Test stale object and lost-response negatives.
- Require exact-head tests and independent security review before merge/activation.

### What this PR does not establish

This source alone is **not** proof of a live Admin App installation, fresh owner
step-up, hosted secret, connected Hatchable API, successful live mutation or
protected release. The administrator identity and live canary requirements in
#169 remain open until separately verified. The existing hourly Continuum
automation/council does not get these privileges from this PR.

No paid services may be activated without separate permission; **$0/day paid spend**.
