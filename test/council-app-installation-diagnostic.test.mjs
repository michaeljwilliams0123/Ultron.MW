import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {diagnoseCouncilAppInstallation} from '../src/security/council-app-installation-diagnostic.mjs';

const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const pem=privateKey.export({type:'pkcs1',format:'pem'});
const now=()=>Date.parse('2026-11-10T12:00:00Z');
const appId=5633654;
const appResponse={id:appId,slug:'ultron-coordinator'};
const installation={id:778899,app_id:appId,account:{login:'michaeljwilliams0123'}};

function response(status,data){
 return {ok:status>=200&&status<300,status,
  json:async()=>data,headers:{get:()=>null}};
}
function requestFor(app,repo,requests){
 return async (url,opts)=>{
  requests.push({url,opts});
  assert.equal(opts.method,'GET');
  assert.equal(opts.redirect,'error');
  const jwt=opts.headers.Authorization.replace('Bearer ','');
  const [header,payload,sig]=jwt.split('.');
  assert.equal(JSON.parse(Buffer.from(header,'base64url')).alg,'RS256');
  assert.equal(JSON.parse(Buffer.from(payload,'base64url')).iss,String(appId));
  assert.equal(verify('RSA-SHA256',Buffer.from(header+'.'+payload),
   publicKey,Buffer.from(sig,'base64url')),true);
  if(url==='https://api.github.com/app')return app;
  if(url==='https://api.github.com/repos/michaeljwilliams0123/Ultron.MW/installation')return repo;
  throw Error('unexpected request');
 };
}

test('valid signing key and organization installation are observed without claiming a scoped principal',async()=>{
 const seen=[];
 const r=await diagnoseCouncilAppInstallation({appId,privateKey:pem,now,
  request:requestFor(response(200,appResponse),response(200,installation),seen)});
 assert.equal(r.status,'installation-observed');
 assert.equal(r.appIdentityVerified,true);
 assert.equal(r.installationVisible,true);
 assert.equal(r.verifiedPrincipalCount,0);
 assert.equal(r.installationId,778899);
 assert.equal(r.repository,'michaeljwilliams0123/Ultron.MW');
 assert.deepEqual(seen.map(x=>x.url),[
  'https://api.github.com/app',
  'https://api.github.com/repos/michaeljwilliams0123/Ultron.MW/installation']);
 assert.equal(JSON.stringify(r).includes('PRIVATE KEY'),false);
 assert.equal(JSON.stringify(r).includes('Bearer '),false);
});

test('valid Coordinator signing key with missing org/repository installation holds with precise reason',async()=>{
 const seen=[];
 const r=await diagnoseCouncilAppInstallation({appId,privateKey:pem,now,
  request:requestFor(response(200,appResponse),response(404,{message:'Not Found'}),seen)});
 assert.equal(r.status,'held');
 assert.equal(r.reason,'coordinator-organization-installation-not-visible');
 assert.equal(r.appIdentityVerified,true);
 assert.equal(r.installationVisible,false);
 assert.equal(r.verifiedPrincipalCount,0);
 assert.equal(seen.length,2);
});

test('invalid app identity or rejected JWT fails closed before repository lookup',async()=>{
 for(const app of [response(200,{id:123,slug:'other-app'}),response(401,{}),response(403,{})]){
  const seen=[];
  const r=await diagnoseCouncilAppInstallation({appId,privateKey:pem,now,
   request:requestFor(app,response(200,installation),seen)});
  assert.equal(r.status,'held');
  assert.equal(r.verifiedPrincipalCount,0);
  assert.equal(seen.length,1);
 }
});

test('invalid configuration and network errors fail closed without leaking credentials',async()=>{
 const empty=await diagnoseCouncilAppInstallation({appId,privateKey:'',now,
  request:async()=>{throw Error('must not call network');}});
 assert.equal(empty.status,'held');
 const malformed=await diagnoseCouncilAppInstallation({appId,privateKey:'not a PEM',now,
  request:async()=>{throw Error('must not call network');}});
 assert.equal(malformed.status,'held');
 const network=await diagnoseCouncilAppInstallation({appId,privateKey:pem,now,
  request:async()=>{throw Error('SENSITIVE_ERROR_PAYLOAD');}});
 assert.equal(network.status,'held');
 assert.equal(JSON.stringify(network).includes('SENSITIVE_ERROR_PAYLOAD'),false);
});

test('retired organization installation or wrong app id never passes',async()=>{
 for(const candidate of [
  {...installation,id:0},
  {...installation,app_id:12},
  {...installation,account:{login:'Ultron-MW'}},
  {...installation,account:{login:'Attacker'}},
 ]){
  const r=await diagnoseCouncilAppInstallation({appId,privateKey:pem,now,
   request:requestFor(response(200,appResponse),response(200,candidate),[])});
  assert.equal(r.status,'held');
  assert.equal(r.installationVisible,false);
 }
});

test('Council workflow publishes sanitized diagnostics even when installation is absent',async()=>{
 const yaml=await readFile(new URL('../.github/workflows/council-principal-proof.yml',import.meta.url),'utf8');
 assert.match(yaml,/node scripts\/diagnose-council-installation\.mjs/);
 assert.match(yaml,/artifacts\/council-app-installation-diagnostic\.json/);
 assert.ok(yaml.indexOf('node scripts/diagnose-council-installation.mjs') <
  yaml.indexOf('actions/create-github-app-token@'));
 assert.match(yaml,/if: always\(\)/);
 assert.doesNotMatch(yaml,/contents: write|actions: write|id-token: write|pull_request_target:|skip-token-revoke: true/);
});
