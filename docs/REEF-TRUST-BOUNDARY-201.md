# Reef #201 — Separate candidate execution and trusted evaluation (increment)

This source-only increment deliberately does **not** claim completion of #201,
qualifying independent security review or Reef pre-merge acceptance.

## Current evaluated design

- `scripts/reef-candidate-only-child.mjs` is a distinct, restricted
  child process running candidate source with only the selected input.
- `src/reef-separated-admission.mjs` owns the test expectation, the score,
  temporary workspace, timeout, output limit, and zero-paid-cost rule.
- The child receives **no** benchmark expected status, signing key, GitHub
  credential, owner token, or inherited provider environment secret.
- Raw child results are *untrusted diagnostics*, not a cryptographically
  authenticated statement of candidate behavior. False stdout can still
  be possible under a sufficiently malicious candidate; no parent-owned
  trusted oracle can be established by simply trusting child text.
- Every returned record explicitly sets `eligibleForMerge:false`,
  `independentlyCertified:false`, `resultIsUntrusted:true` and
  `signingKeyInChild:false`. No production release operation reads this
  prototype to authorize a change.
- The existing `scripts/reef-paired-cases.mjs` pipeline is **unchanged**.
  Its unresolved signer/candidate same-process trust boundary remains a
  release blocker until genuinely independent execution and trusted scoring
  are built and empirically validated.

## Test-first evidence

- A regression suite drives ordinary accept/reject inputs, early-exit
  stdout forgery, inherited environment secret isolation, and denial of
  positive-cost and unapproved methods.
- The regression was committed first (RED), followed by a restricted worker
  and parent evaluator (GREEN); use the exact-head CI report for proof.
- The test does not establish case confidentiality from an adversary that
  controls candidate source and process stdout. It only demonstrates a
  process boundary and owner-controlled scoring on the tested cases.

## Next security acceptance steps

1. Execute candidate-only logic through a separately controlled OS/container
   sandbox with no evaluator or signer artifacts, no ambient credentials,
   no unauthorized networking and enforced resource limits.
2. Keep the actual test-case manifest, expected outcomes, validation logic,
   scoring and cryptographic receipt generation in a separate trusted parent.
3. Make each case outcome observationally grounded through a trusted
   adversarial harness rather than candidate-authored stdout claims.
4. Test host-module mutation, forged stdout, candidate file-system attacks,
   network exfiltration, process/worker escape, timeouts and invalid artifacts.
5. Require independent security adjudication and a controlled production
   canary before making `reefRunVerified` or `eligibleForMerge` true.

No tokens, branch-protection rules, project secrets, production deployment,
cost ceiling or review permissions were changed for this increment.
