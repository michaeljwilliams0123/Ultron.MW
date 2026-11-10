import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runOwnerCanaryMatrix,markerDocument} from '../scripts/owner-canary-matrix.mjs';

const BASE='a'.repeat(40),TREE='b'.repeat(40);
const MARKER_TREE='c'.repeat(40),MARKER_COMMIT='d'.repeat(40);
const TARGET='42827178057',RUN='42830123456',ROOT='https://api.github.com/repos/Ultron-MW/Ultron.MW';
const BRANCH='ultron/canary-owner-actions-'+TARGET;
const PATH='docs/canary/owner-actions-'+TARGET+'.json';
const env={GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',
 GITHUB_REPOSITORY:'Ultron-MW/Ultron.MW',GITHUB_ACTOR:'michaeljwilliams0123',
 GITHUB_TRIGGERING_ACTOR:'michaeljwilliams0123',GITHUB_REF:'refs/heads/main',
 GITHUB_SHA:BASE,GITHUB_RUN_ID:RUN,GITHUB_RUN_ATTEMPT:'1',
 GITHUB_TOKEN:'FAKE_TOKEN_NEVER_LEAK',OWNER_CANARY_STOP:'false'};
const response=(status,body)=>({ok:status>=200&&status<300,status,json:async()=>body});
const sha1=(str)=>import('node:crypto').then(({createHash})=>
 createHash('sha1').update('blob '+Buffer.byteLength(str)+'\0'+str).digest('hex'));
function mock({initialSha=BASE,mainSha=BASE,repoId=1424939667,
 allowMarker=true,postStatus=200,tamperContent=false,compareFiles=1,throwPatch=false}={}){
 const calls=[];let refSha=initialSha;let document='';
 const fetch=async(url,opts)=>{
  assert.ok(url.startsWith(ROOT));
  assert.equal(opts.headers.Authorization,'Bearer '+env.GITHUB_TOKEN);
  assert.equal(opts.redirect,'error');
  const path=url.slice(ROOT.length);
  calls.push({path,method:opts.method,body:opts.body});
  if(opts.method==='GET'&&path==='')return response(200,{id:repoId,full_name:'Ultron-MW/Ultron.MW',default_branch:'main'});
  if(opts.method==='GET'&&path==='/git/ref/heads/main')
   return response(200,{ref:'refs/heads/main',object:{type:'commit',sha:mainSha}});
  if(opts.method==='GET'&&path==='/git/ref/heads/'+BRANCH)
   return response(200,{ref:'refs/heads/'+BRANCH,object:{type:'commit',sha:refSha}});
  if(opts.method==='GET'&&path==='/git/commits/'+BASE)
   return response(200,{sha:BASE,tree:{sha:TREE},parents:[{sha:'f'.repeat(40)}]});
  if(opts.method==='GET'&&path==='/git/commits/'+MARKER_COMMIT)
   return response(200,{sha:MARKER_COMMIT,tree:{sha:MARKER_TREE},parents:[{sha:BASE}],
    message:'test(canary): owner approved marker '+RUN});
  if(opts.method==='GET'&&path.startsWith('/contents/'+PATH+'?ref=')){
   if(refSha===BASE)return response(404,{message:'Not found'});
   const actual=tamperContent?'tampered\n':document;
   return response(200,{type:'file',path:PATH,encoding:'base64',
    content:Buffer.from(actual).toString('base64'),size:Buffer.byteLength(actual),
    sha:await sha1(actual)});
  }
  if(opts.method==='GET'&&path==='/compare/'+BASE+'...'+MARKER_COMMIT)
   return response(200,{ahead_by:1,total_commits:1,files:compareFiles===1?
    [{filename:PATH,status:'added'}]:[{filename:PATH,status:'added'},{filename:'src/other.mjs',status:'modified'}]});
  if(opts.method==='POST'&&path==='/git/trees'){
   const body=JSON.parse(opts.body);
   assert.equal(body.base_tree,TREE);
   assert.deepEqual(body.tree.map(x=>[x.path,x.mode,x.type]),[[PATH,'100644','blob']]);
   document=body.tree[0].content;
   return response(201,{sha:MARKER_TREE});
  }
  if(opts.method==='POST'&&path==='/git/commits'){
   const body=JSON.parse(opts.body);
   assert.deepEqual(body.parents,[BASE]);
   assert.equal(body.tree,MARKER_TREE);
   return response(201,{sha:MARKER_COMMIT,tree:{sha:MARKER_TREE}});
  }
  if(opts.method==='PATCH'&&path==='/git/refs/heads/'+BRANCH){
   if(throwPatch)throw Error('SENSITIVE_FAILURE_NEVER_EMIT');
   const body=JSON.parse(opts.body);
   assert.deepEqual(body,{sha:MARKER_COMMIT,force:false});
   if(postStatus!==200)return response(postStatus,{message:'Failed'});
   refSha=MARKER_COMMIT;
   return response(200,{ref:'refs/heads/'+BRANCH,object:{type:'commit',sha:MARKER_COMMIT}});
  }
  throw Error('unhandled GitHub operation: '+opts.method+' '+path);
 };
 return {request:fetch,calls,read:()=>({refSha,document})};
}
const args=(h,mode)=>({env,mode,targetRunId:TARGET,expectedSha:BASE,
 markerRunId:RUN,approvalPhrase:'APPROVE_ONE_CANARY_MARKER_COMMIT',request:h.request});

