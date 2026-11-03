-- Owner-scoped Hatchable action receipts. No external account, token, or spend.
ALTER TABLE brain_notes ADD COLUMN IF NOT EXISTS action_key text;
ALTER TABLE brain_notes ADD COLUMN IF NOT EXISTS fingerprint text;
ALTER TABLE brain_notes ADD CONSTRAINT brain_notes_action_pair CHECK (
 (action_key IS NULL AND fingerprint IS NULL) OR
 (action_key ~ '^[a-z][a-z0-9_.:-]{7,119}$' AND fingerprint ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS brain_notes_action_key ON brain_notes(action_key);

CREATE OR REPLACE FUNCTION brain_notes_action_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.action_key IS NOT NULL THEN RAISE EXCEPTION 'cloud action deletion denied'; END IF;
  RETURN OLD;
 END IF;
 IF OLD.action_key IS NOT NULL OR NEW.action_key IS NOT NULL THEN
  RAISE EXCEPTION 'cloud action note immutable';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER brain_notes_action_guard
 BEFORE UPDATE OR DELETE ON brain_notes
 FOR EACH ROW EXECUTE FUNCTION brain_notes_action_guard();

ALTER TABLE brain_owner_autonomy_profile
 DROP CONSTRAINT brain_owner_autonomy_profile_allowed_operations_check;
ALTER TABLE brain_owner_autonomy_profile
 ADD CONSTRAINT brain_owner_autonomy_profile_allowed_operations_check
 CHECK (jsonb_typeof(allowed_operations)='array'
 AND jsonb_array_length(allowed_operations) BETWEEN 1 AND 15);
