import { createHash } from 'node:crypto';
import { readFile, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { githubRequest } from './cloud-pr.mjs';
import { applyPrPatch } from './pr-brain-patch.mjs';
import { generateAndApply } from './pr-brain-model.mjs';
import { parseMultiFileRequest, generateAndApplyMulti } from './pr-brain-multifile.mjs';
import { dispatchAndObserveVerify } from './pr-brain-verify.mjs';
import { buildFrameworkOnPr } from './framework-builder.mjs';
import { CREDENTIAL_POLICY } from './capability-credentials.mjs';

const OWNER='michaeljwilliams0123';
const REPO=OWNER+'/Ultron.MW';
const ROOT='/repos/'+REPO;
const MARK='<!-- ULTRON_PR_BRAIN_V1 comment:';
const SHA=/^[a-f0-9]{40}$/;
const FINDINGS=Object.freeze({
  'ci-head-unobserved':'Dispatch a Verify run bound to the exact PR branch; only independent success confirms the check.',
  'live-execution-unobserved':'Execute an authenticated end-user request against the actual deployed runtime and compare its durable receipt with the source SHA.',
  'learning-effect-unobserved':'Run held-out prediction tests, record realized outcomes, then compare them with the baseline. CI alone does not prove learning.',
  'routing-contract-gap':'Identify the missing source link and propose an exact-context source patch; verify head before claiming repair.',
  'missing-source-path':'Identify the missing expected source file and restore it with an independently verifiable patch.',
});
function sha256(value){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function short(s,max=300){return String(s||'').replace(/[\r\n<>]/g,' ').slice(0,max);}
function directPhrase(body){
  return String(body||'').match(/^\s*(?:@ultron(?:\.mw)?\b|\/ultron\b|ultron:)\s*([\s\S]*)$/i)?.[1];
}
/** Workflow preflight for the optional CPU runtime. */
export function needsPrModelRuntime(body){
  const direct=directPhrase(body);
  const phrase=(direct===undefined?String(body||''):direct).trim();
  // A bare command can be a short follow-up. The full handler still verifies
  // that conversation history admits it before invoking the model.
  return /^implement\s+[\s\S]{5,500}$/i.test(phrase);
}
export function admitPrTurn(event,eventName,actor,repository){
  const inline=eventName==='pull_request_review_comment';
  if(!inline&&eventName!=='issue_comment')throw Error('Unsupported conversation event');
  const c=event?.comment;
  const number=inline?event.pull_request?.number:event.issue?.number;
  if(repository!==REPO||actor!==OWNER||event?.action!=='created'||
    c?.user?.login!==OWNER||!Number.isSafeInteger(c?.id)||c.id<1||
    typeof c.body!=='string'||c.body.length<1||c.body.length>22000||
    !Number.isSafeInteger(number)||number<1||
    (!inline&&!event.issue?.pull_request))
    throw Error('Only owner-authored Ultron pull-request comments are admitted');
  return {number,commentId:c.id,body:c.body.trim(),raw:c.body,inline};
}
export function routePrTurn(body,history=[]){
  let phrase=directPhrase(body);
  if(phrase===undefined){
    const last=history.at(-1);
    if(last?.user?.login==='github-actions[bot]'&&last.body?.startsWith(MARK)&&
      body.length<=1600)phrase=body;
  }
  if(phrase===undefined)return null;
  const value=phrase.trim();
  if(!value||/^(help|commands|what can you do)\??$/i.test(value))return {kind:'help'};
  if(/^(status|state|what changed|where are we)\??$/i.test(value))return {kind:'status'};
  if(/^(findings|gaps|weaknesses|what is wrong)\??$/i.test(value))return {kind:'findings'};
  if(/^(next|and now|what next|next steps)\??$/i.test(value))return {kind:'next'};
  if(/^(verify|run checks|rerun checks)\??$/i.test(value))return {kind:'verify'};
  if(/^(regress|regression|run regression|run regression tests|full regression)\??$/i.test(value))
    return {kind:'regress'};
  const create=value.match(/^build\s+(api|mcp)\s+([a-z][a-z0-9-]{2,30})$/i);
  if(create)return {kind:'build',type:create[1].toLowerCase(),slug:create[2].toLowerCase()};
  if(/^(credentials|secrets|tokens|credential status)\??$/i.test(value))
    return {kind:'credentials'};
  if(/^(rescan|scan again|scan yourself)\??$/i.test(value))return {kind:'rescan'};
  const specific=value.match(/^(?:address|fix|explain|why|plan)\s+([a-z0-9][a-z0-9-]{0,80})\??$/i);
  if(specific)return {kind:'address',code:specific[1].toLowerCase()};
  const multi=parseMultiFileRequest(value);
  if(multi)return multi;
  const implement=value.match(/^implement\s+([\s\S]{5,500})$/i);
  if(implement)return {kind:'implement',objective:implement[1].trim()};
  const patch=value.match(/^(?:patch|apply)\s*\n([\s\S]+)$/i);
  if(patch)return {kind:'patch',manifest:patch[1]};
  return {kind:'unknown',text:value.slice(0,160)};
}
function readFindings(source){
  if(!source?.startsWith('<!-- ULTRON_SELF_SCAN_REPORT_V1 -->'))return [];
  const section=source.split('## Findings\n')[1]?.split('\n## ')[0]||'';
  return section.split('\n').flatMap(row=>{
    const cells=row.split('|').slice(1,-1).map(x=>x.trim());
    return cells.length===4&&/^[a-z][a-z0-9-]{0,80}$/.test(cells[1])?
      [{priority:cells[0],code:cells[1],detail:cells[2],suggestion:cells[3]}]:[];
  }).slice(0,20);
}
async function listComments(get,number,inline){
  const prefix=ROOT+(inline?'/pulls/':'/issues/')+number+'/comments';
  const all=[];
  for(let page=1;page<=5;page++){
    const part=await get(prefix+'?per_page=100&page='+page);
    if(!Array.isArray(part))throw Error('Cannot verify PR conversation');
    all.push(...part);
    if(part.length<100)return all;
  }
  throw Error('PR conversation pagination incomplete');
}
function verifyLine(action){
  const result=action?.verify;
  if(result?.state==='completed')return 'Authenticated exact-head Verify: **'+result.conclusion+'** ('+result.url+').';
  return 'Verify requested but its terminal conclusion was not yet independently observed.';
}
function answer({turn,pr,intent,findings,history,action}){
  const lines=[MARK+turn.commentId+' -->','### Ultron PR brain','',
    'PR #'+turn.number+' to main; head '+pr.head.sha.slice(0,12),
    'Conversation history digest: '+sha256(history.slice(-12).map(x=>[x.id,x.body])).slice(0,16),
    ''];
  switch(intent.kind){
  case 'help':lines.push(
    'Available: @ultron status, findings, next, address <finding-code>, regress, build api <slug>, build mcp <slug>, credentials, verify, rescan, implement <objective>, or patch followed by a JSON manifest.',
    'Owner-authored replies in the same conversation can use short follow-ups. Source mutations require an explicit exact-head manifest.');break;
  case 'status':lines.push('Open PR branch: '+pr.head.ref,
    'Exact PR head: '+pr.head.sha,'Source-scan findings: '+findings.length,
    'Provider / runtime readiness: not independently established.');break;
  case 'findings':lines.push(...(findings.length?findings.map(x=>
    '- '+short(x.code,90)+' ('+short(x.priority,20)+'): '+short(x.detail)):
    ['No verified self-scan findings available on this PR branch.']));
    lines.push('Use @ultron address <finding-code>.');break;
  case 'next':lines.push(findings.length?
    'Next candidate: '+findings[0].code+' — '+short(findings[0].suggestion):
    'No structured findings observed. Try @ultron status or @ultron rescan.');break;
  case 'address':{
    const row=findings.find(x=>x.code===intent.code);
    const remedy=FINDINGS[intent.code];
    if(!row&&!remedy)lines.push('Finding not established: '+intent.code+'. Try @ultron findings.');
    else{
      lines.push('Finding: '+intent.code, row?'Observed: '+short(row.detail):'Known category, not present in current scan.',
        'Next action: '+(remedy||short(row.suggestion)));
      if(action?.requested)lines.push(verifyLine(action));
      lines.push('To commit a source repair here, supply @ultron patch followed by a bounded JSON manifest.');
    }break;
  }
  case 'verify':case 'regress':
    lines.push('Complete cloud regression suite requested against PR head '+pr.head.ref+'.',
      verifyLine(action));
    if(action?.verify?.conclusion!=='success')
      lines.push('No green regression claim until exact-head CI independently finishes.');
    break;
  case 'credentials':
    lines.push('Owner-controlled credentials framework:',
      '- '+CREDENTIAL_POLICY.owner,
      '- '+CREDENTIAL_POLICY.externalProviders,
      '- '+CREDENTIAL_POLICY.deployedApi,
      '- '+CREDENTIAL_POLICY.publicRepo,
      'Runtime-owned HMAC bearer tokens can be issued with fixed scopes and expiry. GitHub/OAuth/third-party secret grants cannot be fabricated by a public PR comment.');
    break;
  case 'build':
    if(action.error)lines.push('Framework build rejected: '+short(action.error,280),
      'No source commit or generated credentials claimed.');
    else lines.push('Generated '+action.kind.toUpperCase()+' integration: '+action.slug,
      'Source commit: '+action.commitSha,
      'Generated source, test and deployment contract: '+action.paths.join(', '),
      'Credential authority: runtime secret references; no values written to GitHub.',
      'The generated connector is not a continuously deployed API.',
      verifyLine(action),
      'No automatic merge. New provider scopes still require owner-authorized credentials.');
    break;
  case 'rescan':lines.push('Self-scan workflow dispatched on main.',
    'Material changes update the existing findings PR; no Issue is created.');break;
  case 'implement':case 'implement-multi':
    if(action.error)lines.push('CPU model implementation did not produce an accepted source change.',
      'Reason: '+short(action.error,240),
      'No code commit, test pass or deployment is claimed. Try a smaller objective naming one file.');
    else lines.push('Public CPU model proposed '+(intent.kind==='implement-multi'?'coordinated source changes':'a source change')+', validated and committed on this PR branch.',
      'Model: '+action.model+' (pinned model files)',
      'New source SHA: '+action.commitSha,
      'Changed: '+action.paths.join(', '),
      verifyLine(action),
      action.rollback?.status==='committed'?
        'Failed model patch automatically restored by a new auditable commit: '+action.rollback.sha+
        '. '+(action.rollback.verify?.state==='completed'?
          'Restored-head Verify: **'+action.rollback.verify.conclusion+'**.':
          'Restored-head Verify is pending.') :
        action.rollback?.status==='failed'?
          'Automatic rollback was attempted but could not be verified: '+short(action.rollback.reason):
          'No rollback was necessary or no terminal failure was observed.');
    break;
  case 'patch':lines.push('Exact-context source patch committed to this PR branch.',
    'New commit: '+action.commitSha,'Files: '+action.paths.join(', '),
    verifyLine(action),
    'No automatic merge or production deployment occurred.');break;
  default:lines.push('I cannot verify an open-ended answer or safely infer source changes from that message.',
    'Try @ultron findings or @ultron address ci-head-unobserved.',
    'Received: '+short(intent.text));break;
  }
  lines.push('','This reply uses GitHub source and conversation evidence. No unverified model inference or claimed consciousness.');
  return lines.join('\n');
}
export async function handlePrConversation({event,eventName,actor,repository,get,post,patch,
  generate=generateAndApply,generateMulti=generateAndApplyMulti,
  observeVerify=dispatchAndObserveVerify,
  buildFramework=buildFrameworkOnPr}={}){
  const turn=admitPrTurn(event,eventName,actor,repository);
  if(typeof get!=='function'||typeof post!=='function'||typeof patch!=='function')
    throw Error('PR conversation GitHub adapter incomplete');
  const pr=await get(ROOT+'/pulls/'+turn.number);
  // Closed/superseded PR discussions are ordinary no-ops, not failed agents.
  if(pr?.number===turn.number && pr.state==='closed')
    return {status:'ignored-closed',prNumber:turn.number,created:false};
  if(pr?.number!==turn.number||pr.state!=='open'||pr.base?.ref!=='main'||
    pr.base?.repo?.full_name!==REPO||pr.head?.repo?.full_name!==REPO||
    !pr.head?.ref?.startsWith('ultron/')||!SHA.test(pr.head?.sha||''))
    throw Error('PR must be an open same-repo Ultron branch into main');
  if(!pr.body?.startsWith('<!-- ULTRON_SELF_SCAN_PR_V1 -->')&&
    !pr.body?.includes('Manifest digest: ')&&
    !pr.body?.includes('## Ultron issue #')&&
    !pr.head.ref.startsWith('ultron/framework-'))
    throw Error('Unadmitted PR cannot access Ultron brain');
  const comments=await listComments(get,turn.number,turn.inline);
  const source=comments.find(x=>x.id===turn.commentId);
  if(!source||source.user?.login!==OWNER||source.body!==turn.raw)
    throw Error('Originating owner comment cannot be reverified');
  const prior=comments.filter(x=>x.id!==turn.commentId).slice(-12);
  const priorReceipt=comments.find(x=>x.user?.login==='github-actions[bot]'&&
    x.body?.startsWith(MARK+turn.commentId+' -->'));
  if(priorReceipt)return {status:'already-replied',prNumber:turn.number,
    replyId:priorReceipt.id,created:false};
  const intent=routePrTurn(turn.body,prior);
  if(!intent)return {status:'ignored',prNumber:turn.number,created:false};
  let report=null;
  if(pr.head.ref.startsWith('ultron/self-scan-')){
    report=await get(ROOT+'/contents/reports/self-scan/current.md?ref='+
      encodeURIComponent(pr.head.ref));
    if(report?.encoding!=='base64')throw Error('Scan source report unavailable');
  }
  const findings=readFindings(report?
    Buffer.from(report.content.replace(/\s/g,''),'base64').toString('utf8'):'');
  let action={};
  if(intent.kind==='verify'||intent.kind==='regress'||intent.kind==='address'&&
    intent.code==='ci-head-unobserved'){
    action={requested:true,verify:await observeVerify({get,post,branch:pr.head.ref,headSha:pr.head.sha})};
  }else if(intent.kind==='rescan'){
    await post(ROOT+'/actions/workflows/self-scan-pr.yml/dispatches',{ref:'main'});
    action={requested:true};
  }else if(intent.kind==='implement'||intent.kind==='implement-multi'){
    try{
      action=intent.kind==='implement-multi'?
        await generateMulti({pr,paths:intent.paths,objective:intent.objective,get,post}):
        await generate({pr,objective:intent.objective,get,post});
    }catch(error){action={error:error instanceof Error?error.message:'Model inference failed'};}
    if(!action.error&&SHA.test(action.commitSha||'')){
      pr.head.sha=action.commitSha;
      try{
        action.verify=await observeVerify({get,post,branch:pr.head.ref,headSha:pr.head.sha});
      }catch(error){action.verify={state:'pending',conclusion:null};
        action.verifyError=error instanceof Error?error.message:'Verify could not be observed';}
      // One bounded, exact-context undo on independent Verify failure.
      // Never force-update main; this writes a new auditable revert commit
      // and independently verifies the restored PR head.
      if(action.verify?.state==='completed'&&action.verify.conclusion!=='success'&&
        Array.isArray(action.rollbackChanges)&&action.rollbackChanges.length){
        try{
          const manifest=JSON.stringify({objective:'Restore source after failed model Verify',
            baseSha:pr.head.sha,changes:action.rollbackChanges});
          const restored=await patch({pr,manifest,get,post});
          pr.head.sha=restored.commitSha;
          action.rollback={status:'committed',sha:restored.commitSha};
          try{action.rollback.verify=await observeVerify({get,post,
            branch:pr.head.ref,headSha:pr.head.sha});}
          catch(error){action.rollback.verify={state:'pending',conclusion:null};}
        }catch(error){action.rollback={status:'failed',
          reason:error instanceof Error?error.message:'Rollback failed'};}
      }
    }
  }else if(intent.kind==='build'){
    try{
      action=await buildFramework({pr,kind:intent.type,slug:intent.slug,get,post});
      pr.head.sha=action.commitSha;
      try{
        action.verify=await observeVerify({get,post,branch:pr.head.ref,headSha:pr.head.sha});
      }catch(error){action.verify={state:'pending',conclusion:null,
        reason:'Independent regression observation unavailable'};}
    }catch(error){action={error:error instanceof Error?error.message:'Build unavailable'};}
  }else if(intent.kind==='patch'){
    action=await patch({pr,manifest:intent.manifest,get,post});
    pr.head.sha=action.commitSha;
    action.verify=await observeVerify({get,post,branch:pr.head.ref,headSha:pr.head.sha});
  }
  const body=answer({turn,pr,intent,findings,history:prior,action});
  const replyPath=turn.inline?ROOT+'/pulls/'+turn.number+'/comments/'+turn.commentId+
    '/replies':ROOT+'/issues/'+turn.number+'/comments';
  const receipt=await post(replyPath,{body});
  if(!Number.isSafeInteger(receipt?.id)||receipt.id<1)
    throw Error('PR reply not acknowledged by GitHub');
  const verified=await get(turn.inline?ROOT+'/pulls/comments/'+receipt.id:
    ROOT+'/issues/comments/'+receipt.id);
  if(verified?.id!==receipt.id||verified.body!==body||
    verified.user?.login!=='github-actions[bot]')
    throw Error('PR reply readback failed');
  return {status:'replied',prNumber:turn.number,replyId:receipt.id,
    intent:intent.kind,action,created:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const event=JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8'));
    const result=await handlePrConversation({event,
      eventName:process.env.GITHUB_EVENT_NAME,actor:process.env.GITHUB_ACTOR,
      repository:process.env.GITHUB_REPOSITORY,
      get:p=>githubRequest(p),
      post:(p,b)=>githubRequest(p,{method:'POST',body:b}),
      patch:applyPrPatch});
    if(process.env.GITHUB_STEP_SUMMARY)
      await appendFile(process.env.GITHUB_STEP_SUMMARY,
        '### Ultron PR brain\n\nStatus: '+result.status+
        '\nPR: #'+(result.prNumber||'n/a')+'\nIntent: '+(result.intent||'none')+'\n');
    console.log(JSON.stringify(result));
  }catch(e){console.error('Ultron PR brain rejected: '+e.message);process.exitCode=1;}
}
