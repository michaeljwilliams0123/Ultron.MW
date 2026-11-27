import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createLocalPairing,publicEnrollment,canaryTask} from '../browser-extension/ultron-native/pairing.mjs';
const extensionOrigin='chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/';
const host=generateKeyPairSync('ed25519');
const spki=host.publicKey.export({type:'spki',format:'der'});
const hostPublicKey=host.publicKey.export({type:'spki',format:'pem'});
const fingerprint=createHash('sha256').update(spki).digest('hex');
test('pairing verifies an independently supplied host fingerprint and exports only public enrollment',async()=>{
 const p=await createLocalPairing({hostId:'ultron-local-browser',hostPublicKey,fingerprint,extensionOrigin});
 assert.equal(p.devicePrivateKey.extractable,false);
 const enrollment=publicEnrollment(p);
 assert.deepEqual(Object.keys(enrollment).sort(),['deviceId','devicePublicKey','extensionOrigin','hostId']);
 assert.equal(enrollment.extensionOrigin,extensionOrigin);
 assert.match(enrollment.devicePublicKey,/BEGIN PUBLIC KEY/);
 await assert.rejects(crypto.subtle.exportKey('pkcs8',p.devicePrivateKey));
 await assert.rejects(createLocalPairing({hostId:'ultron-local-browser',hostPublicKey,fingerprint:'0'.repeat(64),extensionOrigin}),/fingerprint/);
 assert.deepEqual(canaryTask(p),canaryTask(p));
 assert.equal(canaryTask(p).maxPaidCents,0);
 assert.equal(canaryTask(p).path,'/browser-write-acceptance.html');
});
test('extension manifest has only native messaging permission, no automatic background or website access',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../browser-extension/ultron-native/manifest.json',import.meta.url),'utf8'));
 assert.equal(manifest.manifest_version,3);
 assert.deepEqual(manifest.permissions,['nativeMessaging']);
 for(const k of ['host_permissions','optional_host_permissions','optional_permissions','content_scripts','externally_connectable','background','web_accessible_resources'])assert.equal(Object.hasOwn(manifest,k),false);
 assert.equal(manifest.action.default_popup,'popup.html');
});

test('source popup resolves the canonical client and package contains the same implementation',async()=>{
 const {createNativeBrowserClient}=await import('../src/computer/native-browser-client.mjs');
 const source=await import('../browser-extension/ultron-native/native-browser-client.mjs');
 assert.equal(source.createNativeBrowserClient,createNativeBrowserClient);
 const {mkdtemp,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const {execFileSync}=await import('node:child_process');
 const {fileURLToPath}=await import('node:url');
 const dir=await mkdtemp(join(tmpdir(),'ultron-extension-package-test-'));
 try{
  const dest=join(dir,'package');
  execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/package-native-browser-extension.mjs',import.meta.url)),dest]);
  assert.deepEqual(await readFile(join(dest,'native-browser-client.mjs')),await readFile(new URL('../src/computer/native-browser-client.mjs',import.meta.url)));
 }finally{await rm(dir,{recursive:true,force:true});}
});
