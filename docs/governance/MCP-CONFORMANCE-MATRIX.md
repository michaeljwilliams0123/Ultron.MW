# MCP 2026-07-28 conformance matrix — first verified-source slice (#348)

**Decision status:** bounded source-conformance change tracked in PR #350; not live remote MCP certification. **Source baseline:** main merge `57d5107ec4738101e4999dbb685a30432f8f37d4` from PR #347.

**Transport boundary:** `src/framework-integration-runtime.mjs` is a JSON-RPC handler consumed by a generated local **stdio** adapter. It does not receive HTTP headers and must not be represented as an authenticated remote HTTP gateway. Hatchable's native `[mcp]` feature is a distinct deployment needing independent black-box tests.

| Concern | Published protocol requirement | Verified source / target | Operational evidence still needed |
| --- | --- | --- | --- |
| Modern request envelope | Each 2026-07-28 RPC puts version/client capabilities in `params._meta` | PR #350 corrects bridge parsing; includes discovery, list, and call regression cases | Verify against genuine 2026 client SDK as well as test fixture |
| Modern discovery | `server/discover` supported with `resultType: complete` and versions/capabilities | Existing bridge response retained; fixed request metadata parsing | Live stdio SDK interop and remote Hatchable discovery |
| Errors and downgrade | Unsupported version `-32022`; missing or malformed metadata must not silently become legacy | Negative tests for unsupported version, malformed envelope and nonstandard top-level `_meta` | Explicit multi-version client negotiation, downgrade rejection and error observations |
| List result caching | `tools/list` returns `ttlMs` and `cacheScope` | Source returns deterministic `public` scope for fixed read-only list | Verify cache invalidation and no tenant-specific tool list leakage on hosted server |
| Tool calls | `tools/call` with per-request metadata and bounded schema | Fixed tools `ultron_status` / `ultron_ci`, no mutations | Versioned SDK client, failures, replay and result provenance |
| Modern HTTP | POST with `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name` as applicable, body/header consistency and `-32020` on mismatch | **Not a function of the local stdio handler** | Real Hatchable HTTP endpoint, modern client, negative header mismatch and HTTP 400 readback |
| Authentication | Remote resource authorization and issuer-bound OAuth; clientInfo is not a credential | Stdio process inherits host permissions; no new remote auth grant | Approved token and denied wrong bearer/issuer/tenant tests for deployed endpoint |
| Legacy versions | Older `2025-06-18` `initialize` clients must remain compatible during migration | Legacy initialization and read tools are preserved by tests | Inventory external clients, count successful old handshakes and migration notice |
| Business state | Transport statelessness does not remove task, lease, receipt or SaaS sessions | Hatchable PostgreSQL/outbox/owner sessions untouched | C01/C02 scheduler and writer/recovery evidence under #183/#184/#204 |
| Optional extras | MRTR, subscriptions, resource caching and Tasks extension require explicit capability support | **Not claimed** by this bounded adapter | Probe only declared features, fail closed when not supported |

## Concrete acceptance phases

1. **Source:** run new and existing Node tests on exact PR head, keep evidence of prior false-metadata behavior; no credentials or paid provider inference.
2. **Interop:** use a real modern TypeScript/Go SDK against the local generated stdio transport; separately probe Hatchable native remote service under owner-approved identity; log only redacted response/HTTP codes, source SHA, SDK version and timestamp.
3. **Security:** force missing/mismatched HTTP method/name/version headers, invalid scope, wrong OAuth issuer, revoked grant, replay and unknown-write handling. A read-only tool must never provide an implicit write or admin route.
4. **Deprecation:** capture actual old-client traffic, published compatibility window, owner decision, fallback and rollback; **separate** PR for any removal. Do not remove local stdio, business durable state, request-scoped SSE or legacy transport merely because an adapter is modern.

**Follow-ups:** #348 remains OPEN until live compatibility and security results exist; #187/#169 own authorization, #189 owns generated adapter expansion, #204 owns historical proof, #170/#194 own UI cutover. Explicit incremental paid spend ceiling: **$0**.

References: https://blog.modelcontextprotocol.io/posts/2026-07-28/ and https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/server/discover.mdx and https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/transports/streamable-http.mdx .
