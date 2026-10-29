# Council debate workflow

Workflow: `.github/workflows/council-debate.yml`  
Script: `scripts/council-debate.mjs`

## Behavior

| Aspect | Policy |
|--------|--------|
| Trigger | PRs (opened/sync/reopen); issues with `feature` or `proposal` label; manual `workflow_dispatch` |
| Deliberation | Deterministic GrokBot governor — **zero** model invocations / credits |
| Feedback | Issue/PR **comment** + artifact receipt |
| Memory | Does **not** push to `main`; owner promotes to `docs/council_precedents.md` |
| Actions | SHA-pinned; `persist-credentials: false`; contents read-only |

## Not included (by design)

- Live Grok/OpenAI API stages
- Auto-commit of precedents to main
- Merge or deploy authority

## Local smoke

```bash
TITLE='Test' BODY='proposal text' ITEM_NUMBER=1 IS_PR=false node scripts/council-debate.mjs
```
