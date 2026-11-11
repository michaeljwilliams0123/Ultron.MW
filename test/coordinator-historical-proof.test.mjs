import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyHistoricalCoordinatorProof} from '../cloud/hatchable/lib/coordinator-historical-proof.js';

const REPO='michaeljwilliams0123/Ultron.MW';
const ROOT='/repos/'+REPO;
const SHA='ab1fedf1595956221cd92c7c1c6b3980c147b728';
const MAIN='a8f6959320119a927ef202c783f8f47da0fc5544';
const COMMENT=ROOT+'/issues/comments/6777504499';
const RUN=ROOT+'/actions/runs/42888428130';
const REF=ROOT+'/git/ref/heads/main';
const COMPARE=ROOT+'/compare/'+SHA+'...'+MAIN;

function fixtures(){
 return {
  [COMMENT]:{
   id:6777504499,issue_url:'https://api.github.com'+ROOT+'/issues/186',
   user:{login:'ultron-coordinator[bot]',id:353078104,type:'Bot'},
   body:'**Builder** identity proof (council-identity-proof:builder:a75b152fa573d364)\n'+
    'Run: https://github.com/'+REPO+'/actions/runs/42888428130\n'+
    'Source: '+String.fromCharCode(96)+SHA+String.fromCharCode(96)+'\n'+
    '<!-- council-identity-proof:builder:a75b152fa573d364 -->',
   performed_via_github_app:null
  },
  [RUN]:{
   id:42888428130,event:'workflow_dispatch',status:'completed',conclusion:'success',
   head_sha:SHA,repository:{id:1424939667,full_name:REPO},
   head_repository:{id:1424939667,full_name:REPO},
   actor:{login:'michaeljwilliams0123',id:308995719,type:'User'},
   triggering_actor:{login:'michaeljwilliams0123',id:308995719,type:'User'}
  },
  [REF]:{ref:'refs/heads/main',object:{type:'commit',sha:MAIN}},
  [COMPARE]:{
   status:'ahead',behind_by:0,ahead_by:3,
   merge_base_commit:{sha:SHA},commits:[{sha:MAIN}]
  }
 };
}
async function run(mutator=()=>{}){
 const data=fixtures();mutator(data);
 const calls=[];
 const caller=async(name,{method,path})=>{
  assert.equal(name,'github_operator');
  assert.equal(method,'GET');
  assert.ok([COMMENT,RUN,REF,COMPARE].includes(path),'unsupported GET '+path);
  calls.push(path);
  return {status:200,body:data[path]};
 };
 const result=await verifyHistoricalCoordinatorProof(caller);
 assert.equal(result.productionAccepted,false);
 assert.equal(result.externalMutationAuthorized,false);
 assert.equal(result.ownerSignedGrantVerified,false);
 assert.equal(result.durableWriteReceiptVerified,false);
 assert.equal(result.installationVerified,false);
 assert.equal(result.readOnly,true);
 assert.equal(result.paidExternalSpendUSD,0);
 assert.equal(calls.some(x=>x.includes('POST')),false);
 return result;
}
test('historical bot comment/run/main ancestry passes without claiming App attribution',async()=>{
 const result=await run();
 assert.equal(result.state,'historical-proof-partial');
 assert.equal(result.botIdentityVerified,true);
 assert.equal(result.workflowVerified,true);
 assert.equal(result.mainLineageVerified,true);
 assert.equal(result.historicalGithubCommentObserved,true);
 assert.equal(result.githubAppProvenanceVerified,false);
 assert.equal(result.mainSha,MAIN);
});
test('matching GitHub App attribution is separately verified but never write authorization',async()=>{
 const result=await run(d=>{
  d[COMMENT].performed_via_github_app={id:5633654,slug:'ultron-coordinator'};
 });
 assert.equal(result.state,'historical-proof-verified');
 assert.equal(result.githubAppProvenanceVerified,true);
});
for(const [name,mutator] of [
 ['wrong app id',d=>{d[COMMENT].performed_via_github_app={id:33,slug:'ultron-coordinator'};}],
 ['spoofed bot numeric id',d=>{d[COMMENT].user.id=99;}],
 ['wrong issue',d=>{d[COMMENT].issue_url='https://api.github.com/repos/other/repo/issues/186';}],
 ['tampered historical marker',d=>{d[COMMENT].body=d[COMMENT].body.replace('a75b152fa573d364','0000000000000000');}],
 ['wrong workflow owner',d=>{d[RUN].triggering_actor.id=354634860;}],
 ['failed workflow',d=>{d[RUN].conclusion='failure';}],
 ['wrong repo id',d=>{d[RUN].repository.id=123;}],
 ['wrong workflow SHA',d=>{d[RUN].head_sha='f'.repeat(40);}],
 ['divergent main lineage',d=>{d[COMPARE].status='diverged';d[COMPARE].behind_by=1;}],
 ['malformed main SHA',d=>{d[REF].object.sha='not-a-sha';}]
]){
 test('rejects '+name,async()=>{
  const r=await run(mutator);
  assert.equal(r.state,'historical-proof-unverified');
 });
}
test('provider outage fails closed without exposing secrets',async()=>{
 const r=await verifyHistoricalCoordinatorProof(async()=>{throw Error('offline');});
 assert.equal(r.state,'provider-readback-unavailable');
 assert.equal(r.productionAccepted,false);
 assert.doesNotMatch(JSON.stringify(r),/access_token|private_key|client_secret/i);
});
test('API remains owner-only GET and contains no provider write path',()=>{
 const code=readFileSync(new URL('../cloud/hatchable/api/brain/coordinator-proof.js',
  import.meta.url),'utf8');
 assert.match(code,/access\s*=\s*'admin'/);
 assert.match(code,/methods\s*=\s*\['GET'\]/);
 assert.match(code,/req\.member\?\.handle/);
 assert.doesNotMatch(code,/\b(?:POST|PUT|PATCH|DELETE)\b/);
});
