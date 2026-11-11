import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPrPatch } from '../src/pr-brain-patch.mjs';

const ROOT='/repos/michaeljwilliams0123/Ultron.MW';
const HEAD='a'.repeat(40),NEXT='b'.repeat(40),TREE='c'.repeat(40),NEW_TREE='d'.repeat(40);
const REPO='michaeljwilliams0123/Ultron.MW', BRANCH='ultron/self-scan-abc';
const pr={number:24,state:'open',
  head:{ref:BRANCH,sha:HEAD,repo:{full_name:REPO}},
  base:{ref:'main',sha:'9'.repeat(40),repo:{full_name:REPO}}};
const source='first old line final\n';
function fixture({behind=false,staleRefReads=0,staleFileReads=0}={}){
  const state={sha:HEAD,main:pr.base.sha,calls:[],blobs:[],
    files:{'src/example.mjs':source},updated:null};
  const get=async path=>{
    state.calls.push(['GET',path]);
    if(path===ROOT+'/git/ref/heads/main')return {object:{sha:state.main}};
    if(path===ROOT+'/compare/'+state.main+'...'+HEAD)return {
      status:behind?'diverged':'ahead',behind_by:behind?1:0,
      merge_base_commit:{sha:behind?'8'.repeat(40):state.main}};
    if(path===ROOT+'/git/ref/heads/'+BRANCH){
      if(state.sha===NEXT && staleRefReads-->0)return {object:{sha:HEAD}};
      return {object:{sha:state.sha}};
    }
    if(path===ROOT+'/git/commits/'+HEAD)return {tree:{sha:TREE}};
    const match=path.match(/^\/repos\/michaeljwilliams0123\/Ultron\.MW\/contents\/([^?]+)\?ref=([a-f0-9]{40})$/);
    if(match){
      if(match[2]===NEXT && staleFileReads-->0)throw Error('GitHub content not visible yet');
      const body=state.files[match[1]];
      if(body===undefined)throw Error('missing file');
      return {encoding:'base64',sha:'e'.repeat(40),
        content:Buffer.from(match[2]===NEXT?state.updated??body:body).toString('base64')};
    }
    throw Error('unexpected '+path);
  };
  const post=async(path,body)=>{
    state.calls.push(['POST',path,body]);
    if(path.endsWith('/git/blobs')){state.blobs.push(body.content);return {sha:'f'.repeat(40)};}
    if(path.endsWith('/git/trees')){assert.equal(body.base_tree,TREE);return {sha:NEW_TREE};}
    if(path.endsWith('/git/commits')){assert.deepEqual(body.parents,[HEAD]);return {sha:NEXT};}
    throw Error('unexpected POST '+path);
  };
  const updateRef=async(path,body)=>{
    state.calls.push(['PATCH',path,body]);
    assert.equal(path,ROOT+'/git/refs/heads/'+BRANCH);
    assert.equal(body.force,false);
    assert.equal(body.sha,NEXT);
    state.sha=NEXT;state.updated=state.blobs[0];return {object:{sha:NEXT}};
  };
  const args=changes=>({pr,manifest:JSON.stringify({
    objective:'Repair routing',baseSha:HEAD,changes}),get,post,updateRef});
  return {state,args};
}
test('PR code patch is atomic and head-bound without pushing main',async()=>{
  const f=fixture(),arg=f.args([{path:'src/example.mjs',before:'old',after:'new'}]);
  const r=await applyPrPatch(arg);
  assert.equal(r.commitSha,NEXT);
  assert.deepEqual(r.paths,['src/example.mjs']);
  assert.equal(f.state.updated,'first new line final\n');
  assert.equal(f.state.calls.filter(x=>x[0]==='PATCH').length,1);
  assert.equal(f.state.calls.some(x=>x[1].includes('/refs/heads/main')),false);
});
test('head drift, ambiguous context and workflow mutations fail before source commit',async()=>{
  for(const change of [
    {path:'.github/workflows/verify.yml',before:'x',after:'y'},
    {path:'src/../unsafe.mjs',before:'x',after:'y'},
    {path:'src/example.mjs',before:'nope',after:'different'},
  ]){
    const f=fixture();
    await assert.rejects(()=>applyPrPatch(f.args([change])),/Patch|context|rejected/);
    assert.equal(f.state.calls.some(x=>x[0]==='POST'),false);
  }
  const bad=fixture();
  await assert.rejects(()=>applyPrPatch({...bad.args([{path:'src/example.mjs',before:'old',after:'new'}]),
    manifest:JSON.stringify({objective:'fix',baseSha:'9'.repeat(40),
      changes:[{path:'src/example.mjs',before:'old',after:'new'}]})}),/exact head/);
  assert.equal(bad.state.calls.length,0);
  const dup=fixture();
  await assert.rejects(()=>applyPrPatch(dup.args([
    {path:'src/example.mjs',before:'old',after:'one'},
    {path:'src/example.mjs',before:'old',after:'two'}])),/rejected/);
  const stale=fixture({behind:true});
  await assert.rejects(()=>applyPrPatch(stale.args([
    {path:'src/example.mjs',before:'old',after:'new'}])),/behind current main/);
  assert.equal(stale.state.calls.some(x=>x[0]==='POST'),false);
});

