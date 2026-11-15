#!/usr/bin/env node
/**
 * Trusted-main role attestation verification. The root seed is a separate
 * protected Actions secret; a self-advertised public key is never a trust root.
 * Seven signatures attest to controller-produced records, not to seven Apps.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {deriveCouncilRolePublicKeys,verifyCouncilRoleVerdict}
 from '../src/council-role-attestation.mjs';
const out='council-role-attestation-verification.json';
const status=x=>{writeFileSync(out,JSON.stringify({
 schema:'ultron.council-role-attestation-verification.v1',...x
},null,2));console.log(JSON.stringify(x));};
const root=process.env.COUNCIL_MASTER_SEED||'';
if(!root){status({verified:false,reason:'root-not-configured',independentGithubReview:false});}
else{
 const sha=process.env.TARGET_SOURCE_SHA||'';
 const number=Number(process.env.ITEM_NUMBER);
 try{
  const data=JSON.parse(readFileSync('council-role-attestations.json','utf8'));
  const expected=deriveCouncilRolePublicKeys(root);
  const roles=['Builder','Skeptic','Steward','Predictor','Generator','Sentinel','Companion'];
  if(data.sourceSha!==sha||data.prNumber!==number||
   data.signerAuthority!=='shared-council-controller'||
   data.signedRoles!==7||data.independentGithubReview!==false||
   !Array.isArray(data.verdicts)||data.verdicts.length!==7||
   new Set(data.verdicts.map(x=>x.role)).size!==7||
   !roles.every(r=>data.verdicts.some(v=>v.role===r))||
   data.verdicts.some(v=>!verifyCouncilRoleVerdict(v,{
    trustedPublicKeys:expected,expectedSha:sha,expectedPr:number
   })))throw Error('missing-or-invalid-role-attestation');
  status({verified:true,rolesVerified:7,sourceSha:sha,
   independentGithubReview:false,authority:'shared-council-controller'});
 }catch(e){
  status({verified:false,reason:String(e.message).slice(0,130),
   independentGithubReview:false});
  process.exitCode=1;
 }
}
