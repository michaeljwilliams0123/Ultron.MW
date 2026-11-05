#!/usr/bin/env node
/** Phase 3: prove that a Council role's GitHub App installation token authors
 * a real GitHub effect. Posts one marked comment, reads it back from GitHub,
 * and records evidence. "authenticated" is claimed ONLY when GitHub's own
 * response shows the expected bot author AND the expected App slug.
 * Configured credentials alone never produce a verified result. */
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

export const REPO='michaeljwilliams0123/Ultron.MW';
const ROLES=['Builder','Skeptic','Steward','Predictor','Generator','Sentinel','Companion'];

export function expectedIdentity(role,slug){
 if(!ROLES.includes(role))throw Error('identity-proof-role-invalid');
 const appSlug=slug||'ultron-mw-'+role.toLowerCase();
 return{appSlug,botLogin:appSlug+'[bot]'};
}

/** Pure judgement over GitHub's readback of the comment. */
export function judgeIdentityProof({role,slug,posted,readback,marker}){
 const want=expectedIdentity(role,slug);
 const checks={
  bodyHasMarker:typeof readback?.body==='string'&&readback.body.includes(marker),
  sameComment:Boolean(posted?.id)&&readback?.id===posted.id,
  authorIsExpectedBot:readback?.user?.login===want.botLogin&&readback?.user?.type==='Bot',
  viaExpectedApp:readback?.performed_via_github_app?.slug===want.appSlug,
  onThisRepository:typeof readback?.html_url==='string'&&readback.html_url.includes('/'+REPO+'/')
 };
 const authenticated=Object.values(checks).every(Boolean);
 return Object.freeze({schema:'ultron.council-identity-proof.v1',role,expected:want,checks,
  authenticated,independentReview:false,modelInvoked:false,
  evidence:authenticated?{commentId:readback.id,url:readback.html_url,
   authorLogin:readback.user.login,authorId:readback.user.id,appId:readback.performed_via_github_app.id,
   appSlug:readback.performed_via_github_app.slug,createdAt:readback.created_at}:null});
}

export async function proveIdentity({role,slug,token,issueNumber,runUrl,sha,fetchImpl=fetch}){
 if(!token||!Number.isSafeInteger(issueNumber)||issueNumber<1)throw Error('identity-proof-input-invalid');
 const marker='council-identity-proof:'+role.toLowerCase()+':'+createHash('sha256').update(String(runUrl)+sha).digest('hex').slice(0,16);
 const call=async(method,path,body)=>{
  const r=await fetchImpl('https://api.github.com/repos/'+REPO+path,{method,signal:AbortSignal.timeout(15000),
   headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json','user-agent':'ultron-identity-proof','content-type':'application/json'},
   body:body===undefined?undefined:JSON.stringify(body)});
  if(!r.ok)throw Error('github-'+r.status+' '+method+' '+path);
  return r.json();
 };
 const posted=await call('POST','/issues/'+issueNumber+'/comments',{body:
  '**'+role+'** identity proof (`'+marker+'`). This comment demonstrates which GitHub identity authored it; it is not a review.\n\n'+
  'Run: '+runUrl+'\nSource: `'+sha+'`\n\n<!-- '+marker+' -->'});
 const readback=await call('GET','/issues/comments/'+posted.id);
 return judgeIdentityProof({role,slug,posted,readback,marker});
}

if(import.meta.url===new URL(process.argv[1],'file:').href||process.argv[1]?.endsWith('council-identity-proof.mjs')){
 const role=process.env.COUNCIL_ROLE;
 const result=await proveIdentity({role,slug:process.env.COUNCIL_APP_SLUG||undefined,token:process.env.APP_TOKEN,
  issueNumber:Number(process.env.ISSUE_NUMBER),sha:process.env.GITHUB_SHA,
  runUrl:process.env.GITHUB_SERVER_URL+'/'+REPO+'/actions/runs/'+process.env.GITHUB_RUN_ID});
 writeFileSync('council-identity-proof.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify(result,null,2));
 if(!result.authenticated)process.exitCode=1;
}
