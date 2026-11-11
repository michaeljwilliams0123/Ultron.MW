# Meet the Council

A short, plain-language introduction to the Council of Ultron. The Phase 1 foundation, trust model, and local commands are in [COUNCIL-OF-ULTRON.md](./COUNCIL-OF-ULTRON.md). This page only restates what that document already says.

Phase 1 is source-only and advisory. It adds a roster, memory, a skills hookup, a lane router, and a Companion reply draft. It registers no new capability, executes no operation, calls no model, and changes no workflow, secret, env name, endpoint, ruleset, or GitHub App binding.

## Ultron Core

The Council follows the GrokBot pattern: one lead brain with specialized member bots around it.

**Ultron Core** (`ultron-core`, also called Ultron) is that lead. It triages work, routes tasks, merges evidence, and escalates questions that need the owner.

## The seven members

Phase 1 uses the seven existing Council roles. Their profiles live in `COUNCIL_ROSTER` (see [COUNCIL-OF-ULTRON.md](./COUNCIL-OF-ULTRON.md)). That foundation document does not list each member’s name and duties one by one. It does name two of them in the routing and front-door design:

- **Skeptic** — joined as a challenger when the lead routes a task.
- **Companion** — speaks first at the Council Room front door, in plain language, with in-thread progress and approval cards. Outbound replies start as drafts (`sent:false`) for the Council Room thread.

Each member profile can include a name, a description, capability lanes, skills, declarative routines, a memory namespace, and tools. A profile can narrow a role’s existing abilities, never widen them.

## How work is routed

When the lead dispatches work, it picks a lead, supporters, a Skeptic challenger, and the operator who holds the needed tool. Owner-only operations always escalate to the owner, with approval cards. Results can be recorded as evidence-linked outcomes; a scorecard then weights future routing by each member’s track record on a lane. Held outcomes do not count.

The capability lanes named in Phase 1 are: agentic, generative, predictive, self-improvement, reasoning, reliability, governance, and continuity. “Universal” here means each lane has an owner and a measurable track record, not a claim of AGI.

## Trust, in brief

Council output is advice. Nothing in Phase 1 is a release vote, a commit status, or a merge gate. Recorded evidence is a reference until it is read back independently. Shared memory requires a repo URL, `sha256:`, or `receipt:` evidence link for every shared fact.

## Not in Phase 1

Persisting memory to Hatchable PostgreSQL, wiring the Council Room UI, running routines, and any live write are out of scope for Phase 1.
