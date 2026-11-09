# Cryptographic owner approval and scoped GitHub App issuance (source candidate)

Scope: Ultron.MW GitHub App operation admission. This complements the existing
Hatchable P-256 signed-grant verifier and the existing GitHub principal policy;
it does not introduce a second owner, a new GitHub identity, or new privileges.
**No live keys, deployment, or runtime activation are asserted by this PR.**

## Inbound envelope and authority boundary

An untrusted MCP request may carry
`params._meta.humanApprovalSignature` and the four-field approval payload.
Neither `_meta` nor the payload may name the trusted key, supply allowed
permissions, mint a token, or mark its own approval as verified.

The trusted server constructs:
- `expectedToolName`: an exact entry in the existing operation-profile registry
- `expectedTargetResource`: `ultron:github:michaeljwilliams0123/Ultron.MW:sha256:<SHA-256 of immutable operation plan>`
- `now`: a server clock; `secretKey` or P-256 public key from secret/key config
- `nonceStore`: a durable PostgreSQL atomic insert-if-absent nonce ledger

The signed canonical UTF-8 JSON is
`{"toolName":"...","targetResource":"...","timestamp":1794254400000,"nonce":"..."}`
in exactly that key order. `timestamp` is Unix milliseconds and must be within
five minutes of server time; `nonce` is a unique, cryptographically random
lowercase base64url identifier (at least 22 characters). HMAC uses SHA-256
with a high-entropy key at least 32 bytes and 64 lowercase hexadecimal
characters for the signature. ECDSA uses P-256/SHA-256 and 64-byte
IEEE-P1363 signatures encoded as 86-character unpadded base64url, matching
Hatchable's raw-signature convention. The verifier rejects extra or missing
claims, malformed encodings, substituted scopes, expired signatures, failed
signature checks, and duplicate or unavailable nonce claims.

Migration `0037_github_approval_nonces.sql` creates the unique-key ledger.
`createPostgresApprovalNonceStore({db})` atomically consumes a verified
nonce; database failure and duplicate claims DENY. Do not use a process-local
Set in production. Retain nonce records beyond possible clock-skew/replay
windows. Every user-approved write needs a fresh signed envelope.

## Trusted adapter wiring (not activated by this source change)

```js
import {
 createSignedGitHubAuthority,createScopedInstallationTokenProvider,
 createPostgresApprovalNonceStore,
} from './src/security/crypto_auth.mjs';
import {createUnifiedGitHubTransport} from './src/github-app-transport.mjs';

const nonceStore=createPostgresApprovalNonceStore({db:trustedPostgres});
const authority=createSignedGitHubAuthority({
  getEnvelope:async ({operation,planDigest}) =>
    await trustedOwnerGrantReader({operation,planDigest}),
  publicKey:trustedOwnerPublicKey,algorithm:'ecdsa-p256-sha256',
  expectedInstallationId:trustedInstallationId,nonceStore
});
const getToken=createScopedInstallationTokenProvider({
  appId:trustedAppId,installationId:trustedInstallationId,
  privateKey:trustedAppPrivateKey
});
const github=createUnifiedGitHubTransport({
  getToken,expectedInstallationId:trustedInstallationId
});
// Pass {authority, github, identity, control, ledger, clock} into
// executeGitHubOperation(plan, services). The identity, control and ledger
// adapters must also be trusted, authenticated and durable.
```

Only server-side credential stores supply private keys and HMAC secrets.
Never pass a secret, installation token, App private key, or raw HTTP
Authorization header through the MCP _meta envelope or a result body.
The token provider uses a short-lived RSA App JWT to POST
`/app/installations/{id}/access_tokens` with **both**
`repository_ids:[1424939667]` and the exact operation-profile
`permissions`. It rejects mismatched response repo lists, permissions,
expiry and identity. Tokens expire within one hour per GitHub's API.
No request for all repositories or all installed permissions is permitted.

A signed grant does not bypass the existing pause/revoke checks, plan validation,
action/path fences, ledger reservation, provider readback or protected merge
policy. The token provider alone does not authorize an action; the signed owner
authority must be used by the executor and tested in a live trusted runtime
before any production rollout.

## Verification

`node --test test/github-crypto-auth.test.mjs` tests HMAC and P-256
verification, tampering, scope changes, replay, malformed signatures,
uncertain nonce stores, token down-scoping and response rejection.
`node scripts/verify.mjs` remains the repository-wide regression gate.
Test-only cryptographic keys are generated in memory; no key material is
committed or exposed.

Acceptance remains pending until a trusted runtime wiring change is reviewed,
the migration is applied, configuration exists in the protected vault, and
live negative/positive canaries prove denial of tampered metadata, replay,
overbroad permissions, wrong repositories and expired approvals.
