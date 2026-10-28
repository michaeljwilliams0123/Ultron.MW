const REPO = 'michaeljwilliams0123/mahoraga';
const REPO_ID = 1343333190;
const API = 'https://api.github.com';
const SHA = /^[a-f0-9]{40}$/;
const KEY = /^[a-z0-9][a-z0-9_.:-]{7,127}$/i;
const REF = /^mahoraga\/[a-z0-9][a-z0-9._-]{2,79}$/;
const MARKER = key => `<!-- ULTRON_MAHORAGA_CONTROL_V1 ${key} -->`;
const HEADERS = { Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Ultron-Mahoraga-Control' };
const REQUEST_TIMEOUT_MS = 8000;
const ACTION_DEADLINE_MS = 24000;
const ISSUE_PAGE_SIZE = 100;
const ISSUE_SCAN_BATCH_SIZE = 4;
const MAX_ISSUE_PAGES = 40;

async function githubJson(transport,url,init,deadlineAt,requestTimeoutMs,errorCode) {
 const remaining=deadlineAt-Date.now();
 if(remaining<=0)throw Error('mahoraga-action-deadline-exceeded');
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),Math.min(requestTimeoutMs,remaining));
 try {
   const response=await transport(url,{...init,signal:controller.signal});
   if(!response.ok)throw Error(errorCode || 'github-status-'+response.status);
   return response.status===204?null:await response.json();
 } catch(error) {
   if(controller.signal.aborted)throw Error('github-request-timeout');
   throw error;
 } finally {clearTimeout(timer);}
}

