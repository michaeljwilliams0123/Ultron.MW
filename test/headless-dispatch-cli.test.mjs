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

test('CLI invokes the real ESM boundary with bounded graph context',async()=>{
  const stubGraph=String.raw`export async function runAutonomyGraph(c) {
    if (c.objective !== 'Verify source' || c.requiresResponse !== true ||
        c.enforceSignedApproval !== true ||
        !/^canary\/autonomous-run-[0-9]+-[a-f0-9-]{36}$/.test(c.targetBranch) ||
        !/^canary-exec-[0-9]+-[a-f0-9-]{36}$/.test(c.taskId)) {
      throw Error('bad-context');
    }
    return {status:'succeeded',productionAccepted:true};
  }`;
  const out=await withCli(stubGraph,' Verify source ');
  assert.equal(out.status,0,out.stderr);
  assert.deepEqual(JSON.parse(out.stdout),{status:'succeeded',productionAccepted:true});
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

test('CLI never serializes scoped token fields or arbitrary graph payloads',async()=>{
  const out=await withCli('export async function runAutonomyGraph(){return {status:"succeeded",productionAccepted:true,token:"secret-fixture-token",internal:{privateKey:"private-test-value"}};}');
  assert.equal(out.status,0);
  assert.doesNotMatch(out.stdout,/secret-fixture-token|private-test-value/);
  assert.deepEqual(JSON.parse(out.stdout),{status:'succeeded',productionAccepted:true});
});

test('CLI distinguishes missing graph from missing imported dependency',async()=>{
  const out=await withCli('import "./missing-dependency.mjs"; export async function runAutonomyGraph(){return {status:"succeeded"};}');
  assert.equal(out.status,1);
  assert.equal(out.stderr.trim(),'headless-execution-failed');
});

test('CLI requires positive production acceptance before successful exit',async()=>{
  const out=await withCli('export async function runAutonomyGraph(){return {status:"succeeded"};}');
  assert.equal(out.status,1);
  assert.deepEqual(JSON.parse(out.stdout),{status:'succeeded',productionAccepted:false});
});

test('CLI never echoes arbitrary errors from the graph',async()=>{
  const out=await withCli('export async function runAutonomyGraph(){throw Error("headless-secret-example");}');
  assert.equal(out.status,1);
  assert.equal(out.stderr.trim(),'headless-execution-failed');
});
