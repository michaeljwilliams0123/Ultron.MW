# GitLab, GitHub and Hatchable MCP/CI bridge (source-only)

## Distinct endpoints and trust boundaries

| Service | Endpoint | Use |
| --- | --- | --- |
| Ultron project MCP | `https://ultron-mw-cloud.hatchable.site/mcp` | Owner-OAuth tool access to deployed `mcp/*.js`, including `ultron_gitlab_ci` once released |
| GitLab's native MCP | `https://gitlab.com/api/v4/mcp` | Separately owner-authorized GitLab-native tools; requires OAuth `mcp` scope or an eligible fine-grained MCP token |
| GitLab REST via Hatchable | `https://gitlab.com/api/v4/projects/87884831` | Read-only exact private-project CI observation through `[[api]]` OAuth broker |
| GitHub canonical head | `https://api.github.com/repos/michaeljwilliams0123/Ultron.MW/git/ref/heads/main` | Public exact-main SHA readback |
| GitLab Observability OTLP | Project-specific HTTPS and gRPC addresses under Observe > Setup | Traces/metrics/logs **only**; these are NOT MCP endpoints |

The Observability UI's "MCP server is being provisioned" refers to an observability-specific service. It does not imply GitLab's general `/api/v4/mcp` is absent or that an OTLP endpoint can be used as an MCP server.

## Implemented source contract

- `mcp/ultron_gitlab_ci.js` exposes an **admin-only**, zero-argument read tool.
- Hatchable `[[api]]` name `gitlab` requests an independently owner-consented OAuth connection at deploy/setup time. The platform API broker attaches the GitLab credential; neither source nor MCP parameters contain it.
- The tool calls exactly three fixed GitLab GET paths: project identity, private `main` SHA, and up to 20 pipeline summaries. It also checks the public canonical GitHub `main` ref.
- Rejects incorrect project ID, namespace, visibility, branch or commit shapes. No arbitrary URL, source code, provider mutation, CI dispatch, or secrets appear in the returned JSON.
- Distinguishes `exact-main-match` from `diverged` and exposes only bounded successful `verify/*` pipeline metadata. It always returns `acceptanceVerified:false`: provider metadata alone is not an independently verified task receipt.

This does **not** create a general GitLab MCP proxy. The official GitLab MCP server is an optional client-side connection with separate consent. The Hatchable tool reads GitLab REST through the platform's OAuth API broker.

## Activation and acceptance — separately authorized

1. Source PR is reviewed and merged under applicable repository rules, and exact-main source checks pass. Do not merge held PRs #311, #312 or #313 on this tool's behalf.
2. Review Hatchable's deployment diff, then separately authorize a deployment. The `gitlab` API requires a consented owner OAuth connection; use least-privilege `read_api` where supported. No credential may be copied from a ChatGPT connector or committed to GitHub/GitLab.
3. OAuth-connect the private GitLab project through Hatchable's Setup page. The client must not request arbitrary GitLab project IDs or mutating operations.
4. Connect a trusted MCP client to `https://ultron-mw-cloud.hatchable.site/mcp` with project-scoped OAuth. Confirm `tools/list` offers `ultron_gitlab_ci` only to authorized admins.
5. Invoke `ultron_gitlab_ci` with `{}`; independently compare returned GitHub and GitLab commit SHAs, the GitLab pipeline URL and job outcome. Confirm an unconnected client or arbitrary argument is held with **zero external writes**.
6. For a real cross-provider acceptance receipt, rely on the separately reviewed exact-SHA GitLab job in PR #313 and independent artifact readback; this read-only tool does not upgrade that evidence to release approval.

## Observability (optional)

The screenshot shows GitLab Observability enabled and provides two telemetry ingestion addresses. For GitLab CI pipeline tracing/metrics, GitLab documents the `GITLAB_OBSERVABILITY_EXPORT=traces,metrics` project CI variable. Do not send private logs by default. Authentication to ingestion is a separate configuration and must be adopted by every sender before enabling enforcement. No OTLP exporter, token, variable, billing setting or production telemetry is modified in this source PR.

## Constraints

- GitHub remains the sole authoritative source; GitLab is a secondary mirror/CI provider. Hatchable owns the task ledger and owner UI.
- No privileged MCP writes, cross-system write permissions, signature approval, signer keys or production data migration.
- No paid third-party calls or new hosted services; $0 additional cash-spend ceiling.
- No deployment or production OAuth consent is implied by a green source test or a Hatchable dry-run.
