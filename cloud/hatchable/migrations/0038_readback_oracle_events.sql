-- Chunk 5: immutable observation record; never an authorization or release grant.
CREATE TABLE IF NOT EXISTS brain_readback_oracle_events (
  attempt_id TEXT PRIMARY KEY CHECK (attempt_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{5,127}$'),
  evidence_digest CHAR(64) NOT NULL CHECK (evidence_digest ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL CHECK (status IN (
    'verified-external','observed-only','not-verified','reconcile-required')),
  event JSONB NOT NULL CHECK (jsonb_typeof(event)='object'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (event->>'attemptId'=attempt_id),
  CHECK (event->>'evidenceDigest'=evidence_digest),
  CHECK (event->>'status'=status)
);
CREATE OR REPLACE FUNCTION brain_readback_oracle_immutable() RETURNS trigger AS $$
BEGIN
 RAISE EXCEPTION 'readback-oracle-event-immutable';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS brain_readback_oracle_guard ON brain_readback_oracle_events;
CREATE TRIGGER brain_readback_oracle_guard BEFORE UPDATE OR DELETE ON brain_readback_oracle_events
 FOR EACH ROW EXECUTE FUNCTION brain_readback_oracle_immutable();
