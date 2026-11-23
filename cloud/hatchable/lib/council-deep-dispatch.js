import {signRs256,base64url} from 'lib/rsa-pkcs1-sign.js';

const REPO='michaeljwilliams0123/Ultron.MW';
const REPO_ID=1424939667;
const API='https://api.github.com';
const WORKFLOW_FILE='council-deep-reasoning.yml';
const DEFAULT_CALLBACK_URL='https://ultron-mw-cloud.hatchable.site/api/brain/council-deep-callback';
const HEX64=/^[a-f0-9]{64}$/;
const TASK_ID=/^[1-9][0-9]{0,15}$/;
const ROOM=/^(?:owner-main|chat-[a-f0-9-]{36})$/;

function clean(value,max=120){
 return String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
}
function b64json(value){
 return Buffer.from(JSON.stringify(value)).toString('base64url');
}
async function readAppCredentials(config){
 const [appIdRaw,installationIdRaw,privateKeyRaw]=await Promise.all([
  config.get('ULTRON_GITHUB_APP_ID'),
  config.get('ULTRON_GITHUB_INSTALLATION_ID'),
  config.get('ULTRON_GITHUB_APP_PRIVATE_KEY')
 ]);
 const appId=String(appIdRaw??'').trim();
 const installationId=String(installationIdRaw??'').trim();
 const privateKey=typeof privateKeyRaw==='string'?privateKeyRaw.replace(/\\n/g,'\n'):'';
 if(!/^[1-9][0-9]*$/.test(appId)||!/^[1-9][0-9]*$/.test(installationId)||
    !privateKey.includes('PRIVATE KEY'))
  throw Error('github-app-credentials-unconfigured');
 return {appId,installationId,privateKey};
}
async function mintActionsToken({credentials,fetchImpl=globalThis.fetch,now=Date.now}){
 const ts=now();
 const seconds=Math.floor(ts/1000);
 if(!Number.isSafeInteger(ts)||seconds<1)throw Error('clock-invalid');
 const unsigned=b64json({alg:'RS256',typ:'JWT'})+'.'+
  b64json({iat:seconds-30,exp:seconds+540,iss:credentials.appId});
 const jwt=unsigned+'.'+base64url(signRs256(credentials.privateKey,unsigned));
 const res=await fetchImpl(`${API}/app/installations/${credentials.installationId}/access_tokens`,{
  method:'POST',
  redirect:'error',
  signal:AbortSignal.timeout(12000),
  headers:{
   Authorization:'Bearer '+jwt,
   Accept:'application/vnd.github+json',
   'X-GitHub-Api-Version':'2022-11-28',
   'Content-Type':'application/json',
   'User-Agent':'UltronMW-Council-Deep-Dispatch'
  },
  body:JSON.stringify({
   repository_ids:[REPO_ID],
   permissions:{actions:'write',contents:'read'}
  })
 });
 if(res.status!==201)throw Error('github-token-exchange-failed-'+res.status);
 const body=await res.json();
 if(typeof body?.token!=='string'||body.token.length<8)
  throw Error('github-token-invalid');
 return body.token;
}

export async function dispatchCouncilDeepReasoning({
 taskId,requestDigest,roomKey='owner-main',
 callbackUrl=DEFAULT_CALLBACK_URL,config,
 fetchImpl=globalThis.fetch,now=Date.now
}={}){
 const cleanTaskId=String(taskId??'').trim();
 const cleanDigest=String(requestDigest??'').trim().toLowerCase();
 const cleanRoom=String(roomKey||'owner-main').trim();
 if(!TASK_ID.test(cleanTaskId))return {ok:false,status:'dispatch-failed',error:'task-id-invalid'};
 if(!HEX64.test(cleanDigest))return {ok:false,status:'dispatch-failed',error:'request-digest-invalid'};
 if(!ROOM.test(cleanRoom))return {ok:false,status:'dispatch-failed',error:'room-key-invalid'};
 if(!config||typeof config.get!=='function')
  return {ok:false,status:'dispatch-failed',error:'config-unavailable'};
 try{
  const credentials=await readAppCredentials(config);
  const token=await mintActionsToken({credentials,fetchImpl,now});
  const res=await fetchImpl(
   `${API}/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,{
    method:'POST',
    redirect:'error',
    signal:AbortSignal.timeout(12000),
    headers:{
     Authorization:'Bearer '+token,
     Accept:'application/vnd.github+json',
     'X-GitHub-Api-Version':'2022-11-28',
     'Content-Type':'application/json',
     'User-Agent':'UltronMW-Council-Deep-Dispatch'
    },
    body:JSON.stringify({
     ref:'main',
     inputs:{
      task_id:cleanTaskId,
      request_digest:cleanDigest,
      room_key:cleanRoom,
      callback_url:callbackUrl
     }
    })
   }
  );
  if(res.status!==204){
   return {ok:false,status:'dispatch-failed',error:'workflow-dispatch-http-'+res.status,
    workflow:WORKFLOW_FILE,requestDigest:cleanDigest};
  }
  return {ok:true,status:'dispatched',workflow:WORKFLOW_FILE,
   requestDigest:cleanDigest,roomKey:cleanRoom,callbackUrl,
   dispatchedAt:new Date(now()).toISOString()};
 }catch(error){
  return {ok:false,status:'dispatch-failed',
   error:clean(error?.message||'dispatch-error',80),
   workflow:WORKFLOW_FILE,requestDigest:cleanDigest};
 }
}