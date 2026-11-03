-- C06 live cross-system deep-task checkpoint for one bounded issue.create route.
-- Owner/admin authorization is in the API; this schema never grants a token.
CREATE TABLE IF NOT EXISTS brain_deep_objectives(
 task_key text PRIMARY KEY CHECK (task_key ~ '^[a-z][a-z0-9_.:-]{7,119}$'),
 fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
 profile_version bigint NOT NULL CHECK (profile_version>=1),
 stop_version bigint NOT NULL CHECK (stop_version>=1),
 state text NOT NULL DEFAULT 'prepared' CHECK
  (state IN ('prepared','dispatching','reconcile-required','observed')),
 issue_number integer UNIQUE CHECK (issue_number>0),
 external_url text UNIQUE,
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 CONSTRAINT deep_outcome_consistent CHECK (
  (state='observed' AND issue_number IS NOT NULL AND external_url IS NOT NULL)
  OR (state<>'observed' AND issue_number IS NULL AND external_url IS NULL)
 )
);

CREATE OR REPLACE FUNCTION deep_objectives_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'deep objective deletion denied'; END IF;
 IF (OLD.task_key,OLD.fingerprint,OLD.profile_version,OLD.stop_version,OLD.created_at)
    IS DISTINCT FROM
    (NEW.task_key,NEW.fingerprint,NEW.profile_version,NEW.stop_version,NEW.created_at)
 THEN RAISE EXCEPTION 'deep objective identity immutable'; END IF;
 IF NOT (
    (OLD.state='prepared' AND NEW.state='dispatching')
    OR (OLD.state='dispatching' AND NEW.state='reconcile-required')
    OR (OLD.state IN ('dispatching','reconcile-required') AND NEW.state='observed')
 ) THEN RAISE EXCEPTION 'deep objective transition denied'; END IF;
 IF NEW.state='observed' AND (
    NEW.issue_number IS NULL OR NEW.external_url IS NULL
    OR NEW.external_url <> ('https://github.com/michaeljwilliams0123/mahoraga/issues/' || NEW.issue_number::text)
 ) THEN RAISE EXCEPTION 'deep objective provider result mismatch'; END IF;
 NEW.updated_at:=statement_timestamp();
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS deep_objectives_guard ON brain_deep_objectives;
CREATE TRIGGER deep_objectives_guard
 BEFORE UPDATE OR DELETE ON brain_deep_objectives
 FOR EACH ROW EXECUTE FUNCTION deep_objectives_guard();
