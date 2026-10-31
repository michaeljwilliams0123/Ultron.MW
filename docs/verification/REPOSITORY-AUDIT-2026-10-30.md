# Repository, workflow and reference audit — October 30, 2026

## Baseline and scope

Audited GitHub `main` at `a5aae26cd5e612ddad26a669a92b36092271f7a3`
from a clean checkout: 366 tracked paths, 23 scripts, 10 workflows and 112 test
files. The audit covered entrypoint/reference inventory, workflow events and
permissions, checkout/action pinning, script syntax/regressions, dependency
advisories and active operator/acceptance documentation. This is not a fresh
owner-browser run or a blanket security certification.

## Findings and disposition

| Finding | Impact | Action in this PR |
| --- | --- | --- |
| P2: active browser/runbook guidance still required two sites, private-account MFA and broader hosted/offline acceptance | Reintroduces superseded gates into #65 and suggests completed #66/#67 work is pending | Link the live issue contracts, use one supervised controlled app, retain runtime consent/no-replay controls and distinguish future capabilities |
| P2: the live-audit playbook required keeping #65–#69 open and described #68 as active P1 research | Contradicts the owner's accepted scoped milestones and research disposition | Replace stale status paragraphs with a dated issue table; public observations do not decide issue closure |
| P3: README/architecture omitted the durable backend or described Mahoraga as historical-only, automatic retries as universally absent and cloud-pr as the only source writer | Misstates the current lane and permission boundaries | Describe the distinct GitHub, Hatchable and local browser lanes and the actual writer jobs |
| P3: handbook limitations still said GitBook/Git Sync had never been created and presented old setup/automation assertions as current | Confuses historical preparation with a current operator action | Retain the linked prior sync evidence and require fresh publication readback for later documentation revisions |
| Comment-trigger workflow fan-out | Three workflows subscribe directly to every new issue comment; unrelated comments yield skipped runs | Already addressed by [open PR #164](https://github.com/michaeljwilliams0123/Ultron.MW/pull/164); workflow files are unchanged here |

The [acceptance summary](../ACCEPTANCE-STATUS.md) is navigation for the dated
owner decisions. The live #65 body remains its closure contract. Historical
verification records retain their observations and limitations; the active
guides explicitly separate those records from current work requirements.

## Executed baseline checks

| Check | Observed result |
| --- | --- |
| `node scripts/audit-route-references.mjs` | Exit 0; 362 text-source files, 150 routes, 920 references; zero unresolved module references, missing retained routes or unreferenced candidates |
| `node scripts/verify.mjs` on Node 24.22.1 / Linux | Exit 0; 758 tests: 746 passed, 0 failed, 12 skipped |
| `bash scripts/lint-workflows.sh` | Exit 0 using the repository's checksum-pinned actionlint |
| `node scripts/verify-audited-lockfile.mjs` | Exit 0; recorded production graph fingerprint matched |
| `npm audit --omit=dev --audit-level=high --json` | Exit 0; zero reported vulnerabilities in the returned audit |
| Relative Markdown file-link scan, excluding fenced examples and remote URLs | All 53 baseline links resolved |

The 12 local skips are not passed acceptance cases. PostgreSQL acceptance runs
separately in Verify's ephemeral service. Workflow review found declared job
permissions, timeouts, immutable action pins, checkout credential suppression
and no direct `github.event` interpolation in shell `run` blocks. These checks
do not prove private service readiness or replace an owner-host acceptance run.

Candidate validation at `f69cc6d1bc72b3991035edb5636be440fd65e466` before publication also passed: 746 tests with zero
failures and the same 12 skips; 364 text-source files, 150 route entries and
930 references with zero unresolved/retained-route errors; all 64 relative
Markdown file links resolved. The candidate contains 11 Markdown files.

No route was removed: the source inventory supplied no deletion candidate.
This PR changes documentation only. It leaves workflow triggers, schedules,
runtime behavior, credentials, production control and required checks in place.
GitBook publication of the changed pages must be independently checked after
the source change is merged; this audit does not assert that publication.
