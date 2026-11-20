-- Owner-signed, immutable evidence binding one exact GitHub main commit to an
-- independently read-back Hatchable deployment manifest. This records proof;
-- it never deploys, rolls back, or grants provider authority.
CREATE TABLE IF NOT EXISTS brain_deployment_release_receipts (
 id BIGSERIAL PRIMARY KEY,
 receipt_key TEXT NOT NULL UNIQUE
  CHECK (receipt_key ~ '^[a-z0-9][a-z0-9-]{7,47}$'),
 target TEXT NOT NULL CHECK (target ~ '^hatchable-v[1-9][0-9]{0,8}$'),
 source_sha TEXT NOT NULL CHECK (source_sha ~ '^[a-f0-9]{40}$'),
 artifact_digest TEXT NOT NULL
  CHECK (artifact_digest ~ '^sha256:[a-f0-9]{64}$'),
 manifest_file_count INTEGER NOT NULL
  CHECK (manifest_file_count BETWEEN 1 AND 5000),
 independent_readback BOOLEAN NOT NULL CHECK (independent_readback),
 grant_id TEXT NOT NULL UNIQUE
  REFERENCES brain_authority_grants(grant_id) ON DELETE RESTRICT,
 policy_sha TEXT NOT NULL CHECK (policy_sha ~ '^[a-f0-9]{64}$'),
 profile_version INTEGER NOT NULL CHECK (profile_version > 0),
 stop_version INTEGER NOT NULL CHECK (stop_version > 0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(target,source_sha,artifact_digest)
);
CREATE INDEX IF NOT EXISTS brain_deployment_release_by_source
 ON brain_deployment_release_receipts(source_sha,created_at DESC);

CREATE OR REPLACE FUNCTION brain_deployment_release_immutable() RETURNS TRIGGER AS $$
BEGIN
 RAISE EXCEPTION 'deployment-release-receipt-immutable';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS brain_deployment_release_immutable_trg
 ON brain_deployment_release_receipts;
CREATE TRIGGER brain_deployment_release_immutable_trg
 BEFORE UPDATE OR DELETE ON brain_deployment_release_receipts
 FOR EACH ROW EXECUTE FUNCTION brain_deployment_release_immutable();

-- This is a receipt-recording capability only. Version the owner profile so
-- signatures made before the capability existed cannot authorize it.
UPDATE brain_owner_autonomy_profile
SET allowed_operations=allowed_operations ||
    jsonb_build_array('cloud.deploy'),
    version=version+1,
    updated_at=statement_timestamp()
WHERE id=1 AND owner='michaeljwilliams0123'
 AND NOT jsonb_exists(allowed_operations,'cloud.deploy');
