import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {sealCredential,openCredential,createCredentialVault,openCloudBrowser,createCloudDesktop}
  from '../src/cloud-computer.mjs';

const KEY=randomBytes(32).toString('base64');
const memStore=()=>{const m=new Map();return{get:async k=>m.get(k)??null,set:async(k,v)=>void m.set(k,v),
  delete:async k=>void m.delete(k),list:async p=>[...m.keys()].filter(k=>k.startsWith(p))};};

test('vault round-trips, is opaque at rest and rejects tampering/wrong key',async()=>{
  const credentials={username:'me',password:'pw'};
  const blob=sealCredential(credentials,KEY);
  assert.ok(!blob.includes(JSON.stringify(credentials)));
  assert.deepEqual(openCredential(blob,KEY),credentials);
  assert.throws(()=>openCredential(blob,randomBytes(32).toString('base64')));
  const bad=Buffer.from(blob,'base64');bad[bad.length-1]^=1;
  assert.throws(()=>openCredential(bad.toString('base64'),KEY));
  assert.throws(()=>sealCredential({},'short'),/vault-key-invalid/);
});
test('vault lists sites only and normalises hostnames',async()=>{
  const v=createCredentialVault({store:memStore(),vaultKey:KEY});
  await v.save('https://Example.com/login',{username:'a',password:'b'});
  assert.deepEqual(await v.list(),['example.com']);
  assert.equal((await v.open('example.com')).username,'a');
  await v.remove('example.com');assert.equal(await v.open('example.com'),null);
});
test('signIn fills saved credentials on any origin and persists the session',async()=>{
  const v=createCredentialVault({store:memStore(),vaultKey:KEY});
  await v.save('anywhere.test',{username:'me',password:'pw'});
  const filled=[];
  const loc=sel=>({first:()=>loc(sel),count:async()=>1,isVisible:async()=>true,
    waitFor:async()=>{},fill:async x=>void filled.push([sel.slice(0,14),x]),click:async()=>{}});
  const page={goto:async()=>{},locator:loc,keyboard:{press:async()=>{}},
    waitForLoadState:async()=>{},context:()=>({storageState:async()=>({cookies:['c']})})};
  const context={pages:()=>[page],newPage:async()=>page};
  const pw={chromium:{connectOverCDP:async ws=>{assert.equal(ws,'wss://remote');
    return{contexts:()=>[context],newContext:async()=>context,close:async()=>{}};}}};
  const b=await openCloudBrowser({vault:v,env:{ULTRON_CLOUD_BROWSER_WS:'wss://remote'},playwright:pw});
  const r=await b.signIn('https://anywhere.test/login');
  assert.equal(r.signedIn,true);
  assert.deepEqual(filled.map(f=>f[1]),['me','pw']);
  assert.deepEqual((await v.open('anywhere.test')).storageState,{cookies:['c']});
});
test('cloud browser and desktop refuse to run unconfigured or insecure',async()=>{
  await assert.rejects(openCloudBrowser({env:{}}),/cloud-browser-unconfigured/);
  assert.throws(()=>createCloudDesktop({env:{}}),/cloud-desktop-unconfigured/);
  assert.throws(()=>createCloudDesktop({env:{ULTRON_CLOUD_DESKTOP_URL:'http://x',ULTRON_CLOUD_DESKTOP_TOKEN:'t'}}),/https/);
});
test('desktop verbs call the remote VM with bearer auth',async()=>{
  const calls=[];
  const d=createCloudDesktop({env:{ULTRON_CLOUD_DESKTOP_URL:'https://vm.example/',ULTRON_CLOUD_DESKTOP_TOKEN:'tok'},
    fetchImpl:async(u,i)=>{calls.push([u,i.headers.authorization,i.body]);return{ok:true,json:async()=>({ok:1})};}});
  await d.click(10,20);await d.type('hi');
  assert.equal(calls[0][0],'https://vm.example/click');
  assert.equal(calls[0][1],'Bearer tok');
  assert.equal(calls[1][2],'{"text":"hi"}');
});