test('eventually consistent GitHub ref and content reads recover without replaying write',async()=>{
  const f=fixture({staleRefReads:3,staleFileReads:2});
  const args=f.args([{path:'src/example.mjs',before:'old',after:'new'}]);
  const result=await applyPrPatch({...args,sleep:async()=>{}});
  assert.equal(result.commitSha,NEXT);
  assert.equal(f.state.calls.filter(x=>x[0]==='PATCH').length,1);
  assert.ok(f.state.calls.filter(x=>x[1]===ROOT+'/git/ref/heads/'+BRANCH).length>=5);
});


test('governance repair pilot atomically commits paired source and regression on PR branch only',async()=>{
 const branch='governance/council-7of7-20261110',main='9'.repeat(40);
 const source='Council source old behavior\n',regression='Council test old behavior\n';
 const files={'src/council-members.mjs':source,'test/council-members.test.mjs':regression};
 const changes=[
  {path:'src/council-members.mjs',before:'old',after:'new'},
  {path:'test/council-members.test.mjs',before:'old',after:'new'}
 ];
 const p={number:397,state:'open',
  body:'<!-- ULTRON_COUNCIL_REPAIR_PR_V1 -->\nBounded source+test',
  head:{ref:branch,sha:HEAD,repo:{id:1424939667,full_name:REPO}},
  base:{ref:'main',sha:main,repo:{id:1424939667,full_name:REPO}}};
 const state={sha:HEAD,blobs:[],updatedFiles:{},calls:[],newTree:null};
 const get=async path=>{
  state.calls.push(['GET',path]);
  if(path===ROOT+'/pulls/397')return structuredClone(p);
  if(path===ROOT+'/git/ref/heads/main')return{object:{sha:main}};
  if(path===ROOT+'/compare/'+main+'...'+HEAD)
   return{status:'ahead',behind_by:0,merge_base_commit:{sha:main}};
  if(path===ROOT+'/git/ref/heads/'+branch)return{object:{sha:state.sha}};
  if(path===ROOT+'/git/commits/'+HEAD)return{tree:{sha:TREE}};
  const m=path.match(/^\/repos\/michaeljwilliams0123\/Ultron\.MW\/contents\/([^?]+)\?ref=([a-f0-9]{40})$/);
  if(m){const v=m[2]===NEXT?state.updatedFiles[m[1]]:files[m[1]];
   if(typeof v!=='string')throw Error('mock read unknown file');
   return{encoding:'base64',sha:'e'.repeat(40),content:Buffer.from(v).toString('base64')};}
  throw Error('Unexpected GitHub get '+path);
 };
 const post=async (path,payload)=>{
  state.calls.push(['POST',path]);
  if(path.endsWith('/git/blobs')){
   state.blobs.push(payload.content);
   return{sha:'f'.repeat(40)};
  }
  if(path.endsWith('/git/trees')){
   assert.equal(payload.base_tree,TREE);
   state.updatedFiles=Object.fromEntries(payload.tree.map((v,i)=>[v.path,state.blobs[i]]));
   return{sha:NEW_TREE};
  }
  if(path.endsWith('/git/commits')){
   assert.deepEqual(payload.parents,[HEAD]);
   return{sha:NEXT};
  }
  throw Error('Unexpected GitHub POST '+path);
 };
 const updateRef=async(path,payload)=>{
  assert.equal(path,ROOT+'/git/refs/heads/'+branch);
  assert.equal(payload.force,false);
  assert.equal(payload.sha,NEXT);
  state.sha=NEXT;return{object:{sha:NEXT}};
 };
 const result=await applyPrPatch({pr:p,manifest:JSON.stringify({
   objective:'Repair Council source with matching regression',baseSha:HEAD,changes
  }),get,post,updateRef,sleep:async()=>{}});
 assert.equal(result.commitSha,NEXT);
 assert.deepEqual(result.paths,changes.map(c=>c.path));
 assert.equal(state.updatedFiles[changes[0].path],'Council source new behavior\n');
 assert.equal(state.updatedFiles[changes[1].path],'Council test new behavior\n');
 assert.equal(state.calls.filter(c=>c[0]==='POST'&&c[1].endsWith('/git/commits')).length,1);
 assert.equal(state.calls.some(c=>c[1].endsWith('/refs/heads/main')),false);
});


