import test from 'node:test';
import assert from 'node:assert/strict';
import {createComposioV3Worker} from '../index.mjs';
const ids={primaryAccountId:'ca_owner_read_123',executorAccountId:'ca_delegated_read_456'};
const sha='a'.repeat(40);
function fake(){
 const used=[],state=new Map(),writes=[];
 const serverConfig=p=>({
  instant:false,toolkits:{enabled:['github']},sandbox:{enable:false},proxy_execute:{enable:!!p.proxyExecute},
  tools:{github:{enabled:p.tools.github.enable}},
  connected_accounts:{github:p.connectedAccounts.github},
  multi_account:{enable:p.multiAccount.enable,
   require_explicit_selection:p.multiAccount.requireExplicitSelection},
 });
 const client={
  async create(user,config){used.push({action:'create',user,config});
   return {sessionId:'session_test_123',config:serverConfig(config),
    execute:async(slug,arg,opt)=>{writes.push({slug,arg,opt});
     const owner=opt.account===ids.primaryAccountId;
     return {resultType:'completed',data:slug==='GITHUB_GET_THE_AUTHENTICATED_USER'?
      {login:owner?'michaeljwilliams0123':'michaeljwilliams0123ultron',
       id:owner?308995719:354634860}:
      {full_name:'michaeljwilliams0123/Ultron.MW',id:1424939667,
       owner:{id:308995719,login:'michaeljwilliams0123'},
       permissions:{pull:true,admin:owner}}};
    },
    proxyExecute:async()=>({resultType:'completed',status:200,data:{test:true}})
   };
  },
  async use(id){used.push({action:'use',id});return state.get('session');}
 };
 const store={
  async read(){return state.get('record');},
  async reserve(){return {ok:true,id:'lease123'};},
  async activate(v){state.set('record',{status:'active',...v});state.set('session',session);},
  async reconcile(){used.push({action:'reconcile'});},
  async recordObservation(){used.push({action:'receipt'});return {verified:true,receiptKey:'receipt_mock_123'};}
 };
 // Preserve object identity after create and activation.
 const create=client.create.bind(client);
 let session;
 client.create=async(u,p)=>{session=await create(u,p);return session;};
 return {client,store,used,writes};
}
test('missing protected secret and incomplete SDK/store fail closed',()=>{
 assert.throws(()=>createComposioV3Worker({accountIds:ids,userId:'ultron-owner-308995719',sourceSha:sha}),/protected API key/);
});
test('creates scoped owner direct session, verifies readback and reuses persisted ID',async()=>{
 const f=fake();
 const worker=createComposioV3Worker({client:f.client,store:f.store,
   accountIds:ids,userId:'ultron-owner-308995719',sourceSha:sha});
 const receipt=await worker.inspect({actor:'mw-primary'});
 assert.equal(receipt.verified,true);
 assert.equal(receipt.receiptKey,'receipt_mock_123');
 assert.equal(receipt.githubUserId,308995719);
 assert.equal(f.used.filter(x=>x.action==='create').length,1);
 const second=await worker.inspect({actor:'mw-primary'});
 assert.equal(second.verified,true);
 assert.equal(f.used.filter(x=>x.action==='use').length,1);
 assert.ok(f.writes.every(x=>x.opt.account===ids.primaryAccountId));
});
test('delegated account and arbitrary mutation are denied',async()=>{
 const f=fake();const worker=createComposioV3Worker({
  client:f.client,store:f.store,accountIds:ids,userId:'ultron-owner-308995719',sourceSha:sha});
 await assert.rejects(worker.inspect({profile:'multi-account',actor:'ultron-admin'}),/grant verifier/);
 assert.throws(()=>worker.denyMutation(),/signed owner/);
 assert.equal(f.writes.length,0);
});
test('proxy denies other origins, writes, delegated actors before any provider call',async()=>{
 const f=fake();const worker=createComposioV3Worker({
  client:f.client,store:f.store,accountIds:ids,userId:'ultron-owner-308995719',sourceSha:sha});
 await assert.rejects(worker.proxyRead({actor:'ultron-admin',endpoint:'/user'}),/primary-only/);
 await assert.rejects(worker.proxyRead({actor:'mw-primary',endpoint:'/user?redirect=https://evil.test'}),/denied/);
 assert.equal(f.used.length,0);
});
