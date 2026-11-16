#!/usr/bin/env node
/**
 * Local-only OAuth client for OpenAI's open-source Sign in with ChatGPT plan.
 * No account tokens enter git, GitHub Actions, public UIs or Hatchable.
 *
 * Commands:
 *   node scripts/chatgpt-plan-council.mjs status
 *   node scripts/chatgpt-plan-council.mjs login
 *   node scripts/chatgpt-plan-council.mjs models
 *   node scripts/chatgpt-plan-council.mjs canary <model-slug>
 */
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {homedir,platform} from 'node:os';
import {join} from 'node:path';
import {mkdir,readFile,writeFile,rename,chmod,unlink} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {createAuthorizationAttempt,validateAuthorizationCallback,
 completeAuthorization,refreshChatgptSession} from '../src/providers/chatgpt-siwc-auth.mjs';
import {listChatgptPlanModels} from '../src/providers/openai-chatgpt-plan.mjs';
import {reasonAsRole} from '../src/council-reasoning.mjs';

const HOME=join(homedir(),'.ultron','chatgpt-plan');
const HOST_FILE=join(HOME,'host-id.json');
const SESSION_FILE=join(HOME,'selected-session.json');
const PENDING_FILE=join(HOME,'refresh.lock');
const SCOPE='chatgpt.tokens.use.direct';
const PRIVATE_FILE_MODE=0o600;
const EIGHT_MINUTES=8*60*1000;

