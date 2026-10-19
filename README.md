# Ultron.MW
**Ultron** — a single-owner, local-first adaptive AI brain. Clean-room successor to Mahoraga.

## Principles
- **One interface**: the same responsive UI works from the local runtime or as a static GitHub Pages shell. No second admin UI.
- **One coordinating brain**: dynamic planning and provider/tool selection belong to one coordinator; deterministic tasks stay deterministic.
- **Real learning, not self-congratulation**: Serve → Observe → Propose → Evaluate → Commit/Rollback. No candidate can promote itself from unverified subjective feedback.
- **No inherited infrastructure**: no copied secrets, no Cloudflare by default, no GitLab mirror, no duplicated bot lanes, no hardcoded provider dependencies.
- **One owner**: no tenancy, signup or role-management subsystem; authenticated operations are confined to a trusted local runtime.
- **Visible truth**: the UI never reports live execution when only the Pages shell or a draft is available.

## Quick start
Requires Node.js 20+; no npm install or API token.

```bash
node src/server.mjs
```

Open http://127.0.0.1:4782/ to see the single local UI. Commands /help, /system status, /repo inspect and /learning status execute bounded read-only checks and persist signed-off outcome *records* (not cryptographic signatures) through restart. Other text is saved as a draft. No AI model, external action or general shell is available yet.

```bash
node --test test/*.test.mjs
```

The same `docs/index.html` is deployable as a GitHub Pages **public static shell** after an explicit Pages activation. A private source repository does **not** make the published Pages site private. Do not put secrets, internal data, or privileged logic in `docs/`.

## What exists
- `src/learning.mjs`: deterministic, evidence-gated harness update selection, rollback and idempotent observation ledger.
- `src/server.mjs`: loopback-only status/draft/read-only command server; serves the same UI as Pages, requires local origin for writes, and persists state atomically.
- `docs/index.html` and `docs/app.js`: one responsive UI for GitHub Pages (offline static) or the local runtime (connected, read-only).
- `test/*.test.mjs`: regression and local HTTP integration tests.
- `docs/ARCHITECTURE.md`: boundaries, evaluation policy and rollout plan.

## Migration
Mahoraga remains unchanged. The previously created private archived `mahoraga-baseline-20261018` is historical source evidence, not an Ultron runtime dependency. Port capabilities selectively behind conformance tests; do not transplant obsolete pipelines.

**Status:** local read-only execution prototype. GitHub Pages is a publicly visible static shell; the local runtime supplies actual receipts, but the Pages URL cannot execute locally without an authenticated remote bridge. No production cutover, model training, remote execution or Cloudflare work is implied.
