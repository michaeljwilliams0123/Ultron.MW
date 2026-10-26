-- Post-adjudication one-time capability receipts.
-- Migration 0008 follows #106 migration 0006 and #107 migration 0007.
-- No root credential or private signing key is persisted in this ledger.
CREATE TABLE IF NOT EXISTS brain_authority_grants (
 grant_id TEXT PRIMARY KEY,
 objective_id TEXT NOT NULL,
 actor TEXT NOT NULL,
 operation TEXT NOT NULL,
 resource TEXT NOT NULL,
 policy_sha TEXT NOT NULL CHECK (policy_sha ~ '^[a-f0-9]{64}$'),
 expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS brain_authority_grants_expiration
 ON brain_authority_grants(expires_at);
