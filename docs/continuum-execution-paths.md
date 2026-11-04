# Ultron Continuum — execution-path comparison and chosen release slice

The **Brancha local canvas is unavailable when the connected desktop hosts are offline**. Preserve the three distinct implementation directions here without substituting a fake local canvas or claiming any remote hosted Brancha project.

## Shared goal

Move beyond in-memory scenarios and light note writes to **real provider effects, independent postconditions, protected source merges, and deployed runtime verification**, while keeping the existing $0 paid-provider ceiling, owner-bound capability and stop controls.

## Direction A — Source-only synthetic release simulator

**Architecture:** use `runDeepTask` in Node with in-memory ledger and fake GitHub steps. This already exists in PR #242.

- Strength: fast, exhaustive regression/fault injection at every step.
- Weakness: fake readback does not establish the external side effect.
- Decision: retain for CI, but **do not select** as production proof.

## Direction B — Authoritative provider verification (selected)

**Architecture:** add an owner-only Hatchable GET route that reads the committed `mahoraga_actions` record and then performs a **fresh authenticated GitHub REST GET** for repository identity and the exact issue. Compare durable intent, issue number, GitHub URL, title, complete body and immutable marker.

- Strength: real external readback with no new token, mutation or spend; no accidental retry after an uncertain ACK. Reuses proven Mahoraga credential and GitHub REST contract.
- Risk: GitHub 403/404/timeouts remain `reconcile-required`, never interpreted as successful completion. Provider readback cannot itself prove independent evaluator identity, code patch quality or merge eligibility.
- Evidence: regression for matching provider state, drift, wrong repository, outage, unknown state, repeated read-only checks, owner denial. After protected squash, deploy to existing Hatchable and probe known live Mahoraga issue #1190.
- Selected because it closes an **observed** missing verification boundary with a narrow, reversible and auditable multi-file change.

## Direction C — Autonomous multi-file source patch and protected release

**Architecture:** connect the existing `src/pr-brain-multifile.mjs` model generation and `src/repair-pr-reconciler.mjs` GitHub lifecycle to a separately authenticated durable cloud executor. Use Git tree/commit operations for atomic multi-file writes, exact-head CI, branch-policy eligibility, release disposition and real rollback/readback.

- Strength: reaches the desired full engineering autonomy.
- Prerequisites: transport-specific write admission, persistent prepared-commit manifest, immutable source fingerprint, reliable task lease, external execution identity, evaluation and protected branch gates, hard resource budgets and confirmed rollback.
- Risk: GitHub App token permissions and network returns may differ from source-only assumptions; retries after unknown writes require authoritative Git object reconciliation. Do not automatically promote the broad executor from a successful issue-create canary.
- Decision: **next implementation after Direction B**, not a claim that C06/C03 pilot acceptance has already happened.

## GitHub API contract (Context7)

GitHub REST documentation specifies `GET /repos/{owner}/{repo}/issues/{issue_number}` for a direct issue readback. The response includes issue number, title, body, HTML URL and the `pull_request` discriminator. Transfer/removal can yield 301/404/410, which must not be treated as confirmed absence or an invitation to repeat a write.

For an atomic multi-file source update, GitHub's Git database API uses: create blobs, create a tree with `base_tree`, create a commit pointing to the new tree, and update the branch reference. **Do not** create a tree without a base tree and accidentally delete unrelated source. This documented sequence is the basis for Direction C's future implementation.

## Acceptance classification

A successful GitHub issue verification is an **observed provider effect**. It is not proof of an autonomous patch, live two-PR release, deployed end-to-end rollback, signed Destiny/Codex completion or a multi-day SLO. Keep parent issues #185, #188, #195 and #204 open until their distinct criteria are independently verified.
