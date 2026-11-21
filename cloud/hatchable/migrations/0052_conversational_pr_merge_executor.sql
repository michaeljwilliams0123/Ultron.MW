-- Extend existing owner WebAuthn challenge ledger to conversational PR squash merge.
-- Uses existing owner passkeys, runtime controls, and council_room_messages.
ALTER TABLE brain_owner_passkey_challenges
 DROP CONSTRAINT IF EXISTS brain_owner_passkey_challenges_operation_check;
ALTER TABLE brain_owner_passkey_challenges
 ADD CONSTRAINT brain_owner_passkey_challenges_operation_check
 CHECK(operation IN ('gitlab.branch.create','pr.comment','pr.merge'));
ALTER TABLE brain_owner_passkey_challenges
 DROP CONSTRAINT IF EXISTS brain_owner_passkey_challenges_resource_check;
ALTER TABLE brain_owner_passkey_challenges
 ADD CONSTRAINT brain_owner_passkey_challenges_resource_check
 CHECK(
  (operation='gitlab.branch.create' AND resource ~ '^sha256:[a-f0-9]{64}$')
  OR
  (operation='pr.comment' AND
   resource ~ '^github:pr-comment:michaeljwilliams0123/Ultron[.]MW:[1-9][0-9]{0,8}:sha256:[a-f0-9]{64}$')
  OR
  (operation='pr.merge' AND
   resource ~ '^github:pr-merge:michaeljwilliams0123/Ultron[.]MW:[1-9][0-9]{0,8}:head:[a-f0-9]{40}$')
 );

CREATE TABLE IF NOT EXISTS github_pr_merge_executions (
 idempotency_key TEXT PRIMARY KEY,
 operation_digest TEXT NOT NULL,
 repository TEXT NOT NULL,
 target_number INTEGER NOT NULL CHECK (target_number BETWEEN 1 AND 999999999),
 head_sha TEXT NOT NULL CHECK (head_sha ~ '^[a-f0-9]{40}$'),
 grant_id TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL CHECK (state IN ('reserved','in_flight','completed','reconcile_required','denied_no_effect')),
 merge_commit_sha TEXT CHECK (merge_commit_sha IS NULL OR merge_commit_sha ~ '^[a-f0-9]{40}$'),
 provider_url TEXT,
 receipt JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE (repository, target_number, head_sha)
);

UPDATE brain_owner_autonomy_profile
SET allowed_operations=allowed_operations || jsonb_build_array('pr.merge'),
    version=version+1,
    updated_at=now()
WHERE id=1 AND owner='michaeljwilliams0123'
 AND NOT jsonb_exists(allowed_operations,'pr.merge');