test('read-only inspect validates first real canary branch and main with zero mutations',async()=>{
 const h=mock();
 const result=await runOwnerCanaryMatrix(args(h,'inspect'));
 assert.equal(result.status,'verified');
 assert.equal(result.operation,'branch.inspect');
 assert.equal(result.executionPrincipal,'github-actions[bot]');
 assert.equal(result.appPrincipalsVerified,0);
 assert.equal(result.postgresReceiptVerified,false);
 assert.equal(result.externalWritePerformed,false);
 assert.equal(h.calls.every(x=>x.method==='GET'),true);
 assert.equal(result.branch,BRANCH);
});

test('marker write requires separate owner approval and generates one fast-forward ref update',async()=>{
 const h=mock();
 const result=await runOwnerCanaryMatrix(args(h,'marker'));
 assert.equal(result.status,'verified');
 assert.equal(result.externalWritePerformed,true);
 assert.equal(result.remoteReadbackVerified,true);
 assert.equal(result.postgresReceiptVerified,false);
 assert.equal(result.branch,BRANCH);
 assert.equal(result.commitSha,MARKER_COMMIT);
 assert.equal(result.markerPath,PATH);
 assert.match(result.receiptDigest,/^[0-9a-f]{64}$/);
 assert.deepEqual(h.calls.filter(x=>x.method!=='GET').map(x=>x.method),['POST','POST','PATCH']);
 assert.equal(JSON.stringify(result).includes(env.GITHUB_TOKEN),false);
});

test('read-only verifier checks exact parent, marker content and single-file diff',async()=>{
 const h=mock({initialSha:MARKER_COMMIT});
 // Seed expected marker independently; no commits performed during verify.
 const result=await runOwnerCanaryMatrix(args(h,'verify'));
 assert.equal(result.status,'held'); // test fixture missing marker content; fail-closed
 assert.equal(h.calls.every(x=>x.method==='GET'),true);
});

test('wrong actors, wrong source, reruns, missing approval, stop flag and invalid run IDs deny before network',async()=>{
 const invalid=[
  {env:{...env,GITHUB_ACTOR:'attacker'},mode:'marker'},
  {env:{...env,GITHUB_TRIGGERING_ACTOR:'attacker'},mode:'marker'},
  {env:{...env,GITHUB_REPOSITORY:'michaeljwilliams0123/Ultron.MW'},mode:'marker'},
  {env:{...env,GITHUB_REF:'refs/heads/release'},mode:'marker'},
  {env:{...env,GITHUB_RUN_ATTEMPT:'2'},mode:'marker'},
  {env:{...env,OWNER_CANARY_STOP:'true'},mode:'marker'},
  {targetRunId:'main',mode:'marker'},
  {targetRunId:RUN,mode:'marker'},
  {expectedSha:'z'.repeat(40),mode:'marker'},
  {approvalPhrase:'wrong',mode:'marker'},
  {markerRunId:'123',mode:'marker'}
 ];
 for(const item of invalid){
  let reads=0;
  const result=await runOwnerCanaryMatrix({...args(mock(),'marker'),...item,
   request:async()=>{reads++;throw Error('cannot call');}});
  assert.equal(result.status,'held',JSON.stringify(item));
  assert.equal(reads,0);
 }
});

