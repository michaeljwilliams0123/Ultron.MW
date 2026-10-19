import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { evaluateSelfSnapshot,observeCloudSelf,observeLocalSelf } from '../src/self-observer.mjs';
import { executeCloudTask, REPOSITORY } from '../src/cloud-cycle.mjs';
import { executeReadOnly } from '../src/operations.mjs';
import { routeObjective } from '../docs/core/cycle.mjs';
import { commandsFor } from '../docs/core/capabilities.mjs';
import { createCloudTaskUrl } from '../docs/core/cloud-submit.mjs';

const MAIN='a'.repeat(40), TREE='b'.repeat(40);
const CONTENT=Object.freeze({
  'docs/core/capabilities.mjs':'command: /self scan',
  'docs/core/cycle.mjs':'route /self scan',
  '.github/workflows/self-scan-pr.yml':'run: node src/self-scan-pr.mjs\npull-requests: write',
  '.github/workflows/pr-brain.yml':'run: node src/pr-brain.mjs\nref: main',
  'src/pr-brain.mjs':'handlePrConversation routePrTurn',
  'src/self-scan-pr.mjs':'publishSelfScanPr SELF_SCAN_PATH',
  'src/cloud-cycle.mjs':"case '/self scan':",
  'src/cloud-pr.mjs':'import {launchCodePr}',
  '.github/workflows/cloud-pr.yml':'run: node src/cloud-pr.mjs\npull-requests: write',
  '.github/workflows/cloud-objective.yml':'run: node src/cloud-entry.mjs',
  '.github/workflows/verify.yml':'run: node scripts/verify.mjs',
});
const PATHS=[
  ...Object.keys(CONTENT),
  'src/code-pr.mjs','test/self-scan-pr.test.mjs','test/pr-brain.test.mjs',
  'test/pr-brain-patch.test.mjs','src/pr-brain-patch.mjs','src/grokbot-governor.mjs','src/cognitive-world-model.mjs',
  'src/learning.mjs','src/self-observer.mjs','test/cloud-pr.test.mjs',
  'test/code-pr.test.mjs','test/cloud.test.mjs','test/self-observer.test.mjs'
];
const shaFor = n=>Number(n+1).toString(16).padStart(40,'0');
function reader({stale=false,truncated=false,tampered=false}={}){
  const seen=[];
  let checks=0;
  const get=async path=>{
    seen.push(path);
    if(path.endsWith('/git/ref/heads/main'))
      return {object:{sha:stale&&++checks===2?'9'.repeat(40):MAIN}};
    if(path.endsWith('/git/commits/'+MAIN))return {tree:{sha:TREE}};
    if(path.endsWith('/git/trees/'+TREE+'?recursive=1'))return {
      truncated,tree:PATHS.map((p,i)=>({type:'blob',path:p,sha:shaFor(i)})),
    };
    const match=path.match(/\/contents\/(.*?)\?ref=/);
    if(match){
      const name=match[1], idx=PATHS.indexOf(name);
      return {encoding:'base64',sha:tampered?'f'.repeat(40):shaFor(idx),
        content:Buffer.from(CONTENT[name]||'').toString('base64')};
    }
    throw Error('Unexpected GitHub route '+path);
  };
  return {get,seen};
}

test('self-scan is in one shared read-only command registry and routable in plain English',()=>{
  assert.ok(commandsFor('local').includes('/self scan'));
  assert.deepEqual(commandsFor('cloud'),commandsFor('local'));
  assert.equal(routeObjective('/self scan','routing-v2'),'/self scan');
  assert.equal(routeObjective('scan yourself','routing-v2'),'/self scan');
  assert.equal(routeObjective('review your weaknesses','routing-v2'),'/self scan');
  assert.equal(routeObjective('scan yourself and delete checks','routing-v2'),null);
  const url=new URL(createCloudTaskUrl('scan yourself'));
  assert.equal(url.pathname,'/michaeljwilliams0123/Ultron.MW/actions/workflows/self-scan-pr.yml');
  assert.equal(url.searchParams.has('body'),false);
});

