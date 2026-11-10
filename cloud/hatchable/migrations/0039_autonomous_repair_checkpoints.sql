-- Chunk 6: durable bounded patch/test/recovery checkpoints.
-- This ledger grants no GitHub authority and stores neither tokens nor model secrets.
CREATE TABLE IF NOT EXISTS brain_autonomous_repairs (
 repair_id TEXT PRIMARY KEY CHECK(repair_id ~ '^[a-z][a-z0-9-]{7,79}$'),
 fingerprint CHAR(64) NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 phase TEXT NOT NULL CHECK(phase IN (
   'ready','patch-dispatched','applied','verifying','verified',
   'publication-dispatched','complete','exhausted')),
 version INTEGER NOT NULL DEFAULT 0 CHECK(version >= 0),
 record_json TEXT NOT NULL CHECK(length(record_json) BETWEEN 100 AND 32000),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK((record_json::jsonb->>'id') = repair_id),
 CHECK((record_json::jsonb->>'fingerprint') = fingerprint),
 CHECK((record_json::jsonb->>'phase') = phase),
 CHECK((record_json::jsonb->>'version')::integer = version)
);
CREATE INDEX IF NOT EXISTS brain_autonomous_repairs_open
 ON brain_autonomous_repairs(phase,updated_at)
 WHERE phase NOT IN ('complete','exhausted');

CREATE TABLE IF NOT EXISTS brain_autonomous_repair_events(
 repair_id TEXT NOT NULL REFERENCES brain_autonomous_repairs(repair_id) ON DELETE RESTRICT,
 version INTEGER NOT NULL CHECK(version>=1),
 from_phase TEXT NOT NULL,
 to_phase TEXT NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(repair_id,version)
);

CREATE OR REPLACE FUNCTION brain_autonomous_repair_guard() RETURNS trigger AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'autonomous-repair-delete-denied'; END IF;
 IF NEW.repair_id IS DISTINCT FROM OLD.repair_id OR
    NEW.fingerprint IS DISTINCT FROM OLD.fingerprint OR
    NEW.created_at IS DISTINCT FROM OLD.created_at OR
    NEW.version <> OLD.version+1 THEN
   RAISE EXCEPTION 'autonomous-repair-fence-denied';
 END IF;
 IF NOT (
    (OLD.phase='ready' AND NEW.phase='patch-dispatched') OR
    (OLD.phase='patch-dispatched' AND NEW.phase='applied') OR
    (OLD.phase='applied' AND NEW.phase='verifying') OR
    (OLD.phase='verifying' AND NEW.phase IN ('ready','verified','exhausted')) OR
    (OLD.phase='verified' AND NEW.phase='publication-dispatched') OR
    (OLD.phase='publication-dispatched' AND NEW.phase='complete')
 ) THEN RAISE EXCEPTION 'autonomous-repair-transition-denied'; END IF;
 IF (OLD.phase='ready' AND
     (NEW.record_json::jsonb->>'attempt')::integer <>
       (OLD.record_json::jsonb->>'attempt')::integer+1)
   OR (OLD.phase<>'ready' AND
     (NEW.record_json::jsonb->>'attempt')::integer <>
       (OLD.record_json::jsonb->>'attempt')::integer) THEN
   RAISE EXCEPTION 'autonomous-repair-attempt-fence-denied';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS brain_autonomous_repair_guard_trg ON brain_autonomous_repairs;
CREATE TRIGGER brain_autonomous_repair_guard_trg
 BEFORE UPDATE OR DELETE ON brain_autonomous_repairs
 FOR EACH ROW EXECUTE FUNCTION brain_autonomous_repair_guard();

CREATE OR REPLACE FUNCTION brain_autonomous_repair_event_guard() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'autonomous-repair-events-append-only'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS brain_autonomous_repair_event_guard_trg ON brain_autonomous_repair_events;
CREATE TRIGGER brain_autonomous_repair_event_guard_trg
 BEFORE UPDATE OR DELETE ON brain_autonomous_repair_events
 FOR EACH ROW EXECUTE FUNCTION brain_autonomous_repair_event_guard();
