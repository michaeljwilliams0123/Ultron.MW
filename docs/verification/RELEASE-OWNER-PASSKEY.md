# Owner-authorized deployment receipt ceremony (#525)

This is a proposed, review-required alternative owner authorization mechanism for the existing receipt ledger. It does not remove or modify the current P-256 envelope path, change the release-proof predicate, or grant standing authority. A passkey must already have been enrolled using the existing owner-signed enrollment procedure. The registered authenticator produces a fresh ES256 assertion with user presence and verification for each specific release. The server never creates an owner signature.

## Usage after approved merge and deployment
1. Open /release-owner.html on the canonical Hatchable origin and authenticate as the owner.
2. Use the actual live deployment version, protected-main SHA, independently computed full provider manifest digest and file count. Verify the genuine main source inventory signature externally as before. No stale v157 signature or proof can be reused for the new deployment.
3. Check live release: the server re-reads canonical main and the actual manifest and requires the existing native or independently authenticated source attribution. The challenge binds the exact scope and current authority/stop versions.
4. Review the displayed scope, then personally authorize using the enrolled authenticator. No agent or CI job may emulate this user gesture.
5. A single atomic statement consumes the challenge, advances the credential counter, inserts the scoped grant and immutable receipt, and records an authority event. The browser sends one mutation only and then automatically reconciles through a read-only receipt query and a fresh canonical release-proof query. An uncertain outcome is reconciled, never automatically resubmitted.
6. Production acceptance requires verified:true on the exact source, target and digest, independently observed after the receipt. This PR does not certify the current production release.

The old signing path remains supported. Existing GitHub and Cloudflare webhook work (draft #548) remains separately reviewable. Event delivery can wake read-only verification but must never create or renew owner authority. A scoped machine-to-machine read-only reconciliation contract, webhook deduplication and a deployed end-to-end run remain required for unattended event-driven verification. No production key, passkey proof, or bearer token belongs in workflow artifacts or logs.

## Verification
Run the focused tests and the full protected Verify workflow. Real PGlite tests cover the transactional claim and reconciliation; browser tests must use a staging fixture or the owner's real device after the approved release. No simulated assertion or mock database result constitutes production authorization.
