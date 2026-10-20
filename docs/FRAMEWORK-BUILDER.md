# Ultron autonomous framework builder

One GitHub-hosted PR conversation is the authority. This is a **bounded framework factory**, not a general-purpose credential issuer or unmanaged background process.

## Native PR commands

| Comment | Real effect |
| --- | --- |
| `@ultron regress` | Dispatch the existing complete Verify workflow on the exact PR head and independently observe its terminal result |
| `@ultron build api telemetry` | Generate authenticated API module, Node regression test and deployment contract on the PR branch |
| `@ultron build mcp telemetry` | Generate MCP JSON-RPC stdio tool server module, Node regression test and deployment contract on the PR branch |
| `@ultron credentials` | Report scopes and secret boundaries without printing credentials |

Builder emits three files per integration in `src/generated`, `test` and `docs/integrations`. It validates repository owner, live PR branch, current-main relationship, head SHA, source tree, allowed file paths, and committed file bytes. It never changes `main` directly or grants permissions.

The generated connectors expose two read-only functions against the fixed Ultron repository: repository status and recent CI outcomes. More capabilities require another reviewed template; natural-language comments cannot silently create arbitrary shell or admin tools. Every build dispatches exact-head regression verification. This requires no personal PC.

## Token and secret semantics

`src/capability-credentials.mjs` implements Ultron-owned HMAC bearer tokens using randomized nonces, fixed read-only scope, audience binding and 30–3600 second expiration. It supports environment-only references such as `env:ULTRON_CONNECTOR_SIGNING_KEY` and metadata-only readiness checks; no credential values are included in GitHub source or logs.

GitHub supplies the short-lived `GITHUB_TOKEN` to authorized Actions workflows. That token does not automatically create third-party OAuth accounts, secrets, or deployment identities. The factory does not grant permissions or write GitHub Secrets. External providers still require owner-authorized consent and existing credentials.

Generated APIs are not automatically hosted endpoints. They require a deployed runtime and protected signing key. Their MCP alternatives speak JSON-RPC over stdio, use only fixed public GitHub read methods, and do not request external credentials.

## Acceptance boundaries

- Source generation only updates the PR branch, never `main` directly.
- GitHub Actions Verify covers source, tests and workflow lint on the exact commit.
- A passing test is not proof of a deployed endpoint or provider access.
- Closed PR conversations exit quietly rather than producing failed workflow runs.
- No Cloudflare dependency, new dashboard, paid LLM or Windows machine.
