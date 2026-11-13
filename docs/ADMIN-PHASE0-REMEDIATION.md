# Ultron Admin App — Phase 0 Remediation

**Source target:** `michaeljwilliams0123/Ultron.MW` (repository ID `1424939667`).
**Secondary App developer:** `michaeljwilliams0123ultron` (GitHub user ID `354634860`).
**State:** source/schema candidate; **not a production Admin authorization**.

## Decisions

- **0040:** preserve the existing SQL constraints that admit both the canonical personal repository and retired organization *for historical immutable receipts only*. Correct the outdated comment to state that **all new operations must target the canonical primary-owner repository**. No DML migration, ownership transfer, or historical receipt rewrite is justified; proposed `org_registry` and `organization_transfer_audit` do not exist.
- **0041:** migration number already occupied by `0041_github_pr_comment_executions.sql`, applied in production. Do not overwrite or renumber it.
- **0046:** new `0046_admin_passkey_stepup.sql` adds dedicated Admin step-up tables. This leaves `0033`'s `gitlab.branch.create`-only and `administrative_change = false` constraints untouched.

## Authorization model

`brain_admin_passkey_capabilities` defaults every permission to **false**. To enable a specific combination, a short-lived grant must match the exact passkey ID and exact bits:

`owner-passkey:<credential-id>:admin=<true|false>:vault=<true|false>:events=<true|false>`

The trusted runtime must also verify the actual signed owner grant. A matching database row alone is not cryptographic approval. Capability consumers must query `brain_admin_passkey_effective_capabilities` rather than raw booleans; the view returns false after expiry or passkey revocation.

`brain_admin_passkey_stepup_challenges` permits only the explicitly named Admin Executor operations, owner-vault custody access and signed-event emission. Every challenge is bound to a single passkey, owner grant, actor, exact plan-resource digest, policy SHA, profile version, stop version and a **five-minute maximum**. Inserted challenges start unverified and cannot be consumed before verification. Used challenges cannot be updated or deleted.

**Important:** this DDL cannot verify a WebAuthn signature, authorize secrets access, mint GitHub installation tokens, expand owner policy, or authorize actions on its own. Those require the separate trusted verifier and runtime wiring. No default Admin capability is enabled by deployment.

## Verification

In an isolated clean checkout with `@electric-sql/pglite` installed:

```sh
node scripts/verify-phase0-gate.mjs
```

The gate pins the baseline contract blob hashes; compares historical 0040 SQL tokens with Git HEAD to ensure comment-only changes; checks migration names and default-deny step-up policy; examines changed source files for key-like material without printing secrets; and executes real PostgreSQL plus cryptographic tests. It must fail when the database engine is missing or any regression fails. Passing means **source/schema only**, never live deployment acceptance.

## Outstanding production custody blocker

A read-only Actions-secret-name inspection observed `ULTRON_SECONDARY_ADMIN_PRIVATE_KEY` **in the primary production repository's Actions secrets**, contrary to the target of isolating this App's credential custody from `Ultron.MW`. The associated private-key PEM is also retained on the authorized Windows computer; it is not tracked in this repository. No value was disclosed in this audit.

An App cannot store its own private key inside GitHub's App metadata. Before credential-custody acceptance, create and verify a separate, restricted Admin credential service (such as an environment secret owned by the secondary account in a dedicated deployment repository or isolated vault), migrate *without printing* the key, prove the service can mint a correctly downscoped token, change all consumers, rotate or retire prior credentials safely, then remove the primary-repository copy. Do not delete the last functional credential or expose the PEM through code, issues, logs, environment dumps or PRs.

**Production gate remains BLOCKED** until isolated custody, owner WebAuthn enrollment and genuine step-up verification, runtime caller identity resolution, App installation permissions, durable nonce consumption, and negative live canaries are independently verified. No production database migration or Admin operation is executed by this source PR.

**Spending ceiling:** $0 paid usage. No changes to primary repository ownership or security protections.
