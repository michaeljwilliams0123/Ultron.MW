-- Persist only keyed authority checkpoints and public digests.
-- One durable attempted external action per (binding,idempotency key).
CREATE TABLE IF NOT EXISTS capability_attempts (
 attempt_id text PRIMARY KEY,
 fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
 status text NOT NULL CHECK (status IN
  ('approval-pending','reconcile-required','completed')),
 receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt)='object'),
 CONSTRAINT capability_attempt_receipt_status_consistent CHECK (receipt->>'status'=status),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS capability_attempts_pending_idx
 ON capability_attempts (status,updated_at)
 WHERE status <> 'completed';
