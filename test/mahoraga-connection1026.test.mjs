import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyMahoragaToken,SECRET_NAME} from '../scripts/mahoraga-connection1026.mjs';

const token='github_pat_fixture_only_0123456789abcdef';
const sha='a'.repeat(40);
const fileBlob='c'.repeat(40);
function fake({foreign=false,missingBranch=true,changedMain=false}={}){
 const calls=[];
 let made=false,hasFile=false;
 const branch='mahoraga/ultron-conn1026-123';
 const file='docs/ultron/connection-canary-123.md';
 const marker='# Ultron Mahoraga connection canary\n\nRun ID: 123\nConnection: Ultron-Mahoraga-Connection1026\nRepository: michaeljwilliams0123/mahoraga\n';
 const ok=(data,status=200)=>({ok:status<400,status,json:async()=>data});
 const fetcher=async(url,options)=>{
  const path=new URL(url).pathname;
  calls.push({path,method:options.method,tokenUsed:options.headers.Authorization==='Bearer '+token});
  if(!url.startsWith('https://api.github.com/repos/michaeljwilliams0123/mahoraga'))
   throw Error('foreign endpoint '+url);
  if(path==='/repos/michaeljwilliams0123/mahoraga')return ok({
   id:foreign?13:1343333190,full_name:'michaeljwilliams0123/mahoraga',private:true,default_branch:'main'
  });
  if(path.endsWith('/git/ref/heads/main'))return ok({object:{sha:changedMain&&calls.length>2?'b'.repeat(40):sha}});
  if(path.endsWith('/git/ref/heads/'+branch))return made||!missingBranch?ok({object:{sha}}):ok({},404);
  if(path.endsWith('/git/refs')&&options.method==='POST'){
   assert.equal(JSON.parse(options.body).ref,'refs/heads/'+branch);made=true;return ok({ref:'refs/heads/'+branch},201);
  }
  if(path.endsWith('/contents/'+file)&&options.method==='PUT'){
   const data=JSON.parse(options.body);
   assert.equal(data.branch,branch);
   assert.equal(Buffer.from(data.content,'base64').toString('utf8'),marker);
   hasFile=true;return ok({content:{sha:fileBlob}},201);
  }
  if(path.endsWith('/contents/'+file)&&options.method==='GET')return hasFile?ok({
   encoding:'base64',content:Buffer.from(marker).toString('base64'),sha:fileBlob
  }):ok({},404);
  throw Error('unrecognized path '+path);
 };
 return {calls,fetcher};
}
test('read-only acceptance is bound to exactly Mahoraga',async()=>{
 const f=fake();const result=await verifyMahoragaToken({token,mode:'read',actor:'michaeljwilliams0123',fetcher:f.fetcher});
 assert.equal(SECRET_NAME,'ULTRON_MAHORAGA_CONNECTION1026');
 assert.equal(result.readVerified,true);
 assert.equal(result.writeVerified,false);
 assert.equal(f.calls.filter(c=>c.method!=='GET').length,0);
 assert.ok(f.calls.every(c=>c.tokenUsed));
});
test('write-canary pushes only a new branch and reads back exact content',async()=>{
 const f=fake();
 const result=await verifyMahoragaToken({token,mode:'write-canary',
   actor:'michaeljwilliams0123',runId:'123',fetcher:f.fetcher});
 assert.equal(result.writeVerified,true);
 assert.equal(result.mainSha,sha);
 assert.equal(result.fileBlobSha,fileBlob);
 assert.match(result.branch,/^mahoraga\/ultron-conn1026-/);
 assert.equal(f.calls.filter(c=>c.method==='PUT').length,1);
 assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
 assert.equal(JSON.stringify(result).includes(token),false);
});
test('rejects foreign repository, nonowner, missing token and invalid modes',async()=>{
 const f=fake({foreign:true});
 await assert.rejects(verifyMahoragaToken({token,actor:'michaeljwilliams0123',fetcher:f.fetcher}),/repository-mismatch/);
 assert.equal(f.calls.filter(c=>c.method!=='GET').length,0);
 await assert.rejects(verifyMahoragaToken({token,actor:'stranger',fetcher:()=>{throw Error('must not run')}}),/owner-required/);
 await assert.rejects(verifyMahoragaToken({token:'',actor:'michaeljwilliams0123',fetcher:f.fetcher}),/missing-or-invalid-token/);
 await assert.rejects(verifyMahoragaToken({token,actor:'michaeljwilliams0123',mode:'delete',fetcher:f.fetcher}),/unsupported-mode/);
});
