-- Additive durable mutation and scheduler evidence tables.
-- Existing C04 comment and 0039 branch ledgers are unchanged.
CREATE TABLE IF NOT EXISTS brain_github_deep_mutations (
 idempotency_key TEXT PRIMARY KEY,
 operation_digest TEXT NOT NULL CHECK (operation_digest ~ '^[a-f0-9]{64}$'),
 grant_id TEXT NOT NULL REFERENCES brain_authority_grants(grant_id) ON DELETE RESTRICT,
 operation_type TEXT NOT NULL CHECK (operation_type IN ('pr.comment','repair.branch.create')),
 target_ref TEXT NOT NULL,
 state TEXT NOT NULL CHECK (state IN ('reserved','sent','reconcile_required','verified')),
 receipt JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK ((state='verified')=(receipt IS NOT NULL)),
 CHECK (receipt IS NULL OR (receipt->>'verified')='true')
);
CREATE OR REPLACE FUNCTION brain_deep_mutation_guard() RETURNS TRIGGER AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.state='verified' THEN RAISE EXCEPTION 'deep-mutation-immutable'; END IF;
 IF NEW.idempotency_key<>OLD.idempotency_key OR
    NEW.operation_digest<>OLD.operation_digest OR NEW.grant_id<>OLD.grant_id OR
    NEW.operation_type<>OLD.operation_type OR NEW.target_ref<>OLD.target_ref OR
    NEW.created_at<>OLD.created_at OR
    (OLD.state='reserved' AND NEW.state<>'sent') OR
    (OLD.state='sent' AND NEW.state NOT IN ('verified','reconcile_required')) OR
    (OLD.state='reconcile_required' AND NEW.state NOT IN ('reconcile_required','verified'))
 THEN RAISE EXCEPTION 'deep-mutation-transition-denied'; END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS brain_deep_mutation_guard_trg ON brain_github_deep_mutations;
CREATE TRIGGER brain_deep_mutation_guard_trg BEFORE UPDATE OR DELETE
 ON brain_github_deep_mutations FOR EACH ROW EXECUTE FUNCTION brain_deep_mutation_guard();

-- No scheduled execution is altered by this telemetry table.
CREATE TABLE IF NOT EXISTS brain_scheduler_slots (
 slot_key TEXT PRIMARY KEY CHECK (slot_key ~ '^\d{4}-\d{2}-\d{2}T\d{2}:00Z$'),
 declared_minute INTEGER NOT NULL CHECK (declared_minute BETWEEN 0 AND 59),
 actual_pickup_at TIMESTAMPTZ,
 pickup_lag_seconds INTEGER CHECK (pickup_lag_seconds>=0),
 classification TEXT NOT NULL CHECK (classification IN ('scheduled','recovery','missing')),
 completion_status TEXT NOT NULL DEFAULT 'pending'
   CHECK (completion_status IN ('pending','done','failed')),
 evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
