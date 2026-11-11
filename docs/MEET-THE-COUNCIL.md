# Meet the Council

A short, plain-language introduction to the Council of Ultron. The Phase 1 foundation, trust model, and local commands are in [COUNCIL-OF-ULTRON.md](./COUNCIL-OF-ULTRON.md). Names, roles, and duties below come from that document and from the canonical `COUNCIL_ROSTER` in `src/council-of-ultron.mjs` (merged to `main` in [#403](https://github.com/michaeljwilliams0123/Ultron.MW/pull/403)). Nothing here is invented beyond those two sources.

Phase 1 is source-only and advisory. It adds a roster, memory, a skills hookup, a lane router, and a Companion reply draft. It registers no new capability, executes no operation, calls no model, and changes no workflow, secret, env name, endpoint, ruleset, or GitHub App binding.

The Council follows the GrokBot pattern: one lead brain with specialized member bots around it. `COUNCIL_ROSTER` lists the lead plus the seven existing Council roles, in this order. Each profile has a name, a description, capability lanes, skills, declarative routines, a memory namespace, and tools. A profile can narrow a role’s existing abilities, never widen them. Routines are declared on the roster; Phase 1 does not schedule or run them.

## Ultron Core

**Ultron** (role Core, id `ultron-core`) is the lead brain and chief of staff. It triages work, routes work to members, merges their evidence, and escalates owner decisions.

## The seven members

- **Ultron Builder** (role Builder, id `ultron-builder`) — Ships working changes: turns a spec into a branch, code, and tests. Primary lane: agentic.
- **Ultron Skeptic** (role Skeptic, id `ultron-skeptic`) — Breaks assumptions: finds the counterexample and demands a falsifiable test. Primary lane: reasoning. When the lead routes a task, the Skeptic is added as challenger.
- **Ultron Steward** (role Steward, id `ultron-steward`) — Guards authority, provenance, secrets hygiene, and release gates. Primary lane: governance.
- **Ultron Predictor** (role Predictor, id `ultron-predictor`) — Forecasts outcomes, registers calibrated forecasts, and scores routing by track record. Primary lane: predictive.
- **Ultron Generator** (role Generator, id `ultron-generator`) — Generates alternatives, drafts, designs, and candidate skill improvements. Primary lane: generative.
- **Ultron Sentinel** (role Sentinel, id `ultron-sentinel`) — Watches CI, drift, and live operations; opens bounded repairs. Primary lane: reliability.
- **Ultron Companion** (role Companion, id `ultron-companion`) — Keeps the owner’s intent central: summaries, priorities, and decision cards. Primary lane: continuity. At the Council Room front door, Companion speaks first in plain language, with in-thread progress and approval cards. Outbound replies start as drafts (`sent:false`) for the Council Room thread.

## How work is routed

When the lead dispatches work, it picks a lead, supporters, a Skeptic challenger, and the operator who holds the needed tool. Owner-only operations always escalate to the owner, with approval cards. Results can be recorded as evidence-linked outcomes; a scorecard then weights future routing by each member’s track record on a lane. Held outcomes do not count.

The capability lanes named in Phase 1 are: agentic, generative, predictive, self-improvement, reasoning, reliability, governance, and continuity. “Universal” here means each lane has an owner and a measurable track record, not a claim of AGI.

## Trust, in brief

Council output is advice. Nothing in Phase 1 is a release vote, a commit status, or a merge gate. Recorded evidence is a reference until it is read back independently. Shared memory requires a repo URL, `sha256:`, or `receipt:` evidence link for every shared fact.

## Not in Phase 1

Persisting memory to Hatchable PostgreSQL, wiring the Council Room UI, running routines, and any live write are out of scope for Phase 1.
