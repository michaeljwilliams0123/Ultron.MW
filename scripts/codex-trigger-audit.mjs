#!/usr/bin/env node
/**
 * A read-only, GitHub-only C03 event audit. A passing workflow proves only
 * transport admission, NEVER delivery to or execution by Codex/Work.
 */
import {readFile,appendFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {parseCodexCall,codexRecordPaths} from '../src/codex-call.mjs';
import {assessCodexTrigger} from '../src/codex-trigger-gate.mjs';
import {resolveCodexAuthor,isCodexRunCommand} from '../docs/core/codex-authors.mjs';
const exec=promisify(execFile);
const ROOT='repos/michaeljwilliams0123/Ultron.MW';
const SHA=/^[a-f0-9]{40}$/;
async function get(path,{optional=false}={}){
  try{
    const {stdout}=await exec('gh',['api','--hostname','github.com','--method','GET',path],
      {windowsHide:true,timeout:15000,maxBuffer:2000000});
    return JSON.parse(stdout);
  }catch(err){
    if(optional&&/HTTP 404\b/.test(String(err.stderr||'')))return null;
    throw Error('GitHub admission readback unavailable; executor not attested');
  }
}
function content(raw){
  if(raw?.type!=='file'||raw.encoding!=='base64'||typeof raw.content!=='string')
    throw Error('Codex proposal readback is not a file');
  return Buffer.from(raw.content,'base64').toString('utf8');
}
async function observe(){
  const event=JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8'));
  const n=event.issue?.number;
  if(!Number.isSafeInteger(n)||n<1)
    throw Error('Codex trigger event number invalid');
  const pr=await get(ROOT+'/pulls/'+n);
  const call=parseCodexCall(pr.body);
  const sourceIssue=await get(ROOT+'/issues/'+call.issueNumber);
  const main=await get(ROOT+'/git/ref/heads/main');
  if(!SHA.test(main?.object?.sha||'')||!SHA.test(pr.head?.sha||''))
    throw Error('GitHub source readback invalid');
  const proposal=content(await get(ROOT+'/contents/docs/proposals/issue-'+
    call.issueNumber+'.md?ref='+encodeURIComponent(pr.head.sha)));
  const comments=await get(ROOT+'/issues/'+n+'/comments?per_page=100');
  if(!Array.isArray(comments)||comments.length>=100)
    throw Error('Codex owner trigger inventory incomplete');
  const paths=codexRecordPaths(call);
  const [claim,receipt]=await Promise.all([
    get(ROOT+'/contents/'+paths.claim+'?ref='+encodeURIComponent(pr.head.sha),{optional:true}),
    get(ROOT+'/contents/'+paths.receipt+'?ref='+encodeURIComponent(pr.head.sha),{optional:true}),
  ]);
  const bindingFingerprint=resolveCodexAuthor(call.authorId,{requireBinding:true}).binding.fingerprint;
  const state=assessCodexTrigger({
    repository:process.env.GITHUB_REPOSITORY,actor:process.env.GITHUB_ACTOR,
    event,pr,issue:sourceIssue,mainSha:main.object.sha,proposalText:proposal,
    bindingFingerprint,
    ownerTriggerCount:comments.filter(c=>c?.user?.login==='michaeljwilliams0123'&&
      isCodexRunCommand(c.body,call.authorId)).length,
    ownerTriggerIds:comments.filter(c=>c?.user?.login==='michaeljwilliams0123'&&
      isCodexRunCommand(c.body,call.authorId)).map(c=>c.id),
    claimState:claim===null?'missing':'present',
    receiptState:receipt===null?'missing':'present',
  });
  // After all reads, verify that nothing important changed. No retries or writes.
  const [afterPr,afterIssue,afterMain]=await Promise.all([
    get(ROOT+'/pulls/'+n),
    get(ROOT+'/issues/'+call.issueNumber),
    get(ROOT+'/git/ref/heads/main'),
  ]);
  if(afterPr.head?.sha!==pr.head.sha||afterPr.body!==pr.body||
    afterPr.state!==pr.state||afterIssue.body!==sourceIssue.body||
    afterIssue.state!==sourceIssue.state||
    afterMain.object?.sha!==main.object.sha)
    throw Error('Codex event changed during readback; reconciliation required');
  return state;
}
try{
  const r=await observe();
  const summary=[
    '## C03 Codex trigger provenance (GitHub only)',
    '',
    '- Admission state: **'+r.state+'**',
    '- Reason: `'+r.reason+'`',
    '- Task ID: `'+(r.taskId||'not-admitted')+'`',
    '- Source SHA: `'+(r.sourceSha||'not-admitted')+'`',
    '- Work/Codex executor authenticated: **NO**',
    '- Independently verified external completion: **NO**',
    '- Production accepted: **NO**',
    '',
    'This is a read-only event audit. GitHub Actions success DOES NOT dispatch',
    'or attest a Codex Cloud task. Unknown claims/outcomes require reconciliation,',
    'not automatic replay. External Work event subscription is a separate gate.',
    '',
  ].join('\n');
  if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,summary);
  console.log(JSON.stringify({state:r.state,reason:r.reason,taskId:r.taskId||null,
    externalExecutionVerified:false,productionAccepted:false}));
}catch{
  console.error('C03 trigger admission not established; no executor claim, retry, or success.');
  process.exitCode=2;
}
