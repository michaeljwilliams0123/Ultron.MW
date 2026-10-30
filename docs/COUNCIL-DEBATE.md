# Council debate — owner-first

Ultron’s council is built to **work for the owner**, not the other way around.

Policy: [OWNER-AUTONOMY.md](./OWNER-AUTONOMY.md) · `src/owner-autonomy.mjs`

## Triggers

| Event | When it runs |
|-------|----------------|
| Pull request | opened / synchronize / reopened |
| Issue | opened/labeled/edited by **owner**, or labels `feature` / `proposal` / `council` |
| Comment | Owner comment containing `/council` |
| Manual | `workflow_dispatch` with item number |

## Owner mode

When `github.actor` is the repository owner (or dispatch sets `owner_mode=1`):

- Softer planning friction (still advisory)
- Explicit **action board** in the comment (what to do next)
- Status `OWNER-READY — PROCEED WITH CONSTRAINTS` when governor proceeds
- Body budget up to 8k characters

## Hard floors (unchanged)

- No push to `main`
- No paid model keys required
- Security-sensitive language → HOLD
- SHA-pinned actions · `persist-credentials: false`

## Local

```bash
OWNER_MODE=1 TITLE='Ship X' BODY='…' ITEM_NUMBER=1 IS_PR=false node scripts/council-debate.mjs
```
