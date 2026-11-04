-- Bounded, owner-scoped GitHub Actions status cache. No tokens, prompt text,
-- generated code, identities or API credentials are persisted.
CREATE TABLE IF NOT EXISTS hf_lab_cache (
 id text PRIMARY KEY CHECK (id='owner'),
 snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
 observed_at timestamptz NOT NULL DEFAULT to_timestamp(0),
 lease_until timestamptz NOT NULL DEFAULT to_timestamp(0),
 refresh_key text
);
