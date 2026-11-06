-- Grants attached to MCP-originated Mahoraga actions remain required during
-- every later prepared-to-sent transition, including scheduler recovery.
CREATE TABLE IF NOT EXISTS mahoraga_mcp_authority (
 action_id BIGINT PRIMARY KEY REFERENCES mahoraga_actions(id),
 grant_id TEXT NOT NULL UNIQUE REFERENCES brain_authority_grants(grant_id),
 fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
 profile_version BIGINT NOT NULL CHECK (profile_version >= 1),
 stop_version BIGINT NOT NULL CHECK (stop_version >= 1)
);
