# Owner autonomy doctrine

**Slogan:** Ultron works for the owner, not the other way around.

## Intent

Ultron is a **single-owner** system. Governance exists to protect the owner from irreversible mistakes and hostile input — not to obstruct the owner’s own directed work.

When owner-autonomy mode is on, planning and multi-file budgets expand, the council prioritizes **action boards** over gatekeeping prose, and soft evidence floors lower for advisory proceed decisions.

## Enable

| Flag | Effect |
|------|--------|
| `OWNER_MODE=1` | Owner-first planning (CI sets this when `github.actor` is the owner) |
| `ULTRON_AUTONOMY=1` | Explicit autonomy mode |
| `ULTRON_VELOCITY=1` | Same budgets (velocity alias) |

Policy module: `src/owner-autonomy.mjs`

## Welcomed under autonomy

- Higher multifile caps (up to 12 paths, larger byte budgets)
- Softer advisory governor thresholds
- Council `/council` and owner-issue triggers without extra labels
- Concrete next-step action boards on every council report
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

## Related

- [GROKBOT.md](./GROKBOT.md) — multi-self council
- [COUNCIL-DEBATE.md](./COUNCIL-DEBATE.md) — workflow triggers
- [MULTI-FILE-AUTONOMY.md](./MULTI-FILE-AUTONOMY.md) — implement-files route
- [autonomy-acceptance.md](./autonomy-acceptance.md) — acceptance canaries
