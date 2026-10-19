import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPrPatch } from '../src/pr-brain-patch.mjs';

const ROOT='/repos/michaeljwilliams0123/Ultron.MW';
const HEAD='a'.repeat(40),NEXT='b'.repeat(40),TREE='c'.repeat(40),NEW_TREE='d'.repeat(40);
const REPO='michaeljwilliams0123/Ultron.MW', BRANCH='ultron/self-scan-abc';
const pr={number:24,state:'open',
  head:{ref:BRANCH,sha:HEAD,repo:{full_name:REPO}},
  base:{ref:'main',repo:{full_name:REPO}}};
const source='first old line final\n';
function fixture(){
  const state={sha:HEAD,calls:[],blobs:[],files:{'src/example.mjs':source},updated:null};
  const get=async path=>{
    state.calls.push(['GET',path]);
    if(path===ROOT+'/git/ref/heads/'+BRANCH)return {object:{sha:state.sha}};
    if(path===ROOT+'/git/commits/'+HEAD)return {tree:{sha:TREE}};
    const match=path.match(/^\/repos\/michaeljwilliams0123\/Ultron\.MW\/contents\/([^?]+)\?ref=([a-f0-9]{40})$/);
    if(match){
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
    state.calls.push(['PATCH',path,body]);assert.equal(body.force,false);
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
});
