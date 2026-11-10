-- Task 4: durable, per-operation GitHub write admission and verified receipts.
-- This is not an authorization source. Task 2 must verify signed owner grants.
CREATE TABLE IF NOT EXISTS github_idempotent_executions (
  idempotency_key TEXT PRIMARY KEY CHECK (idempotency_key ~ '^ultron-task-[a-zA-Z0-9][a-zA-Z0-9_-]{0,90}$'),
  operation_digest TEXT NOT NULL CHECK (operation_digest ~ '^[a-f0-9]{64}$'),
  repository TEXT NOT NULL CHECK (repository='michaeljwilliams0123/Ultron.MW'),
  target_branch TEXT NOT NULL,
  persona_role TEXT NOT NULL CHECK (persona_role IN ('builder','skeptic','steward','predictor','generator','sentinel','companion')),
  state TEXT NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','in_flight','reconcile_required','completed')),
  receipt JSONB CHECK (receipt IS NULL OR jsonb_typeof(receipt)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(repository,target_branch),
  CHECK ((state='completed')=(receipt IS NOT NULL)),
  CHECK (receipt IS NULL OR (
    receipt->>'idempotencyKey'=idempotency_key AND
    receipt->'details'->>'operationDigest'=operation_digest AND
    receipt->'details'->>'branch'=target_branch AND
    receipt->'details'->>'repository'=repository AND
    receipt->'details'->>'personaRole'=persona_role AND
    receipt->'details'->>'remoteVerified'='true' AND
    receipt->'details'->>'sha' ~ '^[a-f0-9]{40}$' AND
    receipt->>'status' IN ('success','reconciled_success','recovered_success')) IS TRUE)
);
-- Guard all identity fields and final receipts against mutation or deletion.
CREATE OR REPLACE FUNCTION github_idempotent_executions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'github-idempotent-immutable'; END IF;
  IF OLD.state='completed' THEN RAISE EXCEPTION 'github-idempotent-completed-immutable'; END IF;
  IF NEW.idempotency_key<>OLD.idempotency_key OR
     NEW.operation_digest<>OLD.operation_digest OR
     NEW.repository<>OLD.repository OR
     NEW.target_branch<>OLD.target_branch OR
     NEW.persona_role<>OLD.persona_role OR
     (OLD.state='reconcile_required' AND NEW.state<>'completed') OR
     (OLD.state='in_flight' AND NEW.state NOT IN ('completed','reconcile_required')) OR
     (OLD.state='reserved' AND NEW.state NOT IN ('in_flight','completed','reconcile_required'))
  THEN RAISE EXCEPTION 'github-idempotent-transition-denied'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS github_idempotent_executions_guard_trg ON github_idempotent_executions;
CREATE TRIGGER github_idempotent_executions_guard_trg
 BEFORE UPDATE OR DELETE ON github_idempotent_executions
 FOR EACH ROW EXECUTE FUNCTION github_idempotent_executions_guard();
