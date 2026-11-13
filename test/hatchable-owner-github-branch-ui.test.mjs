import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const HTML=readFileSync(new URL('../cloud/hatchable/public/passkey-owner.html',import.meta.url),'utf8');
const JS=readFileSync(new URL('../cloud/hatchable/public/github-branch-canary.js',import.meta.url),'utf8');
const SHA='9e6a18870303b2d75926feb7c93f5cc610ff69e3';
const TIME=Date.parse('2026-11-12T15:00:00.000Z');
const PREPARED={
 taskId:'hb-1234567890abcdef12345678',sourceSha:SHA,
 branch:'ultron/canary-hb-1234567890abcdef12345678',
 planSha256:'a'.repeat(64)
};
const GRANT={actor:'worker:builder',objectiveId:'ultron-task-'+PREPARED.taskId,
 operation:'repair.branch.create',
 resource:'github:branch:michaeljwilliams0123/Ultron.MW:'+PREPARED.branch+
  ':sha256:'+PREPARED.planSha256,
 administrativeChange:false,policySha:'b'.repeat(64),
 profileVersion:7,stopVersion:5};
function fixture({allowed=true,passkeys=1,ci=true,submitOutcome='success'}={}){
 const elements=new Map(),requests=[],reads=[];
 function element(id){
  if(!elements.has(id))elements.set(id,{
   value:'',textContent:'',disabled:false,handlers:{},
   addEventListener(type,handler){this.handlers[type]=handler}
  });
  return elements.get(id);
 }
 let clipboard='',confirmed=0;
 class Clock extends Date{static now(){return TIME}}
 const profile={paused:false,maxPaidCents:0,allowedOperations:
  allowed?['repair.branch.create','owner.passkey.enroll']:['owner.passkey.enroll']};
 const registry={credentials:Array.from({length:passkeys},(_,i)=>({credentialId:'cred-'+i}))};
 const connectivity={github:{mainSha:SHA},ci:{sourceSha:SHA,state:ci?'observed':'unavailable',conclusion:ci?'success':null}};
 const respond=(status,body)=>({ok:status>=200&&status<300,status,json:async()=>body});
 const fetch=async(path,options={})=>{
  const body=options.body?JSON.parse(options.body):null;
  if(body)requests.push({path,body}); else reads.push(path);
  if(path==='/api/brain/autonomy')return respond(200,{ok:true,profile});
  if(path==='/api/brain/owner-passkeys')return respond(200,{ok:true,...registry});
  if(path==='/api/brain/connectivity')return respond(200,{ok:true,...connectivity});
  if(path==='/api/brain/github-branch-canary'&&body?.mode==='prepare')
   return respond(200,{ok:true,status:'prepared',prepared:PREPARED,
    ownerGrantRequest:GRANT,plan:{parameters:{branch:PREPARED.branch}}});
  if(path==='/api/brain/github-branch-canary'&&body?.mode==='submit')
   return submitOutcome==='success'?
    respond(201,{ok:true,status:'success',branch:PREPARED.branch,commitSha:SHA,
     idempotencyKey:'ultron-task-'+PREPARED.taskId,
     productionAccepted:false,providerReadbackStatus:'matched'}):
    respond(202,{ok:false,status:'reconcile-required',error:'provider-outcome-unresolved'});
  if(path==='/api/brain/github-branch-canary'&&body?.mode==='reconcile')
   return respond(200,{ok:true,status:'reconciled_success',
    providerReadbackStatus:'matched',receipt:{idempotencyKey:'ultron-task-'+PREPARED.taskId}});
  throw Error('unexpected API '+path);
 };
 const ctx={
  document:{getElementById:element},
  navigator:{clipboard:{readText:async()=>clipboard,writeText:async t=>{clipboard=t}}},
  window:{},Date:Clock,console,
  confirm:()=>{confirmed++;return true},
  fetch
 };
 runInNewContext(JS,ctx);
 return {element,requests,reads,confirmations:()=>confirmed,
  clipboard:()=>clipboard,setClipboard:value=>{clipboard=value},
  setManualEnvelope:value=>{element('gh-envelope').value=value},
  signed:({seconds=290,request=GRANT}={})=>JSON.stringify({
   payload:JSON.stringify({...request,authorizedBy:'michaeljwilliams0123',
    grantId:'owner-test-approval-1234',notBefore:new Date(TIME-30000).toISOString(),
    expiresAt:new Date(TIME+seconds*1000).toISOString()}),
   signature:'A'.repeat(86)}),
  click:async id=>{
   const click=element(id).handlers.click;
   assert.equal(typeof click,'function',id+' should be wired');
   await click();
  }
 };
}
test('one-page UI has distinct GitHub grant-based canary controls',()=>{
 for(const id of ['gh-check','gh-source','gh-prepare','gh-branch','gh-grant',
  'gh-copy','gh-envelope','gh-paste','gh-submit','gh-reconcile','gh-status-text'])
  assert.match(HTML,new RegExp('id="'+id+'"'));
 assert.match(HTML,/GitHub.*branch/i);
});
test('readiness blocks a write when no owner passkey or operation enablement exists',async()=>{
 for(const options of [{passkeys:0},{allowed:false},{ci:false}]){
  const h=fixture(options);
  await h.click('gh-check');
  assert.equal(h.element('gh-prepare').disabled,true);
  await h.click('gh-prepare');
  assert.equal(h.requests.some(x=>x.body.mode==='prepare'),false);
  assert.match(h.element('gh-status-text').textContent,/(passkey|repair.branch.create|CI)/i);
 }
});
test('signed grant must match prepared branch and have enough time for owner authorization',async()=>{
 const h=fixture();
 await h.click('gh-check');await h.click('gh-prepare');
 assert.equal(h.element('gh-branch').value,PREPARED.branch);
 h.setClipboard(h.signed({request:{...GRANT,resource:'mismatch'}}));
 await h.click('gh-paste');
 assert.match(h.element('gh-status-text').textContent,/mismatch/i);
 assert.equal(h.element('gh-envelope').value,'');
 h.setClipboard(h.signed({seconds:60}));
 await h.click('gh-paste');
 assert.match(h.element('gh-status-text').textContent,/expiry|expire/i);
 assert.equal(h.element('gh-submit').disabled,true);
 h.setClipboard(h.signed());
 await h.click('gh-paste');
 assert.equal(h.element('gh-submit').disabled,false);
});
test('authorized branch submission sends exactly one mutation request',async()=>{
 const h=fixture();
 await h.click('gh-check');await h.click('gh-prepare');await h.click('gh-copy');
 assert.match(h.clipboard(),/repair.branch.create/);
 h.setClipboard(h.signed());await h.click('gh-paste');
 await h.click('gh-submit');
 assert.match(h.element('gh-status-text').textContent,/independent|readback|receipt/i);
 await h.click('gh-submit');
 assert.match(h.element('gh-status-text').textContent,/already submitted/i);
 assert.equal(h.requests.filter(x=>x.body.mode==='submit').length,1);
 assert.equal(h.confirmations(),1);
 assert.equal(h.element('gh-submit').disabled,true);
});
test('ambiguous GitHub response never blindly resubmits; owner can reconcile read-only',async()=>{
 const h=fixture({submitOutcome:'ambiguous'});
 await h.click('gh-check');await h.click('gh-prepare');
 h.setClipboard(h.signed());await h.click('gh-paste');
 await h.click('gh-submit');
 assert.equal(h.requests.filter(x=>x.body.mode==='submit').length,1);
 assert.equal(h.element('gh-submit').disabled,true);
 assert.equal(h.element('gh-reconcile').disabled,false);
 await h.click('gh-reconcile');
 assert.equal(h.requests.filter(x=>x.body.mode==='reconcile').length,1);
 assert.equal(h.requests.filter(x=>x.body.mode==='submit').length,1);
 assert.match(h.element('gh-status-text').textContent,/reconciled/i);
});

test('rapid concurrent clicks cannot authorize two branch submissions',async()=>{
 const h=fixture();
 await h.click('gh-check');await h.click('gh-prepare');
 h.setClipboard(h.signed());await h.click('gh-paste');
 await Promise.all([h.click('gh-submit'),h.click('gh-submit')]);
 assert.equal(h.requests.filter(x=>x.body.mode==='submit').length,1);
 assert.equal(h.confirmations(),1);
});
