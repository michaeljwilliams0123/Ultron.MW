import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startLocalServer } from '../src/server.mjs';

const WORDS = ['alpha','bravo','charlie','delta','echo','foxtrot',
  'golf','hotel','india','juliet','kilo','lima','mango','november','oscar',
  'papa','quebec','romeo','sierra','tango','uniform','victor','whiskey','xray'];

function seededState({ lastUnrated = false, tamper = false } = {}) {
  const ownerJobs = [], receipts = [];
  WORDS.forEach((word, i) => {
    const negative = i % 2 === 1;
    const id = 'job-' + word;
    const receiptId = 'receipt-' + word;
    const sha = 'f'.repeat(64);
    ownerJobs.push({
      id, kind: 'local-note', title: 'Local workspace ' +
        (negative ? 'duplicate incorrect' : 'operational journal'),
      text: 'Assess the ' + word + ' incident in an isolated workspace',
      status: 'verified', result: { verified: true, sha256: sha },
      receiptId, rating: lastUnrated && i === WORDS.length - 1 ? undefined :
        negative ? 'not-helpful' : 'helpful',
      ratedAt: lastUnrated && i === WORDS.length - 1 ? undefined : '2026-10-19T12:20:00Z',
      latencyMs: 20 + i,
      verifiedAt: new Date(Date.UTC(2026,9,19,12,i)).toISOString(),
    });
    receipts.push({
      id: receiptId, kind: 'verified-owner-action', status: 'succeeded',
      command: 'local-note', operationId: tamper && i === 0 ? 'wrong' : id,
      details: { verified: true, sha256: sha },
    });
  });
  return {
    objectives: [], receipts, plans: [], conversations: [], ownerJobs,
    learning: { accepted:'seed-v1', history:[], observations:[], candidates:[] },
  };
}

async function fixture(run, options) {
  const dir = await mkdtemp(join(tmpdir(),'ultron-experience-'));
  const statePath = join(dir, 'state.json');
  await writeFile(statePath, JSON.stringify(seededState(options)));
  const root = resolve(import.meta.dirname, '..');
  let app = await startLocalServer({ root, statePath, port:0, ownerKey:'only-owner' });
  let origin = () => 'http://127.0.0.1:' + app.port;
  const request = (method,path,data,key='only-owner') => fetch(origin()+path,{
    method, headers: { origin:origin(),'x-ultron-owner':key,
      'content-type':'application/json' },
    ...(method==='GET'?{}:{body:JSON.stringify(data||{})}),
  });
  try {
    await run({request, restart:async()=>{
      await app.close();
      app = await startLocalServer({root,statePath,port:0,ownerKey:'only-owner'});
    }});
  } finally { await app.close(); await rm(dir,{recursive:true,force:true}); }
}

test('owner-paired observed learning adopts only a measured policy and survives restart', async () => {
  await fixture(async ({request,restart}) => {
    assert.equal((await request('GET','/api/owner/learning',null,'wrong')).status,403);
    const initial = await(await request('GET','/api/owner/learning')).json();
    assert.equal(initial.eligible,24);
    assert.equal(initial.activeVersion,'baseline');
    const before = await(await request('POST','/api/owner/suggest',{
      objective:'Local workspace duplicate incorrect case',
    })).json();
    assert.equal(before.kind,'local-note');
    assert.equal(before.executable,false);
    const r=await request('POST','/api/owner/evaluate',{});
    assert.equal(r.status,200);
    const data=await r.json();
    assert.equal(data.report.status,'validated');
    assert.ok(data.report.delta >= .05);
    assert.equal(data.report.regressions,0);
    assert.match(data.activeVersion,/^experience-/);
    const after=await(await request('POST','/api/owner/suggest',{
      objective:'Local workspace duplicate incorrect case',
    })).json();
    assert.equal(after.kind,null);
    assert.equal(after.authority,'suggestion-only');
    // The same accepted policy feeds Ultron's primary objective planner,
    // without granting a new execution capability.
    const objective = await request('POST','/api/plan',{
      text:'Local workspace operational journal case',
    });
    // /api/plan requires the same-origin local client marker as existing
    // deterministic plans, unlike paired owner endpoints.
    assert.equal(objective.status,403);
    const repeat=await(await request('POST','/api/owner/evaluate',{})).json();
    assert.equal(repeat.report.status,'unchanged-evidence');
    await restart();
    const recovered=await(await request('GET','/api/owner/learning')).json();
    assert.equal(recovered.activeVersion,data.activeVersion);
    assert.equal(recovered.assessments.length,1);
    assert.equal(recovered.changes.length,1);
    assert.equal((await request('POST','/api/owner/rollback',{reason:'bad'})).status,400);
    const rollback=await(await request('POST','/api/owner/rollback',{
      reason:'owner-request',
    })).json();
    assert.equal(rollback.active,'baseline');
    const history=await(await request('GET','/api/owner/learning')).json();
    assert.equal(history.changes.at(-1).action,'rollback');
    const restored=await(await request('POST','/api/owner/suggest',{
      objective:'Local workspace duplicate incorrect case',
    })).json();
    assert.equal(restored.kind,'local-note');
  });
});

test('new owner feedback triggers evaluation without new privilege grants', async () => {
  await fixture(async ({request}) => {
    const before=await(await request('GET','/api/owner/learning')).json();
    assert.equal(before.eligible,23);
    const rating=await request('POST','/api/owner/feedback',{
      id:'job-xray',rating:'not-helpful',
    });
    assert.equal(rating.status,200);
    const confirmed=await rating.json();
    assert.equal(confirmed.learning.eligible,24);
    assert.equal(confirmed.learning.status,'validated');
    assert.equal(confirmed.learning.adopted,true);
    const manifest=await(await request('GET','/api/owner/status')).json();
    assert.deepEqual(manifest.actions,['local-note']);
    const forbidden=await request('POST','/api/owner/prepare',{
      id:'00000000-0000-0000-0000-000000000000',
      kind:'github-draft',title:'Draft',text:'Not yet enabled',
    });
    assert.equal(forbidden.status,403);
  },{lastUnrated:true});
});

test('an unsupported action suggestion is never treated as execution', async () => {
  await fixture(async ({request}) => {
    const suggest=await(await request('POST','/api/owner/suggest',{
      objective:'delete local files and deploy code',
    })).json();
    assert.equal(suggest.kind,null);
    assert.equal(suggest.executable,false);
    assert.equal((await request('POST','/api/owner/suggest',{
      objective:'inspect the repo',
    },'not-owner')).status,403);
  },{tamper:true});
});
