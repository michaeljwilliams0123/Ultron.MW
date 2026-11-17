#!/usr/bin/env node
/**
 * Local-only OAuth client for OpenAI's open-source Sign in with ChatGPT plan.
 * No account tokens enter git, GitHub Actions, public UIs or Hatchable.
 *
 * Commands:
 *   node scripts/chatgpt-plan-council.mjs status
 *   node scripts/chatgpt-plan-council.mjs login
 *   node scripts/chatgpt-plan-council.mjs models
 *   node scripts/chatgpt-plan-council.mjs confirm-plan-only
 *   node scripts/chatgpt-plan-council.mjs canary <model-slug>
 */
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {homedir,platform} from 'node:os';
import {join} from 'node:path';
import {mkdir,readFile,writeFile,rename,chmod,unlink} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {createAuthorizationAttempt,
 completeAuthorization,refreshChatgptSession} from '../src/providers/chatgpt-siwc-auth.mjs';
import {createOneTimeSiwcCallback} from '../src/providers/chatgpt-siwc-callback.mjs';
import {listChatgptPlanModels} from '../src/providers/openai-chatgpt-plan.mjs';
import {reasonAsRole} from '../src/council-reasoning.mjs';
import {assertOwnerConfirmedPlanOnly} from '../src/providers/chatgpt-plan-only-policy.mjs';
import {resolveSiwcBrowserCommand} from '../src/providers/chatgpt-siwc-browser.mjs';

