# Ultron MW agent instructions

## Agent skills

Start with [AskMatt / SetupMatt](hubs/skills/matt-engineering/SKILL.md). This repository-native playbook is shared by Core and the seven Council profiles. It routes engineering work; it is not a new executor.

### Issue tracker

GitHub Issues in `michaeljwilliams0123/Ultron.MW`. See [issue tracker](docs/agents/issue-tracker.md).

### Triage labels

Use the five canonical triage roles. See [triage labels](docs/agents/triage-labels.md).

### Domain docs

Single-context: [CONTEXT.md](CONTEXT.md), [domain rules](docs/agents/domain.md), [ADRs](docs/adr/README.md).

## Engineering and authorization

- Read the originating issue, applicable nested instructions, [architecture governance](docs/governance/ARCHITECTURE-GOVERNANCE.md), and [acceptance status](docs/ACCEPTANCE-STATUS.md).
- Pin source and target revisions. Work in a scoped branch, use existing tests and Verify, and provide review findings and evidence.
- Preserve the Council's owner-authorized admin capability design; do not infer authority from a skill, role, label, plan, green test, or shared Coordinator identity.
- Use existing owner authorization, short-lived identity, durable ledger, exact effect readback, stop/revoke and $0 incremental paid budget. Never bypass protections or self-review; no blind replay.
- Public repository: omit credentials, private conversations and client data. Report unavailable evidence as unavailable.
