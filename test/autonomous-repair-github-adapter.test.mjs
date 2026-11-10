import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createAutonomousRepairGitHubAdapters} from '../src/autonomous-repair-github-adapter.mjs';

const repo='Ultron-MW/Ultron.MW',root='/repos/'+repo;
const base='a'.repeat(40),head='b'.repeat(40),tree='c'.repeat(40);
const branch='ultron/repair-example-001',id='repair-example-001';
const plan={id,repository:repo,branch,objective:'Repair bounded source and CI regression',fingerprint:'d'.repeat(64)};
const manifest={objective:'Fix source',baseSha:base,
 changes:[{path:'src/example.mjs',before:'old',after:'new'}]};
const stored=text=>({encoding:'base64',content:Buffer.from(text).toString('base64')});
function fixture(){
 const actions=[],state={sha:head,pr:null},url=(path)=>path;
 const get=async path=>{
  actions.push(['GET',path]);
  if(path===root+'/git/ref/heads/'+branch)
   return {ref:'refs/heads/'+branch,object:{sha:state.sha}};
  if(path===root+'/git/commits/'+head)
   return {sha:head,tree:{sha:tree},parents:[{sha:base}]};
  if(path===root+'/compare/'+base+'...'+head)
   return {total_commits:1,ahead_by:1,behind_by:0,
    files:[{filename:'src/example.mjs',status:'modified'}]};
  if(path===root+'/contents/src/example.mjs?ref='+base)return stored('old');
  if(path===root+'/contents/src/example.mjs?ref='+head)return stored('new');
  if(path.startsWith(root+'/pulls?'))return state.pr?[state.pr]:[];
  throw Error('unexpected GET '+path);
 };
 const post=async(path,body)=>{
  actions.push(['POST',path,body]);
  if(path===root+'/pulls'){
   state.pr={number:88,state:'open',draft:false,
    head:{ref:branch,sha:head,repo:{full_name:repo}},
    base:{ref:'main',repo:{full_name:repo}},body:body.body};
   return state.pr;
  }
  throw Error('unexpected POST '+path);
 };
 return {get,post,state,actions};
}
test('post-commit GitHub readback checks exact base parent and modified source bytes',async()=>{
 const f=fixture(),patcher=createAutonomousRepairGitHubAdapters({...f,
  updateRef:async()=>{}}).patcher;
 const found=await patcher.observe({plan,manifest,expectedHeadSha:base});
 assert.deepEqual(found,{verified:true,baseSha:base,headSha:head,
   patchDigest:createHash('sha256').update(JSON.stringify(manifest)).digest('hex')});
});
test('branch or file drift never promotes a successful write acknowledgement',async()=>{
 const f=fixture();f.state.sha=base;
 const patcher=createAutonomousRepairGitHubAdapters({...f,updateRef:async()=>{}}).patcher;
 assert.equal(await patcher.observe({plan,manifest,expectedHeadSha:base}),null);
 const g=fixture(),get=async path=>{
  if(path.includes('ref='+head))return stored('wrong');
  return g.get(path);
 };
 const patcher2=createAutonomousRepairGitHubAdapters({get,post:g.post,updateRef:async()=>{}}).patcher;
 assert.equal(await patcher2.observe({plan,manifest,expectedHeadSha:base}),null);
});
test('PR creation uses bound marker and a second independent readback; no duplicate write',async()=>{
 const f=fixture(),publisher=createAutonomousRepairGitHubAdapters({...f,
   updateRef:async()=>{}}).publisher;
 await publisher.start({plan,headSha:head});
 assert.equal(f.actions.filter(a=>a[0]==='POST').length,1);
 const found=await publisher.observe({plan,headSha:head});
 assert.deepEqual(found,{verified:true,branch,headSha:head,prNumber:88});
 await publisher.start({plan,headSha:head});
 assert.equal(f.actions.filter(a=>a[0]==='POST').length,1);
 assert.match(f.state.pr.body,new RegExp(plan.fingerprint));
});
test('foreign PR and unexpectedly advanced branch remain unverified',async()=>{
 const f=fixture(),publisher=createAutonomousRepairGitHubAdapters({...f,
  updateRef:async()=>{}}).publisher;
 f.state.pr={number:99,state:'open',draft:false,
  head:{ref:branch,sha:head,repo:{full_name:repo}},
  base:{ref:'main',repo:{full_name:repo}},body:'unrelated'};
 assert.equal(await publisher.observe({plan,headSha:head}),null);
 await assert.rejects(publisher.start({plan,headSha:head}),/untrusted/);
 f.state.pr=null;f.state.sha=base;
 await assert.rejects(publisher.start({plan,headSha:head}),/drift/);
});
test('adapter cannot be created without bounded authenticated transport',()=>{
 assert.throws(()=>createAutonomousRepairGitHubAdapters({get:async()=>{}}),
  /trusted-GitHub-adapter-required/);
});
