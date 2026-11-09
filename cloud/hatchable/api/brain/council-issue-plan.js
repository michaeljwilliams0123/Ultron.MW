import {inspectOpenIssue} from 'lib/council-issues.js';
import {makeIssueCouncilPlan,validateCandidateFiles} from 'lib/issue-council-plan.js';

export const access='admin';
export const methods=['POST'];
const OWNER='michaeljwilliams0123';
const MAIN='https://api.github.com/repos/michaeljwilliams0123/Ultron.MW/git/ref/heads/main';
function reply(res,status,payload){
 res.setHeader('cache-control','private, no-store');
 res.setHeader('vary','Cookie');
 return res.status(status).json({ok:status===200,...payload});
}
async function mainSha(){
 try{
  const r=await fetch(MAIN,{method:'GET',cache:'no-store',redirect:'error',
   headers:{Accept:'application/vnd.github+json','User-Agent':'UltronMW-Issue-Council'},
   signal:AbortSignal.timeout(9000)});
  if(!r.ok)return null;
  const j=await r.json();
  const sha=j?.object?.sha;
  return /^[a-f0-9]{40}$/.test(sha||'')?sha:null;
 }catch{return null}
}
export default async function(req,res){
 if(req.member?.handle!==OWNER)return reply(res,403,{error:'owner-required'});
 if(req.method!=='POST')return reply(res,405,{error:'method-not-allowed'});
 const input=req.body;
 if(!input||typeof input!=='object'||Array.isArray(input)||
   Object.keys(input).some(k=>!['issueNumber','mode','candidateFiles'].includes(k))||
   !Number.isSafeInteger(input.issueNumber)||input.issueNumber<1||
   input.issueNumber>1000000000||!['plan','prepare'].includes(input.mode))
  return reply(res,400,{error:'request-invalid'});
 let candidateFiles;
 try{candidateFiles=validateCandidateFiles(input.candidateFiles)}
 catch{return reply(res,422,{error:'scope-invalid'})}
 try{
  // Every request independently re-fetches this fixed repository's live issue.
  // GitHub issue body, labels and links are always untrusted data.
  const [issue,sourceSha]=await Promise.all([
   inspectOpenIssue(input.issueNumber),mainSha()
  ]);
  const plan=makeIssueCouncilPlan({issue,sourceSha,mode:input.mode,candidateFiles});
  return reply(res,200,{plan});
 }catch(error){
  const message=String(error?.message||'github-read-failed');
  const name=/^(issue-not-open-or-not-found|issue-number-invalid|github-(?:unreachable|rate-limited-or-unauthorized|invalid-response|http-[0-9]+))$/.test(message)?
    message:'issue-readback-unavailable';
  return reply(res,502,{error:name});
 }
}
