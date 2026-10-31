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
