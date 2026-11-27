import {createNativeBrowserClient} from './native-browser-client.mjs';
import {createLocalPairing,publicEnrollment,canaryTask} from './pairing.mjs';
import {exchangeNativeRead} from './port.mjs';
const $=id=>document.getElementById(id);
const runtime=chrome.runtime;
let db,pairing,busy=false;
const status=text=>{$('status').textContent=text;};
function openDB(){return new Promise((resolve,reject)=>{
 const r=indexedDB.open('ultron-native-pairing-v1',1);
 r.onupgradeneeded=()=>r.result.createObjectStore('local');
 r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('Pairing storage unavailable'));
});}
function load(){return new Promise((resolve,reject)=>{
 const r=db.transaction('local','readonly').objectStore('local').get('pairing');
 r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('Pairing read failed'));
});}
function persist(value){return new Promise((resolve,reject)=>{
 const t=db.transaction('local','readwrite');
 t.oncomplete=resolve;t.onabort=()=>reject(Error('Pairing already exists or storage failed'));
 t.objectStore('local').add(value,'pairing');
});}
function show(){
 $('pair').hidden=!!pairing;$('paired').hidden=!pairing;
 $('enroll').disabled=busy||!!pairing;$('run').disabled=busy||!pairing;
 if(pairing)$('public').value=JSON.stringify(publicEnrollment(pairing),null,2);
}
$('enroll').addEventListener('click',async e=>{
 if(!e.isTrusted||busy||pairing||!db)return;
 busy=true;show();
 try{
  const p=await createLocalPairing({hostId:$('host').value,hostPublicKey:$('pem').value,
   fingerprint:$('fingerprint').value.trim(),extensionOrigin:runtime.getURL('')});
  await persist(p);pairing=p;status('Local key created. Register the public enrollment on the trusted host before running.');
 }catch{status('Pairing not created. Check the independently verified host fingerprint and local storage.');}
 finally{busy=false;show();}
});
$('run').addEventListener('click',async e=>{
 if(!e.isTrusted||busy||!pairing)return;
 busy=true;show();status('Waiting for authenticated native host...');
 try{
  const task=canaryTask(pairing);
  const client=createNativeBrowserClient({...pairing,authorize:async t=>busy&&JSON.stringify(t)===JSON.stringify(task)});
  const result=await exchangeNativeRead({runtime,client,task});
  status(JSON.stringify(result,null,2));
 }catch{status('Held: pairing or native exchange unavailable. No automatic retry.');}
 finally{busy=false;show();}
});
try{db=await openDB();pairing=await load();show();status(pairing?'Local pairing available. Host registration must be independently completed.':'Enter the independently verified host public key and fingerprint.');}
catch{status('Pairing storage unavailable.');}
