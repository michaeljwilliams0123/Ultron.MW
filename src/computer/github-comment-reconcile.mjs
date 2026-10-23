import { createHash } from 'node:crypto';
import { normalizeComputerPlan } from './executor.mjs';

const sha256 = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ID = /^[a-z0-9][a-z0-9_.-]{0,79}$/i;
const LOGIN = /^[a-z0-9](?:[a-z0-9-]{0,38})$/i;
const REPO = /^[a-z0-9_.-]{1,100}$/i;
const CANARY = /\bULTRON_BROWSER_WRITE_CANARY_[A-Z0-9_]{12,80}\b/;
const URL_RE = /^\/([a-z0-9-]+)\/([a-z0-9_.-]+)\/pull\/([1-9][0-9]*)\/?$/i;

function strictGithubCommentPlan(plan, allowedOrigins, ownerLogin) {
  if (!LOGIN.test(ownerLogin || '') || allowedOrigins.length !== 1 ||
      allowedOrigins[0] !== 'https://github.com')
    throw Error('GitHub readback requires exact trusted owner and GitHub scope');
  const normalized = normalizeComputerPlan(plan, { allowedOrigins });
  const last = normalized.steps.at(-1), type = normalized.steps.at(-2);
  if (normalized.steps.length < 3 || last.action !== 'click' ||
      type.action !== 'type' || !last.selector.includes('Comment') ||
      !last.selector.includes('submit') || !type.value ||
      !last.expect?.textIncludes || !CANARY.test(last.expect.textIncludes) ||
      !type.value.includes(last.expect.textIncludes))
    throw Error('GitHub comment confirmation requires a bound type/publish pair and unique canary marker');
  const navigation = [...normalized.steps].reverse().find(s => s.action === 'navigate');
  if (!navigation) throw Error('GitHub readback requires a PR navigation step');
  const url = new URL(navigation.url);
  const match = url.origin === 'https://github.com' && !url.search && !url.hash &&
    url.pathname.match(URL_RE);
  if (!match || !LOGIN.test(match[1]) || !REPO.test(match[2]) ||
      match[1].toLowerCase() !== ownerLogin.toLowerCase())
    throw Error('GitHub readback scope mismatches exact owner/PR destination');
  return { normalized, type, last, repository:match[1]+'/'+match[2],
    issue:Number(match[3]), message:type.value };
}

/**
 * Narrow read-only reconciliation of an *already dispatched* GitHub comment.
 * A positive independent REST API readback cannot be inferred from browser
 * URL, DOM text, user approval or a guessed comment ID. Never dispatches.
 */
export async function reconcileGithubCommentCheckpoint({
  plan, allowedOrigins, store, ownerLogin, readComments,
  apply = true, clock = () => new Date().toISOString(),
} = {}) {
  if (!store || typeof store.read !== 'function' ||
      typeof store.write !== 'function' || typeof readComments !== 'function')
    throw Error('Reconciliation requires checkpoint store and independent read-only provider');
  const { normalized, type, last, repository, issue, message } =
    strictGithubCommentPlan(plan, allowedOrigins, ownerLogin);
  const checkpoint = await store.read(normalized.id);
  if (!checkpoint || checkpoint.fingerprint !== sha256(normalized))
    throw Error('Checkpoint fingerprint mismatch or missing original');
  if (checkpoint.status === 'completed' && checkpoint.pending === null &&
      checkpoint.reconciliation?.mode === 'github-api-readback')
    return { status:'completed', id:normalized.id,
      reconciliation:checkpoint.reconciliation, resumed:true };
  if (checkpoint.status !== 'reconcile-required' ||
      checkpoint.pending !== last.id || checkpoint.errorCode !== 'outcome-unverified' ||
      !Array.isArray(checkpoint.completed) || !Array.isArray(checkpoint.receipts) ||
      checkpoint.completed.length !== normalized.steps.length-1 ||
      checkpoint.receipts.length !== normalized.steps.length-1 ||
      normalized.steps.slice(0,-1).some((s,i) =>
        checkpoint.completed[i] !== s.id ||
        checkpoint.receipts[i]?.stepId !== s.id ||
        checkpoint.receipts[i]?.status !== 'verified') ||
      !checkpoint.receipts.some(r=>r.stepId===type.id && r.action==='type'))
    throw Error('Checkpoint is not a verifiable pending GitHub publish');
  const typed = checkpoint.receipts.find(r=>r.stepId===type.id);
  const afterTyped = Date.parse(typed.observedAt);
  const started = Date.parse(checkpoint.createdAt);
  if (!Number.isFinite(afterTyped) || !Number.isFinite(started) ||
      afterTyped < started || afterTyped-started > 20*60*1000)
    throw Error('Checkpoint write window is missing or inconsistent');
  let comments;
  try { comments = await readComments({ repository, issue }); }
  catch { return {status:'reconcile-required',id:normalized.id,
    pending:last.id,reason:'Read-only provider unavailable; no modification'}; }
  if (!Array.isArray(comments))
    return {status:'reconcile-required',id:normalized.id,pending:last.id,
      reason:'Provider returned untrusted or partial evidence'};
  const exact = comments.filter(c=>c?.body === message);
  if (exact.length !== 1)
    return {status:'reconcile-required',id:normalized.id,pending:last.id,
      reason:exact.length > 1?'Duplicate exact comments; owner investigation required':'Exact published comment not independently confirmed'};
  const c = exact[0];
  const when = Date.parse(c.created_at);
  const canonical = 'https://github.com/'+repository+'/pull/'+issue+'#issuecomment-'+c.id;
  if (!Number.isSafeInteger(c.id) || c.id < 1 ||
      c.user?.login?.toLowerCase() !== ownerLogin.toLowerCase() ||
      c.html_url !== canonical || !Number.isFinite(when) ||
      when < afterTyped || when - afterTyped > 10*60*1000)
    return {status:'reconcile-required',id:normalized.id,pending:last.id,
      reason:'Comment identity, URL, actor or timing does not match checkpoint'};
  const proof = Object.freeze({
    mode:'github-api-readback',commentId:c.id,commentUrl:canonical,
    providerCreatedAt:c.created_at,bodySha256:createHash('sha256').update(message).digest('hex'),
    previousPending:last.id,previousFailurePhase:checkpoint.failurePhase||null,
    previousErrorCode:checkpoint.errorCode,
    verifiedAt:clock(),
  });
  if (!apply) return {status:'reconciliation-ready',id:normalized.id,
    pending:last.id,reconciliation:proof,dispatches:0};
  const receipt={stepId:last.id,action:last.action,status:'verified',
    observedAt:clock(),origin:'https://github.com',
    verificationMode:proof.mode,
    observationDigest:sha256({commentId:c.id,createdAt:c.created_at,bodySha256:proof.bodySha256}),
    resultDigest:sha256({commentId:c.id,repository,issue})};
  const next={...checkpoint,status:'completed',pending:null,
    completed:[...checkpoint.completed,last.id],
    receipts:[...checkpoint.receipts,receipt],reconciliation:proof};
  // Original ambiguous outcome retained in proof; never issue another click.
  delete next.errorCode;
  delete next.failurePhase;
  delete next.failureKind;
  delete next.observedOrigin;
  delete next.observedPath;
  delete next.observedVisualDigest;
  await store.write(normalized.id,next);
  return {status:'completed',id:normalized.id,
    reconciliation:proof,resumed:true,dispatches:0};
}
