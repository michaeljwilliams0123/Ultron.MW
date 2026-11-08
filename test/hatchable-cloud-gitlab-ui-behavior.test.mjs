import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';

const script=await readFile(new URL('../cloud/hatchable/public/cloud-gitlab.js',import.meta.url),'utf8');
const SHA='8c03bc3a56b41be88f65caa18568d6876bbe974c';
const KEY='branchcanary001';
const profile={owner:'michaeljwilliams0123',preset:'release',version:6,
 stopVersion:5,paused:false,maxPaidCents:0,
 allowedOperations:['gitlab.branch.create']};
const grantRequest={actor:'mcp:ultron',objectiveId:KEY,
 operation:'gitlab.branch.create',resource:'sha256:'+'a'.repeat(64),
 administrativeChange:false,profileVersion:6,stopVersion:5,
 policySha:'c'.repeat(64)};

function start(fetcher){
 const ids=['cloud-gitlab-key','cloud-gitlab-sha','cloud-gitlab-prepare',
 'cloud-gitlab-copy','cloud-gitlab-submit','cloud-gitlab-reconcile',
 'cloud-gitlab-grant','cloud-gitlab-envelope','cloud-gitlab-status'];
 const els=new Map(ids.map(id=>[id,{id,value:'',disabled:false,textContent:'',
  listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},
  dispatch(type){this.listeners[type]?.()}}]));
 els.get('cloud-gitlab-key').value=KEY;
 els.get('cloud-gitlab-sha').value=SHA;
 const calls=[],clip=[];
 const sandbox={document:{getElementById:id=>els.get(id)},
  navigator:{clipboard:{writeText:async value=>{clip.push(value)}}},
  fetch:async(path,options={})=>{
   calls.push({path,options,body:options.body?JSON.parse(options.body):null});
   return fetcher(path,options);
  },window:{confirm:()=>true},crypto:webcrypto,TextEncoder,
  setTimeout,clearTimeout,console};
 vm.runInNewContext(script,sandbox,{filename:'cloud-gitlab.js'});
 return {el:id=>els.get('cloud-gitlab-'+id),calls,clip,els};
}
function response(body,status=200){
 return {ok:status>=200&&status<300,status,
  json:async()=>body};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function settle(){for(let i=0;i<7;i++)await tick();}

test('slow owner-profile fetch cannot resurrect a stale prepared request after user edits SHA',async()=>{
 let releaseOwner;
 const owner=new Promise(resolve=>{releaseOwner=resolve});
 const h=start(async(path)=>{
  if(path==='/api/brain/autonomy')return owner;
  if(path==='/api/brain/gitlab-branch')return response({ok:true,mode:'prepare',grantRequest});
  throw Error('unexpected call');
 });
 h.el('prepare').dispatch('click');
 await settle();
 h.el('sha').value='b'.repeat(40);
 h.el('sha').dispatch('input');
 releaseOwner(response({ok:true,profile}));
 await settle();
 assert.equal(h.calls.filter(x=>x.path==='/api/brain/gitlab-branch').length,0,
  'stale user intent must not trigger cloud prepare after changing SHA');
 assert.equal(h.el('grant').value,'','the stale signable request must not reappear');
 assert.equal(h.el('submit').disabled,true);
});

test('signed grant with a mismatched policy digest never reaches cloud submit',async()=>{
 const h=start(async(path)=>{
  if(path==='/api/brain/autonomy')return response({ok:true,profile});
  if(path==='/api/brain/gitlab-branch')return response({ok:true,mode:'prepare',grantRequest});
  throw Error('unexpected call');
 });
 h.el('prepare').dispatch('click');await settle();
 assert.equal(h.el('grant').value.length>0,true);
 const signable=JSON.parse(h.el('grant').value);
 h.el('envelope').value=JSON.stringify({
  payload:JSON.stringify({schema:'ultron.security-grant.v1',issuer:'ultron-owner-authority',
   audience:'ultron-cloud-brain',authorizedBy:'michaeljwilliams0123',
   grantId:'owner-grant-001',...signable,policySha:'f'.repeat(64)}),
  signature:'a'.repeat(86)});
 h.el('envelope').dispatch('input');
 h.el('submit').dispatch('click');await settle();
 assert.equal(h.calls.filter(x=>x.body?.mode==='submit').length,0,
  'UI must reject a different signed policy digest before provider boundary');
 assert.match(h.el('status').textContent,/signed-grant-does-not-match-preparation/);
});

test('ambiguous submit never triggers a second submit from the same page',async()=>{
 const h=start(async(path,options)=>{
  if(path==='/api/brain/autonomy')return response({ok:true,profile});
  if(path==='/api/brain/gitlab-branch'&&!options.body?.includes('"mode":"submit"'))
   return response({ok:true,mode:'prepare',grantRequest});
  return response({ok:false,status:'reconcile-required',reason:'provider-outcome-unresolved'},503);
 });
 h.el('prepare').dispatch('click');await settle();
 const signable=JSON.parse(h.el('grant').value);
 h.el('envelope').value=JSON.stringify({payload:JSON.stringify({
  schema:'ultron.security-grant.v1',issuer:'ultron-owner-authority',
  audience:'ultron-cloud-brain',authorizedBy:'michaeljwilliams0123',
  grantId:'owner-grant-001',...signable}),signature:'a'.repeat(86)});
 h.el('envelope').dispatch('input');
 h.el('submit').dispatch('click');await settle();
 h.el('submit').dispatch('click');await settle();
 assert.equal(h.calls.filter(x=>x.body?.mode==='submit').length,1);
 assert.equal(h.el('submit').disabled,true);
 assert.equal(h.el('reconcile').disabled,false);
});

test('uncertain submit preserves the same action and grant for reconciliation after input edit',async()=>{
 const h=start(async(path,options)=>{
  if(path==='/api/brain/autonomy')return response({ok:true,profile});
  if(path==='/api/brain/gitlab-branch'&&!options.body?.includes('"mode":"submit"'))
   return response({ok:true,mode:'prepare',grantRequest});
  return response({ok:false,status:'reconcile-required',reason:'provider-outcome-unresolved'},503);
 });
 h.el('prepare').dispatch('click');await settle();
 const signable=JSON.parse(h.el('grant').value);
 h.el('envelope').value=JSON.stringify({payload:JSON.stringify({
  schema:'ultron.security-grant.v1',issuer:'ultron-owner-authority',
  audience:'ultron-cloud-brain',authorizedBy:'michaeljwilliams0123',
  grantId:'owner-grant-002',...signable}),signature:'a'.repeat(86)});
 h.el('envelope').dispatch('input');
 h.el('submit').dispatch('click');await settle();
 assert.equal(h.el('reconcile').disabled,false);
 h.el('sha').value='b'.repeat(40);
 h.el('sha').dispatch('input');
 assert.equal(h.el('sha').value,SHA,'submitted operation must remain fixed for reconciliation');
 assert.equal(h.el('submit').disabled,true);
 assert.equal(h.el('reconcile').disabled,false,'must preserve the previous grant ID');
});

test('editing inputs after an uncertain submit must not erase the only reconciliation handle',async()=>{
 const h=start(async(path,options)=>{
  if(path==='/api/brain/autonomy')return response({ok:true,profile});
  if(path==='/api/brain/gitlab-branch'&&!options.body?.includes('"mode":"submit"'))
   return response({ok:true,mode:'prepare',grantRequest});
  return response({ok:false,status:'reconcile-required',reason:'provider-outcome-unresolved'},503);
 });
 h.el('prepare').dispatch('click');await settle();
 const signable=JSON.parse(h.el('grant').value);
 h.el('envelope').value=JSON.stringify({payload:JSON.stringify({
  schema:'ultron.security-grant.v1',issuer:'ultron-owner-authority',
  audience:'ultron-cloud-brain',authorizedBy:'michaeljwilliams0123',
  grantId:'owner-grant-001',...signable}),signature:'a'.repeat(86)});
 h.el('envelope').dispatch('input');
 h.el('submit').dispatch('click');await settle();
 assert.equal(h.el('reconcile').disabled,false);
 h.el('key').value='different-key-001';
 h.el('key').dispatch('input');
 await settle();
 assert.equal(h.el('submit').disabled,true,'cannot start a new submit before reconciling uncertain effect');
 assert.equal(h.el('reconcile').disabled,false,'retain original grant id and request');
 assert.equal(h.el('key').value,KEY,'cannot silently change the existing operation identity');
});
