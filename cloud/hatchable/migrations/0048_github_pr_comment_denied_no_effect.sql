-- C04: a provider denial can become terminal only after a read-only
-- reconciliation scan proves the exact comment marker is absent.
-- This is additive to the existing immutable ledger: no row is deleted,
-- backfilled, or retried; completed and denied rows stay terminal.
ALTER TABLE github_pr_comment_executions
  DROP CONSTRAINT IF EXISTS github_pr_comment_executions_state_check;
ALTER TABLE github_pr_comment_executions
  ADD CONSTRAINT github_pr_comment_executions_state_check
  CHECK (state IN ('reserved','in_flight','reconcile_required','completed','denied_no_effect'));

CREATE OR REPLACE FUNCTION github_pr_comment_executions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'github-pr-comment-immutable'; END IF;
  IF OLD.state IN ('completed','denied_no_effect') THEN
    RAISE EXCEPTION 'github-pr-comment-terminal-immutable';
  END IF;
  IF NEW.idempotency_key<>OLD.idempotency_key OR
     NEW.operation_digest<>OLD.operation_digest OR
     NEW.repository<>OLD.repository OR
     NEW.target_number<>OLD.target_number OR
     NEW.body_sha256<>OLD.body_sha256 OR
     NEW.grant_id<>OLD.grant_id OR
     NEW.persona_role<>OLD.persona_role OR
     NEW.created_at<>OLD.created_at OR
     (OLD.state='reconcile_required' AND NEW.state NOT IN ('completed','denied_no_effect')) OR
     (OLD.state='in_flight' AND NEW.state NOT IN ('completed','reconcile_required')) OR
     (OLD.state='reserved' AND NEW.state NOT IN ('in_flight','completed','reconcile_required'))
  THEN RAISE EXCEPTION 'github-pr-comment-transition-denied'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;