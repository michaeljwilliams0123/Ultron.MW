-- C03 source-only: bridge-authenticated ACK, never Work/production acceptance.
-- Depends on 0013_continuum_outbox.sql; independently review before deployment.
CREATE TABLE IF NOT EXISTS brain_continuum_receipts (
 id bigserial PRIMARY KEY,
 receipt_id text NOT NULL UNIQUE,
 delivery_id text NOT NULL UNIQUE REFERENCES brain_continuum_outbox(delivery_id),
 source text NOT NULL CHECK (source IN ('destiny-work','mahoraga-cloud')),
 payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
 route_sha text NOT NULL CHECK (route_sha ~ '^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'acknowledged' CHECK (status = 'acknowledged'),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
-- Prevent a receipt from changing its identity, or being erased.
CREATE OR REPLACE FUNCTION continuum_receipts_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'continuum receipt mutation forbidden';
END;
$$;
DROP TRIGGER IF EXISTS continuum_receipts_immutable ON brain_continuum_receipts;
CREATE TRIGGER continuum_receipts_immutable
 BEFORE UPDATE OR DELETE ON brain_continuum_receipts
 FOR EACH ROW EXECUTE FUNCTION continuum_receipts_immutable();
