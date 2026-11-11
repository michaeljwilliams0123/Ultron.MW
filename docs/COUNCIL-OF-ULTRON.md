# Council of Ultron — Phase 1 foundation

Status: source-only, advisory. This adds a roster, memory, skills hookup, a lane
router and a Companion reply draft. It registers no new capability, executes no
operation, calls no model and changes no workflow, secret, env name, endpoint,
ruleset or GitHub App binding.

## Model

The Council of Ultron follows the GrokBot pattern: one lead brain with
specialised member bots around it.

| GrokBot concept | Council of Ultron |
| --- | --- |
| Lead / chief-of-staff bot | `ultron-core` (Ultron): triages, routes, merges evidence, escalates |
| Member bot profile (name, description) | `COUNCIL_ROSTER` in `src/council-of-ultron.mjs` (the seven existing roles) |
| Bot memory (profile facts + dated journal) | `createCouncilMemory().remember()` / `.journal()`, namespace `council/<role>` (same as `councilMemberIdentity`) |
| Shared user memory | `.share()`; every shared fact needs a repo URL, `sha256:` or `receipt:` evidence link |
| Shared skills library | `loadCouncilSkills()` reads only integrity-verified `hubs/skills` via `verifyGitHubs` |
| Routines (cron / event) | Declarative `routines` on each profile; not scheduled by this change |
| Connectors / tools | `tools` = the role's existing `COUNCIL_ABILITIES`; a profile can narrow, never widen |
| Lead dispatches workers | `routeCouncilTask()` picks lead, supporters, a Skeptic challenger and the tool-holding operator |
| Approval cards | `escalations` + `companionReply().cards`; owner-only ops always escalate |
| Draft-first for anything outbound | `companionReply()` returns `sent:false`; it is a draft for the Council Room thread |

## Trust model (deliberately not PR #397's)

- Council output is advice. Every routing record carries `countsAsApproval:false`;
  nothing here is a release vote, a commit status or a merge gate.
- Objective text can only add escalations. Owner-only operations
  (`OWNER_ONLY_OPERATIONS`) always escalate, whatever the text claims.
- Recorded evidence is a reference (`evidenceVerified:false`) until it is read
  back independently.
- Any future gate built on the council must evaluate from `main` in a trusted
  workflow under a dedicated identity, never from evidence a pull request's own
  workflow produced, and never via a status any Actions run can post.

## Capability lanes

`agentic`, `generative`, `predictive`, `self-improvement`, `reasoning`,
`reliability`, `governance`, `continuity`. "Universal" means each lane has an
owner and a measurable track record, not a claim of AGI.

## Evidence loop

`recordCouncilOutcome()` writes a lane outcome with evidence into the lead's
journal and the outcome ledger. `councilScorecard()` turns outcomes into a
Laplace-smoothed success rate per member and lane, and `routeCouncilTask()`
weights future routing by that rate. Held outcomes do not count.

## Council Room front door

`mapOwnerMessage()` maps plain language onto the already-registered read-only
commands in `docs/core/capabilities.mjs`; anything else becomes a routed task.
`companionReply()` is the Companion speaking first in plain language with
in-thread progress and approval cards.

## Local use

```bash
node scripts/council-of-ultron.mjs roster
node scripts/council-of-ultron.mjs route "Fix the flaky CI workflow" branch.create
node scripts/council-of-ultron.mjs ask "Is Ultron up?"
```

## Not in Phase 1

Persisting memory to Hatchable PostgreSQL, wiring the Council Room UI, running
routines, and any live write. Those follow the existing governed execution path
and the release gate proposed in PR #397.
