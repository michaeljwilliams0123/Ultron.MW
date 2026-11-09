---
description: "Cloud-first owner-controlled execution, release states, and passkey authorization rollout."
---
# Cloud-first execution and owner passkeys

## Current live baseline

Ultron's primary owner console is [Hatchable](https://ultron-mw-cloud.hatchable.site). GitHub [Ultron.MW](https://github.com/michaeljwilliams0123/Ultron.MW) is the authoritative source and required CI system. Private GitLab project 87884831 is a separately authenticated integration and source mirror; this handbook is Git-synced from the GitHub `gitbook/` directory.

At the November 9, 2026 deployment checkpoint, Hatchable v65 exposes 32 active functions, an authenticated owner session, and a durable hourly cloud task lifecycle. The current canonical GitHub and GitLab main SHA is `d94b0962d82a2f7d93c8124e5f19d3f6925a9e36`. A real owner-authorized internal cloud decision was persisted as note 13 and event receipt 1731. That internal receipt does not prove an external GitLab write.

## Bounded external action pathway

1. The owner selects an exact source SHA and durable idempotency key in the Hatchable console.
2. The cloud API prepares an operation-specific request containing target, fingerprint, policy digest and the current owner profile/stop versions.
3. The owner authorizes the exact grant. Currently this is an externally issued P-256 signed envelope; no signing private key belongs in Hatchable.
4. The provider engine checks the $0 paid-spend policy, signed grant and current stop/profile fence, atomically claims the write, verifies source/CI preflight and sends no more than one provider mutation.
5. The same engine performs independent GitLab branch readback and records a durable observation. Ambiguous acknowledgments go to read-only reconciliation, never a duplicate POST.

A configured OAuth connection, authenticated login, green CI, or advisory council vote is **not** a substitute for the specific owner-signed authorization.

## Passkey security foundation — source candidate

[PR #327](https://github.com/michaeljwilliams0123/Ultron.MW/pull/327) introduces the pure ES256 WebAuthn assertion verifier and schema-only registered-passkey and one-use-challenge tables. This is an inert prerequisite, **not** a live passkey enrollment or execution implementation. It does not modify owner operation permissions, profile version, stop version, credentials, or payment settings.

Before passkey execution can be activated, implement an owner-signed initial registration, validate credential registration attestation/public-key binding, use the exact prepared policy/challenge with verified origin, RP, user verification and expiration, atomically consume a one-shot challenge under current owner profile and stop fence, and then reuse the existing provider claim/readback engine. Keep the signed-envelope recovery path available.

## Release and recovery

Each change follows source branch → focused tests → exact-head GitHub CI → authorized squash merge to main → source-matched Hatchable dry-run → deploy → readback of live version and schema → authenticated owner action and independent persisted effect. The GitLab CI receipt can be supplementary; it must use the identical SHA and is not a release authorizer. GitBook sync is downstream documentation only.

If a write response is lost, reconcile by the original key and grant identifier. Do not initiate another provider POST. If the owner pauses runtime or increments stopVersion, new work is denied even when a previously issued grant remains cryptographically valid. Roll forward with an audited PR or revert to a known-good deployed version; do not equate a passed source test with runtime acceptance.

The approved incremental paid spend ceiling is **$0**, including paid provider calls, retries, and fallbacks. Never publish private keys, OAuth secrets, signed envelopes, or raw auth tokens in issue comments, docs, or logs.
