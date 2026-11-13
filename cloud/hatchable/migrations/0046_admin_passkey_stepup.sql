-- 0046: Admin-only WebAuthn step-up. Do NOT renumber/rewrite 0041.
-- Schema-only, fail-closed. No passkey is enrolled, enabled, or elevated by this DDL.
-- Actual WebAuthn assertion/signature verification remains in trusted runtime.
-- Legacy 0033 gitlab.branch.create challenge semantics remain unchanged.

CREATE TABLE IF NOT EXISTS brain_admin_passkey_capabilities(
 credential_id TEXT PRIMARY KEY
  REFERENCES brain_owner_passkeys(credential_id) ON DELETE RESTRICT,
 allow_admin_executor BOOLEAN NOT NULL DEFAULT FALSE,
 allow_vault_custody BOOLEAN NOT NULL DEFAULT FALSE,
 allow_signed_events BOOLEAN NOT NULL DEFAULT FALSE,
 approval_grant_id TEXT UNIQUE
  REFERENCES brain_authority_grants(grant_id) ON DELETE RESTRICT,
 approved_until TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT brain_admin_passkey_capabilities_no_implicit_elevation
 CHECK (
  (NOT allow_admin_executor AND NOT allow_vault_custody AND NOT allow_signed_events)
  OR (approval_grant_id IS NOT NULL AND approved_until IS NOT NULL)
 )
);

CREATE OR REPLACE FUNCTION brain_admin_passkey_capabilities_guard()
RETURNS trigger AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'admin-passkey-capability-immutable'; END IF;
 IF TG_OP='UPDATE' AND (NEW.credential_id<>OLD.credential_id OR
   NEW.created_at<>OLD.created_at)
 THEN RAISE EXCEPTION 'admin-passkey-capability-identity-immutable'; END IF;
 IF NEW.allow_admin_executor OR NEW.allow_vault_custody OR NEW.allow_signed_events THEN
  IF NOT EXISTS (
   SELECT 1 FROM brain_authority_grants g
   JOIN brain_owner_passkeys p ON p.credential_id=NEW.credential_id
   WHERE g.grant_id=NEW.approval_grant_id
    AND g.actor='mcp:ultron'
    AND g.operation='owner.admin.passkey.enable'
    AND g.resource='owner-passkey:'||NEW.credential_id||
      ':admin='||NEW.allow_admin_executor::text||
      ':vault='||NEW.allow_vault_custody::text||
      ':events='||NEW.allow_signed_events::text
    AND g.expires_at>clock_timestamp()
    AND p.revoked_at IS NULL
    AND NEW.approved_until<=g.expires_at
    AND NEW.approved_until>clock_timestamp()
  ) THEN RAISE EXCEPTION 'admin-passkey-capability-owner-grant-required'; END IF;
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS brain_admin_passkey_capabilities_guard_trg
 ON brain_admin_passkey_capabilities;
CREATE TRIGGER brain_admin_passkey_capabilities_guard_trg
 BEFORE INSERT OR UPDATE OR DELETE ON brain_admin_passkey_capabilities
 FOR EACH ROW EXECUTE FUNCTION brain_admin_passkey_capabilities_guard();

-- Runtime readers must use this effective view rather than raw flags.
-- Approval expiry and credential revocation automatically deny prior approval.
CREATE OR REPLACE VIEW brain_admin_passkey_effective_capabilities AS
 SELECT c.credential_id,
  (c.allow_admin_executor AND c.approved_until>clock_timestamp()
   AND p.revoked_at IS NULL) AS can_admin_executor,
  (c.allow_vault_custody AND c.approved_until>clock_timestamp()
   AND p.revoked_at IS NULL) AS can_vault_custody,
  (c.allow_signed_events AND c.approved_until>clock_timestamp()
   AND p.revoked_at IS NULL) AS can_signed_events
 FROM brain_admin_passkey_capabilities c
 JOIN brain_owner_passkeys p ON p.credential_id=c.credential_id;

