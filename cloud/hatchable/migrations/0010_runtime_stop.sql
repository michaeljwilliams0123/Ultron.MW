-- Singleton owner stop switch. Apply only after dependencies and review.
-- Standing worker credentials are NOT revoked by this flag.
CREATE TABLE IF NOT EXISTS brain_runtime_control (
 id SMALLINT PRIMARY KEY CHECK (id=1),
 paused BOOLEAN NOT NULL DEFAULT FALSE,
 version BIGINT NOT NULL DEFAULT 1 CHECK (version>=1),
 reason TEXT,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO brain_runtime_control(id,paused,version,reason)
 VALUES(1,FALSE,1,'initial safe state')
 ON CONFLICT(id) DO NOTHING;
