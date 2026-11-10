# Autonomous Repair Pipeline — bounded execution, durable recovery

## Status

This PR implements the **source-level** bounded worker, real PGlite-backed PostgreSQL checkpoint tests, the pinned optional free-CPU repair-model adapter, and GitHub exact-head postconditions. The workflow is **not yet connected to a trusted production Hatchable invocation**, so its presence in source is not a claim that Ultron can automatically repair any arbitrary issue in production. No new public endpoint, privileged token, scheduler, deployment, release bypass, or paid provider is introduced.

## Canonical lifecycle

1. **Plan and authorize**: generate an immutable task fingerprint binding owner, Ultron.MW repository, pre-existing owner-authorized repair branch, base SHA, allowed src/test paths, three-attempt maximum, owner expiry and zero paid cost. The caller must independently verify owner policy, current stop state, GitHub App identity, permission scope, and the per-operation grant via an injected `authorize` service.
2. **Prepare candidate**: the optional `createCpuAutonomousRepairer` uses the existing pinned public Hugging Face CPU model when `ULTRON_PUBLIC_CPU_INFERENCE=enabled`. A different **trusted** proposer may be injected; its output never grants access. Previous failure output is capped and sanitized before it is supplied as data. An exact-context patch must pass existing source preflight.
3. **Reserve the patch**: the ledger stores the full bounded manifest and SHA-256 digest, advances `ready → patch-dispatched` by compare-and-swap and independently rereads PostgreSQL **before** GitHub mutation. Recheck owner grant and stop state.
4. **Write to the repair branch once**: reuse `applyPrPatch` for bounded atomic 1–6 file edits, only to an already-existing repair branch. The GitHub adapter rejects main, workflow and secret files, behind-main or drifting heads. It does **not** use `execSync`, `git add .`, shell interpolation, arbitrary filesystem writes, or persistent browser credentials.
5. **Readback**: independently check the branch head, parent SHA, one-commit diff, exact set of modified files and their before/after bytes. An unknown response **never** triggers a second PATCH or push. On restart, `patch-dispatched` only probes the immutable manifest.
6. **Test**: after `applied → verifying` is persisted, dispatch the repository's existing `Ultron core verification` workflow for the exact repair head. Observe only that specific branch/SHA and workflow run. Pending or unavailable verification does not promote success or repeat dispatch. A failing conclusion sends sanitized diagnostics back to the repairer for the next attempt, up to three; unsupported proposals or exhausted attempts stop safely.
7. **Publish**: a green exact-head test and fresh owner authorization permit one PR creation attempt using the existing scoped GitHub operation transport. Fresh PR and branch readbacks must match the stored SHA and fingerprint. A restart only reads the already-dispatched PR. **No auto-merge or deploy.**

Durable phases: `ready → patch-dispatched → applied → verifying → ready/verified/exhausted → publication-dispatched → complete`. The append-only history is maintained in `brain_autonomous_repair_events`; migration `0039_autonomous_repair_checkpoints.sql` adds PostgreSQL version and state guards. An uncertain write is retained as a reconciliation-required runtime disposition without erasing the dispatch intent.

## Composition contract

Trusted runtime wiring (illustrative, not a deployed endpoint):

~~~js
import {createAutonomousRepairPlan,runAutonomousRepair} from './src/autonomous-repair-loop.mjs';
import {createPostgresAutonomousRepairLedger} from './src/autonomous-repair-postgres-ledger.mjs';
import {createCpuAutonomousRepairer} from './src/autonomous-repair-model-adapter.mjs';
import {createAutonomousRepairGitHubAdapters} from './src/autonomous-repair-github-adapter.mjs';

// db and github operations must originate in an authenticated Hatchable /
// GitHub App composition root; not user input, MCP _meta, or model output.
const plan=createAutonomousRepairPlan(authorizedImmutableTask);
const ledger=createPostgresAutonomousRepairLedger({db});
const repairer=createCpuAutonomousRepairer({get:github.get});
const {patcher,verifier,publisher}=createAutonomousRepairGitHubAdapters({
  get:github.get,post:github.post,updateRef:github.updateRef,
  readFailureTrace:github.readSanitizedFailedJobLog
});
const outcome=await runAutonomousRepair({
  plan,ledger,repairer,patcher,verifier,publisher,
  authorize:ownerGrantAndStopStateReadback
});
// Only 'completed' means green exact-head source AND matching PR readback.
// It does not mean merged, deployed or externally accepted.
~~~

## Tests and acceptance

Focused tests:
- `npm run verify:fast` (fixed-command no-shell smoke runner, scrubbed child environment; not a release gate)
- `node --test test/autonomous-repair-*.test.mjs`
- Full syntax, regression and workflow checks: `node scripts/verify.mjs`

The existing read-only GitHub Verify workflow now runs the fast smoke before its full regression suite. The automated repair coordinator still treats only the independently observed full exact-head GitHub run as authority to publish.

Tests cover a fully successful attempt, failing-test self-correction, three-attempt exhaustion, response-loss recovery without duplicate patch/PR creation, strict source SHA, invalid proposals, owner-denied writes, pending CI, loss of persistence, secret-redacted diagnostics, and real PostgreSQL CAS/event immutability via PGlite.

**Live activation remains blocked** until a trusted runtime configures migration 0039, Hatchable DB access and independently authenticated GitHub App read/write services, an approved repair branch, a free model worker, an owner stop/grant readback, diagnostic log redaction, and end-to-end external source/CI/PR evidence. This PR is not acceptance evidence for universal browser execution or a fully unattended production deployment. Incremental paid spend: **$0**.
