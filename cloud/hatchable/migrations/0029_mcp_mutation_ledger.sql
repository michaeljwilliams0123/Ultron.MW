-- Exact MCP requests and their one-time adjudicator grants. This migration
-- does not enable an operation or change the owner's profile.
CREATE TABLE IF NOT EXISTS brain_mcp_mutations (
 action_key TEXT PRIMARY KEY,
 fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
 operation TEXT NOT NULL CHECK (operation IN ('mcp.queue.submit','mcp.task.control')),
 grant_id TEXT NOT NULL UNIQUE REFERENCES brain_authority_grants(grant_id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION brain_mcp_mutations_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'mcp mutation ledger is immutable';
END;
$$;
DROP TRIGGER IF EXISTS brain_mcp_mutations_guard ON brain_mcp_mutations;
CREATE TRIGGER brain_mcp_mutations_guard BEFORE UPDATE OR DELETE
 ON brain_mcp_mutations FOR EACH ROW EXECUTE FUNCTION brain_mcp_mutations_immutable();

ALTER TABLE brain_owner_autonomy_profile
 DROP CONSTRAINT IF EXISTS brain_owner_autonomy_profile_allowed_operations_check;
ALTER TABLE brain_owner_autonomy_profile
 ADD CONSTRAINT brain_owner_autonomy_profile_allowed_operations_check
 -- Keep this defensive ceiling synchronized with the 21 operations admitted
 -- by the current owner-profile catalog; reject unreviewed catalog expansion.
 CHECK (jsonb_typeof(allowed_operations)='array'
 AND jsonb_array_length(allowed_operations) BETWEEN 1 AND 21);
