# Mahoraga credential-mode control — Issue #67

The hosted Mahoraga adapter previously selected the configured fine-grained PAT first,
even when an App client, installation and key were also present. Source implementation
did not prove GitHub App execution; the independently observed issue-create canary
used the owner PAT identity.

## Explicit selection

Optional Hatchable config key `ULTRON_MAHORAGA_CREDENTIAL_MODE` has exactly
three supported values:

| Value | Behavior |
| --- | --- |
| Missing, empty, or `auto` | Existing compatibility behavior: use PAT when present, otherwise the GitHub App |
| `pat` | Use only a valid fine-grained PAT; fail before external requests when absent |
| `app` | Use only the GitHub App installation; never read or fall back to PAT |

Invalid settings fail closed with `mahoraga-auth-mode-invalid`.
The App path continues enforcing repository identity, exact head, expiration,
one-repository installation token and precise `contents:read`,
`issues:write`, `actions:write` permissions. This change does not
extend the App's authority, mint durable secrets, alter the credential values,
authorize main merges, or re-dispatch existing `sent`/`uncertain` actions.

## Acceptance sequence

1. Verify the App client ID, installation ID, signing key and target repository
   through a **separate authenticated owner-side channel**. Do not print keys
   in GitHub Issues, action logs, browser JavaScript or GitBook. Masked
   environment-variable presence alone is not proof.
2. Configure `app` in an isolated Hatchable experiment only after a valid
   scoped installation has been independently observed. Do not remove the PAT.
3. Complete read-only provider identity and permission checks, including
   wrong repository, absent permission, revoked key/installation, expired JWT,
   invalid mode and owner-stop cases. Ensure denied requests perform zero writes.
4. Execute one **fresh**, owner-approved, harmless issue-write canary using an
   immutable request key, and independently verify the real GitHub App actor
   and receipt. Keep this separate from previous PAT receipts.
5. Prove restart/response-loss reconciliation, no duplicate mutation,
   explicit stop and revocation. Compare an additional independently
   authenticated provider and typed receipts before closing #67.
6. Only after those gates, review changing production to `app`. Set it
   with the protected Hatchable owner configuration UI/API, not tracked
   source or a public issue. Recheck the effective mode and real actor;
   do not infer this from a successful deployment.

### Current documented limits

At the October 28 live read, the PAT, App client, installation and signing-key
settings appeared present, but a separate sanitized runtime probe did not
validate the App installation/key formats supplied to that probe. Whether
this was masking or invalid actual configuration is not established. The
runtime-selected PAT has an independently observed GitHub issue canary.
The independent adjudicator public JWK and event-bridge HMAC values were not
configured in that probe. No generalized two-provider authorization has been
accepted. Leave `auto` until the App gate is completed.

The source tests cover explicit App-over-PAT selection, exact PAT-only
fail-closed behavior, unrecognized-mode denial without external calls,
and preservation of compatibility behavior. These are **source tests**, not
production actor authentication or new credential-grant evidence.
