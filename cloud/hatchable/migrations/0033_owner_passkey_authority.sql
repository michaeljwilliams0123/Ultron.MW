-- Owner passkeys authorize exact prepared cloud operations without placing a
-- private signing key in Hatchable. Initial enrollment still requires the
-- existing P-256 owner grant and the current profile/stop fences.
-- Schema-only prerequisite: no enrollment permission or profile version is
-- changed until the complete owner-verified enrollment flow is implemented.

CREATE TABLE IF NOT EXISTS brain_owner_passkeys(
 credential_id TEXT PRIMARY KEY
  CHECK(credential_id ~ '^[A-Za-z0-9_-]{16,1024}$'),
 public_key_spki TEXT NOT NULL
  CHECK(public_key_spki ~ '^[A-Za-z0-9_-]{80,1024}$'),
 label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 64),
 sign_count BIGINT NOT NULL DEFAULT 0 CHECK(sign_count BETWEEN 0 AND 4294967295),
 enrollment_key TEXT NOT NULL UNIQUE
  CHECK(enrollment_key ~ '^[a-z0-9-]{8,48}$'),
 enrollment_fingerprint TEXT NOT NULL UNIQUE
  CHECK(enrollment_fingerprint ~ '^[a-f0-9]{64}$'),
 enrolled_grant_id TEXT NOT NULL UNIQUE
  REFERENCES brain_authority_grants(grant_id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 last_used_at TIMESTAMPTZ,
 revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS brain_owner_passkey_challenges(
 grant_id TEXT PRIMARY KEY
  CHECK(grant_id ~ '^passkey-[A-Za-z0-9-]{16,96}$'),
 challenge TEXT NOT NULL UNIQUE
  CHECK(challenge ~ '^[A-Za-z0-9_-]{43}$'),
 credential_id TEXT NOT NULL REFERENCES brain_owner_passkeys(credential_id),
 actor TEXT NOT NULL CHECK(actor='mcp:ultron'),
 objective_id TEXT NOT NULL CHECK(length(objective_id) BETWEEN 8 AND 128),
 operation TEXT NOT NULL CHECK(operation='gitlab.branch.create'),
 resource TEXT NOT NULL CHECK(resource ~ '^sha256:[a-f0-9]{64}$'),
 policy_sha TEXT NOT NULL CHECK(policy_sha ~ '^[a-f0-9]{64}$'),
 administrative_change BOOLEAN NOT NULL CHECK(NOT administrative_change),
 profile_version BIGINT NOT NULL CHECK(profile_version>0),
 stop_version BIGINT NOT NULL CHECK(stop_version>0),
 expires_at TIMESTAMPTZ NOT NULL,
 used_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '10 minutes')
);

CREATE INDEX IF NOT EXISTS brain_owner_passkey_challenges_expiry_idx
 ON brain_owner_passkey_challenges(expires_at) WHERE used_at IS NULL;
