import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateBuildIntent,generateIntegrationFiles,
  buildFrameworkOnPr } from '../src/framework-builder.mjs';
import { routePrTurn } from '../src/pr-brain.mjs';

const ROOT='/repos/michaeljwilliams0123/Ultron.MW';
const MAIN='a'.repeat(40),HEAD='b'.repeat(40),TREE='c'.repeat(40);
const OUT_TREE='d'.repeat(40),NEXT='e'.repeat(40);
function fixture(){
  let head=HEAD,main=MAIN,nextFiles={};const log=[];
  const pr={number:33,state:'open',head:{ref:'ultron/self-scan-c4883fbc33f2d615',
    sha:HEAD,repo:{full_name:'michaeljwilliams0123/Ultron.MW'}},
    base:{ref:'main',repo:{full_name:'michaeljwilliams0123/Ultron.MW'}}};
  const get=async path=>{
    log.push('GET '+path);
    if(path===ROOT+'/git/ref/heads/main')return {object:{sha:main}};
    if(path===ROOT+'/git/ref/heads/'+pr.head.ref)return {object:{sha:head}};
    if(path===ROOT+'/compare/'+main+'...'+HEAD)
      return {status:main===MAIN?'ahead':'diverged',behind_by:main===MAIN?0:1,
        merge_base_commit:{sha:MAIN}};
    if(path===ROOT+'/git/commits/'+HEAD)return {tree:{sha:TREE}};
    if(path===ROOT+'/git/trees/'+TREE+'?recursive=1')
      return {truncated:false,tree:[{type:'blob',path:'reports/self-scan/current.md'}]};
    const filePrefix=ROOT+'/contents/';
    const fileSuffix='?ref='+NEXT;
    if(path.startsWith(filePrefix)&&path.endsWith(fileSuffix)){
      const name=path.slice(filePrefix.length,-fileSuffix.length);
      if(nextFiles[name])return {encoding:'base64',
        content:Buffer.from(nextFiles[name]).toString('base64')};
    }
    throw Error('Unexpected GET '+path);
  };
  const blobMap={};
  const post=async(path,body)=>{
    log.push('POST '+path);
    if(path===ROOT+'/git/blobs'){
      const sha=String(Object.keys(blobMap).length+1).repeat(40);
      blobMap[sha]=body.content;return {sha};
    }
    if(path===ROOT+'/git/trees'){
      for(const x of body.tree)nextFiles[x.path]=blobMap[x.sha];
      return {sha:OUT_TREE};
    }
    if(path===ROOT+'/git/commits')return {sha:NEXT};
    throw Error('Unexpected POST '+path);
  };
  const updateRef=async(path,body)=>{
    assert.equal(path,ROOT+'/git/refs/heads/'+pr.head.ref);
    assert.equal(body.sha,NEXT);
    assert.equal(body.force,false);
    head=NEXT;return {object:{sha:NEXT}};
  };
  return {pr,get,post,updateRef,log,
    setMain:value=>{main=value;},
    setHead:value=>{head=value;},files:()=>nextFiles};
}
test('existing PR brain routes framework builds and regressions without a new lane',()=>{
  assert.deepEqual(routePrTurn('@ultron build api telemetry'),
    {kind:'build',type:'api',slug:'telemetry'});
  assert.deepEqual(routePrTurn('@ultron build mcp registry'),
    {kind:'build',type:'mcp',slug:'registry'});
  assert.equal(routePrTurn('@ultron regress').kind,'regress');
  assert.equal(routePrTurn('@ultron tokens').kind,'credentials');
  assert.equal(routePrTurn('@ultron secrets').kind,'credentials');
});
test('only allowlisted deterministic source and test files can be generated',()=>{
  for(const kind of ['api','mcp']){
    const files=generateIntegrationFiles({kind,slug:'cloud-status'});
    assert.equal(files.length,3);
    assert.ok(files.some(x=>x.path.startsWith('src/generated/cloud-status/')));
    assert.ok(files.some(x=>x.path.startsWith('test/generated-'+kind)));
    assert.ok(files.some(x=>x.path.endsWith('.md')));
    assert.ok(files.every(x=>!x.content.includes('GITHUB_TOKEN =') &&
      !x.content.includes('ghp_')));
  }
  for(const name of ['../escape','ultron-admin','my--api','x','UPPER','bad name']){
    assert.throws(()=>validateBuildIntent({kind:'api',slug:name}),/type must/);
  }
  assert.throws(()=>validateBuildIntent({kind:'shell',slug:'valid-name'}),/type must/);
});
test('generated JS is node-parseable before any GitHub mutation',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ultron-integration-'));
  try{
    for(const kind of ['api','mcp']){
      const sources=generateIntegrationFiles({kind,slug:'demo-api'})
        .filter(x=>x.path.endsWith('.mjs'));
      for(const x of sources){
        const dest=join(dir,x.path.split('/').at(-1));
        await writeFile(dest,x.content);
        const checked=spawnSync(process.execPath,['--check',dest],{
          encoding:'utf8',timeout:4000});
        assert.equal(checked.status,0,checked.stderr);
      }
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('generated MCP contract points to the current stateless protocol',()=>{
  const files=generateIntegrationFiles({kind:'mcp',slug:'current-mcp'});
  const readme=files.find(x=>x.path.endsWith('.md')).content;
  assert.match(readme,/MCP speaks JSON-RPC 2\.0 over stdio/);
  assert.match(readme,/2026-07-28/);
});
test('autonomous PR build commits source, tests and docs on branch after exact-main readback',async()=>{
  const f=fixture();
  const result=await buildFrameworkOnPr({pr:f.pr,kind:'api',slug:'telemetry',
    get:f.get,post:f.post,updateRef:f.updateRef});
  assert.equal(result.commitSha,NEXT);
  assert.equal(result.paths.length,3);
  assert.equal(result.action,'generated');
  assert.equal(result.auth,'runtime-secret-reference-only');
  assert.ok(result.paths.every(p=>f.files()[p]));
  assert.ok(f.log.every(x=>!x.includes('/secrets')));
  assert.equal(f.log.filter(x=>x.endsWith('/git/commits')&&x.startsWith('POST ')).length,1);
  assert.equal(f.log.filter(x=>x.includes('/git/refs/heads/main')).length,0);
});
test('stale source and tampered github PR identity cannot create source blobs',async()=>{
  const changed=fixture();changed.setMain('f'.repeat(40));
  await assert.rejects(()=>buildFrameworkOnPr({
    pr:changed.pr,kind:'mcp',slug:'example',get:changed.get,
    post:changed.post,updateRef:changed.updateRef}),/before build/);
  assert.equal(changed.log.filter(x=>x.startsWith('POST ')).length,0);
  const detached=fixture();detached.setHead('f'.repeat(40));
  await assert.rejects(()=>buildFrameworkOnPr({
    pr:detached.pr,kind:'api',slug:'example',get:detached.get,
    post:detached.post,updateRef:detached.updateRef}),/before build admission/);
  assert.equal(detached.log.filter(x=>x.startsWith('POST ')).length,0);
  const invalid=fixture();invalid.pr.head.repo.full_name='other/repository';
  await assert.rejects(()=>buildFrameworkOnPr({
    pr:invalid.pr,kind:'api',slug:'example',get:invalid.get,
    post:invalid.post,updateRef:invalid.updateRef}),/same-repository/);
});
