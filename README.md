# Ultron.MW

Ultron is an independent, single-owner execution platform with a GitHub-hosted read-only runtime, one shared interface, optional device inference, and evidence-gated routing improvements. Its capability and release decisions are defined by this repository. Mahoraga is historical reference material only; Ultron has no runtime dependency on it.

**Console:** https://michaeljwilliams0123.github.io/Ultron.MW/

## Current capabilities

| Capability | Environment | Implemented behavior | Evidence boundary |
|---|---|---|---|
| Read-only objectives | GitHub Actions | Read-only commands, at most three steps; hosted issue receipts | `/repo inspect` observed on issue #10 at the reviewed baseline; other paths have automated coverage |
| Hourly self-scan PR | GitHub Actions | At minute 17 scans current `main` and creates or refreshes one report PR only when findings change | No Issues; skipped cron runs are not evidence of health |
| Local tools | Loopback Node | Same shared commands, persisted objectives and receipts | Automated HTTP coverage; owner-device acceptance outstanding |
| Model responses | Optional Ollama, Hugging Face (local), or browser WebGPU | Bounded, unverified generated text | Provider availability is checked at activation; no hosted cloud LLM by default |
| Browser memory | Opt-in encrypted vault | History, feedback, plans, encrypted import/export | Device-local; manual transfer rather than automatic synchronization |
| Routing improvement | Shared core and local ledger | Fixed held-out routing evaluation and rollback | Policy selection, not model training or general intelligence |
| Experience suggestions | Local owner-action ledger | Verified, rated outcomes inform suggestions | Minimum 16 distinct outcomes; chronological holdout; no new action authority |
| Cognitive governance | Local planning | Fixed GrokBot council (7 selves), metacognition, counterfactual simulation and dissent-preserving synthesis — see [docs/GROKBOT.md](docs/GROKBOT.md) | Deterministic, zero-credit and advisory; no new action authority |
| Always-on standby | Local Node | Multi-self idle posture `waiting-for-owner`; `GET /api/standby` | Advisory receipts only; no tool execution |
| Owner actions | Paired local Node | Bounded notes; optional documentation draft adapter | Draft adapter disabled by default; no shell, merge, or deployment permission |

See [docs/GROKBOT.md](docs/GROKBOT.md) for the full GrokBot multi-self council pipeline.

## Optional local inference / always-on

| Setting | Default | Purpose |
|---|---|---|
| `ULTRON_ENABLE_LOCAL_MODEL` | Disabled | Set to `1` to enable local Ollama |
| `ULTRON_ENABLE_HF` | Disabled | Set to `1` to enable local Hugging Face Transformers |
| `ULTRON_HF_MODEL` | `Xenova/distilgpt2` | Optional HF model id |
| `ULTRON_ALWAYS_ON` | Disabled | Set to `1` for continuous multi-self standby (waiting-for-owner) |
| `ULTRON_ENABLE_GITHUB_DRAFT` | Disabled | Set to `1` to enable the restricted local documentation draft adapter |

Requires Node.js 20+. Run: `node src/server.mjs` then open http://127.0.0.1:4782/

Verification: `node scripts/verify.mjs`

## Always-on multi-self

With `ULTRON_ALWAYS_ON=1`, local Ultron keeps a seven-self advisory council in standby (`waiting-for-owner`), emits idle heartbeats every 60s, and exposes `GET /api/standby` and enriched `GET /api/health`. See [docs/GROKBOT.md](docs/GROKBOT.md). Standby never executes tools or expands authority.

**Version:** 0.2.0
