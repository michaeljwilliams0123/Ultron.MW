/**
 * Read-only C03 GitHub trigger admission. An owner comment is transport evidence,
 * never a Codex/Work task, authenticated account, or external result.
 * No side effects and no replay/dispatch action are returned.
 */
import { parseCodexCall, validateCodexAdmission, CODEX_OWNER,
  CODEX_REPOSITORY } from './codex-call.mjs';

const SHA=/^[a-f0-9]{40}$/;
const evidence=(state,reason,extra={})=>Object.freeze({
  state,reason,externalExecutionVerified:false,
  workAccountAuthenticated:false,productionAccepted:false,...extra,
});

export function assessCodexTrigger({
  repository,actor,event,pr,issue,mainSha,proposalText,
  bindingFingerprint,ownerTriggerCount,claimState='unknown',receiptState='unknown',
}={}){
  if(repository!==CODEX_REPOSITORY||actor!==CODEX_OWNER||
    event?.action!=='created'||
    event.comment?.user?.login!==CODEX_OWNER||
    !Number.isSafeInteger(event.comment?.id)||event.comment.id<1||
    !Number.isSafeInteger(event.issue?.number)||event.issue.number<1||
    !event.issue?.pull_request||event.issue.state!=='open'||
    pr?.number!==event.issue.number)
    return evidence('held','untrusted-or-unrelated-event');

  let call;
  try { call=parseCodexCall(pr?.body); }
  catch { return evidence('held','invalid-task-envelope'); }

  if(event.comment.body!=='/codex run '+call.authorId)
    return evidence('held','command-does-not-match-author');
  if(!SHA.test(mainSha||'')||mainSha!==call.sourceSha)
    return evidence('held','stale-or-unverified-main');
  if(!Number.isSafeInteger(ownerTriggerCount)||
     ownerTriggerCount<0||ownerTriggerCount>100)
    return evidence('held','incomplete-trigger-inventory');
  try{
    validateCodexAdmission({pr,issue,mainSha,bindingFingerprint,proposalText});
  }catch{
    return evidence('held','invalid-owner-source-or-route');
  }
  const identity={taskId:call.taskId,sourceSha:call.sourceSha,
    prHeadSha:pr.head.sha,requestDigest:call.digest,
    bindingFingerprint:call.bindingFingerprint};
  if(ownerTriggerCount===0)
    return evidence('held','owner-trigger-unobserved',identity);
  if(ownerTriggerCount!==1)
    return evidence('reconcile-required','duplicate-owner-trigger',identity);
  if(!['missing','present','unknown'].includes(claimState)||
    !['missing','present','unknown'].includes(receiptState))
    return evidence('held','invalid-record-inventory',identity);
  if(claimState!=='missing'||receiptState!=='missing')
    return evidence('reconcile-required','executor-record-or-unknown-outcome',identity);
  return evidence('transport-observed-executor-unverified',
    'await-independent-executor-receipt',identity);
}
