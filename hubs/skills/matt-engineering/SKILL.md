# Skill: Matt engineering suite for Ultron

## Inputs
- Canonical issue or explicit owner request, pinned source/target, repository domain context and existing governance.
- Read AGENTS.md, CONTEXT.md and docs/agents/ before work. Use the established GitHub issue tracker and triage vocabulary.
- Route the work by intent. If an installed Matt workflow is available, invoke it; otherwise use this self-contained procedure index. This is an original repository-native adaptation, not a copied plugin distribution.

## Procedure

### Setup and routing

| Workflow | Use and output |
| --- | --- |
| setup-matt-pocock-skills | Verify tracker, labels, agent entry point and domain layout; record defaults without duplicating existing files. |
| ask-matt | Select the shortest relevant flow; explicit user intent wins. |
| using-agent-skills | Discover applicable skill and required inputs; do not infer a missing tool or grant. |
| triage | Classify incoming issues, verify evidence and choose one triage state. |
| wayfinder | For unclear multi-session designs, map decision dependencies; resolve blockers before implementation. |
| wizard | Identify truly owner-only steps; provide bounded instructions, never expose credentials. |

### Idea to implementation

| Workflow | Use and output |
| --- | --- |
| grill-me / grilling | Ask one consequential design question at a time; resolve repository facts independently. |
| grill-with-docs | Resolve design questions and persist domain language and decisions. |
| domain-modeling | Sharpen shared terminology and capture tradeoffs in CONTEXT.md or an ADR. |
| codebase-design | Identify small stable interfaces, deep modules and meaningful test seams. |
| prototype | Isolate an experiment, state a hypothesis and report runnable evidence; do not promote automatically. |
| research | Verify uncertain facts against primary sources and record dated references. |
| to-spec | Produce behavior, scope, acceptance, constraints and risks from resolved decisions. |
| to-tickets | Create independently testable slices, dependency edges and acceptance criteria. |
| implement / implement-spec | Execute the bounded ticket in a branch, test, review and commit with evidence. |
| tdd | Reproduce failure at a real interface, make the smallest fix, rerun and simplify. |
| diagnosing-bugs | Build a fast deterministic reproduction; falsify hypotheses, fix root cause, rerun and clean up. |
| code-review | Compare exact revisions; report standards and specification findings separately, with severity and evidence. |
| improve-codebase-architecture | Identify high-leverage seam or module improvements; prioritize measured problems. |
| resolving-merge-conflicts | Trace both changes to intent; resolve hunk by hunk and rerun affected tests. |

### Continuity, setup and communication

| Workflow | Use and output |
| --- | --- |
| handoff / claude-handoff | Provide a redacted, portable brief: objective, source, decisions, work completed, blockers, evidence and next step. |
| loop-me | Interview workflow requirements and iterate against acceptance. |
| retro | Record what worked, failed and one concrete improvement; evidence precedes promotion. |
| setup-ts-deep-modules | Where TypeScript exists, use narrow tested module contracts; do not force migration. |
| migrate-to-shoehorn | Only when requested, replace unsafe test casts using the established typed-fixture pattern. |
| git-guardrails-claude-code | Preserve protected refs and dangerous-command safeguards; require existing approvals. |
| setup-pre-commit | Use existing local validation tooling; never replace required CI. |
| scaffold-exercises | Create scoped exercises, solutions and checks only for an actual training request. |
| writing-beats / writing-fragments / writing-shape | Plan, draft and restructure requested writing using its audience and intended effect. |
| teach | Sequence concepts, runnable examples and understanding checks. |
| to-questionnaire | List questions only the external stakeholder can answer. |
| wait-what | Re-explain the missing concept using domain vocabulary and a concrete example. |
| writing-for-agents | Write short, testable repository instructions with explicit inputs, outputs and limits. |

### Default flow and roles

Incoming issue -> triage -> grill/domain -> spec/tickets -> TDD implementation -> standards/spec review -> existing protected CI/release -> verified receipt -> retro.

Core coordinates and routes; Builder implements; Skeptic diagnoses and reviews; Steward checks authorization and ADRs; Predictor evaluates risk and held-out evidence; Generator explores alternatives/specs; Sentinel verifies CI and recovery; Companion preserves decisions, progress and handoff. Every profile can consult the suite. Role specialties guide work, not authority.

Use existing `node --test` focused suites and required Verify. For privileged operations the existing authorization, exact target, cost, durable intent, independently observed effect and reconciliation rules apply. A skill is not a permission change; preserve owner-authorized admin design and report its actual readiness separately.

## Fail-Closed Rules
- Never treat shared Coordinator attribution as seven independent installations.
- Never infer acceptance from a green local fixture, unverified configuration, proposal or successful HTTP status alone.
- No self-review, bypass of protected release controls, exposure of secrets, blind replay, new paid usage or undisclosed external writes.
- Do not schedule another polling loop, create a parallel execution database, or introduce a competing permission framework.
- If blocked, report the exact missing evidence, responsible actor and next bounded step.

## Test Evidence
- Hub digest and admission: test/git-hubs.test.mjs
- Roster association and unchanged authorization boundary: test/council-of-ultron.test.mjs
- Required hosted checks: .github/workflows/verify.yml