const HOME=join(homedir(),'.ultron','chatgpt-plan');
const HOST_FILE=join(HOME,'host-id.json');
const SESSION_FILE=join(HOME,'selected-session.json');
const PLAN_ONLY_POLICY_FILE=join(HOME,'owner-plan-only-confirmation.json');
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
async function openBrowser(url){
 if(process.env.ULTRON_SIWC_MANUAL_BROWSER==='1'){
  const destination=new URL(url);
  if(destination.origin!=='https://auth.openai.com'||destination.searchParams.has('id_token_hint'))
   throw Error('chatgpt-plan-manual-browser-unavailable');
  console.log('OpenAI authorization: '+destination.href);
  return;
 }
 // Launch Chrome directly on Windows. Shell URL associations previously
 // reported successful process startup without opening a visible consent tab.
 const {command,args,windowsHide}=resolveSiwcBrowserCommand(url);
 await new Promise((resolve,reject)=>{
  const child=spawn(command,args,{stdio:'ignore',detached:true,windowsHide});
  child.once('error',()=>reject(Error('chatgpt-plan-browser-start-unavailable')));
  child.once('spawn',()=>{child.unref();resolve()});
 });
}
async function login(){
 const saved=await loadSession();
 const chosen=await hostId();
 let attempt,gate,finished=false,resolve,reject;
 const authorization=new Promise((res,rej)=>{resolve=res;reject=rej});
 const server=createServer(async(req,res)=>{
  if(!req.url?.startsWith('/auth/callback?')||req.method!=='GET'){
   res.writeHead(404);res.end('Not found');return;
  }
  if(finished||!gate){
   res.writeHead(finished?410:503);res.end('Authorization not available');return;
  }
  const result=await gate.handle(
   'http://127.0.0.1:'+server.address().port+req.url);
  if(result.status===200){
   res.writeHead(200,{'content-type':'text/html; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff'});
   res.end('<!doctype html><title>Ultron.MW Council connected</title>'+
    '<p>ChatGPT authorization complete. You can close this tab.</p>');
   resolve({connected:true,planEnabled:result.planEnabled});
  }else{
   res.writeHead(result.status,{'content-type':'text/plain; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff'});
   res.end(result.status===410?'Authorization already handled':
    'Sign in unsuccessful. Return to Ultron.MW.');
   if(result.terminal)reject(Error(result.reason||'chatgpt-plan-login-not-completed'));
  }
  if(result.terminal){finished=true;server.close()}
 });
 try{
  await new Promise((res,rej)=>{
   server.once('error',rej);
   server.listen(0,'127.0.0.1',res);
  });
  attempt=createAuthorizationAttempt({hostId:chosen,
   port:server.address().port,clientId:saved?.client_id??null});
  gate=createOneTimeSiwcCallback({attempt,consume:async({code,clientId})=>{
   const credentials=await completeAuthorization({
    code,clientId,verifier:attempt.verifier,redirectUri:attempt.redirectUri,
    nonce:attempt.nonce,hostId:chosen
   });
   if(saved&&saved.subject!==credentials.subject)
    throw Error('chatgpt-plan-account-mismatch');
   await store(SESSION_FILE,credentials);
   return {planEnabled:credentials.scope.split(/\s+/).includes(SCOPE)};
  }});
  console.log('ChatGPT OAuth consent is required in the Windows browser.');
  console.log('Credentials will stay on this owner-controlled computer.');
  await openBrowser(attempt.authorizationUrl);
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
async function confirmPlanOnly(){
 const credential=await updateSession({allowRefresh:false});
 if(!process.stdin.isTTY||!process.stdout.isTTY)
  throw Error('chatgpt-plan-owner-console-required');
 const rl=createInterface({input:process.stdin,output:process.stdout});
 try{
  console.log('Open ChatGPT Settings > Usage > App limits for Ultron.MW Council.');
  console.log('The app limit must be BELOW 100%, and app credit use must be OFF.');
  console.log('This is your on-device confirmation, not independent OpenAI settings readback.');
  const raw=(await rl.question('Enter the saved app weekly usage limit (1-99%): ')).trim();
  if(!/^(?:[1-9]|[1-9][0-9])$/.test(raw))
   throw Error('chatgpt-plan-only-settings-not-confirmed');
  const credits=(await rl.question('Type CREDITS OFF after confirming app credit use is disabled: ')).trim();
  if(credits!=='CREDITS OFF')
   throw Error('chatgpt-plan-only-settings-not-confirmed');
  const confirmation={
   kind:'owner-confirmed-plan-only-settings',
   clientId:credential.client_id,hostId:credential.ext_agent_host_id,
   subject:credential.subject,appLimitPercent:Number(raw),
   appCreditsEnabled:false,confirmedAt:new Date().toISOString()
  };
  assertOwnerConfirmedPlanOnly(credential,confirmation);
  await store(PLAN_ONLY_POLICY_FILE,confirmation);
  console.log('PLAN_ONLY_OWNER_CONFIRMATION_SAVED=true');
  console.log('Actual credit blocking is enforced by your <100% limit in ChatGPT settings.');
 }finally{rl.close()}
}
async function main(){
 const cmd=process.argv[2]??'status';
 if(cmd==='status'){
  const c=await loadSession();
  const valid=Boolean(c?.scope?.split(/\s+/).includes(SCOPE));
  const active=Boolean(c&&Date.parse(c.saved_at)+c.expires_in*1000>Date.now()+30000);
  let planOnlyAcknowledged=false;
  try{
   assertOwnerConfirmedPlanOnly(c,await readJson(PLAN_ONLY_POLICY_FILE));
   planOnlyAcknowledged=true;
  }catch{}
  console.log(JSON.stringify({provider:'openai-chatgpt',mode:'oss-local-siwc',
   connected:!!c,planPermission:valid,accessTokenActive:active,
   planOnlyAcknowledged,planOnlyServerVerified:false,
   creditPolicy:'App weekly limit <100% plus app credits OFF required before inference'}));
 }else if(cmd==='login')await login();
 else if(cmd==='models'){
  const c=await updateSession();
  const available=await listChatgptPlanModels({credential:c});
  console.log(JSON.stringify({provider:'openai-chatgpt',
   models:available.map(m=>({slug:m.slug,display_name:m.display_name}))}));
 }else if(cmd==='confirm-plan-only')await confirmPlanOnly();
 else if(cmd==='canary'){
  const model=process.argv[3];
  if(!model)throw Error('model-selection-required: run models first');
  const credential=await updateSession();
  // No billable-risk canary without recent, account-bound owner confirmation.
  // The ChatGPT app limit below 100% is the actual server-side credit barrier.
  assertOwnerConfirmedPlanOnly(credential,
   await readJson(PLAN_ONLY_POLICY_FILE));
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
