import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITIES, capabilityManifest, commandsFor } from '../docs/core/capabilities.mjs';
import { ROUTES, routeObjective } from '../docs/core/cycle.mjs';
import { COMMANDS, executeReadOnly } from '../src/operations.mjs';
import { executeCloudTask, REPOSITORY } from '../src/cloud-cycle.mjs';

test('registry, router and local executor share one immutable command surface',()=>{
  assert.deepEqual(ROUTES,commandsFor('cloud'));
  assert.deepEqual(COMMANDS.map(x=>x.command),commandsFor('local'));
  assert.equal(new Set(CAPABILITIES.map(x=>x.id)).size,CAPABILITIES.length);
  for(const capability of CAPABILITIES){
    assert.ok(Object.isFrozen(capability));
    assert.ok(Object.isFrozen(capability.environments));
    assert.equal(capability.authority,'read-only');
    assert.equal(capability.readiness,'implemented');
    assert.ok(capability.proof.length);
    assert.equal(routeObjective(capability.command,'routing-v2'),capability.command);
  }
  assert.deepEqual(commandsFor('browser'),[]);
  assert.throws(()=>commandsFor('unknown'),/environment/);
});

test('machine-readable manifest does not claim deployment or model readiness',async()=>{
  const manifest=capabilityManifest('cloud');
  assert.equal(manifest.schema,'ultron.capabilities.v1');
  assert.equal(manifest.environment,'cloud');
  assert.equal(manifest.liveReadiness,'not-probed');
  const help=await executeCloudTask({repository:REPOSITORY,issueNumber:null,objective:'/help'},
    {get:async()=>{throw Error('Help needs no network');}});
  assert.deepEqual(help.receipts[0].details.capabilities,manifest);
  const local=await executeReadOnly('/help',{});
  assert.deepEqual(local.details.map(x=>x.command),commandsFor('local'));
});
