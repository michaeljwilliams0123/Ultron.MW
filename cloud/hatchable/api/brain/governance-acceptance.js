import {db} from 'hatchable';
import {recordGovernanceAcceptance} from 'lib/governance-acceptance.js';

export const access='admin';
export const methods=['POST'];
const GH='https://api.github.com/repos/michaeljwilliams0123/Ultron.MW';
const HEADERS={Accept:'application/vnd.github+json','User-Agent':'UltronMW-Governance-Acceptance'};
const SHA=/^[a-f0-9]{40}$/;

async function github(path){
 const response=await fetch(GH+path,{headers:HEADERS,signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('github-status-'+response.status);
 return response.json();
}
async function observeMain(){
 const ref=await github('/git/ref/heads/main');
 const sha=String(ref?.object?.sha||'');
 if(!SHA.test(sha))throw Error('main-sha-invalid');
 return {sha};
}
async function observePullRequest({number,headSha}){
 const [pr,reviews,checks]=await Promise.all([
  github('/pulls/'+number),github('/pulls/'+number+'/reviews'),
  github('/commits/'+headSha+'/check-runs')
 ]);
 const runs=Array.isArray(checks?.check_runs)?checks.check_runs:[];
 const exact=runs.filter(x=>x?.head_sha===headSha).map(x=>({
  id:x.id,name:String(x.name||'').slice(0,100),status:x.status,conclusion:x.conclusion,
  url:x.html_url||null
 }));
 const required=exact.filter(x=>x.name==='test');
 const approvals=(Array.isArray(reviews)?reviews:[]).filter(x=>
  x?.state==='APPROVED'&&x?.user?.type==='User'&&
  x?.user?.login&&x.user.login!=='michaeljwilliams0123');
 return {
  number:pr?.number,headSha:pr?.head?.sha,baseRef:pr?.base?.ref,
  state:pr?.state,draft:pr?.draft===true,url:pr?.html_url||null,
  exactHeadChecksGreen:required.length>0&&required.every(x=>
   x.status==='completed'&&['success','neutral','skipped'].includes(x.conclusion)),
  requiredChecks:required,eligibleIndependentApproval:approvals.length>0,
  eligibleApprovalCount:approvals.length
 };
}

export default async function(req,res){
 if(req.member?.handle!=='michaeljwilliams0123')return res.status(403).json({
  schema:'ultron.governance-acceptance.v1',ok:false,status:'held',
  reason:'owner-identity-required',providerWrites:0,productionAccepted:false
 });
 const result=await recordGovernanceAcceptance({db,request:req.body,
  observeMain,observePullRequest});
 const status=result.status==='held'?(result.reused?200:201):
  result.reason==='idempotency-conflict'?409:
  result.status==='reconcile-required'?503:400;
 return res.status(status).json({schema:'ultron.governance-acceptance.v1',
  ok:result.status==='held',...result});
}
