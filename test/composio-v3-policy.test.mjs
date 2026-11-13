import test from 'node:test';
import assert from 'node:assert/strict';
import {
 buildComposioV3Policy,requireComposioReadAdmission,requireComposioProxyRead,
 maskComposioDisplay,denyUntrustedComposioMutation,
} from '../src/composio-v3-policy.mjs';
const p='ca_owner_read_123',x='ca_executor_read_456',auth='ac_verified_custom_123';
const opt={primaryAccountId:p,executorAccountId:x,customAuthConfigId:auth,
 sessionPresetDirectTools:'DIRECT_TOOLS'};

test('primary DIRECT_TOOLS pinned to owner and zero paid usage',()=>{
 const s=buildComposioV3Policy({...opt,profile:'primary-direct'});
 assert.deepEqual(s.connectedAccounts.github,[p]);assert.equal(s.sessionPreset,'DIRECT_TOOLS');
 assert.equal(s.instant,false);assert.equal(s.proxyExecute,false);
 assert.equal(s.sandbox.enable,false);assert.equal(s.multiAccount.enable,false);
 assert.equal(s.tools.github.enable.length,2);
});
test('multi-account has explicit selection and no incompatible preload or DIRECT_TOOLS',()=>{
 const s=buildComposioV3Policy({...opt,profile:'multi-account'});
 assert.deepEqual(s.connectedAccounts.github,[p,x]);assert.equal(s.multiAccount.maxAccountsPerToolkit,3);
 assert.equal(s.multiAccount.requireExplicitSelection,true);
 assert.equal('sessionPreset' in s,false);assert.equal('preload' in s,false);
});
test('missing/foreign platform credentials and unverified auth config reject',()=>{
 for(const candidate of [{...opt,primaryAccountId:'github_chatgpt_alias'},
  {...opt,executorAccountId:p},{...opt,executorAccountId:undefined},
  {...opt,customAuthConfigId:undefined}]){
  assert.throws(()=>buildComposioV3Policy({...candidate,profile:'multi-account'}),/denied/);
 }
 assert.throws(()=>buildComposioV3Policy({primaryAccountId:p}),/DIRECT_TOOLS/);
});
test('read admission requires explicit account and verified delegated grant',()=>{
 assert.equal(requireComposioReadAdmission({actor:'mw-primary',toolSlug:'GITHUB_GET_A_REPOSITORY',
  accountIds:opt}).account,p);
 assert.throws(()=>requireComposioReadAdmission({actor:'ultron-admin',toolSlug:'GITHUB_GET_A_REPOSITORY',accountIds:opt}),/signed-grant/);
 assert.equal(requireComposioReadAdmission({actor:'ultron-admin',toolSlug:'GITHUB_GET_A_REPOSITORY',
  accountIds:opt,grantVerified:true}).account,x);
 for(const tool of ['GITHUB_CREATE_AN_ISSUE','GITHUB_DELETE_A_REPOSITORY','COMPOSIO_PROXY_EXECUTE'])
  assert.throws(()=>requireComposioReadAdmission({actor:'mw-primary',toolSlug:tool,accountIds:opt}),/read-only/);
});
test('proxy restricted to exact primary GET endpoints',()=>{
 assert.equal(requireComposioProxyRead({profile:'primary-proxy',actor:'mw-primary',method:'GET',
  endpoint:'/user'}).toolkit,'github');
 for(const endpoint of ['/repos/a/b','/user/../admin','https://api.github.com/user','/user?foo=1'])
  assert.throws(()=>requireComposioProxyRead({profile:'primary-proxy',actor:'mw-primary',method:'GET',endpoint}),/denied/);
 assert.throws(()=>requireComposioProxyRead({profile:'multi-account',actor:'mw-primary',method:'POST',endpoint:'/user'}),/primary-only/);
});
test('no token values beyond four display characters',()=>{
 assert.equal(maskComposioDisplay('ABCDEFGH'),'ABCD••••');
 assert.equal(maskComposioDisplay(null),'****');
 assert.throws(()=>denyUntrustedComposioMutation(),/signed owner/);
});
