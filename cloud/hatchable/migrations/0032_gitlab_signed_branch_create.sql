-- Source-only opt-in expansion: signed GitLab branch creation.
-- Requires independently rehearsed 0029-0031 reconciliation; do not apply to
-- a partially migrated production profile or ledger without schema readback.
-- Does not append an operation to any owner profile, activate OAuth or grant.
ALTER TABLE brain_mcp_provider_writes
 DROP CONSTRAINT IF EXISTS brain_mcp_provider_writes_operation_check;
ALTER TABLE brain_mcp_provider_writes
 ADD CONSTRAINT brain_mcp_provider_writes_operation_check
 CHECK (operation IN ('graph.workbook.cell.write','github.issue.write',
                      'gitlab.branch.create'));
ALTER TABLE brain_owner_autonomy_profile
 DROP CONSTRAINT IF EXISTS brain_owner_autonomy_profile_allowed_operations_check;
ALTER TABLE brain_owner_autonomy_profile
 ADD CONSTRAINT brain_owner_autonomy_profile_allowed_operations_check
 CHECK (jsonb_typeof(allowed_operations)='array'
 AND jsonb_array_length(allowed_operations) BETWEEN 1 AND 22);
