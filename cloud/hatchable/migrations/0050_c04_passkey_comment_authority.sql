-- Extend the EXISTING owner WebAuthn challenge ledger to one additional
-- owner-only, origin-bound operation. No new table, signer, app, grant key,
-- credential, or paid infrastructure is introduced.
-- The original GitLab operation retains exactly its previous resource shape.
ALTER TABLE brain_owner_passkey_challenges
 DROP CONSTRAINT IF EXISTS brain_owner_passkey_challenges_operation_check;
ALTER TABLE brain_owner_passkey_challenges
 ADD CONSTRAINT brain_owner_passkey_challenges_operation_check
 CHECK(operation IN ('gitlab.branch.create','pr.comment'));
ALTER TABLE brain_owner_passkey_challenges
 DROP CONSTRAINT IF EXISTS brain_owner_passkey_challenges_resource_check;
ALTER TABLE brain_owner_passkey_challenges
 ADD CONSTRAINT brain_owner_passkey_challenges_resource_check
 CHECK(
  (operation='gitlab.branch.create' AND resource ~ '^sha256:[a-f0-9]{64}$')
  OR
  (operation='pr.comment' AND
   resource ~ '^github:pr-comment:michaeljwilliams0123/Ultron[.]MW:[1-9][0-9]{0,8}:sha256:[a-f0-9]{64}$')
 );
