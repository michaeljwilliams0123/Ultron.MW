-- Immutable owner-enrolled standing release policy and atomic autonomous receipt claims.
-- Separate from per-release owner passkey grants; never grants deployment or branch-protection authority.

CREATE TABLE IF NOT EXISTS brain_standing_release_policies (
 id BIGSERIAL PRIMARY KEY,
 policy_id TEXT NOT NULL UNIQUE CHECK (policy_id ~ '^srp-[a-z0-9-]{8,64}$'),
 policy_version INTEGER NOT NULL UNIQUE CHECK (policy_version > 0),
 policy_sha256 CHAR(64) NOT NULL UNIQUE CHECK (policy_sha256 ~ '^[a-f0-9]{64}$'),
 owner_handle TEXT NOT NULL CHECK (owner_handle = 'michaeljwilliams0123'),
 owner_credential_id TEXT NOT NULL,
 stop_version INTEGER NOT NULL DEFAULT 1 CHECK (stop_version > 0),
 max_releases INTEGER NOT NULL CHECK (max_releases BETWEEN 1 AND 100),
 releases_consumed INTEGER NOT NULL DEFAULT 0 CHECK (releases_consumed >= 0),
 repository TEXT NOT NULL CHECK (repository = 'michaeljwilliams0123/Ultron.MW'),
 repository_id BIGINT NOT NULL CHECK (repository_id = 1424939667),
 project_id TEXT NOT NULL CHECK (project_id = 'proj_A6GCXRSKizko'),
 environment TEXT NOT NULL CHECK (environment = 'production'),
 branch_ref TEXT NOT NULL CHECK (branch_ref = 'refs/heads/main'),
 workflow_ref TEXT NOT NULL,
 council_app_id BIGINT NOT NULL DEFAULT 5765239 CHECK (council_app_id = 5765239),
 max_cost_usd INTEGER NOT NULL DEFAULT 0 CHECK (max_cost_usd = 0),
 enabled BOOLEAN NOT NULL DEFAULT FALSE,
 policy_json JSONB NOT NULL,
 owner_signature JSONB NOT NULL,
 enrolled_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
 not_before TIMESTAMPTZ NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 revoked_at TIMESTAMPTZ,
 revoked_reason TEXT
);

CREATE INDEX IF NOT EXISTS brain_standing_release_policies_active_idx
 ON brain_standing_release_policies(policy_version DESC)
 WHERE revoked_at IS NULL AND enabled = TRUE;

CREATE TABLE IF NOT EXISTS brain_autonomous_release_claims (
 id BIGSERIAL PRIMARY KEY,
 policy_id TEXT NOT NULL REFERENCES brain_standing_release_policies(policy_id) ON DELETE RESTRICT,
 policy_version INTEGER NOT NULL CHECK (policy_version > 0),
 policy_sha256 CHAR(64) NOT NULL CHECK (policy_sha256 ~ '^[a-f0-9]{64}$'),
 jti TEXT NOT NULL UNIQUE CHECK (length(jti) BETWEEN 8 AND 256),
 workflow_run_id BIGINT NOT NULL CHECK (workflow_run_id > 0),
 workflow_attempt INTEGER NOT NULL CHECK (workflow_attempt > 0),
 project_id TEXT NOT NULL CHECK (project_id = 'proj_A6GCXRSKizko'),
 target TEXT NOT NULL CHECK (target ~ '^hatchable-v[1-9][0-9]{0,8}$'),
 source_sha CHAR(40) NOT NULL CHECK (source_sha ~ '^[a-f0-9]{40}$'),
 artifact_digest TEXT NOT NULL CHECK (artifact_digest ~ '^sha256:[a-f0-9]{64}$'),
 deployment_version INTEGER NOT NULL CHECK (deployment_version > 0),
 receipt_id BIGINT REFERENCES brain_deployment_release_receipts(id) ON DELETE RESTRICT,
 decision TEXT NOT NULL CHECK (decision IN ('authorized','human-required','denied')),
 reason TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(project_id, source_sha, artifact_digest, deployment_version)
);

CREATE INDEX IF NOT EXISTS brain_autonomous_release_claims_sha_idx
 ON brain_autonomous_release_claims(source_sha, created_at DESC);

CREATE OR REPLACE FUNCTION brain_autonomous_release_claim_immutable() RETURNS TRIGGER AS $$
BEGIN
 RAISE EXCEPTION 'autonomous-release-claim-immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS brain_autonomous_release_claim_immutable_trg
 ON brain_autonomous_release_claims;
CREATE TRIGGER brain_autonomous_release_claim_immutable_trg
 BEFORE UPDATE OR DELETE ON brain_autonomous_release_claims
 FOR EACH ROW EXECUTE FUNCTION brain_autonomous_release_claim_immutable();

-- Durable dispatch admission; native recovery is independent.
CREATE TABLE IF NOT EXISTS brain_release_dispatch_nonces (
 nonce TEXT PRIMARY KEY,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS brain_release_dispatch_windows (
 source_sha CHAR(40) NOT NULL CHECK(source_sha ~ '^[a-f0-9]{40}$'),
 window_id BIGINT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(source_sha,window_id)
);
