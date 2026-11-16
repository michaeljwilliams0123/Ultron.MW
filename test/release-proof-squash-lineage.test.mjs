import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildReleaseProof} from '../src/evidence/release-proof.mjs';
import {collectMergedCouncilReadback} from '../cloud/hatchable/lib/release-github-readback.js';

const MAIN='a'.repeat(40),HEAD='b'.repeat(40),REPO_ID=1424939667,PR=468;
const sourcePr={
 number:PR,state:'closed',merged_at:'2026-11-15T23:35:12Z',
 merge_commit_sha:MAIN,draft:false,
 base:{ref:'main',repo:{id:REPO_ID,full_name:'michaeljwilliams0123/Ultron.MW'}},
 head:{sha:HEAD,repo:{id:REPO_ID,full_name:'michaeljwilliams0123/Ultron.MW'}}
};
const check={
 id:10000,name:'ultron/council-7of7',head_sha:HEAD,status:'completed',
 conclusion:'success',app:{id:5765239,slug:'ultron-council-gate'},
 output:{title:'7/7 Council roles and model reviews on exact head',summary:[
  '**Decision:** accepted','**PR:** #468','**Head:** '+HEAD,
  '**Role approvals:** 7/7','**Held roles:** none',
  '**Model hold/unavailable:** none','**Security-sensitive paths:** none'
 ].join('\n')}
};
const ci={verified:true,status:'verified',headSha:MAIN,workflowId:388875616,runId:43775618599};
const deployment={target:'hatchable-v119',sourceSha:MAIN,
 artifactDigest:'sha256:'+'c'.repeat(64),receiptId:'durable-readback-1',independentReadback:true};

test('squash-merge lineage binds exact main CI to Council App on verified source head',async()=>{
 const r=await buildReleaseProof({commitSha:MAIN,ci,councilCheck:check,sourcePr,deployment});
 assert.equal(r.verified,true);
 assert.equal(r.council.quorum,'7/7');
 assert.equal(r.council.publisherAppId,5765239);
 assert.equal(r.council.sourceHeadSha,HEAD);
 assert.equal(r.council.prNumber,468);
});

test('unmerged, wrong-source, wrong-repo or ambiguous lineage never verifies release',async()=>{
 for(const change of [
  {...sourcePr,merge_commit_sha:'d'.repeat(40)},
  {...sourcePr,merged_at:null},
  {...sourcePr,state:'open'},
  {...sourcePr,base:{...sourcePr.base,ref:'feature'}},
  {...sourcePr,head:{...sourcePr.head,sha:'d'.repeat(40)}},
  {...sourcePr,head:{...sourcePr.head,repo:{id:999,full_name:'foreign/repo'}}},
  {...sourcePr,base:{...sourcePr.base,repo:{id:999,full_name:'foreign/repo'}}},
  {...sourcePr,draft:true},
  {...sourcePr,number:999},
  {}
 ]){
  const r=await buildReleaseProof({commitSha:MAIN,ci,councilCheck:check,sourcePr:change,deployment});
  assert.equal(r.verified,false);
  assert.equal(r.council.verified,false);
 }
});

test('source check spoof, failed Council or missing deployed readback stays unverified',async()=>{
 for(const candidate of [
  {...check,app:{id:15368,slug:'github-actions'}},
  {...check,head_sha:MAIN},
  {...check,conclusion:'failure'},
  {...check,output:{...check.output,summary:check.output.summary.replace('#468','#467')}}
 ]){
  const r=await buildReleaseProof({commitSha:MAIN,ci,councilCheck:candidate,sourcePr,deployment});
  assert.equal(r.verified,false);
 }
 const noDeployment=await buildReleaseProof({commitSha:MAIN,ci,councilCheck:check,sourcePr,deployment:{}});
 assert.equal(noDeployment.council.verified,true);
 assert.equal(noDeployment.deployment.verified,false);
 assert.equal(noDeployment.verified,false);
});

const response=(v,links='')=>({ok:true,status:200,json:async()=>v,
 headers:{get:header=>header.toLowerCase()==='link'?links:null}});
test('independent GitHub fetch binds PR merge to exact main and source check; no credentials',async()=>{
 const calls=[];
 const fetcher=async (url,options)=>{
  calls.push({url,options});
  if(url.endsWith('/commits/'+MAIN+'/pulls?per_page=100'))return response([sourcePr]);
  if(url.endsWith('/pulls/468'))return response(sourcePr);
  if(url.includes('/commits/'+HEAD+'/check-runs?'))return response({total_count:1,check_runs:[check]});
  if(url.endsWith('/git/ref/heads/main'))return response({object:{sha:MAIN}});
  throw Error('unexpected external URL '+url);
 };
 const r=await collectMergedCouncilReadback({commitSha:MAIN,fetchGithub:fetcher});
 assert.equal(r.sourcePr.number,468);
 assert.equal(r.councilCheck.id,10000);
 assert.equal(calls.length,4);
 for(const call of calls){
  assert.ok(call.url.startsWith('https://api.github.com/repos/michaeljwilliams0123/Ultron.MW/'));
  assert.equal(call.options.headers.authorization,undefined);
  assert.equal(call.options.method,'GET');
 }
});

