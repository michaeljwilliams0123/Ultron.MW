import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepairGitHubAdapter } from '../src/repair-github-adapter.mjs';

const REPO='michaeljwilliams0123/Ultron.MW', ID=1424939667;
const BRANCH='ultron/repair-seeded-case', SHA='a'.repeat(40);
const repo={id:ID,full_name:REPO};
function pr(overrides={}){
 return {number:176,state:'open',draft:false,title:'repair: accepted seeded test',
   body:'<!-- ultron-repair:'+ '1'.repeat(64) +' -->',head:{ref:BRANCH,sha:SHA,repo},
   base:{ref:'main',repo},...overrides};
}
function stub({branch={ref:'refs/heads/'+BRANCH,object:{type:'commit',sha:SHA}},
  prs=[pr()]}={}){
 const calls=[];
 const operator={async request(query){
   calls.push(query);
   if(query.method==='GET'&&query.path.startsWith('/git/ref/heads/')){
     if(branch===null)throw Error('GitHub operation denied or unavailable: HTTP 404');
     return branch;
   }
   if(query.method==='GET'&&query.path.startsWith('/pulls?'))return prs;
   if(query.method==='POST'&&query.path==='/git/refs')return {ref:query.body.ref};
   if(query.method==='POST'&&query.path==='/pulls')return {number:176};
   throw Error('Unexpected endpoint '+query.path);
 }};
 return {operator,calls};
}
test('adapter creates only one authorized branch and one non-draft PR',async()=>{
 const {operator,calls}=stub();
 const github=createRepairGitHubAdapter({operator});
 await github.createBranch({repository:REPO,branch:BRANCH,baseSha:SHA});
 await github.createPR({repository:REPO,branch:BRANCH,base:'main',draft:false,
   title:'repair: fixed seeded task',body:'<!-- ultron-repair:'+ '1'.repeat(64) +' -->'});
 assert.deepEqual(calls.map(x=>[x.method,x.path,x.permission]),[
   ['POST','/git/refs','contents:write'],
   ['POST','/pulls','pull_requests:write']
 ]);
 assert.deepEqual(calls[0].body,{ref:'refs/heads/'+BRANCH,sha:SHA});
 assert.deepEqual(calls[1].body,{head:BRANCH,base:'main',
   title:'repair: fixed seeded task',body:'<!-- ultron-repair:'+ '1'.repeat(64) +' -->',draft:false});
});
test('branch readback has exact ref and object SHA',async()=>{
 const {operator,calls}=stub();const g=createRepairGitHubAdapter({operator});
 assert.deepEqual(await g.getBranch({repository:REPO,branch:BRANCH}),
   {repo:REPO,ref:BRANCH,sha:SHA});
 assert.equal(calls[0].permission,'contents:read');
 const missing=createRepairGitHubAdapter({operator:stub({branch:null}).operator});
 assert.equal(await missing.getBranch({repository:REPO,branch:BRANCH}),null);
});
test('PR readback is restricted to exactly one owner-owned open PR',async()=>{
 const {operator,calls}=stub(),g=createRepairGitHubAdapter({operator});
 const got=await g.findPR({repository:REPO,branch:BRANCH,base:'main'});
 assert.deepEqual(got,{number:176,repo:REPO,head:BRANCH,base:'main',
   title:'repair: accepted seeded test',body:'<!-- ultron-repair:'+ '1'.repeat(64) +' -->',draft:false});
 assert.match(calls[0].path,/head=michaeljwilliams0123:ultron\/repair-seeded-case/);
 assert.match(calls[0].path,/state=all/);
 const none=createRepairGitHubAdapter({operator:stub({prs:[]}).operator});
 assert.equal(await none.findPR({repository:REPO,branch:BRANCH,base:'main'}),null);
});
test('reject ambiguous or forged PR object instead of adopting it',async()=>{
 for(const raw of [
   [pr(),pr({number:177})],
   [pr({head:{ref:BRANCH,repo:{id:13,full_name:'evil/repo'}}})],
   [pr({base:{ref:'other',repo}})],
   [pr({state:'closed'})],
   [pr({draft:true})],
   [pr({number:'176'})],
 ]) {
   const github=createRepairGitHubAdapter({operator:stub({prs:raw}).operator});
   await assert.rejects(github.findPR({repository:REPO,branch:BRANCH,base:'main'}),
     /Repair GitHub PR readback/);
 }
});
test('invalid repo, main branch, arbitrary mutation and malformed input never dispatch',async()=>{
 const {operator,calls}=stub(),g=createRepairGitHubAdapter({operator});
 for(const bad of [
   ()=>g.createBranch({repository:'other/repo',branch:BRANCH,baseSha:SHA}),
   ()=>g.createBranch({repository:REPO,branch:'main',baseSha:SHA}),
   ()=>g.createBranch({repository:REPO,branch:'ultron/repair-../main',baseSha:SHA}),
   ()=>g.createBranch({repository:REPO,branch:BRANCH,baseSha:'main'}),
   ()=>g.createPR({repository:REPO,branch:BRANCH,base:'other',draft:false,
     title:'repair: seeded task resolution',body:'body'}),
   ()=>g.createPR({repository:REPO,branch:BRANCH,base:'main',draft:true,
     title:'repair: seeded task resolution',body:'body'}),
   ()=>g.createPR({repository:REPO,branch:BRANCH,base:'main',draft:false,
     title:'bad title',body:'body'}),
 ]) await assert.rejects(bad(),/Repair GitHub/);
 assert.equal(calls.length,0);
});
test('non-404 read errors and GitHub response-loss propagate unchanged',async()=>{
 const {operator}=stub();
 operator.request=async()=>{throw Error('GitHub write outcome unknown; reconcile before retry')};
 const g=createRepairGitHubAdapter({operator});
 await assert.rejects(g.getBranch({repository:REPO,branch:BRANCH}),/unknown/);
 await assert.rejects(g.createBranch({repository:REPO,branch:BRANCH,baseSha:SHA}),/unknown/);
});
