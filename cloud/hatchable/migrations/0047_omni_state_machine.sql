-- 0047: additive, shadow-only execution evidence. NO new release authority.
-- Existing 0013 outbox, 0028 Council, 0039/0041/0045 GitHub ledgers are untouched.
-- Owner-signed 7/7 governance, owner WebAuthn, and repo protections remain external gates.

CREATE TABLE IF NOT EXISTS brain_omni_shadow_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 nonce TEXT NOT NULL UNIQUE CHECK (nonce ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{11,95}$'),
 payload JSONB NOT NULL CHECK (jsonb_typeof(payload)='object'),
 payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
 repository TEXT NOT NULL CHECK (repository='michaeljwilliams0123/Ultron.MW'),
 source_sha TEXT NOT NULL CHECK (source_sha ~ '^[a-f0-9]{40}$'),
 effect TEXT NOT NULL DEFAULT 'advisory' CHECK (effect IN ('read','advisory')),
 max_paid_cents INTEGER NOT NULL DEFAULT 0 CHECK(max_paid_cents=0),
 current_state TEXT NOT NULL DEFAULT 'RECEIVED' CHECK(current_state IN
  ('RECEIVED','PERSISTED','AUTHORIZED','RECONCILE_REQUIRED','EXECUTED_AND_VERIFIED','FAILED_TERMINAL')),
 grant_id TEXT UNIQUE REFERENCES brain_authority_grants(grant_id) ON DELETE RESTRICT,
 owner_proof_sha TEXT CHECK (owner_proof_sha IS NULL OR owner_proof_sha ~ '^[a-f0-9]{64}$'),
 provider_receipt JSONB CHECK (provider_receipt IS NULL OR jsonb_typeof(provider_receipt)='object'),
 provider_receipt_sha TEXT CHECK (provider_receipt_sha IS NULL OR provider_receipt_sha ~ '^[a-f0-9]{64}$'),
 reason TEXT CHECK (reason IS NULL OR char_length(reason)<=200),
 created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
 CONSTRAINT brain_omni_authority_presence CHECK
  (current_state NOT IN ('AUTHORIZED','RECONCILE_REQUIRED','EXECUTED_AND_VERIFIED')
   OR (grant_id IS NOT NULL AND owner_proof_sha IS NOT NULL)),
 CONSTRAINT brain_omni_receipt_presence CHECK
  ((current_state='EXECUTED_AND_VERIFIED')=
   (provider_receipt IS NOT NULL AND provider_receipt_sha IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS brain_omni_shadow_pending_idx
 ON brain_omni_shadow_events(current_state,created_at)
 WHERE current_state IN ('RECEIVED','PERSISTED','AUTHORIZED','RECONCILE_REQUIRED');

CREATE TABLE IF NOT EXISTS brain_omni_transition_events (
 seq BIGSERIAL PRIMARY KEY,
 event_id UUID NOT NULL REFERENCES brain_omni_shadow_events(id) ON DELETE RESTRICT,
 from_state TEXT NOT NULL,
 to_state TEXT NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);
CREATE INDEX IF NOT EXISTS brain_omni_transition_by_event
 ON brain_omni_transition_events(event_id,seq);

-- Advisory evidence is not a TSS signature verification or Council vote.
CREATE TABLE IF NOT EXISTS brain_omni_advisory_signatures (
 event_id UUID NOT NULL REFERENCES brain_omni_shadow_events(id) ON DELETE RESTRICT,
 signer_fingerprint TEXT NOT NULL CHECK (signer_fingerprint ~ '^[a-f0-9]{64}$'),
 signature TEXT NOT NULL CHECK (length(signature) BETWEEN 8 AND 4096),
 advisory_only BOOLEAN NOT NULL DEFAULT TRUE CHECK (advisory_only),
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
 PRIMARY KEY(event_id,signer_fingerprint)
);

-- Store candidate manifests only. No hot-loading, activation or secret binding.
CREATE TABLE IF NOT EXISTS brain_omni_candidate_tools (
 tool_name TEXT PRIMARY KEY CHECK (tool_name ~ '^[a-z][a-z0-9_.-]{2,127}$'),
 manifest JSONB NOT NULL CHECK (jsonb_typeof(manifest)='object'),
 manifest_sha256 TEXT NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
 is_active BOOLEAN NOT NULL DEFAULT FALSE CHECK (NOT is_active),
 created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);

CREATE OR REPLACE FUNCTION brain_omni_shadow_guard() RETURNS TRIGGER AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'omni-shadow-immutable'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.current_state<>'RECEIVED' OR NEW.grant_id IS NOT NULL
    OR NEW.owner_proof_sha IS NOT NULL OR NEW.provider_receipt IS NOT NULL
    OR NEW.provider_receipt_sha IS NOT NULL
   THEN RAISE EXCEPTION 'omni-shadow-insert-must-be-received'; END IF;
  NEW.created_at:=statement_timestamp();
  NEW.updated_at:=NEW.created_at;
  RETURN NEW;
 END IF;
 IF (NEW.id,NEW.nonce,NEW.payload,NEW.payload_sha256,NEW.repository,
   NEW.source_sha,NEW.effect,NEW.max_paid_cents,NEW.created_at)
 IS DISTINCT FROM
  (OLD.id,OLD.nonce,OLD.payload,OLD.payload_sha256,OLD.repository,
   OLD.source_sha,OLD.effect,OLD.max_paid_cents,OLD.created_at)
 THEN RAISE EXCEPTION 'omni-shadow-immutable-identity'; END IF;
 IF OLD.current_state IN ('EXECUTED_AND_VERIFIED','FAILED_TERMINAL')
 THEN RAISE EXCEPTION 'omni-shadow-terminal-immutable'; END IF;
 IF NOT (
  (OLD.current_state='RECEIVED' AND NEW.current_state='PERSISTED') OR
  (OLD.current_state='PERSISTED' AND NEW.current_state IN ('AUTHORIZED','FAILED_TERMINAL')) OR
  (OLD.current_state='AUTHORIZED' AND NEW.current_state IN
    ('RECONCILE_REQUIRED','EXECUTED_AND_VERIFIED','FAILED_TERMINAL')) OR
  (OLD.current_state='RECONCILE_REQUIRED' AND NEW.current_state IN
    ('EXECUTED_AND_VERIFIED','FAILED_TERMINAL'))
 ) THEN RAISE EXCEPTION 'omni-shadow-transition-denied'; END IF;
 IF OLD.current_state<>'PERSISTED' AND
    (NEW.grant_id IS DISTINCT FROM OLD.grant_id OR
     NEW.owner_proof_sha IS DISTINCT FROM OLD.owner_proof_sha)
 THEN RAISE EXCEPTION 'omni-shadow-authorization-immutable'; END IF;
 IF NEW.current_state='AUTHORIZED' THEN
  IF NOT EXISTS(SELECT 1 FROM brain_authority_grants g
    WHERE g.grant_id=NEW.grant_id
    AND g.actor='mcp:ultron'
    AND g.operation='omni.shadow.authorize'
    AND g.resource='omni-event:'||NEW.id::text||':sha256:'||NEW.payload_sha256
    AND g.policy_sha=NEW.payload_sha256
    AND g.expires_at>clock_timestamp())
   THEN RAISE EXCEPTION 'omni-shadow-owner-grant-unbound'; END IF;
 ELSIF NEW.grant_id IS DISTINCT FROM OLD.grant_id OR
       NEW.owner_proof_sha IS DISTINCT FROM OLD.owner_proof_sha THEN
   RAISE EXCEPTION 'omni-shadow-authorization-immutable';
 END IF;
 IF NEW.current_state='EXECUTED_AND_VERIFIED' THEN
  IF NEW.provider_receipt IS NULL OR NEW.provider_receipt_sha IS NULL
  THEN RAISE EXCEPTION 'omni-shadow-receipt-required'; END IF;
 ELSIF NEW.provider_receipt IS NOT NULL OR NEW.provider_receipt_sha IS NOT NULL
 THEN RAISE EXCEPTION 'omni-shadow-premature-receipt'; END IF;
 IF NEW.current_state NOT IN ('RECONCILE_REQUIRED','FAILED_TERMINAL') AND NEW.reason IS NOT NULL
 THEN RAISE EXCEPTION 'omni-shadow-premature-failure'; END IF;
 NEW.updated_at:=statement_timestamp();
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS brain_omni_shadow_guard_trg ON brain_omni_shadow_events;
CREATE TRIGGER brain_omni_shadow_guard_trg
 BEFORE INSERT OR UPDATE OR DELETE ON brain_omni_shadow_events
 FOR EACH ROW EXECUTE FUNCTION brain_omni_shadow_guard();

CREATE OR REPLACE FUNCTION brain_omni_audit_transition() RETURNS TRIGGER AS $$
BEGIN
 INSERT INTO brain_omni_transition_events(event_id,from_state,to_state)
 VALUES(NEW.id,OLD.current_state,NEW.current_state);
 RETURN NULL;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS brain_omni_audit_transition_trg ON brain_omni_shadow_events;
CREATE TRIGGER brain_omni_audit_transition_trg
 AFTER UPDATE ON brain_omni_shadow_events
 FOR EACH ROW EXECUTE FUNCTION brain_omni_audit_transition();

CREATE OR REPLACE FUNCTION brain_omni_append_only_guard() RETURNS TRIGGER AS $$
BEGIN RAISE EXCEPTION 'omni-ledger-append-only'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS brain_omni_transition_append_only ON brain_omni_transition_events;
CREATE TRIGGER brain_omni_transition_append_only
 BEFORE UPDATE OR DELETE ON brain_omni_transition_events
 FOR EACH ROW EXECUTE FUNCTION brain_omni_append_only_guard();
DROP TRIGGER IF EXISTS brain_omni_signatures_append_only ON brain_omni_advisory_signatures;
CREATE TRIGGER brain_omni_signatures_append_only
 BEFORE UPDATE OR DELETE ON brain_omni_advisory_signatures
 FOR EACH ROW EXECUTE FUNCTION brain_omni_append_only_guard();
DROP TRIGGER IF EXISTS brain_omni_candidate_append_only ON brain_omni_candidate_tools;
CREATE TRIGGER brain_omni_candidate_append_only
 BEFORE UPDATE OR DELETE ON brain_omni_candidate_tools
 FOR EACH ROW EXECUTE FUNCTION brain_omni_append_only_guard();
