# Owner autonomy doctrine

**Slogan:** Ultron works for the owner, not the other way around.

## Intent

Ultron is a **single-owner** system. Governance exists to protect the owner from irreversible mistakes and hostile input — not to obstruct the owner’s own directed work.

When owner-autonomy mode is on, planning and multi-file budgets expand, the council prioritizes **action boards** over gatekeeping prose, soft evidence floors lower for advisory proceed decisions, and the **owner workbench** unlocks GitHub issues/PRs/Actions plus bounded HTTPS research.

## Enable

| Flag | Effect |
|------|--------|
| `OWNER_MODE=1` | Owner-first planning (CI sets this when `github.actor` is the owner) |
| `ULTRON_AUTONOMY=1` | Explicit autonomy mode |
| `ULTRON_VELOCITY=1` | Same budgets (velocity alias) |
| `ULTRON_WORKBENCH=1` | Force-enable workbench verbs |

Policy: `src/owner-autonomy.mjs` · Workbench: `src/owner-workbench.mjs`

## Welcomed under autonomy

- Higher multifile caps (up to 12 paths, larger byte budgets)
- Softer advisory governor thresholds
- Council `/council` and owner-issue triggers without extra labels
- Concrete next-step action boards on every council report
- **GitHub issues & PRs** — list, read, comment, label
- **Actions** — list runs, dispatch allowlisted workflows, job status
- **Internet** — HTTPS fetch (size-capped), search-plan helpers
- Passive observer preference for non-critical telemetry

## Hard floors (never removed)

| Floor | Why |
|-------|-----|
| No council push to protected `main` | Branch protection + review stay real |
| Required CI does not fail-open | Broken heads do not merge as green |
| Syntax preflight on model patches | Hallucinated JS does not land |
| No model writes to `.github/workflows/**` | Workflow supply-chain stays owned |
| Council remains advisory | Receipts never become merge authority |
| Secrets never logged | Credential hygiene |
| HTTPS-only internet fetch | No cleartext / odd schemes |
| Workflow dispatch names must be simple `*.yml` | No path traversal |

## Related

- [OWNER-WORKBENCH.md](./OWNER-WORKBENCH.md) — GitHub / Actions / internet verbs
- [GROKBOT.md](./GROKBOT.md) — multi-self council
- [COUNCIL-DEBATE.md](./COUNCIL-DEBATE.md) — workflow triggers
- [MULTI-FILE-AUTONOMY.md](./MULTI-FILE-AUTONOMY.md) — implement-files route
- [INTER-SELF-DIALOGUE.md](./INTER-SELF-DIALOGUE.md) — multi-turn transcripts
- [autonomy-acceptance.md](./autonomy-acceptance.md) — acceptance canaries
