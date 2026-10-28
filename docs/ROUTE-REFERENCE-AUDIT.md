# Route reference audit — issue #69

Run `node scripts/audit-route-references.mjs` from a Git checkout to print a
deterministic JSON inventory. The command reads tracked source files and records
the Git revision and whether the working tree changed. It reports imports,
re-exports, literal dynamic imports (including non-interpolated templates), workflow references, document links and other
text references with file and line evidence. External URLs are reduced to origins;
the audit makes no network requests and reads no credentials.

`retained-entrypoint` protects the required Verify, PR-brain, cloud PR/objective,
self-scan and GitLab mirror workflows, the shared Pages UI, mirror script and
GitBook configuration. Other workflows with an `on:` trigger are declared
entrypoints. A source with consumers is `referenced-source`. A source
without consumers is only an `unreferenced-candidate`; every route remains
ineligible for deletion and runtime evidence remains `not-probed`. Documentation
references and tests do not prove that a production route is live.

Hatchable's `lib/` imports resolve within `cloud/hatchable/`, including imports
from nested API handlers, MCP tools and shared modules. Missing alias targets
are reported like missing relative imports. With `hatchable.toml` present, API
and MCP files are declared platform entrypoints, SQL migration history is
retained, and the TOML configuration is inventoried. They do not require a
literal inbound source reference to be consumed by the platform. Files in the
legacy `api/lib/` and `mcp/lib/` shared pools are not classified as endpoints.
These classifications still carry `runtimeEvidence: not-probed`; use a deployed
manifest and observed responses for independent runtime evidence.

The audit is a conservative first phase of #69. It cannot resolve computed
imports, shell-generated paths, remote consumers, server-side configuration or
runtime endpoint health. Missing literal module targets and retained entrypoints
produce a nonzero exit status. Deleted tracked files remain visible as omitted
paths. Parent-directory symlinks are rejected before reading a tracked file.
Review omitted non-text, symbolic or oversized
paths separately; source strings are never executed.

For each candidate, collect actual caller/runtime evidence, security and feature
parity, latency and cost measurements, failure injection, and a tested rollback.
Then use a separate cleanup PR to delete only proven dead code and repair all
references. Verify Pages, hosted tasks, PR-brain, GitLab and GitBook synchronization
after any cutover. This PR adds the reference inventory and does not close #69's
runtime parity or removal acceptance.

The [October 28 runtime observations](verification/ROUTING-RUNTIME-2026-10-28.md)
record exact source/deployment parity, an isolated deployment rollback drill,
live queued tasks, the recovery mirror readback and remaining acceptance gaps.
