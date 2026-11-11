/** Lane rules that fix the two cheapest recurring red X's without touching
 * the legacy workflows. Phase 1 uses them only to project what a lane would
 * have reported (shadow); at cutover the lane preflight calls them directly.
 *
 * 1. pr-conversation: an owner comment on an open `ultron/` PR that is not an
 *    admitted Ultron PR is a no-op, not a failed agent. pr-brain.mjs exits 1
 *    with "Unadmitted PR cannot access Ultron brain" (~99 lifetime failures).
 * 2. codex-trigger-audit: a `/codex run` with nothing admitted is a neutral
 *    audit result, not a red X. The script exits 2 by design (fail-closed);
 *    the lane keeps fail-closed semantics but reports `neutral`.
 */
const REPO='michaeljwilliams0123/Ultron.MW';
const SHA=/^[a-f0-9]{40}$/;

/** Mirrors the PR checks in handlePrConversation (src/pr-brain.mjs). The
 * contract test runs both on the same fixtures so the two cannot drift. */
export function prConversationAdmission(pr,{number}={}){
  if(!pr||pr.number!==number)return Object.freeze({admit:false,status:'skipped-unreadable'});
  if(pr.state==='closed')return Object.freeze({admit:false,status:'ignored-closed'});
  if(pr.state==='open'&&typeof pr.head?.ref==='string'&&!pr.head.ref.startsWith('ultron/'))
    return Object.freeze({admit:false,status:'ignored-unmanaged'});
  if(pr.state!=='open'||pr.base?.ref!=='main'||pr.base?.repo?.full_name!==REPO||
    pr.head?.repo?.full_name!==REPO||!pr.head?.ref?.startsWith('ultron/')||!SHA.test(pr.head?.sha||''))
    return Object.freeze({admit:false,status:'skipped-not-ultron-branch'});
  const body=String(pr.body||'');
  const marked=body.startsWith('<!-- ULTRON_SELF_SCAN_PR_V1 -->')||body.includes('Manifest digest: ')||
    body.includes('## Ultron issue #')||pr.head.ref.startsWith('ultron/framework-');
  if(!marked)return Object.freeze({admit:false,status:'skipped-unadmitted'});
  return Object.freeze({admit:true,status:'admitted'});
}

const RULES=Object.freeze([
  {workflow:'owner-comment-router.yml',match:/Unadmitted PR cannot access Ultron brain/,
    projected:'skipped',reason:'unadmitted Ultron PR: lane preflight skips pr-conversation'},
  {workflow:'pr-brain.yml',match:/Unadmitted PR cannot access Ultron brain/,
    projected:'skipped',reason:'unadmitted Ultron PR: lane preflight skips converse'},
  {workflow:'codex-trigger-audit.yml',match:/C03 trigger admission not established/,
    projected:'neutral',reason:'nothing admitted: audit reports neutral, no executor claim'},
  {workflow:'*',match:/Internal server error|job was not acquired by Runner|The hosted runner encountered an error|lost communication with the server/i,
    projected:'rerun',reason:'GitHub service-side failure: rerun the whole workflow once on the same head'},
]);

/** Projects how a lane would report one failed legacy run. `log` is the
 * failed job's log tail; `jobCount` 0 means GitHub never created jobs. */
export function classifyLegacyFailure({workflow,log='',jobCount}={}){
  if(jobCount===0)return Object.freeze({projected:'rerun',
    reason:'no jobs created (#351 pattern): unknown-missing, rerun whole workflow'});
  for(const rule of RULES)
    if((rule.workflow==='*'||rule.workflow===workflow)&&rule.match.test(String(log)))
      return Object.freeze({projected:rule.projected,reason:rule.reason});
  return Object.freeze({projected:'red',reason:'real failure: stays red and goes to the self-repair loop'});
}

/** Lane exit policy: only a real failure is red. */
export function laneConclusion(outcomes){
  const list=Array.isArray(outcomes)?outcomes:[];
  if(list.some(o=>o==='red'))return 'failure';
  if(list.some(o=>o==='admitted'||o==='success'))return 'success';
  return 'neutral';
}
