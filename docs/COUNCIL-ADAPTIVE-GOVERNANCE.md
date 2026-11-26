# Adaptive Council Governance v3 — staged migration

The owner approved a risk-scaled policy: 4/7 administrative, 5/7 low, 6/7
standard, 7/7 high, and 7/7 plus owner authority for critical work. Mandatory CI,
exact head/base, dedicated publisher, zero paid spend, and material veto remain.

## Phase 1 (this PR): non-authoritative shadow

Trusted main evaluates the existing gate as before. A separate v3 shadow
decision is recorded in council-release-gate.json and the job summary.
It never changes the required check or authorizes an effect. The highest risk
path wins, including rename sources; unknown paths default high. Auth,
governance, release proof, standing policies and passkey paths are critical.
Only explicit, evidence-backed abstentions/advisories can be non-veto dissent.
Existing untyped HOLD/REVISE, unknowns, source findings, incomplete scan
coverage, invalid attestations and unexplained governor holds remain blocked.
One explicitly observed free-provider outage can be retained separately from
role approval. High/critical decisions stay held until their enhanced evidence
and authorization contracts are implemented. Static screening is not proof of
absence of vulnerabilities. No independent GitHub identity is inferred from
shared-controller signatures.

## Phase 2: diagnostic publisher and consumer contract

The trusted Gate App emits an additive exact-head/base/PR shadow JSON record and SHA-256 digest in its existing check summary. Both byte-identical release-proof consumers expose a diagnostic-only readback parser with pinned App identity, scope, policy-version, quorum and digest validation. No shadow output is a production proof, even on a green check; legacy proof output and digest remain unchanged. The active v3 proof contract and real deployment canaries remain separate prerequisites.

## Required subsequent changes (before activation)

1. Collect real shadow output for each risk tier and typed dissent; implement
   authenticated structured advisory resolution and mandatory material veto.
2. Version the dedicated Gate App's output and bind exact PR, head, base,
   tested integration, policy revision, evidence digest and decision. Preserve
   the existing required check name/source while migrating consumers.
3. Upgrade Hatchable release-proof, deployment attestation, standing release
   authorization, and any hardcoded 7/7 consumers. Test legacy receipt
   compatibility and rejection of forged, stale, downgraded or incomplete v3
   output. Deploy the compatible consumer before emitting v3 success.
4. Integrate #551's bounded exact-head HOLD remediation; do not increase paid
   spend or retry unboundedly. Rebase related branches after each merge.
5. Activate only through a separately verified governance PR under the
   existing policy. No candidate self-approval or protection removal.
6. Verify real 4/7, 5/7 and 6/7 eligible canaries plus material dissent,
   critical authorization, provider outage, and rollback negative controls.
   Report historical v2 proof separately. If any proof is unverified, stop.

Verification: node --test test/council-adaptive-governance.test.mjs; full
node scripts/verify.mjs and required CI. Production rollout is not established
by shadow eligibility. Keep budget $0 and the dedicated publisher unchanged.
