-- #412 Option A: grant-bound branch canary on the canonical 0039 branch ledger.
-- 0041 creates a separate github_pr_comment_executions table; never reintroduce
-- its PR-comment columns into github_idempotent_executions or drop 0039 checks.
-- The owner alone may enable repair.branch.create; this migration never does.
ALTER TABLE github_idempotent_executions
 ADD COLUMN IF NOT EXISTS grant_id TEXT
 REFERENCES brain_authority_grants(grant_id) ON DELETE RESTRICT;

-- NULL historical branch grants remain valid; a non-NULL grant can be spent once.
CREATE UNIQUE INDEX IF NOT EXISTS github_idempotent_executions_grant_id_unique
 ON github_idempotent_executions(grant_id)
 WHERE grant_id IS NOT NULL;

-- Signed grant must exactly bind the target repository, branch and digest.
CREATE OR REPLACE FUNCTION github_idempotent_branch_grant_guard() RETURNS trigger AS $$
BEGIN
 IF NEW.grant_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM brain_authority_grants g
  WHERE g.grant_id=NEW.grant_id AND g.operation='repair.branch.create'
   AND g.resource='github:branch:'||NEW.repository||':'||
    NEW.target_branch||':sha256:'||NEW.operation_digest
 ) THEN
  RAISE EXCEPTION 'github-idempotent-branch-grant-unbound';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS github_idempotent_branch_grant_guard_trg
 ON github_idempotent_executions;
CREATE TRIGGER github_idempotent_branch_grant_guard_trg
 BEFORE INSERT ON github_idempotent_executions
 FOR EACH ROW EXECUTE FUNCTION github_idempotent_branch_grant_guard();

-- One additional owner-selectable operation; do not update the owner profile.
ALTER TABLE brain_owner_autonomy_profile
 DROP CONSTRAINT IF EXISTS brain_owner_autonomy_profile_allowed_operations_check;
ALTER TABLE brain_owner_autonomy_profile
 ADD CONSTRAINT brain_owner_autonomy_profile_allowed_operations_check
 CHECK (jsonb_typeof(allowed_operations)='array'
  AND jsonb_array_length(allowed_operations) BETWEEN 1 AND 24);

-- Terminal states are permitted only for grant-bound branch rows.
ALTER TABLE github_idempotent_executions
 DROP CONSTRAINT IF EXISTS github_idempotent_executions_state_check;
ALTER TABLE github_idempotent_executions
 ADD CONSTRAINT github_idempotent_executions_state_check
 CHECK (state IN ('reserved','in_flight','reconcile_required','completed',
  'failed_before_write','abandoned'));
ALTER TABLE github_idempotent_executions
 DROP CONSTRAINT IF EXISTS github_idempotent_executions_terminal_branch_check;
ALTER TABLE github_idempotent_executions
 ADD CONSTRAINT github_idempotent_executions_terminal_branch_check
 CHECK (state NOT IN ('failed_before_write','abandoned') OR
   (grant_id IS NOT NULL AND receipt IS NULL));

-- Preserve 0039 identity immutability and completed receipts; add grant immutability,
-- terminal immutability, and only the explicitly allowed state transitions.
-- The 0041 PR-comment guard function and table are unaffected.
CREATE OR REPLACE FUNCTION github_idempotent_executions_guard() RETURNS trigger AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'github-idempotent-immutable'; END IF;
 IF OLD.state='completed' THEN
  RAISE EXCEPTION 'github-idempotent-completed-immutable'; END IF;
 IF OLD.state IN ('failed_before_write','abandoned') THEN
  RAISE EXCEPTION 'github-idempotent-terminal-immutable'; END IF;
 IF NEW.idempotency_key<>OLD.idempotency_key OR
    NEW.operation_digest<>OLD.operation_digest OR
    NEW.repository<>OLD.repository OR
    NEW.target_branch<>OLD.target_branch OR
    NEW.persona_role<>OLD.persona_role OR
    NEW.grant_id IS DISTINCT FROM OLD.grant_id OR
    (OLD.state='reconcile_required' AND NEW.state NOT IN ('completed','abandoned')) OR
    (OLD.state='in_flight' AND NEW.state NOT IN ('completed','reconcile_required')) OR
    (OLD.state='reserved' AND NEW.state NOT IN
     ('in_flight','completed','reconcile_required','failed_before_write','abandoned'))
 THEN RAISE EXCEPTION 'github-idempotent-transition-denied'; END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
