# Named Codex authors

## Outcome
Ultron displays exactly two callable authors, **Mike's Codex** (`mike-codex`)
and **Destiny's Codex** (`destiny-codex`). An author has a stable public
fingerprint, separate from a Work automation binding and session observation.
The current Work account enrolls Destiny. Mike remains explicitly unbound
until his own authenticated account enrolls; never route him to Destiny.

## Design
Extend the existing owner-confirmed proposal launcher with `/codex <name> <task>`.
It creates a normal PR containing a strict task envelope bound to the issue,
author fingerprint, automation fingerprint, main SHA and objective digest.
A narrowly filtered Work webhook receives the PR, validates trusted main and
the owner request, claims the task create-only, performs the bounded task on
that PR branch, then persists a correlated receipt. No extra hosting or model
API. Keep the existing proposal and exact-code-manifest flows unchanged.

The console renders registry data with textContent and offers a named call
button. Unknown, ambiguous and unbound authors fail before publication.
Enrollment is not proof of delivery or proof of an OpenAI account identity.
Raw environment/session/account IDs and credentials never enter public source.

## Lessons carried from Mahoraga
Shared GitHub identity is not Codex account identity. Hash opaque IDs locally.
Preserve exact-source evidence, request digests, create-only claims, terminal
receipts, explicit uncertain outcomes, and separate enrollment from live proof.
Use current Mahoraga identity and trust scripts as reference only; no runtime
dependency, copied credentials, private payloads or imported authority.

## Verification and delivery
Test aliases, unbound/unknown targets, malformed/tampered envelopes, author
swaps, duplicate delivery, stale source, changed owner requests and receipts.
Run the full existing verifier and required exact-head CI; squash through
normal branch protection. Then submit a real harmless named task through the
public Issue-to-PR path and inspect independent Work completion evidence.
Report Mike's missing enrollment and any delivery gap explicitly.
