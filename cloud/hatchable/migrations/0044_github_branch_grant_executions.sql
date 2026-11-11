-- #412 Option A: permit an owner-signed, grant-bound branch execution in the
-- immutable GitHub execution ledger. Historical branch rows (grant_id NULL)
-- and C04 pull-request comment rows keep their existing shape and checks.
-- No operation is enabled here: repair.branch.create is NOT added to any
-- default, seed or owner profile; the owner must select it explicitly.
ALTER TABLE github_idempotent_executions
  DROP CONSTRAINT github_idempotent_executions_target_shape_check;

ALTER TABLE github_idempotent_executions
  ADD CONSTRAINT github_idempotent_executions_target_shape_check
  CHECK (
    (target_kind='branch' AND target_branch IS NOT NULL AND
      target_number IS NULL AND body_sha256 IS NULL) OR
    (target_kind='pull_request_comment' AND target_branch IS NULL AND
      target_number BETWEEN 1 AND 999999999 AND
      body_sha256 ~ '^[a-f0-9]{64}$' AND grant_id IS NOT NULL)
  );

-- A grant-bound branch row must reference exactly one repair.branch.create
-- grant whose signed resource names this repository, branch and digest.
-- grant_id is already immutable after reservation (0041 guard trigger) and
-- unique across executions (github_idempotent_pr_comment_grant index).
CREATE OR REPLACE FUNCTION github_idempotent_branch_grant_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.target_kind='branch' AND NEW.grant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM brain_authority_grants g
    WHERE g.grant_id=NEW.grant_id AND g.operation='repair.branch.create'
      AND g.resource='github:branch:'||NEW.repository||':'||
        NEW.target_branch||':sha256:'||NEW.operation_digest)
  THEN RAISE EXCEPTION 'github-idempotent-branch-grant-unbound'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS github_idempotent_branch_grant_guard_trg ON github_idempotent_executions;
CREATE TRIGGER github_idempotent_branch_grant_guard_trg
 BEFORE INSERT ON github_idempotent_executions
 FOR EACH ROW EXECUTE FUNCTION github_idempotent_branch_grant_guard();

-- Room for one more owner-selectable operation; no row is modified.
ALTER TABLE brain_owner_autonomy_profile
 DROP CONSTRAINT IF EXISTS brain_owner_autonomy_profile_allowed_operations_check;
ALTER TABLE brain_owner_autonomy_profile
 ADD CONSTRAINT brain_owner_autonomy_profile_allowed_operations_check
 CHECK (jsonb_typeof(allowed_operations)='array'
  AND jsonb_array_length(allowed_operations) BETWEEN 1 AND 24);
