-- Short-lived, single-use, server-issued standing-policy WebAuthn challenges.
CREATE TABLE IF NOT EXISTS brain_standing_policy_challenges (
 policy_id TEXT PRIMARY KEY CHECK(policy_id ~ '^srp-[a-z0-9-]{8,64}$'),
 policy_sha256 CHAR(64) NOT NULL UNIQUE CHECK(policy_sha256 ~ '^[a-f0-9]{64}$'),
 credential_id TEXT NOT NULL REFERENCES brain_owner_passkeys(credential_id),
 policy_version INTEGER NOT NULL CHECK(policy_version>0),
 stop_version BIGINT NOT NULL CHECK(stop_version>0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 expires_at TIMESTAMPTZ NOT NULL,
 used_at TIMESTAMPTZ,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '5 minutes 1 second')
);
CREATE INDEX IF NOT EXISTS brain_standing_policy_challenges_expiry_idx
 ON brain_standing_policy_challenges(expires_at) WHERE used_at IS NULL;
