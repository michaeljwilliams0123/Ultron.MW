-- 0047: UUAM execution-state projection over existing durable records.
-- Prerequisite: 0009 brain_signed_inbox; 0039 github_idempotent_executions;
-- 0046_admin_passkey_stepup.sql remains the canonical Admin migration.
-- This creates NO second event ledger and NO replacement for owner grants.
-- Receipt authority stays in github_idempotent_executions.
CREATE TABLE IF NOT EXISTS brain_omni_execution_state(
 inbox_id BIGINT PRIMARY KEY
   REFERENCES brain_signed_inbox(id) ON DELETE RESTRICT,
 operation_digest TEXT NOT NULL CHECK(operation_digest ~ '^[a-f0-9]{64}$'),
 github_idempotency_key TEXT NOT NULL UNIQUE CHECK(
   github_idempotency_key ~ '^ultron-task-[a-zA-Z0-9][a-zA-Z0-9_-]{0,90}$'),
 ingress_nonce TEXT NOT NULL UNIQUE CHECK(
   ingress_nonce ~ '^[a-f0-9]{32,64}$'),
 state TEXT NOT NULL DEFAULT 'PERSISTED' CHECK(state IN
   ('PERSISTED','AUTHORIZED','DISPATCHED','RECONCILE_REQUIRED',
    'VERIFIED','FAILED_TERMINAL')),
 owner_grant_id TEXT REFERENCES brain_authority_grants(grant_id) ON DELETE RESTRICT,
 council_attestation_sha256 TEXT CHECK(
   council_attestation_sha256 IS NULL OR
   council_attestation_sha256 ~ '^[a-f0-9]{64}$'),
 lease_owner TEXT,
 lease_expires_at TIMESTAMPTZ,
 retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count BETWEEN 0 AND 20),
 failure_code TEXT,
 verified_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(state NOT IN ('AUTHORIZED','DISPATCHED','RECONCILE_REQUIRED','VERIFIED')
    OR (owner_grant_id IS NOT NULL AND council_attestation_sha256 IS NOT NULL)),
 CHECK(state <> 'VERIFIED' OR verified_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS brain_omni_execution_reconcile_idx
 ON brain_omni_execution_state(state,updated_at)
 WHERE state IN ('PERSISTED','AUTHORIZED','RECONCILE_REQUIRED');

CREATE OR REPLACE FUNCTION brain_omni_state_guard() RETURNS trigger AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   RAISE EXCEPTION 'omni-state-immutable';
 END IF;
 IF TG_OP='INSERT' THEN
   IF NEW.state<>'PERSISTED' OR NEW.owner_grant_id IS NOT NULL OR
      NEW.council_attestation_sha256 IS NOT NULL OR
      NEW.lease_owner IS NOT NULL OR NEW.verified_at IS NOT NULL THEN
     RAISE EXCEPTION 'omni-state-must-start-persisted';
   END IF;
   RETURN NEW;
 END IF;
 IF OLD.state IN ('VERIFIED','FAILED_TERMINAL') THEN
   RAISE EXCEPTION 'omni-state-terminal-immutable';
 END IF;
 IF NEW.inbox_id IS DISTINCT FROM OLD.inbox_id OR
    NEW.operation_digest IS DISTINCT FROM OLD.operation_digest OR
    NEW.github_idempotency_key IS DISTINCT FROM OLD.github_idempotency_key OR
    NEW.ingress_nonce IS DISTINCT FROM OLD.ingress_nonce OR
    NEW.created_at IS DISTINCT FROM OLD.created_at OR
    NEW.retry_count < OLD.retry_count OR
    (OLD.owner_grant_id IS NOT NULL AND NEW.owner_grant_id IS DISTINCT FROM OLD.owner_grant_id) OR
    (OLD.council_attestation_sha256 IS NOT NULL AND
       NEW.council_attestation_sha256 IS DISTINCT FROM OLD.council_attestation_sha256)
 THEN RAISE EXCEPTION 'omni-state-identity-immutable'; END IF;
 IF NOT (
  (OLD.state='PERSISTED' AND NEW.state IN ('AUTHORIZED','FAILED_TERMINAL')) OR
  (OLD.state='AUTHORIZED' AND NEW.state IN ('DISPATCHED','FAILED_TERMINAL')) OR
  (OLD.state='DISPATCHED' AND NEW.state IN ('RECONCILE_REQUIRED','VERIFIED','FAILED_TERMINAL')) OR
  (OLD.state='RECONCILE_REQUIRED' AND NEW.state IN ('DISPATCHED','VERIFIED','FAILED_TERMINAL')) OR
  (OLD.state='RECONCILE_REQUIRED' AND NEW.state='RECONCILE_REQUIRED')
 ) THEN RAISE EXCEPTION 'omni-state-transition-denied'; END IF;
 IF NEW.state='AUTHORIZED' THEN
   IF NEW.owner_grant_id IS NULL OR NEW.council_attestation_sha256 IS NULL OR
      NOT EXISTS(
        SELECT 1 FROM brain_authority_grants g
        WHERE g.grant_id=NEW.owner_grant_id AND g.actor='mcp:ultron'
          AND g.resource='ultron:github:michaeljwilliams0123/Ultron.MW:sha256:'||NEW.operation_digest
          AND g.expires_at>clock_timestamp()
      ) THEN RAISE EXCEPTION 'omni-owner-authorization-unverified'; END IF;
 END IF;
 IF NEW.state='DISPATCHED' AND
    (NEW.lease_owner IS NULL OR length(NEW.lease_owner)<8 OR
      NEW.lease_expires_at IS NULL OR NEW.lease_expires_at<=clock_timestamp())
 THEN RAISE EXCEPTION 'omni-dispatch-lease-required'; END IF;
 IF NEW.state='VERIFIED' THEN
   IF NEW.verified_at IS NULL OR NOT EXISTS(
     SELECT 1 FROM github_idempotent_executions g
      WHERE g.idempotency_key=NEW.github_idempotency_key
       AND g.operation_digest=NEW.operation_digest
       AND g.state='completed' AND g.receipt IS NOT NULL
   ) THEN RAISE EXCEPTION 'omni-independent-readback-required'; END IF;
 END IF;
 NEW.updated_at=clock_timestamp();
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS brain_omni_state_guard_trg ON brain_omni_execution_state;
CREATE TRIGGER brain_omni_state_guard_trg
 BEFORE INSERT OR UPDATE OR DELETE ON brain_omni_execution_state
 FOR EACH ROW EXECUTE FUNCTION brain_omni_state_guard();
),
 ingress_nonce TEXT NOT NULL UNIQUE CHECK(ingress_nonce ~ '^[a-f0-9]{32,64} NOT NULL DEFAULT 'PERSISTED' CHECK(state IN
   ('PERSISTED','AUTHORIZED','DISPATCHED','RECONCILE_REQUIRED',
    'VERIFIED','FAILED_TERMINAL')),
 owner_grant_id TEXT REFERENCES brain_authority_grants(grant_id) ON DELETE RESTRICT,
 council_attestation_sha256 TEXT CHECK(
   council_attestation_sha256 IS NULL OR
   council_attestation_sha256 ~ '^[a-f0-9]{64}$'),
 lease_owner TEXT,
 lease_expires_at TIMESTAMPTZ,
 retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count BETWEEN 0 AND 20),
 failure_code TEXT,
 verified_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(state NOT IN ('AUTHORIZED','DISPATCHED','RECONCILE_REQUIRED','VERIFIED')
    OR (owner_grant_id IS NOT NULL AND council_attestation_sha256 IS NOT NULL)),
 CHECK(state <> 'VERIFIED' OR verified_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS brain_omni_execution_reconcile_idx
 ON brain_omni_execution_state(state,updated_at)
 WHERE state IN ('PERSISTED','AUTHORIZED','RECONCILE_REQUIRED');

CREATE OR REPLACE FUNCTION brain_omni_state_guard() RETURNS trigger AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   RAISE EXCEPTION 'omni-state-immutable';
 END IF;
 IF TG_OP='INSERT' THEN
   IF NEW.state<>'PERSISTED' OR NEW.owner_grant_id IS NOT NULL OR
      NEW.council_attestation_sha256 IS NOT NULL OR
      NEW.lease_owner IS NOT NULL OR NEW.verified_at IS NOT NULL THEN
     RAISE EXCEPTION 'omni-state-must-start-persisted';
   END IF;
   RETURN NEW;
 END IF;
 IF OLD.state IN ('VERIFIED','FAILED_TERMINAL') THEN
   RAISE EXCEPTION 'omni-state-terminal-immutable';
 END IF;
 IF NEW.inbox_id IS DISTINCT FROM OLD.inbox_id OR
    NEW.operation_digest IS DISTINCT FROM OLD.operation_digest OR
    NEW.github_idempotency_key IS DISTINCT FROM OLD.github_idempotency_key OR
    NEW.created_at IS DISTINCT FROM OLD.created_at OR
    NEW.retry_count < OLD.retry_count OR
    (OLD.owner_grant_id IS NOT NULL AND NEW.owner_grant_id IS DISTINCT FROM OLD.owner_grant_id) OR
    (OLD.council_attestation_sha256 IS NOT NULL AND
       NEW.council_attestation_sha256 IS DISTINCT FROM OLD.council_attestation_sha256)
 THEN RAISE EXCEPTION 'omni-state-identity-immutable'; END IF;
 IF NOT (
  (OLD.state='PERSISTED' AND NEW.state IN ('AUTHORIZED','FAILED_TERMINAL')) OR
  (OLD.state='AUTHORIZED' AND NEW.state IN ('DISPATCHED','FAILED_TERMINAL')) OR
  (OLD.state='DISPATCHED' AND NEW.state IN ('RECONCILE_REQUIRED','VERIFIED','FAILED_TERMINAL')) OR
  (OLD.state='RECONCILE_REQUIRED' AND NEW.state IN ('DISPATCHED','VERIFIED','FAILED_TERMINAL')) OR
  (OLD.state='RECONCILE_REQUIRED' AND NEW.state='RECONCILE_REQUIRED')
 ) THEN RAISE EXCEPTION 'omni-state-transition-denied'; END IF;
 IF NEW.state='AUTHORIZED' THEN
   IF NEW.owner_grant_id IS NULL OR NEW.council_attestation_sha256 IS NULL OR
      NOT EXISTS(
        SELECT 1 FROM brain_authority_grants g
        WHERE g.grant_id=NEW.owner_grant_id AND g.actor='mcp:ultron'
          AND g.resource='ultron:github:michaeljwilliams0123/Ultron.MW:sha256:'||NEW.operation_digest
          AND g.expires_at>clock_timestamp()
      ) THEN RAISE EXCEPTION 'omni-owner-authorization-unverified'; END IF;
 END IF;
 IF NEW.state='DISPATCHED' AND
    (NEW.lease_owner IS NULL OR length(NEW.lease_owner)<8 OR
      NEW.lease_expires_at IS NULL OR NEW.lease_expires_at<=clock_timestamp())
 THEN RAISE EXCEPTION 'omni-dispatch-lease-required'; END IF;
 IF NEW.state='VERIFIED' THEN
   IF NEW.verified_at IS NULL OR NOT EXISTS(
     SELECT 1 FROM github_idempotent_executions g
      WHERE g.idempotency_key=NEW.github_idempotency_key
       AND g.operation_digest=NEW.operation_digest
       AND g.state='completed' AND g.receipt IS NOT NULL
   ) THEN RAISE EXCEPTION 'omni-independent-readback-required'; END IF;
 END IF;
 NEW.updated_at=clock_timestamp();
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS brain_omni_state_guard_trg ON brain_omni_execution_state;
CREATE TRIGGER brain_omni_state_guard_trg
 BEFORE INSERT OR UPDATE OR DELETE ON brain_omni_execution_state
 FOR EACH ROW EXECUTE FUNCTION brain_omni_state_guard();
),
 state TEXT NOT NULL DEFAULT 'PERSISTED' CHECK(state IN
   ('PERSISTED','AUTHORIZED','DISPATCHED','RECONCILE_REQUIRED',
    'VERIFIED','FAILED_TERMINAL')),
 owner_grant_id TEXT REFERENCES brain_authority_grants(grant_id) ON DELETE RESTRICT,
 council_attestation_sha256 TEXT CHECK(
   council_attestation_sha256 IS NULL OR
   council_attestation_sha256 ~ '^[a-f0-9]{64}$'),
 lease_owner TEXT,
 lease_expires_at TIMESTAMPTZ,
 retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count BETWEEN 0 AND 20),
 failure_code TEXT,
 verified_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(state NOT IN ('AUTHORIZED','DISPATCHED','RECONCILE_REQUIRED','VERIFIED')
    OR (owner_grant_id IS NOT NULL AND council_attestation_sha256 IS NOT NULL)),
 CHECK(state <> 'VERIFIED' OR verified_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS brain_omni_execution_reconcile_idx
 ON brain_omni_execution_state(state,updated_at)
 WHERE state IN ('PERSISTED','AUTHORIZED','RECONCILE_REQUIRED');

CREATE OR REPLACE FUNCTION brain_omni_state_guard() RETURNS trigger AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   RAISE EXCEPTION 'omni-state-immutable';
 END IF;
 IF TG_OP='INSERT' THEN
   IF NEW.state<>'PERSISTED' OR NEW.owner_grant_id IS NOT NULL OR
      NEW.council_attestation_sha256 IS NOT NULL OR
      NEW.lease_owner IS NOT NULL OR NEW.verified_at IS NOT NULL THEN
     RAISE EXCEPTION 'omni-state-must-start-persisted';
   END IF;
   RETURN NEW;
 END IF;
 IF OLD.state IN ('VERIFIED','FAILED_TERMINAL') THEN
   RAISE EXCEPTION 'omni-state-terminal-immutable';
 END IF;
 IF NEW.inbox_id IS DISTINCT FROM OLD.inbox_id OR
    NEW.operation_digest IS DISTINCT FROM OLD.operation_digest OR
    NEW.github_idempotency_key IS DISTINCT FROM OLD.github_idempotency_key OR
    NEW.created_at IS DISTINCT FROM OLD.created_at OR
    NEW.retry_count < OLD.retry_count OR
    (OLD.owner_grant_id IS NOT NULL AND NEW.owner_grant_id IS DISTINCT FROM OLD.owner_grant_id) OR
    (OLD.council_attestation_sha256 IS NOT NULL AND
       NEW.council_attestation_sha256 IS DISTINCT FROM OLD.council_attestation_sha256)
 THEN RAISE EXCEPTION 'omni-state-identity-immutable'; END IF;
 IF NOT (
  (OLD.state='PERSISTED' AND NEW.state IN ('AUTHORIZED','FAILED_TERMINAL')) OR
  (OLD.state='AUTHORIZED' AND NEW.state IN ('DISPATCHED','FAILED_TERMINAL')) OR
  (OLD.state='DISPATCHED' AND NEW.state IN ('RECONCILE_REQUIRED','VERIFIED','FAILED_TERMINAL')) OR
  (OLD.state='RECONCILE_REQUIRED' AND NEW.state IN ('DISPATCHED','VERIFIED','FAILED_TERMINAL')) OR
  (OLD.state='RECONCILE_REQUIRED' AND NEW.state='RECONCILE_REQUIRED')
 ) THEN RAISE EXCEPTION 'omni-state-transition-denied'; END IF;
 IF NEW.state='AUTHORIZED' THEN
   IF NEW.owner_grant_id IS NULL OR NEW.council_attestation_sha256 IS NULL OR
      NOT EXISTS(
        SELECT 1 FROM brain_authority_grants g
        WHERE g.grant_id=NEW.owner_grant_id AND g.actor='mcp:ultron'
          AND g.resource='ultron:github:michaeljwilliams0123/Ultron.MW:sha256:'||NEW.operation_digest
          AND g.expires_at>clock_timestamp()
      ) THEN RAISE EXCEPTION 'omni-owner-authorization-unverified'; END IF;
 END IF;
 IF NEW.state='DISPATCHED' AND
    (NEW.lease_owner IS NULL OR length(NEW.lease_owner)<8 OR
      NEW.lease_expires_at IS NULL OR NEW.lease_expires_at<=clock_timestamp())
 THEN RAISE EXCEPTION 'omni-dispatch-lease-required'; END IF;
 IF NEW.state='VERIFIED' THEN
   IF NEW.verified_at IS NULL OR NOT EXISTS(
     SELECT 1 FROM github_idempotent_executions g
      WHERE g.idempotency_key=NEW.github_idempotency_key
       AND g.operation_digest=NEW.operation_digest
       AND g.state='completed' AND g.receipt IS NOT NULL
   ) THEN RAISE EXCEPTION 'omni-independent-readback-required'; END IF;
 END IF;
 NEW.updated_at=clock_timestamp();
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS brain_omni_state_guard_trg ON brain_omni_execution_state;
CREATE TRIGGER brain_omni_state_guard_trg
 BEFORE INSERT OR UPDATE OR DELETE ON brain_omni_execution_state
 FOR EACH ROW EXECUTE FUNCTION brain_omni_state_guard();
