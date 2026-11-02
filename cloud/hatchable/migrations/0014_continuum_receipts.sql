-- C03 requires a separately authorized, durable routing registration before an
-- authenticated bridge ACK can be admitted. The ACK endpoint MUST NEVER
-- create routes itself; missing registration fails closed. Registration source
-- and route digest must be independently read back at production admission.
CREATE TABLE IF NOT EXISTS brain_continuum_routes (
 delivery_id text NOT NULL PRIMARY KEY REFERENCES brain_continuum_outbox(delivery_id),
 source text NOT NULL CHECK (source IN ('destiny-work','mahoraga-cloud')),
 route_sha text NOT NULL CHECK (route_sha ~ '^[a-f0-9]{64}$'),
 registered_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
-- Persisted route authority is immutable after registration. Changing the
-- target or route digest requires a NEW delivery, not a silent mutation.
CREATE OR REPLACE FUNCTION continuum_routes_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'continuum route mutation forbidden';
END;
$$;
DROP TRIGGER IF EXISTS continuum_routes_immutable ON brain_continuum_routes;
CREATE TRIGGER continuum_routes_immutable
 BEFORE UPDATE OR DELETE ON brain_continuum_routes
 FOR EACH ROW EXECUTE FUNCTION continuum_routes_immutable();

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
