# PR #35 — Mahoraga lift (dissent + heartbeat)

## Sources

| Ultron module | Mahoraga source | Notes |
|---|---|---|
| `src/collective-dissent-resolution.mjs` | `src/collective-dissent-resolution.mjs` | Multi-cycle dissent, evidence freshness |
| `src/heartbeat-ledger.mjs` | `src/heartbeat-ledger.mjs` (patterns) | Ultron-native; no credit-free autonomy deps |

## Authority

Advisory only. Zero model invocations. No new action rights.

## Verification

- `node --test test/heartbeat-ledger.test.mjs`
- `node --test test/collective-dissent-resolution.test.mjs` (when present)
- `node scripts/verify.mjs`
