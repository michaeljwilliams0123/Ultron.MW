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
- The legacy `scripts/reef-paired-cases.mjs` pipeline has now been **changed**:
  its candidate-executing child receives no HMAC key and no longer signs an
  observation or exposes a signer oracle. The controller accepts only a
  bounded, structurally checked runner frame correlated to a one-use nonce;
  the controller computes case scores from that untrusted frame.
- **A nonce is not cryptographic provenance or independent evidence.** Case
  harness logic and candidate modules still share the restricted child
  process, and a malicious candidate may influence the harness's observations.
  The parent still lacks a separate trusted behavioral oracle. Therefore
  `reefRunVerified:false`, `heldoutCertified:false`, and
  `eligibleForMerge:false` remain mandatory.
- The signer co-location finding has been addressed at source level, but the
  broader #201 trusted-scoring, sandbox, cleanup, independently reviewed
  security acceptance, and protected release gates remain **OPEN**.

## Test-first evidence

- On 2026-11-02, RED `55a70760` showed policy-denial classifier spoofing;
  GREEN `897c8120` restored primitive-only native error matching.
- RED `7ce137a6` proved a candidate could forge a completed worker result
  and exit without running the policy; GREEN `b481d52e` added one-use
  completion correlation while retaining untrusted-output status.
- RED `6934aba0` demonstrated a malicious candidate could interfere with
  legacy HMAC signing in the same process; GREEN `d75dcd41` removed signing
  and the key from that child. GitHub exact-head core, fixed comparison,
  Reef runtime probe and Council checks all passed at `d75dcd41`.
- These fixes are incremental evidence, **not** a positive security
  certification or protected merge authorization.

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
