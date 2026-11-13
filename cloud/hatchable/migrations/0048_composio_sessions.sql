-- 0048: Phase 2 Composio v3 session references only. Never store OAuth credentials.
-- Historical 0039 migrations are independent and MUST NOT be renamed/replayed.
CREATE TABLE IF NOT EXISTS brain_composio_principals (
 principal_key TEXT PRIMARY KEY CHECK (principal_key IN ('mw-primary','ultron-admin')),
 github_login TEXT NOT NULL,
 github_user_id BIGINT NOT NULL,
 repository_id BIGINT NOT NULL DEFAULT 1424939667 CHECK (repository_id=1424939667),
 connected_account_id TEXT CHECK (connected_account_id IS NULL OR
   connected_account_id ~ '^ca_[A-Za-z0-9_-]{3,120}$'),
 custom_auth_config_id TEXT CHECK (custom_auth_config_id IS NULL OR
   custom_auth_config_id ~ '^ac_[A-Za-z0-9_-]{3,120}$'),
 connection_state TEXT NOT NULL DEFAULT 'pending'
   CHECK (connection_state IN ('pending','active','revoked','reconcile-required')),
 grant_digest CHAR(64) CHECK (grant_digest IS NULL OR
   grant_digest ~ '^[a-f0-9]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (
  (principal_key='mw-primary' AND github_login='michaeljwilliams0123'
   AND github_user_id=308995719) OR
  (principal_key='ultron-admin' AND github_login='michaeljwilliams0123ultron'
   AND github_user_id=354634860)
 ),
 CHECK (connection_state<>'active' OR
   (connected_account_id IS NOT NULL AND custom_auth_config_id IS NOT NULL)),
 CHECK (principal_key<>'ultron-admin' OR connection_state<>'active' OR
   grant_digest IS NOT NULL)
);
INSERT INTO brain_composio_principals
  (principal_key,github_login,github_user_id)
 VALUES ('mw-primary','michaeljwilliams0123',308995719),
        ('ultron-admin','michaeljwilliams0123ultron',354634860)
 ON CONFLICT (principal_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS brain_composio_sessions (
 session_id TEXT PRIMARY KEY CHECK (session_id ~ '^[A-Za-z0-9_-]{8,160}$'),
 principal_key TEXT NOT NULL REFERENCES brain_composio_principals(principal_key)
   ON DELETE RESTRICT,
 session_profile TEXT NOT NULL
   CHECK (session_profile IN ('primary-direct','multi-account','primary-proxy')),
 user_id TEXT NOT NULL CHECK (length(user_id) BETWEEN 8 AND 128),
 config_digest CHAR(64) NOT NULL CHECK (config_digest ~ '^[a-f0-9]{64}$'),
 source_sha CHAR(40) NOT NULL CHECK (source_sha ~ '^[a-f0-9]{40}$'),
 status TEXT NOT NULL CHECK (status IN ('reserved','active','reconcile-required','revoked')),
 version INTEGER NOT NULL DEFAULT 0 CHECK (version>=0),
 last_verified_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (session_profile='primary-direct' OR principal_key='mw-primary'),
 CHECK (status<>'active' OR last_verified_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS brain_composio_one_active_session_per_profile
 ON brain_composio_sessions(principal_key,session_profile)
 WHERE status='active';
-- No overlapping in-flight or ambiguous session creation for a profile.
CREATE UNIQUE INDEX IF NOT EXISTS brain_composio_one_unsettled_session
 ON brain_composio_sessions(principal_key,session_profile)
 WHERE status IN ('reserved','active','reconcile-required');
CREATE INDEX IF NOT EXISTS brain_composio_sessions_updated
 ON brain_composio_sessions(status,updated_at);

CREATE TABLE IF NOT EXISTS brain_composio_read_receipts (
 receipt_key TEXT PRIMARY KEY CHECK (receipt_key ~ '^[a-z0-9][a-z0-9_-]{7,100}$'),
 session_id TEXT NOT NULL REFERENCES brain_composio_sessions(session_id) ON DELETE RESTRICT,
 principal_key TEXT NOT NULL REFERENCES brain_composio_principals(principal_key) ON DELETE RESTRICT,
 repository_id BIGINT NOT NULL CHECK (repository_id=1424939667),
 github_user_id BIGINT NOT NULL CHECK (github_user_id IN (308995719,354634860)),
 source_sha CHAR(40) NOT NULL CHECK (source_sha ~ '^[a-f0-9]{40}$'),
 observation_digest CHAR(64) NOT NULL CHECK (observation_digest ~ '^[a-f0-9]{64}$'),
 operation TEXT NOT NULL CHECK (operation IN (
   'GITHUB_GET_THE_AUTHENTICATED_USER','GITHUB_GET_A_REPOSITORY',
   'github.proxy.get')),
 result TEXT NOT NULL CHECK (result IN ('verified','reconcile-required')),
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS brain_composio_read_receipts_session
 ON brain_composio_read_receipts(session_id,recorded_at DESC);
