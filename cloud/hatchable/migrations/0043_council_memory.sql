-- Council of Ultron Phase 2: durable council memory on Hatchable PostgreSQL.
-- Additive only. Default OFF: nothing writes here unless the owner sets
-- ULTRON_COUNCIL_MEMORY_MODE=postgres. No capability or authority is granted.
--
-- Design rules (Predictor's L7 mesh lessons):
--  * Append-only. Prior state is never updated in place; a newer fact row wins.
--  * One writer per key-space: a member writes only its own namespace; only
--    ultron-core (the routing lead) records outcomes. Enforced by CHECK.
--  * IDs come from DB sequences. Batches are capped in the library (max 500).
--  * Snapshots carry schema + sha256 and are only stored after verification.
--  * Scorecard rows are written as a whole generation in one statement; the
--    previous generation stays readable until the new one exists.
CREATE TABLE IF NOT EXISTS brain_council_memory_entries (
 id BIGSERIAL PRIMARY KEY,
 entry_key TEXT NOT NULL UNIQUE CHECK (entry_key ~ '^[a-f0-9]{64}$'),
 member_id TEXT NOT NULL CHECK (member_id IN ('ultron-core','ultron-builder','ultron-skeptic',
  'ultron-steward','ultron-predictor','ultron-generator','ultron-sentinel','ultron-companion')),
 written_by TEXT NOT NULL,
 kind TEXT NOT NULL CHECK (kind IN ('fact','journal','shared','outcome')),
 fact_key TEXT CHECK (fact_key IS NULL OR fact_key ~ '^[a-z][a-z0-9_.-]{1,63}$'),
 at_iso TEXT NOT NULL CHECK (at_iso ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{3})?Z$'),
 body JSONB NOT NULL CHECK (jsonb_typeof(body)='object' AND octet_length(body::text) <= 8000),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK ((kind='fact')=(fact_key IS NOT NULL)),
 CHECK (written_by=member_id OR (kind='outcome' AND written_by='ultron-core')),
 CHECK (kind<>'outcome' OR written_by='ultron-core'),
 CHECK (kind<>'shared' OR body->>'by'=member_id)
);
CREATE INDEX IF NOT EXISTS brain_council_memory_by_member
 ON brain_council_memory_entries(member_id,kind,id);

CREATE TABLE IF NOT EXISTS brain_council_memory_snapshots (
 id BIGSERIAL PRIMARY KEY,
 sha256 TEXT NOT NULL UNIQUE CHECK (sha256 ~ '^[a-f0-9]{64}$'),
 schema_version TEXT NOT NULL CHECK (schema_version='ultron.council-memory.v1'),
 last_entry_id BIGINT NOT NULL CHECK (last_entry_id >= 0),
 body JSONB NOT NULL CHECK (jsonb_typeof(body)='object'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Column contract: SCORECARD_COLUMNS in src/council-of-ultron.mjs.
CREATE TABLE IF NOT EXISTS brain_council_scorecard_rows (
 id BIGSERIAL PRIMARY KEY,
 member_id TEXT NOT NULL,
 lane TEXT NOT NULL CHECK (lane IN ('agentic','generative','predictive','self-improvement',
  'reasoning','reliability','governance','continuity')),
 attempts INTEGER NOT NULL CHECK (attempts >= 0),
 successes INTEGER NOT NULL CHECK (successes >= 0 AND successes <= attempts),
 rate NUMERIC(5,4) NOT NULL CHECK (rate > 0 AND rate < 1),
 snapshot_sha256 TEXT NOT NULL REFERENCES brain_council_memory_snapshots(sha256) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE (snapshot_sha256,member_id,lane)
);

CREATE OR REPLACE FUNCTION brain_council_memory_append_only() RETURNS trigger AS $$
BEGIN
 RAISE EXCEPTION 'council-memory-append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS brain_council_memory_entries_guard_trg ON brain_council_memory_entries;
CREATE TRIGGER brain_council_memory_entries_guard_trg BEFORE UPDATE OR DELETE ON brain_council_memory_entries
 FOR EACH ROW EXECUTE FUNCTION brain_council_memory_append_only();
DROP TRIGGER IF EXISTS brain_council_memory_snapshots_guard_trg ON brain_council_memory_snapshots;
CREATE TRIGGER brain_council_memory_snapshots_guard_trg BEFORE UPDATE OR DELETE ON brain_council_memory_snapshots
 FOR EACH ROW EXECUTE FUNCTION brain_council_memory_append_only();
DROP TRIGGER IF EXISTS brain_council_scorecard_rows_guard_trg ON brain_council_scorecard_rows;
CREATE TRIGGER brain_council_scorecard_rows_guard_trg BEFORE UPDATE OR DELETE ON brain_council_scorecard_rows
 FOR EACH ROW EXECUTE FUNCTION brain_council_memory_append_only();
