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

-- Terminal, non-completed outcomes for grant-bound branch rows only:
--  failed_before_write: the executor proved no non-GET provider request was
--    sent (reserved -> failed_before_write).
--  abandoned: an owner-authenticated abandon after a read-only provider
--    readback confirmed the branch is absent (reserved|reconcile_required ->
--    abandoned). Rows are never deleted; terminal rows are immutable.
ALTER TABLE github_idempotent_executions
  DROP CONSTRAINT github_idempotent_executions_state_check;
ALTER TABLE github_idempotent_executions
  ADD CONSTRAINT github_idempotent_executions_state_check
  CHECK (state IN ('reserved','in_flight','reconcile_required','completed',
    'failed_before_write','abandoned'));
ALTER TABLE github_idempotent_executions
  ADD CONSTRAINT github_idempotent_executions_terminal_branch_check
  CHECK (state NOT IN ('failed_before_write','abandoned') OR
    (target_kind='branch' AND grant_id IS NOT NULL AND receipt IS NULL));

-- Same identity/immutability rules as 0041, plus the two terminal states.
CREATE OR REPLACE FUNCTION github_idempotent_executions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'github-idempotent-immutable'; END IF;
  IF OLD.state='completed' THEN RAISE EXCEPTION 'github-idempotent-completed-immutable'; END IF;
  IF OLD.state IN ('failed_before_write','abandoned') THEN
    RAISE EXCEPTION 'github-idempotent-terminal-immutable'; END IF;
  IF NEW.idempotency_key<>OLD.idempotency_key OR
     NEW.operation_digest<>OLD.operation_digest OR
     NEW.repository<>OLD.repository OR
     NEW.target_kind<>OLD.target_kind OR
     NEW.target_branch IS DISTINCT FROM OLD.target_branch OR
     NEW.target_number IS DISTINCT FROM OLD.target_number OR
     NEW.body_sha256 IS DISTINCT FROM OLD.body_sha256 OR
     NEW.grant_id IS DISTINCT FROM OLD.grant_id OR
     (OLD.provider_comment_id IS NOT NULL AND
       (NEW.provider_comment_id,NEW.provider_url,NEW.provider_actor,NEW.provider_app_id)
       IS DISTINCT FROM
       (OLD.provider_comment_id,OLD.provider_url,OLD.provider_actor,OLD.provider_app_id)) OR
     (OLD.state='reconcile_required' AND NEW.state NOT IN ('completed','abandoned')) OR
     (OLD.state='in_flight' AND NEW.state NOT IN ('completed','reconcile_required')) OR
     (OLD.state='reserved' AND NEW.state NOT IN
       ('in_flight','completed','reconcile_required','failed_before_write','abandoned'))
  THEN RAISE EXCEPTION 'github-idempotent-transition-denied'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