function validate(action) {
 if(!action || !KEY.test(action.key || '') ||
   !['issue.create','verify.dispatch'].includes(action.operation) ||
   !action.input || typeof action.input !== 'object' || Array.isArray(action.input))
   throw Error('invalid-action');
 const i = action.input;
 if(action.operation === 'issue.create') {
   if(typeof i.title !== 'string' || !i.title.trim() || i.title.length > 160 ||
     typeof i.body !== 'string' || !i.body.trim() || i.body.length > 12000 ||
     i.body.includes('ULTRON_MAHORAGA_CONTROL_V1') || !SHA.test(i.expectedMainSha || ''))
     throw Error('invalid-issue-request');
   return {key:action.key,operation:action.operation,
     input:{title:i.title,body:i.body,expectedMainSha:i.expectedMainSha}};
 }
 if(!REF.test(i.ref || '') || !SHA.test(i.expectedHeadSha || ''))
   throw Error('invalid-verify-request');
 return {key:action.key,operation:action.operation,
   input:{ref:i.ref,expectedHeadSha:i.expectedHeadSha}};
}
const encode = value => btoa(String.fromCharCode(...new TextEncoder().encode(
  JSON.stringify(value)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const encodeBytes = bytes => {
 let out = '';
 for(const byte of new Uint8Array(bytes)) out += String.fromCharCode(byte);
 return btoa(out).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
};
function der(tag,bytes) {
 const octets=[];
 for(let n=bytes.length;n>0;n=Math.floor(n/256))octets.unshift(n&255);
 const length=bytes.length<128?[bytes.length]:[128|octets.length,...octets];
 return Uint8Array.from([tag,...length,...bytes]);
}
async function jwt(clientId,pem,now=Date.now()) {
 const match=typeof pem==='string' && pem.trim().match(
   /^-----BEGIN (RSA PRIVATE KEY|PRIVATE KEY)-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END \1-----$/);
 if(!/^[a-zA-Z0-9._-]{3,120}$/.test(clientId) || !match)
   throw Error('app-signing-configuration-invalid');
 const bytes=Uint8Array.from(atob(match[2].replace(/\s/g,'')),x=>x.charCodeAt(0));
 // GitHub downloads PKCS#1 ("RSA PRIVATE KEY"), whereas WebCrypto imports PKCS#8.
 // Wrap the ASN.1 RSAPrivateKey in an unencrypted PrivateKeyInfo (RSA OID).
 const rsaOid=Uint8Array.from([0x30,0x0d,0x06,0x09,0x2a,0x86,0x48,0x86,
   0xf7,0x0d,0x01,0x01,0x01,0x05,0x00]);
 const pkcs8=match[1]==='PRIVATE KEY'?bytes:
   der(0x30,Uint8Array.from([0x02,0x01,0x00,...rsaOid,...der(0x04,bytes)]));
 const key=await crypto.subtle.importKey('pkcs8',pkcs8,
   {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 const time = Math.floor(now/1000);
 const content = encode({alg:'RS256',typ:'JWT'}) + '.' +
   encode({iss:clientId,iat:time-60,exp:time+540});
 return content + '.' + encodeBytes(await crypto.subtle.sign(
   'RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(content)));
}
async function appClient(config,transport=fetch,deadlineAt=Date.now()+ACTION_DEADLINE_MS,
 requestTimeoutMs=REQUEST_TIMEOUT_MS) {
 // Fine-grained PAT is an optional, explicit owner-managed credential lane.
 // The caller's preflight verifies repository ID and exact head before effects.
 let pat;
 try { pat=await config.get('ULTRON_MAHORAGA_CONNECTION1026'); }
 catch { pat=null; } // Unconfigured secret: preserve existing GitHub App lane.
 if(pat!==undefined && pat!==null && pat!==''){
  if(typeof pat!=='string'||!/^github_pat_[A-Za-z0-9_]{20,}$/.test(pat))
   throw Error('mahoraga-pat-invalid');
  return async (path,method='GET',body) => {
   if(!/^\/[a-zA-Z0-9/?=&._-]*$/.test(path)||
     path.includes('..')||!['GET','POST'].includes(method))
    throw Error('invalid-github-api-path');
   return githubJson(transport,API+'/repos/'+REPO+(path==='/'?'':path),{
    method,redirect:'error',headers:{...HEADERS,Authorization:'Bearer '+pat,
     ...(method==='POST'?{'Content-Type':'application/json'}:{})},
    ...(method==='POST'?{body:JSON.stringify(body)}:{})
   },deadlineAt,requestTimeoutMs);
  };
 }
 const [clientId,installationId,key] = await Promise.all([
   config.get('ULTRON_MAHORAGA_GITHUB_APP_CLIENT_ID'),
   config.get('ULTRON_MAHORAGA_GITHUB_APP_INSTALLATION_ID'),
   config.get('ULTRON_MAHORAGA_GITHUB_APP_PRIVATE_KEY')]);
 if(!/^[1-9][0-9]{0,15}$/.test(String(installationId || '')))
   throw Error('app-installation-id-invalid');
 const value = await githubJson(transport,API+'/app/installations/'+installationId+'/access_tokens',{
   method:'POST',redirect:'error',headers:{...HEADERS,Authorization:'Bearer '+await jwt(clientId,key),
     'Content-Type':'application/json'},
   body:JSON.stringify({repository_ids:[REPO_ID],
     permissions:{contents:'read',issues:'write',actions:'write'}})},
   deadlineAt,requestTimeoutMs,'app-installation-admission-denied');
 const expiry = Date.parse(value.expires_at || '');
 if(typeof value.token !== 'string' || value.token.length < 16 ||
   !Number.isFinite(expiry) || expiry < Date.now()+60000 ||
   value.repositories?.length !== 1 || value.repositories[0].id !== REPO_ID ||
   value.repositories[0].full_name !== REPO ||
   value.permissions?.contents !== 'read' ||
   value.permissions?.issues !== 'write' ||
   value.permissions?.actions !== 'write')
   throw Error('app-token-repository-or-grant-mismatch');
 return async (path,method='GET',body) => {
   if(!/^\/[a-zA-Z0-9/?=&._-]*$/.test(path) || path.includes('..') ||
     !['GET','POST'].includes(method)) throw Error('invalid-github-api-path');
   return githubJson(transport,API+'/repos/'+REPO+(path==='/'?'':path),{
     method,redirect:'error',headers:{...HEADERS,Authorization:'Bearer '+value.token,
       ...(method==='POST'?{'Content-Type':'application/json'}:{})},
     ...(method==='POST'?{body:JSON.stringify(body)}:{})},deadlineAt,requestTimeoutMs);
 };
}
async function preflight(get, action) {
 const repo = await get('/');
 if(repo?.id !== REPO_ID || repo?.full_name !== REPO ||
   repo?.private !== true || repo?.default_branch !== 'main')
   throw Error('mahoraga-repository-mismatch');
 const {operation,input} = action;
 const ref = operation==='issue.create'?'main':input.ref;
 const sha = operation==='issue.create'?input.expectedMainSha:input.expectedHeadSha;
 const actual = await get('/git/ref/heads/'+ref);
 if(actual?.object?.sha !== sha) throw Error('mahoraga-exact-sha-mismatch');
 // These reads also prove the scoped token can reach both write domains.
 await get('/issues?per_page=1');
 await get('/actions/workflows/verify.yml');
}
async function findIssue(get,key) {
 let found = null,total=0;
 // The extra page distinguishes exactly-full capacity from overflow.
 for(let first=1;first<=MAX_ISSUE_PAGES+1;first+=ISSUE_SCAN_BATCH_SIZE) {
   const count=Math.min(ISSUE_SCAN_BATCH_SIZE,MAX_ISSUE_PAGES+2-first);
   const pages=await Promise.all(Array.from({length:count},(_,offset)=>
     get('/issues?state=all&per_page='+ISSUE_PAGE_SIZE+'&page='+(first+offset))));
   let ended=false;
   for(const rows of pages) {
     if(!Array.isArray(rows) || rows.length>ISSUE_PAGE_SIZE ||
       (ended && rows.length)) throw Error('issue-readback-invalid');
     total+=rows.length;
     if(total>MAX_ISSUE_PAGES*ISSUE_PAGE_SIZE)
       throw Error('issue-reconciliation-window-exceeded');
     for(const row of rows) if(!row.pull_request && row.body?.includes(MARKER(key))) {
       if(found) throw Error('issue-marker-collision');
       found = row;
     }
     if(rows.length<ISSUE_PAGE_SIZE)ended=true;
   }
   if(ended)return {found,total};
 }
 throw Error('issue-reconciliation-window-exceeded');
}
async function findRun(get,action,since) {
 const {ref,expectedHeadSha} = action.input;
 const value=await get('/actions/workflows/verify.yml/runs?event=workflow_dispatch&head_sha='+
   expectedHeadSha+'&per_page=100');
 if(!Array.isArray(value?.workflow_runs) || value.workflow_runs.length>100 ||
   !Number.isSafeInteger(value.total_count) ||
   value.total_count!==value.workflow_runs.length)
   throw Error('run-readback-invalid');
 const title='Ultron exact-head '+action.key;
 const matches=value.workflow_runs.filter(run =>
   run.event==='workflow_dispatch' && run.head_sha===expectedHeadSha &&
   run.head_branch===ref &&
   (run.path==='.github/workflows/verify.yml@'+ref ||
    run.path==='.github/workflows/verify.yml@refs/heads/'+ref) &&
   run.display_title===title &&
   Number.isSafeInteger(run.id) && run.id>0 &&
   Number.isFinite(Date.parse(run.created_at || '')) &&
   Date.parse(run.created_at) >= Math.floor(Date.parse(since)/1000)*1000);
 if(matches.length>1)throw Error('verify-run-ambiguous');
 if(!matches.length)return null;
 const run=matches[0];
 if(run.status!=='completed')return null; // Pending means uncertain, never re-dispatch.
 if(run.conclusion!=='success')throw Error('verify-run-not-successful');
 const jobs=await get('/actions/runs/'+run.id+'/jobs?per_page=100');
 if(!Array.isArray(jobs?.jobs)||jobs.total_count!==jobs.jobs.length ||
   jobs.total_count<2||jobs.total_count>100)
   throw Error('verify-run-jobs-incomplete');
 for(const name of ['Verify (ubuntu-latest)','Verify (windows-latest)']){
   const matches=jobs.jobs.filter(job=>job.name===name);
   if(matches.length!==1||matches[0].status!=='completed'||
     matches[0].conclusion!=='success')
     throw Error('verify-required-job-not-successful');
 }
 return run;
}
async function observe(get,row,{reserveIssueSlot=false}={}) {
 const action={key:row.action_key,operation:row.operation,input:row.request};
 if(row.operation==='issue.create') {
   const inventory=await findIssue(get,row.action_key),item=inventory.found;
   if(reserveIssueSlot && !item &&
     inventory.total>=MAX_ISSUE_PAGES*ISSUE_PAGE_SIZE)
     throw Error('issue-reconciliation-window-exceeded');
   const expected=row.request.body+'\n\n'+MARKER(row.action_key);
   if(!item)return null;
   // An existing marker with changed content is a conflict, never absence.
   // Treat it as unresolved instead of issuing another POST for the same key.
   if(item.title!==row.request.title || item.body!==expected ||
     !Number.isSafeInteger(item.number) || item.number<=0)
     throw Error('issue-marker-conflict');
   return {kind:'issue',number:item.number,url:item.html_url};
 }
 if(!row.attempt_started_at) return null;
 const run=await findRun(get,action,row.attempt_started_at);
 return run?{kind:'verify',runId:run.id,headSha:run.head_sha,ref:run.head_branch}:null;
}
async function reconcile(db,get,row) {
 const result=await observe(get,row);
 if(!result) {
   await db.query(`UPDATE mahoraga_actions SET state='uncertain',updated_at=now()
     WHERE id=$1 AND state='sent'`,[row.id]);
   return {ok:true,state:'uncertain',id:row.id,taskId:row.task_id,key:row.action_key};
 }
 const saved=await db.query(`UPDATE mahoraga_actions
   SET state='observed',result=$2::jsonb,updated_at=now()
   WHERE id=$1 AND state IN ('sent','uncertain','observed') RETURNING id,state,result`,
   [row.id,JSON.stringify(result)]);
 return {ok:true,state:saved.rows[0]?.state || 'uncertain',id:row.id,taskId:row.task_id,
   key:row.action_key,result:saved.rows[0]?.result || null};
}
async function reconciliationFailure(db,row,error) {
 // Marker conflicts on ANY sent/uncertain path must be explicit. A matching
 // idempotency marker with changed contents is never a missing issue.
 try { await db.query(`UPDATE mahoraga_actions SET state='uncertain',updated_at=now()
     WHERE id=$1 AND state='sent'`,[row.id]); } catch {}
 const conflict=['issue-marker-conflict','issue-marker-collision',
   'verify-run-ambiguous','verify-run-not-successful',
   'verify-run-jobs-incomplete','verify-required-job-not-successful'].includes(error?.message);
 return {ok:!conflict,state:'uncertain',id:row.id,taskId:row.task_id,
   key:row.action_key,...(conflict?{error:error.message}:{})};
}
export async function runMahoragaAction({db,config,transport=fetch,
 requestTimeoutMs=REQUEST_TIMEOUT_MS,actionDeadlineMs=ACTION_DEADLINE_MS},raw) {
 if(!Number.isSafeInteger(requestTimeoutMs)||requestTimeoutMs<1||
   requestTimeoutMs>REQUEST_TIMEOUT_MS||!Number.isSafeInteger(actionDeadlineMs)||
   actionDeadlineMs<1||actionDeadlineMs>ACTION_DEADLINE_MS)
   throw Error('invalid-mahoraga-network-deadline');
 let action;
 try { action=validate(raw); } catch(error) {
   return {ok:false,error:error.message};
 }
 await db.query(`WITH task AS (
   INSERT INTO brain_tasks(task_key,objective,status,max_attempts)
   VALUES('mahoraga:' || $1,'mahoraga.' || $2,'external',1)
   ON CONFLICT(task_key) DO NOTHING RETURNING id
 ), action AS (
   INSERT INTO mahoraga_actions(task_id,action_key,operation,request)
   SELECT id,$1,$2,$3::jsonb FROM task
   ON CONFLICT(action_key) DO NOTHING RETURNING id,task_id
 ), receipt AS (
   INSERT INTO brain_events(task_id,event_type,details)
   SELECT task_id,'mahoraga-admitted',jsonb_build_object('operation',$2::text)
   FROM action RETURNING task_id
 ) SELECT id,task_id FROM action`,
   [action.key,action.operation,JSON.stringify(action.input)]);
 let row=(await db.query(`SELECT id,task_id,action_key,operation,request,state,attempt_started_at,result
   FROM mahoraga_actions WHERE action_key=$1`,[action.key])).rows[0];
 if(!row) return {ok:false,error:'action-admission-unavailable'};
 if(row.operation!==action.operation ||
   Object.keys(action.input).some(key=>row.request[key]!==action.input[key]) ||
   Object.keys(row.request).length!==Object.keys(action.input).length)
   return {ok:false,error:'idempotency-key-conflict'};
 if(row.state==='observed')
   return {ok:true,state:'observed',id:row.id,taskId:row.task_id,key:action.key,result:row.result,reused:true};
 // Stop prevents a new side effect but does not suppress post-send readback
 // reconciliation of operations already in the 'sent' or 'uncertain' state.
 if(row.state==='prepared'){
   let stop;
   try{stop=await db.query("SELECT paused FROM brain_runtime_control WHERE id=1");}
   catch{return {ok:false,state:'prepared',error:'stop-control-unavailable'};}
   if(stop?.rows?.length!==1||typeof stop.rows[0].paused!=='boolean')
     return {ok:false,state:'prepared',error:'stop-control-unavailable'};
   if(stop.rows[0].paused)
     return {ok:false,state:'prepared',error:'owner-execution-paused'};
 }
 let get;
 try { get=await appClient(config,transport,Date.now()+actionDeadlineMs,
   requestTimeoutMs); }
 catch(error) { return {ok:false,state:row.state,id:row.id,taskId:row.task_id,error:error.message}; }
 if(row.state!=='prepared') {
   try { return await reconcile(db,get,row); }
   catch(error) { return reconciliationFailure(db,row,error); }
 }
 try { await preflight(get,action); }
 catch(error) { return {ok:false,state:'prepared',id:row.id,taskId:row.task_id,error:error.message}; }
 // Complete the issue inventory before the durable send checkpoint. A failed
 // read cannot leave an action uncertain when no external write was attempted.
 let existingIssue=null;
 if(action.operation==='issue.create') {
   try { existingIssue=await observe(get,row,{reserveIssueSlot:true}); }
   catch(error) { return {ok:false,state:'prepared',id:row.id,taskId:row.task_id,
     error:error.message}; }
 }
 // Admission to 'sent' is the dispatch boundary. Serialize it with an owner
 // pause so no prepared action can be admitted after the pause commits.
 const claim=await db.query(`WITH control AS MATERIALIZED (
   SELECT paused FROM brain_runtime_control WHERE id=1 FOR SHARE
 ), moved AS (UPDATE mahoraga_actions
   SET state='sent',attempt_started_at=now(),updated_at=now()
   FROM control WHERE id=$1 AND state='prepared' AND NOT control.paused
   RETURNING id,task_id,action_key,operation,request,state,attempt_started_at,result
 ) SELECT * FROM moved`,[row.id]);
 if(!claim.rows.length) {
   row=(await db.query(`SELECT id,task_id,action_key,operation,request,state,attempt_started_at,result
     FROM mahoraga_actions WHERE id=$1`,[row.id])).rows[0];
   if(row?.state==='prepared')return {ok:false,state:'prepared',id:row.id,
     taskId:row.task_id,key:action.key,error:'owner-execution-paused'};
   if(row.state==='observed')
     return {ok:true,state:'observed',id:row.id,taskId:row.task_id,
       key:action.key,result:row.result,reused:true};
   try { return await reconcile(db,get,row); }
   catch(error) { return reconciliationFailure(db,row,error); }
 }
 row=claim.rows[0];
 try {
   if(action.operation==='issue.create') {
     if(!existingIssue)
       await get('/issues','POST',{title:action.input.title,
         body:action.input.body+'\n\n'+MARKER(action.key)});
   } else if(!await observe(get,row)) {
     await get('/actions/workflows/verify.yml/dispatches','POST',
       {ref:action.input.ref,inputs:{ultron_action_key:action.key,
         ultron_expected_head_sha:action.input.expectedHeadSha}});
   }
   return await reconcile(db,get,row);
 } catch(error) {
   // A sent operation remains non-replayable after any ambiguous outcome.
   return reconciliationFailure(db,row,error);
 }
}
/**
 * Hourly recovery of previously owner-admitted external actions. This does not
 * invent work: only actions already persisted with their original key qualify.
 * runMahoragaAction has the exact-once CAS; sent/uncertain are readback only.
 */
export async function resumePendingMahoragaActions({
 db,config,transport=fetch,execute=runMahoragaAction,limit=2
}={}) {
 if(!Number.isSafeInteger(limit)||limit<1||limit>4)
   throw Error('invalid-mahoraga-resume-limit');
 // Oldest first by *last inspection*, not immutable creation ID: a blocked
 // prepared action must not monopolize every hourly scan or prevent an
 // ambiguous sent action from receiving its read-only reconciliation.
 const selected=await db.query(`SELECT action_key,operation,request FROM mahoraga_actions
   WHERE state IN ('prepared','sent','uncertain')
   ORDER BY last_scanned_at ASC NULLS FIRST,id ASC LIMIT $1`,[limit]);
 if(!Array.isArray(selected?.rows)||selected.rows.length>limit)
   throw Error('invalid-mahoraga-resume-snapshot');
 const outcomes=[];
 for(const row of selected.rows) {
   let result;
   try {
     result=await execute({db,config,transport},{
       key:row.action_key,operation:row.operation,input:row.request
     });
   } catch {result={ok:false,state:'unavailable'};}
   // Mark the scan even after missing credentials or an inconclusive readback.
   // The write updates scheduling metadata only; it cannot clear the durable
   // sent/uncertain checkpoint or authorize another external POST.
   await db.query(`UPDATE mahoraga_actions SET last_scanned_at=now()
     WHERE action_key=$1 AND state IN ('prepared','sent','uncertain')`,[row.action_key]);
   outcomes.push({state:['observed','uncertain','prepared'].includes(result?.state)
      ? result.state:'unavailable',ok:result?.ok===true});
 }
 return {scanned:outcomes.length,observed:outcomes.filter(x=>x.state==='observed').length,
   pending:outcomes.filter(x=>x.state!=='observed').length,
   outcomes};
}
export async function mahoragaActionStatus({db},key) {
 if(!KEY.test(key || '')) return {ok:false,error:'invalid-action-key'};
 const row=(await db.query(`SELECT id,task_id,action_key,operation,state,result,created_at,updated_at
   FROM mahoraga_actions WHERE action_key=$1`,[key])).rows[0];
 return row?{ok:true,action:row}:{ok:false,error:'action-not-found'};
}