test('governance repair refuses a changed live PR before creating Git blobs',async()=>{
 const branch='governance/council-7of7-20261110',main='9'.repeat(40);
 const authorized={number:397,state:'open',
  body:'<!-- ULTRON_COUNCIL_REPAIR_PR_V1 -->',
  head:{ref:branch,sha:HEAD,repo:{id:1424939667,full_name:REPO}},
  base:{ref:'main',sha:main,repo:{id:1424939667,full_name:REPO}}};
 const changes=[
  {path:'src/council-members.mjs',before:'old',after:'new'},
  {path:'test/council-members.test.mjs',before:'old',after:'new'}
 ];
 for(const mutate of [
  p=>{p.body='owner marker removed';},
  p=>{p.state='closed';},
  p=>{p.head.sha=NEXT;},
  p=>{p.base.sha='7'.repeat(40);}
 ]){
  const live=structuredClone(authorized);mutate(live);
  let posts=0;
  const get=async path=>{
   if(path===ROOT+'/pulls/397')return live;
   if(path===ROOT+'/git/ref/heads/main')return{object:{sha:main}};
   if(path===ROOT+'/compare/'+main+'...'+HEAD)
    return{status:'ahead',behind_by:0,merge_base_commit:{sha:main}};
   if(path===ROOT+'/git/ref/heads/'+branch)return{object:{sha:HEAD}};
   if(path===ROOT+'/git/commits/'+HEAD)return{tree:{sha:TREE}};
   if(path.startsWith(ROOT+'/contents/'))return{
    encoding:'base64',sha:'e'.repeat(40),content:Buffer.from('old').toString('base64')};
   throw Error('Unexpected read '+path);
  };
  await assert.rejects(()=>applyPrPatch({pr:authorized,
    manifest:JSON.stringify({objective:'Authorized Council repair',baseSha:HEAD,changes}),
    get,post:async()=>{posts++;throw Error('write unexpectedly reached')},
    updateRef:async()=>{posts++;throw Error('ref update unexpectedly reached')},
    sleep:async()=>{}
  }),/Council.*(?:changed|drift|admission|unverified)/i);
  assert.equal(posts,0,'disallowed live PR must fail before provider mutation');
 }
});
