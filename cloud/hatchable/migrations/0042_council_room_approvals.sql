-- Council Room front door: owner decisions on in-thread approval cards.
-- A row records that the owner clicked Approve or Decline on a card the
-- Council requested. It never executes anything and grants no capability;
-- the operation still runs only through its existing governed path.
-- Additive only: no existing table is altered.
CREATE TABLE IF NOT EXISTS council_room_approvals (
 id BIGSERIAL PRIMARY KEY,
 card_id TEXT NOT NULL UNIQUE CHECK (card_id ~ '^[a-f0-9]{64}$'),
 task_id BIGINT NOT NULL REFERENCES brain_tasks(id) ON DELETE RESTRICT,
 operation TEXT NOT NULL CHECK (operation IN ('pr.merge','release.publish','deploy.production',
  'spend.paid','permission.change','secret.write','message.external','repository.settings')),
 decision TEXT NOT NULL CHECK (decision IN ('approved','declined')),
 decided_by TEXT NOT NULL CHECK (decided_by='michaeljwilliams0123'),
 via TEXT NOT NULL DEFAULT 'council-room-card-click' CHECK (via='council-room-card-click'),
 executes BOOLEAN NOT NULL DEFAULT FALSE CHECK (NOT executes),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS council_room_approvals_task ON council_room_approvals(task_id,id);

-- Decisions are append-only: a decision cannot be edited or removed.
CREATE OR REPLACE FUNCTION council_room_approvals_guard() RETURNS trigger AS $$
BEGIN
 RAISE EXCEPTION 'council-room-approval-immutable';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS council_room_approvals_guard_trg ON council_room_approvals;
CREATE TRIGGER council_room_approvals_guard_trg
 BEFORE UPDATE OR DELETE ON council_room_approvals
 FOR EACH ROW EXECUTE FUNCTION council_room_approvals_guard();