test('self-model expresses source facts separately from runtime and learning unknowns',()=>{
  const report=evaluateSelfSnapshot({environment:'cloud',observedAt:'2026-10-19T00:00:00Z',
    paths:PATHS,sourceTexts:CONTENT,commitSha:MAIN,treeSha:TREE});
  assert.equal(report.schema,'ultron.self-model.v1');
  assert.equal(report.sourceAuthority.commitSha,MAIN);
  assert.equal(report.identity.consciousness,'not-established');
  assert.equal(report.uncertainty.operationalReadiness,'not-probed');
  assert.equal(report.uncertainty.independentLearningGain,'not-established');
  assert.ok(report.evidence.some(x=>x.kind==='static-route-link'&&x.status==='observed'));
  assert.ok(report.weaknesses.some(x=>x.code==='live-execution-unobserved'));
  assert.equal(report.prediction.status,'unvalidated');
  assert.match(report.fingerprint,/^[0-9a-f]{64}$/);
  const repeat=evaluateSelfSnapshot({environment:'cloud',observedAt:'2026-10-19T00:00:00Z',
    paths:PATHS,sourceTexts:CONTENT,commitSha:MAIN,treeSha:TREE});
  assert.equal(repeat.fingerprint,report.fingerprint);
});

test('missing or unwired cognitive capabilities produce weaknesses, never fabricated readiness',()=>{
  const texts={...CONTENT,'src/cloud-cycle.mjs':'missing route'};
  const report=evaluateSelfSnapshot({environment:'cloud',observedAt:'2026-10-19T00:00:00Z',
    paths:PATHS.filter(x=>x!=='test/self-observer.test.mjs'),sourceTexts:texts,
    commitSha:MAIN,treeSha:TREE});
  assert.ok(report.weaknesses.some(x=>x.code==='routing-contract-gap'));
  assert.ok(report.weaknesses.some(x=>x.code==='missing-source-path'));
  assert.equal(report.uncertainty.operationalReadiness,'not-probed');
});

test('GitHub self-scan binds route-source bytes to exact main tree and rechecks lease',async()=>{
  const mock=reader();
  const output=await observeCloudSelf({get:mock.get,now:()=> '2026-10-19T00:00:00Z'});
  assert.equal(output.sourceAuthority.kind,'github-main-verified');
  assert.equal(output.sourceAuthority.commitSha,MAIN);
  assert.ok(mock.seen.every(x=>x.startsWith('/repos/'+REPOSITORY+'/')));
  assert.equal(mock.seen.filter(x=>x.endsWith('/git/ref/heads/main')).length,2);
  const task={repository:REPOSITORY,objective:'/self scan',issueNumber:null};
  const result=await executeCloudTask(task,{get:mock.get});
  assert.equal(result.status,'succeeded');
  assert.equal(result.receipts[0].command,'/self scan');
  assert.equal(result.receipts[0].details.uncertainty.productionConvergence,'not-probed');
});

test('source race, incomplete tree or mismatched blob fail without a successful receipt',async()=>{
  for(const mode of [{stale:true},{truncated:true},{tampered:true}]){
    const mock=reader(mode);
    await assert.rejects(()=>observeCloudSelf({get:mock.get}),/changed|incomplete|disagrees/);
    const task={repository:REPOSITORY,objective:'/self scan',issueNumber:null};
    const result=await executeCloudTask(task,{get:reader(mode).get});
    assert.equal(result.status,'failed');
    assert.equal(result.receipts[0].status,'failed');
    assert.equal(result.receipts[0].details,undefined);
  }
});

test('real local source scan is evidence-only with no invented GitHub SHA',async()=>{
  const root=resolve(import.meta.dirname,'..');
  const r=await observeLocalSelf({root,now:()=> '2026-10-19T00:00:00Z'});
  assert.equal(r.environment,'local');
  assert.equal(r.sourceAuthority.commitSha,null);
  assert.match(r.sourceAuthority.sourceDigest,/^[0-9a-f]{64}$/);
  assert.ok(r.inventory.source>5);
  assert.ok(r.inventory.tests>5);
  assert.ok(r.weaknesses.some(x=>x.code==='git-commit-unobserved'));
  const tool=await executeReadOnly('/self scan',{root});
  assert.equal(tool.details.kind,'operational-self-observation');
  assert.equal(tool.details.sourceAuthority.kind,'local-filesystem');
});
