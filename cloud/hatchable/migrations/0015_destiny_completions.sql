-- C03 dedicated Codex Cloud signed completion evidence.
-- Source-only migration; deployment and private signing-key enrollment are
-- separately authorized and observed. Never interpret this schema as live
-- executor acceptance. Requires 0013 and 0014.
--
-- C03 bridge ACKs remain bound to destiny-work/mahoraga-cloud. Codex Cloud
-- receives a *distinct*, immutable route authority; no migration rewrites
-- previously registered route rows or their original source values.
ALTER TABLE brain_continuum_routes
  DROP CONSTRAINT IF EXISTS brain_continuum_routes_source_check;
ALTER TABLE brain_continuum_routes
  ADD CONSTRAINT brain_continuum_routes_source_check CHECK
  (source IN ('destiny-work','mahoraga-cloud','destiny-codex-cloud'));

CREATE TABLE IF NOT EXISTS brain_destiny_completions (
  delivery_id text NOT NULL PRIMARY KEY REFERENCES brain_continuum_outbox(delivery_id),
  task_id text NOT NULL CHECK (task_id ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{11,127}$'),
  source_sha text NOT NULL CHECK (source_sha ~ '^[a-f0-9]{40}$'),
  request_sha text NOT NULL CHECK (request_sha ~ '^[a-f0-9]{64}$'),
  route_sha text NOT NULL CHECK (route_sha ~ '^[a-f0-9]{64}$'),
  receipt_sha text NOT NULL CHECK (receipt_sha ~ '^[a-f0-9]{64}$'),
  canonical_receipt text NOT NULL CHECK (octet_length(canonical_receipt) BETWEEN 100 AND 8000),
  signature_base64 text NOT NULL CHECK
    (signature_base64 ~ '^[A-Za-z0-9+/]{86}==$'),
  github_actor text NOT NULL CHECK (github_actor ~ '^[a-zA-Z0-9-]{1,40}$'),
  environment_fingerprint text NOT NULL CHECK
    (environment_fingerprint ~ '^[a-f0-9]{64}$'),
  key_id text NOT NULL CHECK (key_id ~ '^[-a-z0-9]{4,64}$'),
  result_sha text NOT NULL CHECK (result_sha ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'signed-executor-receipt'
    CHECK (status = 'signed-executor-receipt'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

-- A separately verified key can authorize one immutable delivery record;
-- neither an ambiguous ACK nor a subsequent candidate may rewrite evidence.
CREATE OR REPLACE FUNCTION destiny_completions_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'destiny completion mutation forbidden';
END;
$$;
DROP TRIGGER IF EXISTS destiny_completions_immutable ON brain_destiny_completions;
CREATE TRIGGER destiny_completions_immutable
  BEFORE UPDATE OR DELETE ON brain_destiny_completions
  FOR EACH ROW EXECUTE FUNCTION destiny_completions_immutable();
