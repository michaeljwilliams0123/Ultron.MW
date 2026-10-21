# Issue #32 continual-improvement integration — 2026-10-20 ET

## Authority and starting evidence

- Authoritative repository: `michaeljwilliams0123/Ultron.MW`.
- Exact starting `main`: `bf79dd9251368cc47b170ddd55685bc695d5b64b`.
- GitHub Issue #32 remains the release and end-user acceptance ledger.
- This change uses the existing protected GitHub PR path. It adds no agent hierarchy, provider, deployment service, paid fallback, GitLab CI authority or public GitBook site.

## Confirmed defects

1. The local server persisted an unused `LearningLoop` snapshot that production never populated. `/api/state` and model `/learning status` therefore could report zero observations while the verified owner-action ledger contained eligible feedback. The status path now reads the actual experience and routing ledgers; old state files remain readable.
2. Git Hub artifact fingerprints hashed platform-specific checkout line endings. A clean Windows clone of exact `main` failed before the native tests because committed Linux hashes did not match CRLF materialization. Fingerprints now canonicalize text line endings while preserving every other content byte and the existing credential, path, provenance and authority checks.
3. Candidate evaluation had no reusable disposition contract binding source SHA, baseline/candidate fingerprints, receipt lineage, development/held-out separation, independent evidence, invariants, latency, observable cost and human intervention.
4. Windows verification could not execute either the mirror regression's bare `bash` command or the Linux-only downloaded `actionlint` binary. Tests now resolve Git for Windows Bash, and workflow lint selects the checksum-pinned official Linux or Windows amd64 release.

## Implemented selection boundary

`src/learning.mjs` now returns exactly one candidate disposition:

- **Accepted** — selection policy passed; publication has not occurred.
- **Rejected** — an invariant or critical held-out case regressed, or no targeted measured improvement exists.
- **Blocked** — a required execution dependency is absent. Reef-assisted candidates require a verified real Reef record.
- **Inconclusive** — terminal independent evidence is missing.

An Accepted disposition explicitly reports `publication: not-performed` and `releaseAuthority: github-protected-pr`. It cannot merge, deploy, grant credentials, activate inference or claim post-release improvement.

The Git-backed Harness Hub now references a versioned `continual-improvement` skill. The skill describes Serve → Observe → Grow → Commit without widening the existing read-only command allowlist.

## Reef and provider evidence boundary

| Stage | Observed in this tranche |
|---|---|
| Reef plugin guidance loaded | Yes |
| Reef Python runtime installed | No — `import reef` and `reef --help` fail |
| Git LFS present | Yes |
| Real Reef interaction recorded | No |
| Feedback matched by Reef receipt | No |
| Reef-assisted candidate generated | No |
| Baseline-versus-candidate production evaluation | No |
| Improvement selected and published | No |
| Improvement observed in the live user workflow | No |

The configured Hugging Face model ID `Xenova/distilgpt2` exists as a Transformers.js/ONNX text-generation repository. Repository metadata is not a pinned revision, downloaded-byte verification, local readiness or inference evidence. The optional adapter now fails closed until `ULTRON_HF_REVISION` supplies a full 40-character commit and records `model@revision` on responses. No model download or inference was performed for this change.

## Brancha hypotheses

| Hypothesis | Disposition | Evidence |
|---|---|---|
| H12 — Missing feedback continuity | **Confirmed** | The runtime status path read an unused ledger instead of the owner-action evidence ledger. |
| H13 — Structural validation is mistaken for intelligence | **Confirmed** | Hub SHA/Markdown checks prove admission integrity, not improved task outcomes; the new contract keeps these separate. |
| H14 — Candidate-generation bottleneck | **Confirmed** | Native fixed-policy candidates exist, but no real Reef runtime is available to generate a Reef-assisted candidate. |
| H15 — Evaluation weakness | **Confirmed** | Existing paths lacked one reusable development/held-out lineage and disposition contract. |
| H16 — Release-history inconsistency | **Confirmed** | Generic candidates were not required to name exact source and artifact fingerprints; the new contract requires both and still separates publication. |
| H17 — Excessive integration complexity | **Inconclusive** | Reef runtime overhead and benefit cannot be measured without a real isolated runtime and authorized model endpoint. |

## Verification and remaining acceptance

Focused tests cover cross-platform hub integrity, ledger convergence, candidate lineage, held-out leakage, critical regressions, missing evidence and Reef blocking. The existing full Verify workflow remains the required merge gate.

This tranche does **not** prove a real learning gain. Completion still requires a permitted execution receipt, matched feedback, a versioned candidate, comparable baseline and held-out results, protected GitHub publication, exact-main verification and repetition of the same end-user task with a measurably better result.
