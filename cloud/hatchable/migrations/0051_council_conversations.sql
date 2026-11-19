CREATE TABLE IF NOT EXISTS council_room_threads (
 room_key TEXT PRIMARY KEY,
 title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
 pinned BOOLEAN NOT NULL DEFAULT false,
 archived BOOLEAN NOT NULL DEFAULT false,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO council_room_threads(room_key,title)
 VALUES ('owner-main','Main conversation') ON CONFLICT DO NOTHING;
INSERT INTO council_room_threads(room_key,title)
 SELECT DISTINCT room_key,'Earlier conversation' FROM council_room_messages
 ON CONFLICT DO NOTHING;
CREATE INDEX IF NOT EXISTS council_room_threads_recent
 ON council_room_threads(archived,pinned DESC,updated_at DESC);
