# Execution Corps

Four execution-only workers share Ultron's existing adapters rather than adding a second Council, scheduler, secret store or mutation ledger.

| Agent | Executes | Existing authority |
| --- | --- | --- |
| Forge | GitHub operations | Exact-plan GitHub App admission, stop/revoke control, durable ledger |
| Medic | Bounded patch, CI and PR publication | Existing autonomous-repair coordinator, per-operation grants, max three attempts |
| Nexus | Cross-provider effects (GitLab, Graph, Hugging Face, Composio, Hatchable browser) | Signed intent, zero paid spend, fenced provider outbox, independent readback |
| Relay | Composio repository inspection | Existing scoped v3 worker, explicit account, verified read receipt |

`createExecutionCorps` is an internal trusted composition API. The scheduler/worker composition root must supply the real services. An agent request cannot inject tools, adapters, arbitrary shell commands, or credentials. There is no new public endpoint and no grant is minted here. An uncertain outcome returns reconciliation required; the caller must resume from existing durable state and never blindly repeat a write. A published repair PR is not a merged or deployed release. Production acceptance remains independent.

## Composio Build integration

Use the existing `integrations/composio/index.mjs` worker with server-side scoped sessions. Composio is the integration/tool layer, not a new independent runtime; keep Hatchable/PostgreSQL authoritative for scheduling, task state and operation receipts. Official references: https://docs.composio.dev/docs/sessions and https://docs.composio.dev/docs/sessions/executing-tools . The existing Composio admission allows two GitHub read tools; mutations continue through the existing signed App/ledger executor, not unrestricted OAuth proxy calls. Never silently switch accounts or assume paid fallback.

## Activation checklist

- [ ] Merge after exact-head CI and applicable review.
- [ ] Wire actual scoped service adapters in the existing composition root and schedule admitted tasks.
- [ ] Verify authentic delegated Composio session identity and durable receipt.
- [ ] Prove real scoped GitHub write and recovery (#527).
- [ ] Run one real repair from failing reproduction to PR to protected release (#523).
- [ ] Verify stop/revoke, lost acknowledgement, expired authority, duplicate event and budget-negative paths.
- [ ] Connect the release action using existing protected merge/deployment receipt controls; do not infer production acceptance from worker output.

Local verification: `node --test test/execution-corps.test.mjs test/github-operation-executor.test.mjs test/universal-cloud-executor.test.mjs test/autonomous-repair-loop.test.mjs`. This is source and adapter-contract verification only. No provider write or production activation is claimed.
