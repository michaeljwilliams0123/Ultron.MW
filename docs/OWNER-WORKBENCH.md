# Owner workbench — GitHub, Actions, internet

Ultron gains **explicit, owner-gated** access to:

| Domain | Verbs |
|--------|--------|
| **GitHub issues** | list, read, comment, label |
| **Pull requests** | list, read, comment |
| **Actions** | list runs, `workflow_dispatch`, job status summary |
| **Internet** | HTTPS fetch (size-capped), search-plan helpers |

Module: `src/owner-workbench.mjs`

## Enable

```bash
OWNER_MODE=1          # or
ULTRON_AUTONOMY=1     # or
ULTRON_WORKBENCH=1
```

CI sets `OWNER_MODE` when `github.actor` is the repository owner.

## Design

- **Plan then run** — `planWorkbenchOp` is pure; `runWorkbenchOp` needs adapters.
- **Injected adapters** — tests never hit the network; production wires Octokit / `fetch`.
- **HTTPS only** for internet fetch; workflow names must be simple `*.yml` (no path traversal).
- **Hard floors** from `owner-autonomy.mjs` still apply.

## Owner commands (comment surface)

- `/work issue <n>`
- `/work pr <n>`
- `/work fetch https://…`
- `/work dispatch verify.yml`

## Catalog

```js
import { workbenchCatalog } from '../src/owner-workbench.mjs';
console.log(workbenchCatalog());
```
