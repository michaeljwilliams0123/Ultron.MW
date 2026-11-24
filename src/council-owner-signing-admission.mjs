// Local signing admission only. Does not publish, sign, or change release policy.
import {isOwnerAccount,councilExactHeadCiReady} from './council-trusted-gate.mjs';
const SHA=/^[a-f0-9]{40}$/;
const REPO='michaeljwilliams0123/Ultron.MW';
const canonical=repo=>repo?.id===1424939667&&repo?.full_name===REPO;
const decisions=new Set(['APPROVED','CHANGES_REQUESTED','DISMISSED']);

export function assertOwnerOverrideAdmission({principal,pr,expectedHead,expectedBase,reviews,checks}={}){
 if(!isOwnerAccount(principal))throw Error('Primary GitHub owner authentication is required');
 if(!pr||!Number.isSafeInteger(pr.number)||pr.number<1||pr.state!=='open'||pr.draft!==false||
    pr.base?.ref!=='main'||!canonical(pr.head?.repo)||!canonical(pr.base?.repo)||
    !SHA.test(pr.head?.sha||'')||!SHA.test(pr.base?.sha||''))
  throw Error('Canonical open non-draft PR targeting main is required');
 const {sha:head}=pr.head,{sha:base}=pr.base;
 const authored=isOwnerAccount(pr.user);
 if((!authored&&(!SHA.test(expectedHead||'')||!SHA.test(expectedBase||'')))||
    (expectedHead!=null&&expectedHead!==head)||(expectedBase!=null&&expectedBase!==base))
  throw Error('Exact reviewed head/base required; PR target changed or unspecified');
 if(!authored){
  if(!Array.isArray(reviews))throw Error('Complete GitHub review inventory required');
  const relevant=reviews.filter(r=>isOwnerAccount(r?.user)&&decisions.has(r?.state));
  if(relevant.some(r=>!Number.isSafeInteger(r.id)||r.id<1||!Number.isFinite(Date.parse(r.submitted_at))))
   throw Error('Invalid owner review metadata');
  const latest=relevant.sort((a,b)=>Date.parse(b.submitted_at)-Date.parse(a.submitted_at)||b.id-a.id)[0];
  if(latest?.state!=='APPROVED'||latest.commit_id!==head)
   throw Error('Delegated PR requires current genuine owner approval on the exact head');
 }
 if(!councilExactHeadCiReady(checks,head))
  throw Error('Required exact-head GitHub Actions checks not verified');
 return Object.freeze({head,base,via:authored?'owner-authored':'owner-approved-exact-head'});
}
