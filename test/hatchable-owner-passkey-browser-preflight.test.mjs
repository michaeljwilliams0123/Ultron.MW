import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../cloud/hatchable/public/owner-passkeys.js',import.meta.url),'utf8');
const NOW=Date.parse('2026-11-12T12:30:00.000Z');
function harness(){
 const elements=new Map();
 const name=id=>{
  if(!elements.has(id))elements.set(id,{
   id,value:'',textContent:'',disabled:false,children:[],handlers:{},
   addEventListener(event,fn){this.handlers[event]=fn},
   replaceChildren(){this.children=[]},
   append(child){this.children.push(child)}
  });
  return elements.get(id);
 };
 name('label').value='Test owner device';
 let id=0,clip='',creates=0,finishes=0,prepares=0;
 const clock=class extends Date{static now(){return NOW;}};
 const grant=(key)=>({actor:'mcp:ultron',objectiveId:key,operation:'owner.passkey.enroll',
  resource:'sha256:'+('a'.repeat(64)),administrativeChange:false,
  profileVersion:7,stopVersion:5,policySha:'b'.repeat(64)});
 const fetch=async(url,options={})=>{
  const body=options.body?JSON.parse(options.body):null;
  let response;
  if(url==='/api/brain/autonomy')response={ok:true,profile:{
   version:7,stopVersion:5,paused:false,maxPaidCents:0,
   allowedOperations:['owner.passkey.enroll']}};
  else if(url==='/api/brain/owner-passkeys'&&body?.mode==='prepare'){
   prepares++;
   response={ok:true,status:'prepared',key:body.request.key,grantRequest:grant(body.request.key),
    challenge:'A'.repeat(43),rpId:'ultron-mw-cloud.hatchable.site',
    userId:'A'.repeat(22),expiresAt:new Date(NOW+600000).toISOString()};
  }else if(url==='/api/brain/owner-passkeys'&&body?.mode==='finish'){
   finishes++;response={ok:true,status:'enrolled',label:'Test owner device'};
  }else if(url==='/api/brain/owner-passkeys')response={ok:true,credentials:[]};
  else throw Error('unexpected route: '+url);
  return {ok:true,status:200,json:async()=>response};
 };
 const ctx={
  document:{getElementById:name,createElement:()=>({value:'',textContent:''})},
  window:{PublicKeyCredential:class{}},
  crypto:{randomUUID:()=>('00000000-0000-4000-8000-'+String(++id).padStart(12,'0'))},
  navigator:{
   clipboard:{writeText:async value=>{clip=value},readText:async()=>clip},
   credentials:{create:async()=>{
    creates++;
    return {type:'public-key',rawId:new Uint8Array([1,2,3]),
     response:{clientDataJSON:new Uint8Array([4,5]),attestationObject:new Uint8Array([6,7])}};
   }}
  },fetch,Date:clock,TextEncoder,TextDecoder,Uint8Array,atob,btoa,
  confirm:()=>true,console
 };
 runInNewContext(source,ctx);
 return {name,grant,click:async id=>{
   const f=name(id).handlers.click;
   assert.equal(typeof f,'function','button '+id+' must be interactive');
   await f();
  },setClipboard:s=>clip=s,getClipboard:()=>clip,
  get creates(){return creates},get finishes(){return finishes},get prepares(){return prepares}};
}
function signed(g,secondsRemaining){
 return JSON.stringify({payload:JSON.stringify({
  ...g,authorizedBy:'michaeljwilliams0123',schema:'ultron.security-grant.v1',
  issuer:'ultron-owner-authority',audience:'ultron-cloud-brain',
  grantId:'owner-test-1234',
  notBefore:new Date(NOW-30000).toISOString(),
  expiresAt:new Date(NOW+secondsRemaining*1000).toISOString()
 }),signature:'synthetic-signature-the-server-validates'});
}
test('new Prepare always rotates enrollment key and clears stale pasted authorization',async()=>{
 const h=harness();
 await h.click('enroll-prepare');
 const first=h.name('enroll-key').value;
 h.name('envelope').value='stale-grant';
 await h.click('enroll-prepare');
 assert.notEqual(h.name('enroll-key').value,first);
 assert.equal(h.name('envelope').value,'');
 assert.equal(h.prepares,2);
});
test('pasting a mismatched owner envelope is rejected before Windows Hello',async()=>{
 const h=harness();
 await h.click('enroll-prepare');
 const g=h.grant(h.name('enroll-key').value);
 h.setClipboard(signed({...g,objectiveId:'owner-different-enrollment'},290));
 await h.click('enroll-paste');
 assert.match(h.name('enroll-status').textContent,/does-not-match/i);
 assert.equal(h.name('envelope').value,'');
 assert.equal(h.creates,0);
});
test('near-expiry signed grant is rejected before a WebAuthn prompt',async()=>{
 const h=harness();
 await h.click('enroll-prepare');
 const g=h.grant(h.name('enroll-key').value);
 h.name('envelope').value=signed(g,100);
 await h.click('enroll-finish');
 assert.match(h.name('enroll-status').textContent,/signed-grant-too-close-to-expiry/);
 assert.equal(h.creates,0);
 assert.equal(h.finishes,0);
});
test('a sufficiently fresh matched grant proceeds to WebAuthn and server readback',async()=>{
 const h=harness();
 await h.click('enroll-prepare');
 const g=h.grant(h.name('enroll-key').value);
 h.setClipboard(signed(g,290));
 await h.click('enroll-paste');
 assert.match(h.name('enroll-status').textContent,/Signed grant ready/i);
 await h.click('enroll-finish');
 assert.equal(h.creates,1);
 assert.equal(h.finishes,1);
 assert.match(h.name('enroll-status').textContent,/Passkey enrolled/);
});
