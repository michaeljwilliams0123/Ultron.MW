-- Durable and strictly monotone write-intent ledger for repository Repair App.
-- This migration is versioned source only; it is NOT applied by the PR itself.
-- Never store token material, prompts, or private owner context.
CREATE TABLE IF NOT EXISTS repair_pr_attempts (
  attempt_key text PRIMARY KEY CHECK (attempt_key ~ '^repair:[a-z0-9][a-z0-9-]{7,90}$'),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  phase text NOT NULL CHECK (phase IN (
    'reserved','branch-dispatch','branch-confirmed','pr-dispatch','complete'
  )),
  pr_number integer CHECK (pr_number > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT repair_pr_receipt_consistency CHECK (
    (phase = 'complete' AND pr_number IS NOT NULL)
    OR (phase <> 'complete' AND pr_number IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS repair_pr_attempts_pending_idx
  ON repair_pr_attempts(phase,updated_at) WHERE phase<>'complete';

-- Final write fence: ordinary application SQL must not delete or rewind
-- an externally dispatched idempotency record. Grant the runtime role only
-- SELECT/INSERT/UPDATE; use a distinct migration owner for DDL. Superusers
-- and table owners remain privileged and must be governed separately.
CREATE OR REPLACE FUNCTION repair_pr_attempts_fence()
RETURNS trigger AS $repair_fence$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'repair_pr_attempts deletion denied';
  END IF;
  IF NEW.attempt_key IS DISTINCT FROM OLD.attempt_key OR
     NEW.fingerprint IS DISTINCT FROM OLD.fingerprint OR
     NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'repair_pr_attempts identity immutable';
  END IF;
  IF NOT (
      (OLD.phase = 'reserved' AND NEW.phase = 'branch-dispatch') OR
      (OLD.phase = 'branch-dispatch' AND NEW.phase = 'branch-confirmed') OR
      (OLD.phase = 'branch-confirmed' AND NEW.phase = 'pr-dispatch') OR
      (OLD.phase = 'pr-dispatch' AND NEW.phase = 'complete')
  ) THEN
    RAISE EXCEPTION 'repair_pr_attempts transition denied';
  END IF;
  RETURN NEW;
END;
$repair_fence$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS repair_pr_attempts_fence_trigger
  ON repair_pr_attempts;
CREATE TRIGGER repair_pr_attempts_fence_trigger
  BEFORE UPDATE OR DELETE ON repair_pr_attempts
  FOR EACH ROW EXECUTE FUNCTION repair_pr_attempts_fence();
