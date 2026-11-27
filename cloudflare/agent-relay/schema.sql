CREATE TABLE IF NOT EXISTS agent_relay_v1_events (
  message_id TEXT PRIMARY KEY NOT NULL,
  correlation_id TEXT,
  sender TEXT NOT NULL CHECK(sender IN ('ChatGPT','Gemini')),
  recipient TEXT NOT NULL CHECK(recipient IN ('ChatGPT','Gemini') AND recipient <> sender),
  event_type TEXT NOT NULL CHECK(event_type IN ('coordination','verification','canary','receipt')),
  status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK(status IN ('RECEIVED','ACKNOWLEDGED')),
  created_at INTEGER NOT NULL,
  acknowledged_at INTEGER
);
CREATE INDEX IF NOT EXISTS agent_relay_v1_inbox ON agent_relay_v1_events(recipient,status,created_at);
CREATE TABLE IF NOT EXISTS agent_relay_v1_nonces (
  agent TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(agent,nonce)
);
CREATE INDEX IF NOT EXISTS agent_relay_v1_nonce_expiry ON agent_relay_v1_nonces(expires_at);
