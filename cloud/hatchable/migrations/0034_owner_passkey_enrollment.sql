-- Activate the owner-signed bootstrap only. No passkey can authorize a
-- provider write before a verified registration and separate assertion.
-- PostgreSQL rejects bounded regex repetitions over 255. Correct the v66
-- credential constraints before any owner key is registered.
ALTER TABLE brain_owner_passkeys
 DROP CONSTRAINT IF EXISTS brain_owner_passkeys_credential_id_check;
ALTER TABLE brain_owner_passkeys
 ADD CONSTRAINT brain_owner_passkeys_credential_id_check
 CHECK(length(credential_id) BETWEEN 16 AND 1024 AND credential_id ~ '^[A-Za-z0-9_-]+$');
ALTER TABLE brain_owner_passkeys
 DROP CONSTRAINT IF EXISTS brain_owner_passkeys_public_key_spki_check;
ALTER TABLE brain_owner_passkeys
 ADD CONSTRAINT brain_owner_passkeys_public_key_spki_check
 CHECK(length(public_key_spki) BETWEEN 80 AND 1024 AND public_key_spki ~ '^[A-Za-z0-9_-]+$');

ALTER TABLE brain_owner_autonomy_profile
 DROP CONSTRAINT IF EXISTS brain_owner_autonomy_profile_allowed_operations_check;
ALTER TABLE brain_owner_autonomy_profile
 ADD CONSTRAINT brain_owner_autonomy_profile_allowed_operations_check
 CHECK (jsonb_typeof(allowed_operations)='array'
  AND jsonb_array_length(allowed_operations) BETWEEN 1 AND 23);

UPDATE brain_owner_autonomy_profile
 SET allowed_operations=allowed_operations || jsonb_build_array('owner.passkey.enroll'),
     version=version+1, updated_at=now()
 WHERE id=1 AND owner='michaeljwilliams0123'
  AND max_paid_cents=0 AND preset IN ('build','release')
  AND NOT jsonb_exists(allowed_operations,'owner.passkey.enroll');

CREATE TABLE IF NOT EXISTS brain_owner_passkey_enrollments(
 enrollment_key TEXT PRIMARY KEY
  CHECK(enrollment_key ~ '^[a-z0-9-]{8,48}$'),
 label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 64),
 challenge TEXT NOT NULL UNIQUE
  CHECK(challenge ~ '^[A-Za-z0-9_-]{43}$'),
 fingerprint TEXT NOT NULL UNIQUE
  CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 policy_sha TEXT NOT NULL
  CHECK(policy_sha ~ '^[a-f0-9]{64}$'),
 profile_version BIGINT NOT NULL CHECK(profile_version>0),
 stop_version BIGINT NOT NULL CHECK(stop_version>0),
 expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 used_at TIMESTAMPTZ,
 credential_id TEXT UNIQUE,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '10 minutes')
);
CREATE INDEX IF NOT EXISTS brain_owner_passkey_enrollments_expiry_idx
 ON brain_owner_passkey_enrollments(expires_at) WHERE used_at IS NULL;
