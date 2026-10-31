-- Continuum C01: source-only transactional dispatch-intent ledger.
-- Apply only through an independently reviewed deployment/migration plan.
-- This slice admits READ/ADVISORY intentions; no external dispatch is implemented.
CREATE TABLE IF NOT EXISTS brain_continuum_outbox (
  id bigserial PRIMARY KEY,
  task_id bigint NOT NULL REFERENCES brain_tasks(id),
  objective_id text NOT NULL,
  delivery_id text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  repository text NOT NULL CHECK (repository = 'michaeljwilliams0123/Ultron.MW'),
  source_sha text NOT NULL CHECK (source_sha ~ '^[a-f0-9]{40}$'),
  authority_sha text NOT NULL CHECK (authority_sha ~ '^[a-f0-9]{64}$'),
  request_sha text NOT NULL CHECK (request_sha ~ '^[a-f0-9]{64}$'),
  lease_generation bigint NOT NULL CHECK (lease_generation > 0),
  expires_at timestamptz NOT NULL,
  effect text NOT NULL CHECK (effect IN ('read','advisory')),
  max_paid_cents integer NOT NULL DEFAULT 0 CHECK (max_paid_cents = 0),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','reconcile-required')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT continuum_outbox_expiry CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 days')
);
CREATE INDEX IF NOT EXISTS continuum_outbox_pending
  ON brain_continuum_outbox(state,expires_at,created_at)
  WHERE state <> 'reconcile-required';

-- No delete, rewrite, reset or implicit promotion to "completed".
-- A later independently verified receipt contract must add new transitions.
CREATE OR REPLACE FUNCTION continuum_outbox_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'continuum outbox deletion forbidden';
  END IF;
  IF (OLD.id,OLD.task_id,OLD.objective_id,OLD.delivery_id,OLD.idempotency_key,
      OLD.repository,OLD.source_sha,OLD.authority_sha,OLD.request_sha,
      OLD.lease_generation,OLD.expires_at,OLD.effect,OLD.max_paid_cents,OLD.created_at)
    IS DISTINCT FROM
     (NEW.id,NEW.task_id,NEW.objective_id,NEW.delivery_id,NEW.idempotency_key,
      NEW.repository,NEW.source_sha,NEW.authority_sha,NEW.request_sha,
      NEW.lease_generation,NEW.expires_at,NEW.effect,NEW.max_paid_cents,NEW.created_at)
  THEN
    RAISE EXCEPTION 'continuum outbox immutable identity changed';
  END IF;
  IF NOT (OLD.state = 'pending' AND NEW.state = 'reconcile-required') THEN
    RAISE EXCEPTION 'continuum outbox transition forbidden';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS continuum_outbox_guard ON brain_continuum_outbox;
CREATE TRIGGER continuum_outbox_guard
  BEFORE UPDATE OR DELETE ON brain_continuum_outbox
  FOR EACH ROW EXECUTE FUNCTION continuum_outbox_guard();
