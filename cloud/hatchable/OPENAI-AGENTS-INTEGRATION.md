# Ultron.MW Cloud Brain — OpenAI Agents API integration boundary

**Status:** design and acceptance contract; not yet implemented or deployed. The existing Hatchable v2 read-only worker is the sole hosted runtime. GitHub Pages stays the primary user interface. No Railway/Cloudflare/Vercel dependency, private code publication, or paid-model invocation is authorized by this document.

## Native architectural path

1. **Observe:** Continue the existing PostgreSQL evidence journal, read-only GitHub objectives, and scheduled recovery. Scope any additional GitHub mutation to an independently authorized, installation-scoped GitHub App; never treat a model response as a GitHub permission grant.
2. **Think:** Add an opt-in managed OpenAI Agents API adapter behind the owner-authenticated backend, not the static Pages JavaScript. The adapter uses durable OpenAI session IDs stored in Postgres, and keeps owner objectives/episode references separate from raw external source documents.
3. **Act:** Translate a proposed tool call into a typed capability request. Restrict initial actions to read-only GitHub metadata and safe isolated sandbox work. Later code changes must be written to a fresh PR branch, not directly to protected main, with exact-head source readback and Verify.
4. **Remember:** Persist task IDs, session IDs, turn IDs, model choice, request consent, observations, review feedback, expected postconditions, verification receipts and causal links. Preserve facts separately from forecasts; never claim self-learning solely because an LLM emitted a suggestion.
5. **Resume:** On restart, first query the existing session/turn and required actions; do **not** start a duplicate billable turn or replay a write if its outcome is uncertain. Webhooks must verify provider signatures. Record any unknown result for owner reconciliation.
6. **Inform:** GitHub Pages reads sanitized status through the existing authenticated owner endpoint. Do not expose API keys, private notes, privileged tokens or raw session content in GitHub Pages, Issues or public PR logs.

## Model routing (future, explicitly gated)

| Tier | Preferred model | Eligible work |
| --- | --- | --- |
| Native | No model | Health/readiness checks, polling, filtering, lease recovery, deterministic receipts |
| Low | `gpt-6-luna` | Small summaries and issue classification |
| Normal | `gpt-6.1-sol` | Multi-step orchestration and bounded source analysis |
| High | `gpt-6-astra` | Difficult architecture, coding, test repair and independent review |

Actual model IDs, availability and pricing must be rechecked before activation. Do not hard-code unlimited fallback to another tier.

## Billing and authorization prerequisites

- Default AI mode is `disabled`. No API key is presently stored in the deployed project.
- A per-project OpenAI key must be created and stored in the host's **private** secret configuration; do not add it to repository code, browser storage or CI logs.
- Enable metered inference only after explicit owner opt-in and a hard daily/monthly request and cost budget. Reserve quota atomically before calling a provider; reconcile actual usage after completion and fail closed if the ledger is unavailable.
- Restrict request inputs: no credentials, private Mahoraga source, identity documents or user-sensitive records in public GitHub output. Model tools have no implied account privileges.
- Model-generated code is untrusted until the source patch, security checks and exact-head tests are independently executed. Keep the GitHub review/approval gate for merges, deployments and destructive actions.

## Agents API protocol acceptance

The documented API supports `POST /v1/agents/sessions` with `OpenAI-Beta: agents=v1`, an `agent` configuration, `environment` and `input`. Capture and persist returned session IDs and terminal turn events; `agent.session.idle` alone **does not** prove success. With `environment.type=none`, model deliberation requires no hosted command sandbox; isolated coding would need a separately approved sandbox and its associated cost. Durable sessions are not an always-running scheduler.

Before enabling a real adapter, test mocked transport for 401/429/500, timeout after provider acceptance, webhook redelivery, crash between API acceptance and database checkpoint, duplicate owner input, lost session, revoked API key, cost exhaustion, stale evidence, tool-call approval denial and PR review refusal. Add end-to-end acceptance with the real provider only after owner authorization.

## Release evidence

A proposed model-enabled PR must report: branch and commit SHA; actual API project/model; metered budget and observed cost; verified owner identity; session/turn ID; tested tool allowlist; pre/postconditions; exact-head CI result; reproducible recovery test; and live deployed source/version parity. If any evidence is missing, describe the capability as **unverified** and keep deployment disabled.

References:
- https://developers.openai.com/api/docs/guides/agents-api/overview
- https://developers.openai.com/api/docs/guides/agents-api/quickstart
- https://developers.openai.com/api/docs/guides/agents-api/sessions