async function prepareHome(){
 await mkdir(HOME,{recursive:true,mode:0o700});
 if(platform()!=='win32')await chmod(HOME,0o700);
}
async function readJson(path){
 try{return JSON.parse(await readFile(path,'utf8'))}
 catch(e){if(e.code==='ENOENT')return null;throw e}
}
function protectWindowsFile(path){
 if(platform()!=='win32')return;
 // No token content, paths, or secrets are passed as command-line values.
 const sid=execFileSync('powershell.exe',[
  '-NoProfile','-NonInteractive','-Command',
  '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'
 ],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']}).trim();
 if(!/^S-1-[0-9-]+$/.test(sid))throw Error('chatgpt-plan-private-storage-unavailable');
 execFileSync('icacls.exe',[path,'/inheritance:r','/grant:r','*'+sid+':(F)'],
  {windowsHide:true,stdio:'ignore'});
}
async function store(path,data){
 await prepareHome();
 const tmp=path+'.'+randomUUID()+'.tmp';
 // Never print or pass tokens through shell arguments.
 try{
  await writeFile(tmp,JSON.stringify(data),{mode:PRIVATE_FILE_MODE,flag:'wx'});
  if(platform()!=='win32')await chmod(tmp,PRIVATE_FILE_MODE);
  else protectWindowsFile(tmp);
  await rename(tmp,path);
 }finally{await unlink(tmp).catch(()=>{})}
}
async function hostId(){
 await prepareHome();
 const old=await readJson(HOST_FILE);
 if(typeof old?.id==='string')return old.id;
 const id='urn:uuid:'+randomUUID();
 await store(HOST_FILE,{id});
 return id;
}
async function loadSession(){
 const s=await readJson(SESSION_FILE);
 if(s?.kind!=='chatgpt-plan-oauth'||s?.issuer!=='https://auth.openai.com')
  return null;
 return s;
}
async function updateSession({allowRefresh=true}={}){
 const s=await loadSession();
 if(!s)throw Error('chatgpt-plan-not-connected');
 const expiry=Date.parse(s.saved_at)+s.expires_in*1000;
 if(Number.isFinite(expiry)&&expiry>Date.now()+120000)return s;
 if(!allowRefresh)throw Error('chatgpt-plan-refresh-needed');
 // Serialize refresh across local processes: refresh tokens rotate.
 let lock;
 try{
  const {open}=await import('node:fs/promises');
  lock=await open(PENDING_FILE,'wx',0o600);
 }catch{
  throw Error('chatgpt-plan-refresh-already-running');
 }
 try{
  const fresh=await loadSession();
  const currentExpiry=Date.parse(fresh.saved_at)+fresh.expires_in*1000;
  if(currentExpiry>Date.now()+120000)return fresh;
  const next=await refreshChatgptSession(fresh);
  await store(SESSION_FILE,next);
  return next;
 }finally{
  await lock.close();await unlink(PENDING_FILE).catch(()=>{});
 }
}
function openBrowser(url){
 if(platform()==='win32'){
  // No secrets or ID token hints are included in the first registration URL.
  const cmd=`Start-Process -FilePath '${url.replaceAll("'","''")}'`;
  const encoded=Buffer.from(cmd,'utf16le').toString('base64');
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',encoded],
   {stdio:'ignore',windowsHide:true,detached:true});
  child.unref();
 }else{
  const child=spawn(platform()==='darwin'?'open':'xdg-open',[url],
   {stdio:'ignore',detached:true});
  child.unref();
 }
}
async function login(){
 const saved=await loadSession();
 const chosen=await hostId();
 let attempt,finished=false,resolve,reject;
 const authorization=new Promise((res,rej)=>{resolve=res;reject=rej});
 const server=createServer(async(req,res)=>{
  if(!req.url?.startsWith('/auth/callback?')||req.method!=='GET'){
   res.writeHead(404);res.end('Not found');return;
  }
  if(finished){res.writeHead(410);res.end('Authorization already handled');return;}
  finished=true;
  try{
   const {code,clientId}=validateAuthorizationCallback(
    'http://127.0.0.1:'+server.address().port+req.url,attempt);
   // Local callback contains only authorization code, never access tokens.
   const credentials=await completeAuthorization({
    code,clientId,verifier:attempt.verifier,redirectUri:attempt.redirectUri,
    nonce:attempt.nonce,hostId:chosen
   });
   if(saved&&saved.subject!==credentials.subject)
    throw Error('chatgpt-plan-account-mismatch');
   await store(SESSION_FILE,credentials);
   res.writeHead(200,{'content-type':'text/html; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff'});
   res.end('<!doctype html><title>Ultron.MW Council connected</title>'+
    '<p>ChatGPT authorization complete. You can close this tab.</p>');
   resolve({connected:true,planEnabled:credentials.scope.split(/\s+/).includes(SCOPE)});
  }catch(e){
   res.writeHead(400,{'content-type':'text/plain; charset=utf-8',
    'cache-control':'no-store'});res.end('Sign in unsuccessful. Return to Ultron.MW.');
   reject(new Error(String(e.message).startsWith('siwc-')?e.message:
    'chatgpt-plan-login-not-completed'));
  }finally{server.close()}
 });
 try{
  await new Promise((res,rej)=>{
   server.once('error',rej);
   server.listen(0,'127.0.0.1',res);
  });
  attempt=createAuthorizationAttempt({hostId:chosen,
   port:server.address().port,clientId:saved?.client_id??null});
  console.log('ChatGPT OAuth consent is required in the Windows browser.');
  console.log('Credentials will stay on this owner-controlled computer.');
  openBrowser(attempt.authorizationUrl);
  // Bound one-time listener. No asynchronous background handoff promise.
  const timeout=setTimeout(()=>{
   if(!finished){finished=true;reject(Error('chatgpt-plan-login-not-completed'));server.close()}
  },EIGHT_MINUTES);
  try{
   const result=await authorization;
   console.log('CHATGPT_PLAN_CONNECTED='+result.connected);
   console.log('CHATGPT_PLAN_INFERENCE_ENABLED='+result.planEnabled);
  }finally{clearTimeout(timeout)}
 }finally{server.close()}
}
async function main(){
 const cmd=process.argv[2]??'status';
 if(cmd==='status'){
  const c=await loadSession();
  const valid=Boolean(c?.scope?.split(/\s+/).includes(SCOPE));
  const active=Boolean(c&&Date.parse(c.saved_at)+c.expires_in*1000>Date.now()+30000);
  console.log(JSON.stringify({provider:'openai-chatgpt',mode:'oss-local-siwc',
   connected:!!c,planPermission:valid,accessTokenActive:active,
   costs:'no additional API billing; uses consented ChatGPT plan allowance'}));
 }else if(cmd==='login')await login();
 else if(cmd==='models'){
  const c=await updateSession();
  const available=await listChatgptPlanModels({credential:c});
  console.log(JSON.stringify({provider:'openai-chatgpt',
   models:available.map(m=>({slug:m.slug,display_name:m.display_name}))}));
 }else if(cmd==='canary'){
  const model=process.argv[3];
  if(!model)throw Error('model-selection-required: run models first');
  const credential=await updateSession();
  const r=await reasonAsRole({
   role:'Skeptic',input:'Synthetic public unit-test fixture: a function adds two integers. '+
    'What test could falsify its behavior? This is advisory only.',
   order:['openai-chatgpt'],chatgptPlan:{credential,model},env:{}
  });
  console.log(JSON.stringify({provider:r.provider??'openai-chatgpt',
   modelId:r.modelId??null,modelInvoked:r.modelInvoked,
   verdict:r.verdict,reason:r.fallbackReason??null,paidInference:false}));
  if(!r.modelInvoked)process.exitCode=2;
 }else throw Error('unsupported-command');
}
main().catch(e=>{
 // Never log OAuth codes, credentials, browser URLs or raw provider bodies.
 const m=String(e?.message||'failure');
 console.error('Ultron ChatGPT plan: '+(
  /^(chatgpt-plan-|siwc-|model-selection-required|unsupported-command)/.test(m)?
    m:'operation-unsuccessful'));
 process.exitCode=1;
});
