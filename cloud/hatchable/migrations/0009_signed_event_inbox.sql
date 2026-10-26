-- Signed event bridge admission; requires earlier shared migration sequence.
-- Only event identity/digest is retained here, never signed raw content.
CREATE TABLE IF NOT EXISTS brain_signed_inbox (
 id BIGSERIAL PRIMARY KEY,
 source TEXT NOT NULL,
 delivery_id TEXT NOT NULL,
 task_key TEXT NOT NULL UNIQUE,
 payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
 first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 retain_until TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
 UNIQUE(source,delivery_id)
);
CREATE INDEX IF NOT EXISTS brain_signed_inbox_retention
 ON brain_signed_inbox(retain_until);