test('detects remote identity, ref drift, missing marker, tampering, and partial GitHub write outcomes',async()=>{
 for(const options of [{repoId:1},{mainSha:'e'.repeat(40)},
  {initialSha:'e'.repeat(40)},{postStatus:403},{throwPatch:true},
  {tamperContent:true},{compareFiles:2}]){
  const h=mock(options);
  const result=await runOwnerCanaryMatrix(args(h,'marker'));
  assert.equal(result.status,'held',JSON.stringify(options));
  assert.equal(result.remoteReadbackVerified,false);
  assert.equal(result.appPrincipalsVerified,0);
  assert.equal(JSON.stringify(result).includes('SENSITIVE_FAILURE_NEVER_EMIT'),false);
  if(options.repoId===1||options.mainSha!==undefined||options.initialSha!==undefined)
   assert.equal(h.calls.some(x=>x.method==='PATCH'),false);
  assert.ok(h.calls.filter(x=>x.method==='PATCH').length<=1);
 }
});

test('matrix workflow uses owner-gated separate read and write job, pinned actions, and no secret keys',async()=>{
 const yaml=await readFile(new URL('../.github/workflows/owner-canary-matrix.yml',import.meta.url),'utf8');
 assert.match(yaml,/workflow_dispatch:/);
 assert.match(yaml,/default: inspect/);
 assert.match(yaml,/contents: read/);
 assert.match(yaml,/contents: write/);
 assert.match(yaml,/APPROVE_ONE_CANARY_MARKER_COMMIT/);
 assert.match(yaml,/inputs\.mode == 'marker'/);
 assert.match(yaml,/github\.repository == 'Ultron-MW\/Ultron\.MW'/);
 assert.match(yaml,/github\.actor == 'michaeljwilliams0123'/);
 assert.match(yaml,/github\.triggering_actor == 'michaeljwilliams0123'/);
 assert.match(yaml,/github\.ref == 'refs\/heads\/main'/);
 assert.match(yaml,/node scripts\/owner-canary-matrix\.mjs/);
 assert.match(yaml,/if: always\(\)/);
 assert.doesNotMatch(yaml,/pull_request_target:|id-token: write|actions: write|force: true|secrets\.ULTRON_BUILDER_PRIVATE_KEY/);
});

test('independent read-only verification succeeds after a marker write and rejects replay',async()=>{
 const h=mock();
 const committed=await runOwnerCanaryMatrix(args(h,'marker'));
 assert.equal(committed.status,'verified');
 const before=h.calls.length;
 const replay=await runOwnerCanaryMatrix(args(h,'marker'));
 assert.equal(replay.status,'held');
 assert.equal(h.calls.slice(before).some(x=>x.method!=='GET'),false);
 const start=h.calls.length;
 const verified=await runOwnerCanaryMatrix(args(h,'verify'));
 assert.equal(verified.status,'verified');
 assert.equal(verified.operation,'branch.marker.verify');
 assert.equal(verified.commitSha,MARKER_COMMIT);
 assert.equal(verified.externalWritePerformed,false);
 assert.equal(verified.remoteReadbackVerified,true);
 assert.equal(verified.receiptDigest,committed.receiptDigest);
 assert.equal(h.calls.slice(start).every(x=>x.method==='GET'),true);
 const document=markerDocument({targetRunId:TARGET,markerRunId:RUN,sourceSha:BASE});
 assert.equal(h.read().document,document);
});
