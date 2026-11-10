import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFile, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {dispatchHeadlessTask} from '../scripts/execute-autonomous-task.mjs';

async function withCli(graphSource, objective='Canary') {
  const root=await mkdtemp(join(tmpdir(),'ultron-headless-'));
  try {
    await mkdir(join(root,'scripts'));
    await mkdir(join(root,'src'));
    await copyFile(new URL('../scripts/execute-autonomous-task.mjs',import.meta.url),join(root,'scripts','execute-autonomous-task.mjs'));
    if (graphSource!==null) await writeFile(join(root,'src','autonomy-orchestrator.mjs'),graphSource);
    return spawnSync(process.execPath,[join(root,'scripts','execute-autonomous-task.mjs'),objective],{encoding:'utf8'});
  } finally {await rm(root,{recursive:true,force:true});}
}

test('CLI fails closed without an installed graph',async()=>{
  const out=await withCli(null);
  assert.equal(out.status,1);
  assert.match(out.stderr,/headless-graph-unavailable/);
});

test('CLI performs an ESM graph handoff and passes signed-response flags',async()=>{
  const out=await withCli('export async function runAutonomyGraph(c){return {status:"succeeded",context:c};}', ' Verify source ');
  assert.equal(out.status,0,out.stderr);
  const result=JSON.parse(out.stdout);
  assert.equal(result.context.objective,'Verify source');
  assert.equal(result.context.requiresResponse,true);
  assert.equal(result.context.enforceSignedApproval,true);
  assert.match(result.context.targetBranch,/^canary\/autonomous-run-[0-9]+-[a-f0-9-]{36}$/);
  assert.match(result.context.taskId,/^canary-exec-[0-9]+-[a-f0-9-]{36}$/);
});

test('CLI does not mark a verified plan as completed execution',async()=>{
  const out=await withCli('export async function runAutonomyGraph(){return {status:"verified-plan",productionAccepted:false};}');
  assert.equal(out.status,1,'stdout='+out.stdout);
});

test('CLI rejects a claimed execution when the graph denied production acceptance',async()=>{
  const out=await withCli('export async function runAutonomyGraph(){return {status:"succeeded",productionAccepted:false};}');
  assert.equal(out.status,1,'stdout='+out.stdout);
});

test('CLI fails closed for missing graph export and denied authorization',async()=>{
  for(const source of ['export const unrelated=1;', 'export async function runAutonomyGraph(){return {status:"held",reason:"owner-grant-required"};}']){
    const out=await withCli(source);
    assert.equal(out.status,1);
  }
});

test('dispatcher rejects fake UUIDs before execution',async()=>{
  let graphCalls=0;
  await assert.rejects(dispatchHeadlessTask('Canary',{runGraph:()=>{graphCalls++},newId:()=> '12345678-not-a-uuid'}),/headless-dispatch-identity-invalid/);
  assert.equal(graphCalls,0);
});
