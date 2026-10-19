import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startLocalServer } from '../src/server.mjs';
import { createActionGateway } from '../src/action-gateway.mjs';

test('owner confirmation creates a verified local note once and persists its receipt', async () => {
  const dir = await mkdtemp(join(tmpdir(),'ultron-owner-http-'));
  const root = resolve(import.meta.dirname,'..');
  const statePath = join(dir,'state.json');
  const gateway = createActionGateway({root:dir});
  const key = 'unit-test-owner-key';
  let app = await startLocalServer({root,statePath,port:0,gateway,ownerKey:key});
  let origin = 'http://127.0.0.1:' + app.port;
  const request = (path,body,token=key) => fetch(origin+path,{
    method:'POST',headers:{origin,'content-type':'application/json','x-ultron-owner':token},
    body:JSON.stringify(body),
  });
  try {
    const job={id:randomUUID(),kind:'local-note',title:'Confirmed note',
      text:'The system wrote a new note and independently verified the bytes.'};
    const unverifiedGithub = await request('/api/owner/prepare',{
      ...job, id:randomUUID(), kind:'github-draft',
    });
    assert.equal(unverifiedGithub.status,403);
    assert.equal((await request('/api/owner/prepare',job,'wrong')).status,403);
    const pairing = await fetch(origin + '/api/owner/status', {
      headers: { 'x-ultron-owner': key },
    });
    assert.equal(pairing.status,200);
    const capabilities = await pairing.json();
    assert.deepEqual(capabilities.actions,['local-note']);
    assert.equal(capabilities.githubDraftStatus,'disabled-unverified');
    const prepared=await request('/api/owner/prepare',job);
    assert.equal(prepared.status,201);
    assert.equal((await prepared.json()).executed,false);
    const executed=await request('/api/owner/execute',{id:job.id});
    assert.equal(executed.status,201);
    const receipt=(await executed.json()).receipt;
    assert.equal(receipt.kind,'verified-owner-action');
    assert.equal(receipt.details.verified,true);
    assert.match(await readFile(join(dir,receipt.details.file),'utf8'),/Confirmed note/);
    assert.equal((await request('/api/owner/execute',{id:job.id})).status,409);
    await app.close();
    app=await startLocalServer({root,statePath,port:0,gateway,ownerKey:key});
    origin='http://127.0.0.1:'+app.port;
    const state=await(await fetch(origin+'/api/state')).json();
    assert.equal(state.receipts.filter(r=>r.operationId===job.id).length,1);
    const rated = await request('/api/owner/feedback',{id:job.id,rating:'helpful'});
    assert.equal(rated.status,200);
    const measured = await(await fetch(origin+'/api/owner/jobs',{
      headers:{'x-ultron-owner':key},
    })).json();
    assert.equal(measured.outcomes.verified,1);
    assert.equal(measured.outcomes.helpful,1);
    assert.equal(measured.outcomes.notHelpful,0);
    assert.equal(measured.outcomes.reconcileRequired,0);
    assert.ok(measured.outcomes.meanVerifiedLatencyMs>=0);
  } finally {
    await app.close();
    await rm(dir,{recursive:true,force:true});
  }
});
