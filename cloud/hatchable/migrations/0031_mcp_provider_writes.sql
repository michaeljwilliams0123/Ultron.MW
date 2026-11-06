-- One-shot provider dispatch fence. An unresolved target blocks subsequent
-- writes from this gateway until an owner resolves the external outcome.
ALTER TABLE brain_owner_autonomy_profile
 DROP CONSTRAINT brain_owner_autonomy_profile_allowed_operations_check;
ALTER TABLE brain_owner_autonomy_profile
 ADD CONSTRAINT brain_owner_autonomy_profile_allowed_operations_check
 CHECK (jsonb_typeof(allowed_operations)='array'
 AND jsonb_array_length(allowed_operations) BETWEEN 1 AND 21);
CREATE TABLE IF NOT EXISTS brain_mcp_provider_writes (
 action_key TEXT PRIMARY KEY,
 operation TEXT NOT NULL CHECK (operation IN ('graph.workbook.cell.write','github.issue.write')),
 fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
 resource_key TEXT NOT NULL CHECK (resource_key ~ '^[a-f0-9]{64}$'),
 grant_id TEXT NOT NULL UNIQUE REFERENCES brain_authority_grants(grant_id),
 profile_version BIGINT NOT NULL CHECK (profile_version >= 1),
 stop_version BIGINT NOT NULL CHECK (stop_version >= 1),
 status TEXT NOT NULL CHECK (status IN ('reconcile-required','observed')),
 evidence JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK ((status='observed') = (evidence IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS brain_mcp_provider_one_unresolved_target
 ON brain_mcp_provider_writes(resource_key) WHERE status='reconcile-required';
