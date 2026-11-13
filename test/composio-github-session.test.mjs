import test from 'node:test';
import assert from 'node:assert/strict';
import {
  composioGitHubReadSessionConfig as policy,
  createComposioGitHubReadGateway as gateway,
  startComposioGitHubReadSession as start,
} from '../src/composio-github-session.mjs';

const accounts = {owner:'github_owner123',ultron:'github_ultron123'};
function fake({profile,repo,fail}={}) {
  const calls=[];
  const session={execute:async (tool,args,{account})=>{
    calls.push({tool,args,account});
    if(fail) return {resultType:'failed',data:{}};
    if(tool==='GITHUB_GET_THE_AUTHENTICATED_USER') return {
      resultType:'completed',data:profile||{
        login:account===accounts.owner?'michaeljwilliams0123':'michaeljwilliams0123ultron',
        id:account===accounts.owner?308995719:354634860,
      }
    };
    return {resultType:'completed',data:repo||{
      full_name:'michaeljwilliams0123/Ultron.MW',id:1424939667,
      owner:{login:'michaeljwilliams0123',id:308995719},
      permissions:{pull:true,admin:account===accounts.owner},
    }};
  }};
  return {calls,inspect:gateway({session,accounts}).inspect};
}

test('restricts to two GitHub read operations, disables paid Instant and sandbox',()=>{
  const p=policy(accounts);
  assert.deepEqual(p.toolkits,['github']);
  assert.deepEqual(p.tools.github.enable,[
    'GITHUB_GET_THE_AUTHENTICATED_USER','GITHUB_GET_A_REPOSITORY']);
  assert.equal(p.instant,false);
  assert.equal(p.multiAccount.requireExplicitSelection,true);
  assert.equal(p.multiAccount.maxAccountsPerToolkit,2);
  assert.deepEqual(p.connectedAccounts.github,[accounts.owner,accounts.ultron]);
  assert.equal(p.manageConnections.enable,false);
  assert.equal(p.sandbox.enable,false);
  assert.equal(p.proxyExecute.enable,false);
});

test('never uses implicit or duplicate GitHub connections',()=>{
  for(const bad of [undefined,{}, {owner:'same12345',ultron:'same12345'},
    {owner:'../bad',ultron:accounts.ultron}]){
    assert.throws(()=>policy(bad),/account IDs required/);
  }
});

test('creates only under a stable explicit Ultron application user',async()=>{
  let config;
  const composio={create:async(user,options)=>{config={user,options};return {sessionId:'fixture'};}};
  assert.deepEqual(await start({composio,accounts,userId:'ultron-owner-308995719'}),{sessionId:'fixture'});
  assert.equal(config.options.multiAccount.requireExplicitSelection,true);
  await assert.rejects(start({composio,accounts,userId:'default'}),/stable application user ID/);
});

test('both identities and canonical repo are independently read back',async()=>{
  const f=fake();
  assert.equal((await f.inspect('owner')).verified,true);
  assert.equal((await f.inspect('ultron')).verified,true);
  assert.deepEqual(f.calls.map(x=>x.account),[
    accounts.owner,accounts.owner,accounts.ultron,accounts.ultron]);
  assert.deepEqual(f.calls.map(x=>x.tool),[
    'GITHUB_GET_THE_AUTHENTICATED_USER','GITHUB_GET_A_REPOSITORY',
    'GITHUB_GET_THE_AUTHENTICATED_USER','GITHUB_GET_A_REPOSITORY']);
});

test('mismatched actor aborts before any repository request',async()=>{
  const f=fake({profile:{login:'wrong-user',id:354634860}});
  await assert.rejects(f.inspect('owner'),/identity mismatch/);
  assert.equal(f.calls.length,1);
});

test('repository confusion and missing permissions fail closed',async()=>{
  for(const repo of [
    {full_name:'attacker/Ultron.MW',id:1424939667,owner:{login:'michaeljwilliams0123',id:308995719},permissions:{pull:true,admin:true}},
    {full_name:'michaeljwilliams0123/Ultron.MW',id:999,owner:{login:'michaeljwilliams0123',id:308995719},permissions:{pull:true,admin:true}},
    {full_name:'michaeljwilliams0123/Ultron.MW',id:1424939667,owner:{login:'michaeljwilliams0123',id:308995719},permissions:{pull:false,admin:true}},
  ]) await assert.rejects(fake({repo}).inspect('owner'),/mismatch|permissions/);
});

test('failed execution never yields verified receipt',async()=>{
  await assert.rejects(fake({fail:true}).inspect('ultron'),/read failed/);
});

test('unknown roles cannot dispatch and gateway exposes no write path',async()=>{
  const f=fake();
  await assert.rejects(f.inspect('agent-admin'),/Unrecognized/);
  assert.equal(f.calls.length,0);
  assert.deepEqual(Object.keys(gateway({session:{execute:async()=>({})},accounts})),['inspect']);
});
