-- C04: extend the immutable GitHub execution ledger to one owner-signed,
-- Coordinator-App-authored pull-request comment. Historical branch receipts
-- keep their existing shape and constraints.
ALTER TABLE github_idempotent_executions
  ADD COLUMN target_kind TEXT NOT NULL DEFAULT 'branch',
  ADD COLUMN target_number BIGINT,
  ADD COLUMN body_sha256 TEXT,
  ADD COLUMN grant_id TEXT REFERENCES brain_authority_grants(grant_id),
  ADD COLUMN provider_comment_id BIGINT,
  ADD COLUMN provider_url TEXT,
  ADD COLUMN provider_actor TEXT,
  ADD COLUMN provider_app_id BIGINT;

ALTER TABLE github_idempotent_executions
  ALTER COLUMN target_branch DROP NOT NULL;

ALTER TABLE github_idempotent_executions
  DROP CONSTRAINT github_idempotent_executions_check1;

ALTER TABLE github_idempotent_executions
  ADD CONSTRAINT github_idempotent_executions_target_kind_check
  CHECK (target_kind IN ('branch','pull_request_comment')),
  ADD CONSTRAINT github_idempotent_executions_target_shape_check
  CHECK (
    (target_kind='branch' AND target_branch IS NOT NULL AND
      target_number IS NULL AND body_sha256 IS NULL AND grant_id IS NULL) OR
    (target_kind='pull_request_comment' AND target_branch IS NULL AND
      target_number BETWEEN 1 AND 999999999 AND
      body_sha256 ~ '^[a-f0-9]{64}$' AND grant_id IS NOT NULL)
  ),
  ADD CONSTRAINT github_idempotent_executions_provider_shape_check
  CHECK (
    (state<>'completed' AND provider_comment_id IS NULL AND provider_url IS NULL AND
      provider_actor IS NULL AND provider_app_id IS NULL) OR
    (state='completed' AND (
      target_kind='branch' OR
      (provider_comment_id>0 AND
       provider_url ~ '^https://github.com/michaeljwilliams0123/Ultron[.]MW/(issues|pull)/[1-9][0-9]*/?#issuecomment-[1-9][0-9]*$' AND
       provider_actor='ultron-coordinator[bot]' AND provider_app_id=5633654)
    ))
  ),
  ADD CONSTRAINT github_idempotent_executions_receipt_v2_check
  CHECK (receipt IS NULL OR (
    receipt->>'idempotencyKey'=idempotency_key AND
    receipt->'details'->>'operationDigest'=operation_digest AND
    receipt->'details'->>'repository'=repository AND
    receipt->'details'->>'personaRole'=persona_role AND
    receipt->'details'->>'remoteVerified'='true' AND
    receipt->>'status' IN ('success','reconciled_success','recovered_success') AND
    CASE target_kind
      WHEN 'branch' THEN
        receipt->'details'->>'branch'=target_branch AND
        receipt->'details'->>'sha' ~ '^[a-f0-9]{40}$'
      WHEN 'pull_request_comment' THEN
        (receipt->'details'->>'pullRequest')::bigint=target_number AND
        receipt->'details'->>'bodySha256'=body_sha256 AND
        (receipt->'details'->>'commentId')::bigint=provider_comment_id AND
        receipt->'details'->>'commentUrl'=provider_url AND
        receipt->'details'->>'actor'=provider_actor AND
        (receipt->'details'->>'appId')::bigint=provider_app_id
      ELSE false
    END
  ) IS TRUE);

CREATE UNIQUE INDEX github_idempotent_pr_comment_target
 ON github_idempotent_executions(repository,target_number,body_sha256)
 WHERE target_kind='pull_request_comment';
CREATE UNIQUE INDEX github_idempotent_pr_comment_grant
 ON github_idempotent_executions(grant_id)
 WHERE grant_id IS NOT NULL;
CREATE UNIQUE INDEX github_idempotent_pr_comment_provider
 ON github_idempotent_executions(provider_comment_id)
 WHERE provider_comment_id IS NOT NULL;

-- Preserve the original transition graph while making all new target and
-- provider identity columns immutable after reservation.
CREATE OR REPLACE FUNCTION github_idempotent_executions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'github-idempotent-immutable'; END IF;
  IF OLD.state='completed' THEN RAISE EXCEPTION 'github-idempotent-completed-immutable'; END IF;
  IF NEW.idempotency_key<>OLD.idempotency_key OR
     NEW.operation_digest<>OLD.operation_digest OR
     NEW.repository<>OLD.repository OR
     NEW.target_kind<>OLD.target_kind OR
     NEW.target_branch IS DISTINCT FROM OLD.target_branch OR
     NEW.target_number IS DISTINCT FROM OLD.target_number OR
     NEW.body_sha256 IS DISTINCT FROM OLD.body_sha256 OR
     NEW.grant_id IS DISTINCT FROM OLD.grant_id OR
     (OLD.provider_comment_id IS NOT NULL AND
       (NEW.provider_comment_id,NEW.provider_url,NEW.provider_actor,NEW.provider_app_id)
       IS DISTINCT FROM
       (OLD.provider_comment_id,OLD.provider_url,OLD.provider_actor,OLD.provider_app_id)) OR
     (OLD.state='reconcile_required' AND NEW.state<>'completed') OR
     (OLD.state='in_flight' AND NEW.state NOT IN ('completed','reconcile_required')) OR
     (OLD.state='reserved' AND NEW.state NOT IN ('in_flight','completed','reconcile_required'))
  THEN RAISE EXCEPTION 'github-idempotent-transition-denied'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
