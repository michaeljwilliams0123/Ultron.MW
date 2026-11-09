-- Owner-signed GitHub operation approval replay protection.
-- Never delete a nonce while any five-minute window plus allowed clock
-- skew could still admit its signature. Retain records for audit by default.
CREATE TABLE IF NOT EXISTS brain_github_approval_nonces (
 nonce TEXT PRIMARY KEY,
 operation TEXT NOT NULL,
 target_resource TEXT NOT NULL,
 approval_timestamp TIMESTAMPTZ NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 consumed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS brain_github_approval_nonces_expires_at
 ON brain_github_approval_nonces(expires_at);
