-- C18 owner-configured concurrency is a real DB-enforced lease cap.
-- Deploy behind an owner pause if possible, then reconcile active_leases with
-- actual brain_tasks leased rows before resuming. Does not grant new authority.
ALTER TABLE brain_owner_autonomy_profile
  ADD COLUMN IF NOT EXISTS active_leases INTEGER NOT NULL DEFAULT 0
    CHECK(active_leases >= 0);

CREATE OR REPLACE FUNCTION autonomy_task_capacity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE was_leased BOOLEAN := FALSE;
DECLARE will_lease BOOLEAN := FALSE;
BEGIN
  IF TG_OP='UPDATE' THEN
    was_leased := OLD.status='leased';
  END IF;
  will_lease := NEW.status='leased';
  IF will_lease AND NOT was_leased THEN
    -- Concurrent claims serialize on this row via UPDATE's exclusive lock.
    -- If the configured limit is malformed/missing, fail closed.
    UPDATE brain_owner_autonomy_profile
       SET active_leases=active_leases+1
     WHERE id=1 AND owner='michaeljwilliams0123' AND max_paid_cents=0
       AND active_leases < CASE
         WHEN jsonb_typeof(limits->'maxConcurrent')='number'
          AND (limits->>'maxConcurrent') ~ '^[1-8]$'
         THEN (limits->>'maxConcurrent')::integer ELSE 0 END;
    IF NOT FOUND THEN RETURN NULL; END IF;
  ELSIF was_leased AND NOT will_lease THEN
    UPDATE brain_owner_autonomy_profile
       SET active_leases=active_leases-1
     WHERE id=1 AND active_leases>0;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'autonomy-capacity-ledger-conflict';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS brain_tasks_autonomy_capacity ON brain_tasks;
CREATE TRIGGER brain_tasks_autonomy_capacity
  BEFORE INSERT OR UPDATE OF status ON brain_tasks
  FOR EACH ROW EXECUTE FUNCTION autonomy_task_capacity();

-- Reconcile existing in-flight leases at initial installation. Later changes
-- are maintained by the trigger, including crash recovery and completion.
UPDATE brain_owner_autonomy_profile
  SET active_leases=(SELECT count(*)::integer
                       FROM brain_tasks WHERE status='leased')
  WHERE id=1;
