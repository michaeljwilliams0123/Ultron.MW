# Native edge release verification

This change adds a local workerd integration harness for the real edge Worker and a dedicated, deliberately restricted Preview entrypoint. It does not authorize deployment or change the existing production Worker, bindings, routes, scheduled jobs, or release policy.

## Native CI seam

Run the existing locked edge dependencies and test the actual Worker using the local-only runtime-test configuration. The synthetic loopback origin counts requests and the supported MCP metadata positive control proves the counter works. No production origin, credentials, shared Queue, Workflow, or Durable Object binding is available. The test harness has no production deployment or identity semantics.

## Preview boundary

Use the separate preview configuration only after verifying account free-tier capacity, explicit owner authorization and access policy. The preview is a discovery/health canary, not a full staging instance. It denies all other paths and cannot proxy to Hatchable or invoke production workflows. Do not import production secrets or bind shared account resources. Do not run production deploy commands with this configuration. A public Preview URL is not an authenticated staging environment; configure Cloudflare Access before sharing any preview with private data.

## Promotion and acceptance

1. Land #587 through the existing exact-head Council and CI requirements.
2. Verify native runtime CI and the preview isolation contract on this change.
3. Verify the preview's actual resource inventory and unique deployed version if a preview is authorized; keep its evidence separate from production.
4. Use the existing authorized production release path. Record previous and new deployment IDs; do not assume gradual deployment is compatible with existing Durable Object migrations or workflow changes.
5. Verify exact merged SHA and deployed manifest for both Cloudflare and Hatchable. The existing 18-request HTTP harness reserves estimated bytes and must not be run against production without provider-budget reconciliation. No new scheduler or paid service.
6. Run one Agent Ready rescan after live HTTP acceptance. Track unsupported discovery, OpenAPI and negotiation gaps honestly; do not close acceptance tickets on source results alone.

References: https://developers.cloudflare.com/workers/testing/test-harness/get-started/ ; https://developers.cloudflare.com/workers/testing/test-harness/configure/ ; https://developers.cloudflare.com/workers/previews/resources/ ; https://developers.cloudflare.com/workers/previews/get-started/
