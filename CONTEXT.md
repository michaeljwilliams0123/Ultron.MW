# Ultron MW domain context

This glossary guides implementation and does not replace [architecture governance](docs/governance/ARCHITECTURE-GOVERNANCE.md) or [acceptance evidence](docs/ACCEPTANCE-STATUS.md).

| Term | Meaning |
| --- | --- |
| Ultron Core | Lead planner and coordinator, not an independent Council App. |
| Council member | Builder, Skeptic, Steward, Predictor, Generator, Sentinel or Companion; expertise and authenticated authority are separate. |
| Skill | Versioned engineering guidance admitted by the Git-backed hub integrity gate; not a credential, executor or grant. |
| Issue | Canonical GitHub work item with acceptance criteria and dependencies. |
| Task | Bounded objective recorded by the existing execution system; not automatically authorized by its issue. |
| Intent | Exact target, source, operation, actor, limits and expected effect. |
| Receipt | Durable evidence linked to a specific execution; separate from a plan, HTTP acknowledgment or test fixture. |
| Independent identity | Separately authenticated App/installation with verified repository scope; shared attribution is not independence. |
| Admin capability | Owner-authorized repository operation under existing identity, policy, budget and receipt contracts. |
| Production acceptance | Exact deployed source/artifact and independently observed required gates; source merge alone is insufficient. |
| Reconciliation | Readback of uncertain effects without blind replay. |

Canonical source is GitHub; durable hosted execution is Hatchable PostgreSQL. External peers are separately authorized. Consult the applicable source contract when a term evolves; document consequential decisions in an ADR.
