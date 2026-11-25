-- Owner passkey ceremony for one exact deployment receipt. No new credential,
-- profile permission or general-purpose authority is created.
ALTER TABLE brain_owner_passkey_challenges DROP CONSTRAINT IF EXISTS brain_owner_passkey_challenges_operation_check;
ALTER TABLE brain_owner_passkey_challenges ADD CONSTRAINT brain_owner_passkey_challenges_operation_check
 CHECK(operation IN ('gitlab.branch.create','pr.comment','cloud.deploy'));
ALTER TABLE brain_owner_passkey_challenges DROP CONSTRAINT IF EXISTS brain_owner_passkey_challenges_resource_check;
ALTER TABLE brain_owner_passkey_challenges ADD CONSTRAINT brain_owner_passkey_challenges_resource_check CHECK(
 (operation='gitlab.branch.create' AND resource ~ '^sha256:[a-f0-9]{64}$') OR
 (operation='pr.comment' AND resource ~ '^github:pr-comment:michaeljwilliams0123/Ultron[.]MW:[1-9][0-9]{0,8}:sha256:[a-f0-9]{64}$') OR
 (operation='cloud.deploy' AND resource ~ '^hatchable:deployment:proj_A6GCXRSKizko:hatchable-v[1-9][0-9]{0,8}:sha256:[a-f0-9]{64}:source:[a-f0-9]{40}$')
);
