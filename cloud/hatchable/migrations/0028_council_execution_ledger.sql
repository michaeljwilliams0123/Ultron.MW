-- C04 execution ledger: durable outbox of Council action intents and verified receipts.
-- Records evidence only; it confers no authority and creates no GitHub identity.
-- Terminal rows and every event are immutable so historical receipts are preserved.
CREATE TABLE IF NOT EXISTS brain_council_executions (
 id BIGSERIAL PRIMARY KEY,
 execution_key TEXT NOT NULL UNIQUE CHECK (execution_key ~ '^[a-f0-9]{64}$'),
 case_digest TEXT NOT NULL CHECK (case_digest ~ '^[a-f0-9]{64}$'),
 role_id TEXT NOT NULL CHECK(role_id IN (
  'Builder','Skeptic','Steward','Predictor','Generator','Sentinel','Companion'
 )),
 operation TEXT NOT NULL CHECK(char_length(operation) BETWEEN 1 AND 60),
 ordinal INTEGER NOT NULL DEFAULT 0 CHECK (ordinal BETWEEN 0 AND 1000),
 source_sha TEXT NOT NULL CHECK (source_sha ~ '^[a-f0-9]{40}$'),
 state TEXT NOT NULL CHECK(state IN (
  'reserved','dispatched','verified','executed','failed','reconcile-required','planned'
 )),
 auth_context JSONB NOT NULL CHECK (jsonb_typeof(auth_context)='object'),
 expected_effect TEXT CHECK (expected_effect IS NULL OR char_length(expected_effect) <= 300),
 executor TEXT CHECK (executor IS NULL OR char_length(executor) <= 80),
 effect_url TEXT CHECK (effect_url IS NULL OR char_length(effect_url) <= 300),
 receipt JSONB CHECK (receipt IS NULL OR jsonb_typeof(receipt)='object'),
 receipt_digest TEXT CHECK (receipt_digest IS NULL OR receipt_digest ~ '^[a-f0-9]{64}$'),
 reason TEXT CHECK (reason IS NULL OR char_length(reason) <= 200),
 history JSONB NOT NULL CHECK (jsonb_typeof(history)='array'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (state<>'verified' OR (receipt IS NOT NULL AND receipt_digest IS NOT NULL
  AND executor IS NOT NULL AND effect_url IS NOT NULL)),
 CHECK (state<>'executed' OR (executor IS NOT NULL AND effect_url IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS brain_council_executions_open
 ON brain_council_executions(state,updated_at DESC)
 WHERE state IN ('reserved','dispatched','reconcile-required');
CREATE INDEX IF NOT EXISTS brain_council_executions_by_case
 ON brain_council_executions(case_digest,role_id);

CREATE TABLE IF NOT EXISTS brain_council_execution_events (
 execution_key TEXT NOT NULL REFERENCES brain_council_executions(execution_key) ON DELETE RESTRICT,
 seq INTEGER NOT NULL CHECK (seq >= 1),
 from_state TEXT,
 to_state TEXT NOT NULL,
 detail JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail)='object'),
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY (execution_key,seq)
);

CREATE OR REPLACE FUNCTION brain_council_executions_guard() RETURNS trigger AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'council-ledger-immutable';
 END IF;
 IF OLD.state IN ('verified','executed','failed','planned') THEN
  RAISE EXCEPTION 'council-ledger-terminal-immutable';
 END IF;
 IF NEW.execution_key<>OLD.execution_key OR NEW.case_digest<>OLD.case_digest
   OR NEW.role_id<>OLD.role_id OR NEW.operation<>OLD.operation
   OR NEW.source_sha<>OLD.source_sha OR NEW.auth_context<>OLD.auth_context THEN
  RAISE EXCEPTION 'council-ledger-identity-immutable';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS brain_council_executions_guard_trg ON brain_council_executions;
CREATE TRIGGER brain_council_executions_guard_trg
 BEFORE UPDATE OR DELETE ON brain_council_executions
 FOR EACH ROW EXECUTE FUNCTION brain_council_executions_guard();

CREATE OR REPLACE FUNCTION brain_council_execution_events_guard() RETURNS trigger AS $$
BEGIN
 RAISE EXCEPTION 'council-ledger-events-append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS brain_council_execution_events_guard_trg ON brain_council_execution_events;
CREATE TRIGGER brain_council_execution_events_guard_trg
 BEFORE UPDATE OR DELETE ON brain_council_execution_events
 FOR EACH ROW EXECUTE FUNCTION brain_council_execution_events_guard();