test('unavailable GitHub, mismatched merge, ambiguous PR, wrong check or superseded gate hold',async()=>{
 for(const merges of [[],[sourcePr,sourcePr],[{...sourcePr,merge_commit_sha:HEAD}]]){
  const r=await collectMergedCouncilReadback({commitSha:MAIN,fetchGithub:async()=>response(merges)});
  assert.equal(r.councilCheck,null);
 }
 const noApi=await collectMergedCouncilReadback({commitSha:MAIN,fetchGithub:async()=>({ok:false,status:403})});
 assert.equal(noApi.councilCheck,null);
 const olderSuccess={...check,id:5},newerFailure={...check,id:6,conclusion:'failure'};
 const fetcher=async url=>{
  if(url.includes('/pulls?'))return response([sourcePr]);
  if(url.endsWith('/pulls/468'))return response(sourcePr);
  if(url.includes('/check-runs?'))return response({total_count:2,check_runs:[olderSuccess,newerFailure]});
  if(url.endsWith('/git/ref/heads/main'))return response({object:{sha:MAIN}});
  throw Error('unexpected-url');
 };
 const result=await collectMergedCouncilReadback({commitSha:MAIN,fetchGithub:fetcher});
 assert.equal(result.councilCheck.conclusion,'failure');
 assert.equal((await buildReleaseProof({commitSha:MAIN,ci,deployment,sourcePr:result.sourcePr,
  councilCheck:result.councilCheck})).verified,false);
});

test('missing pagination bounds, schema drift and ambiguous associations fail closed',async()=>{
 const scenarios=[
  {prs:[sourcePr],link:'<https://api.github.com/next>; rel="next"'},
  {prs:[sourcePr,{}],link:''},
  {prs:[sourcePr],checks:{total_count:50,check_runs:[check]}},
  {prs:[sourcePr],checks:{check_runs:[check]}}
 ];
 for(const scenario of scenarios){
  const f=async url=>{
   if(url.includes('/commits/'+MAIN+'/pulls?'))return response(scenario.prs,scenario.link||'');
   if(url.endsWith('/pulls/468'))return response(sourcePr);
   if(url.includes('/check-runs?'))return response(scenario.checks||{total_count:1,check_runs:[check]});
   if(url.endsWith('/git/ref/heads/main'))return response({object:{sha:MAIN}});
   throw Error('unexpected-url');
  };
  const r=await collectMergedCouncilReadback({commitSha:MAIN,fetchGithub:f});
  assert.equal(r.councilCheck,null);
 }
});

test('independent PR read disagreement and moving canonical main never promote Council evidence',async()=>{
 for(const wrong of [
  {...sourcePr,merge_commit_sha:HEAD},
  {...sourcePr,head:{...sourcePr.head,sha:'d'.repeat(40)}},
  {...sourcePr,base:{...sourcePr.base,repo:{id:1,full_name:'foreign/repo'}}},
  null
 ]){
  const f=async url=>{
   if(url.includes('/commits/'+MAIN+'/pulls?'))return response([sourcePr]);
   if(url.endsWith('/pulls/468'))return response(wrong);
   if(url.includes('/check-runs?'))return response({total_count:1,check_runs:[check]});
   if(url.endsWith('/git/ref/heads/main'))return response({object:{sha:MAIN}});
   throw Error('unexpected-url');
  };
  assert.equal((await collectMergedCouncilReadback({commitSha:MAIN,fetchGithub:f})).councilCheck,null);
 }
 const drift=async url=>{
  if(url.includes('/commits/'+MAIN+'/pulls?'))return response([sourcePr]);
  if(url.endsWith('/pulls/468'))return response(sourcePr);
  if(url.includes('/check-runs?'))return response({total_count:1,check_runs:[check]});
  if(url.endsWith('/git/ref/heads/main'))return response({object:{sha:HEAD}});
  throw Error('unexpected-url');
 };
 assert.equal((await collectMergedCouncilReadback({commitSha:MAIN,fetchGithub:drift})).councilCheck,null);
});

test('owner GET route preserves independent deployment HOLD and source policy mirrors cloud',()=>{
 const api=readFileSync(new URL('../cloud/hatchable/api/brain/release-proof.js',import.meta.url),'utf8');
 assert.match(api,/collectMergedCouncilReadback/);
 assert.match(api,/sourcePr:.*sourcePr/);
 assert.match(api,/deployment:\{\}/);
 assert.match(api,/access='admin'/);
 assert.equal(readFileSync(new URL('../src/evidence/release-proof.mjs',import.meta.url),'utf8'),
  readFileSync(new URL('../cloud/hatchable/lib/release-proof.js',import.meta.url),'utf8'));
});