-- Separate table: the 0033 legacy challenge remains nonadministrative.
-- The named operation and SHA-256 plan digest must be independently validated
-- by the trusted owner authority and WebAuthn verifier before verified_at is set.
CREATE TABLE IF NOT EXISTS brain_admin_passkey_stepup_challenges(
 challenge_id TEXT PRIMARY KEY
  CHECK (length(challenge_id) BETWEEN 16 AND 96
   AND challenge_id ~ '^admin-stepup-[A-Za-z0-9-]+$'),
 challenge TEXT NOT NULL UNIQUE
  CHECK (length(challenge)=43 AND challenge ~ '^[A-Za-z0-9_-]+$'),
 credential_id TEXT NOT NULL
  REFERENCES brain_owner_passkeys(credential_id) ON DELETE RESTRICT,
 owner_grant_id TEXT NOT NULL UNIQUE
  REFERENCES brain_authority_grants(grant_id) ON DELETE RESTRICT,
 actor TEXT NOT NULL CHECK (actor='mcp:ultron'),
 operation TEXT NOT NULL CHECK (operation IN (
  'actions.dispatch','actions.rerun_failed','actions.cancel',
  'actions.enable','actions.disable','repository.settings.update',
  'webhooks.ping','vault.custody.access','signed.event.emit'
 )),
 resource TEXT NOT NULL CHECK (
  (operation IN ('actions.dispatch','actions.rerun_failed','actions.cancel',
    'actions.enable','actions.disable','repository.settings.update','webhooks.ping')
   AND resource ~ '^ultron:github:michaeljwilliams0123/Ultron[.]MW:sha256:[a-f0-9]{64}$')
  OR (operation='vault.custody.access'
   AND resource ~ '^owner-vault:sha256:[a-f0-9]{64}$')
  OR (operation='signed.event.emit'
   AND resource ~ '^signed-event:sha256:[a-f0-9]{64}$')
 ),
 policy_sha TEXT NOT NULL CHECK (policy_sha ~ '^[a-f0-9]{64}$'),
 administrative_change BOOLEAN NOT NULL DEFAULT TRUE CHECK (administrative_change),
 profile_version BIGINT NOT NULL CHECK (profile_version>0),
 stop_version BIGINT NOT NULL CHECK (stop_version>0),
 expires_at TIMESTAMPTZ NOT NULL,
 verified_at TIMESTAMPTZ,
 consumed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (expires_at>created_at AND expires_at<=created_at+interval '5 minutes'),
 CHECK (consumed_at IS NULL OR verified_at IS NOT NULL),
 CHECK (verified_at IS NULL OR (verified_at>=created_at AND verified_at<=expires_at)),
 CHECK (consumed_at IS NULL OR (consumed_at>=verified_at AND consumed_at<=expires_at))
);

CREATE INDEX IF NOT EXISTS brain_admin_passkey_stepup_expiry_idx
 ON brain_admin_passkey_stepup_challenges(expires_at)
 WHERE consumed_at IS NULL;

CREATE OR REPLACE FUNCTION brain_admin_passkey_stepup_guard()
RETURNS trigger AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'admin-passkey-stepup-immutable'; END IF;
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS (
   SELECT 1 FROM brain_authority_grants g
   JOIN brain_owner_passkeys p ON p.credential_id=NEW.credential_id
   WHERE g.grant_id=NEW.owner_grant_id
    AND g.actor=NEW.actor AND g.operation=NEW.operation
    AND g.resource=NEW.resource AND g.policy_sha=NEW.policy_sha
    AND g.expires_at>=NEW.expires_at
    AND g.expires_at>clock_timestamp() AND p.revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'admin-passkey-stepup-owner-grant-unbound'; END IF;
  IF NEW.verified_at IS NOT NULL OR NEW.consumed_at IS NOT NULL THEN
   RAISE EXCEPTION 'admin-passkey-stepup-starts-unverified'; END IF;
 ELSE
  IF OLD.consumed_at IS NOT NULL THEN
   RAISE EXCEPTION 'admin-passkey-stepup-consumed-immutable'; END IF;
  IF NEW.challenge_id<>OLD.challenge_id OR NEW.challenge<>OLD.challenge OR
     NEW.credential_id<>OLD.credential_id OR
     NEW.owner_grant_id<>OLD.owner_grant_id OR NEW.actor<>OLD.actor OR
     NEW.operation<>OLD.operation OR NEW.resource<>OLD.resource OR
     NEW.policy_sha<>OLD.policy_sha OR NEW.administrative_change<>OLD.administrative_change OR
     NEW.profile_version<>OLD.profile_version OR NEW.stop_version<>OLD.stop_version OR
     NEW.expires_at<>OLD.expires_at OR NEW.created_at<>OLD.created_at OR
     (OLD.verified_at IS NOT NULL AND NEW.verified_at IS DISTINCT FROM OLD.verified_at)
  THEN RAISE EXCEPTION 'admin-passkey-stepup-identity-immutable'; END IF;
  IF NEW.verified_at IS NOT NULL AND clock_timestamp()>=OLD.expires_at THEN
   RAISE EXCEPTION 'admin-passkey-stepup-expired'; END IF;
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS brain_admin_passkey_stepup_guard_trg
 ON brain_admin_passkey_stepup_challenges;
CREATE TRIGGER brain_admin_passkey_stepup_guard_trg
 BEFORE INSERT OR UPDATE OR DELETE ON brain_admin_passkey_stepup_challenges
 FOR EACH ROW EXECUTE FUNCTION brain_admin_passkey_stepup_guard();

-- No owner profile expansion, secret exposure, vault read, nonce issuance,
-- token mint, or runtime enablement is performed by this migration.
