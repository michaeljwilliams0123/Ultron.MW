const REPO = 'michaeljwilliams0123/mahoraga';
const REPO_ID = 1343333190;
const API = 'https://api.github.com';
const SHA = /^[a-f0-9]{40}$/;
const KEY = /^[a-z0-9][a-z0-9_.:-]{7,127}$/i;
const REF = /^mahoraga\/[a-z0-9][a-z0-9._-]{2,79}$/;
const MARKER = key => `<!-- ULTRON_MAHORAGA_CONTROL_V1 ${key} -->`;
const HEADERS = { Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Ultron-Mahoraga-Control' };

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
async function jwt(clientId,pem,now=Date.now()) {
 if(!/^[a-zA-Z0-9._-]{3,120}$/.test(clientId) ||
   typeof pem !== 'string' || !pem.includes('-----BEGIN PRIVATE KEY-----'))
   throw Error('app-signing-configuration-invalid');
 const bytes = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g,'')),x=>x.charCodeAt(0));
 const key = await crypto.subtle.importKey('pkcs8',bytes,
   {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 const time = Math.floor(now/1000);
 const content = encode({alg:'RS256',typ:'JWT'}) + '.' +
   encode({iss:clientId,iat:time-60,exp:time+540});
 return content + '.' + encodeBytes(await crypto.subtle.sign(
   'RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(content)));
}
async function appClient(config,transport=fetch) {
 const [clientId,installationId,key] = await Promise.all([
   config.get('ULTRON_MAHORAGA_GITHUB_APP_CLIENT_ID'),
   config.get('ULTRON_MAHORAGA_GITHUB_APP_INSTALLATION_ID'),
   config.get('ULTRON_MAHORAGA_GITHUB_APP_PRIVATE_KEY')]);
 if(!/^[1-9][0-9]{0,15}$/.test(String(installationId || '')))
   throw Error('app-installation-id-invalid');
 const response = await transport(API+'/app/installations/'+installationId+'/access_tokens',{
   method:'POST',redirect:'error',headers:{...HEADERS,Authorization:'Bearer '+await jwt(clientId,key),
     'Content-Type':'application/json'},
   body:JSON.stringify({repository_ids:[REPO_ID],
     permissions:{contents:'read',issues:'write',actions:'write'}})});
 if(!response.ok) throw Error('app-installation-admission-denied');
 const value = await response.json();
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
   const r = await transport(API+'/repos/'+REPO+(path==='/'?'':path),{
     method,redirect:'error',headers:{...HEADERS,Authorization:'Bearer '+value.token,
       ...(method==='POST'?{'Content-Type':'application/json'}:{})},
     ...(method==='POST'?{body:JSON.stringify(body)}:{})});
   if(!r.ok) throw Error('github-status-'+r.status);
   return r.status===204?null:r.json();
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
 let found = null;
 for(let page=1;page<=10;page++) {
   const rows = await get('/issues?state=all&per_page=100&page='+page);
   if(!Array.isArray(rows) || rows.length>100) throw Error('issue-readback-invalid');
   for(const row of rows) if(!row.pull_request && row.body?.includes(MARKER(key))) {
     if(found) throw Error('issue-marker-collision');
     found = row;
   }
   if(rows.length<100) return found;
 }
 throw Error('issue-reconciliation-window-exceeded');
}
async function findRun(get,action,since) {
 const {ref,expectedHeadSha} = action.input;
 const value = await get('/actions/workflows/verify.yml/runs?event=workflow_dispatch&head_sha='+
   expectedHeadSha+'&per_page=100');
 if(!Array.isArray(value?.workflow_runs)) throw Error('run-readback-invalid');
 const matches = value.workflow_runs.filter(run =>
   run.event==='workflow_dispatch' && run.head_sha===expectedHeadSha &&
   run.head_branch===ref && run.path==='.github/workflows/verify.yml' &&
   Number.isSafeInteger(run.id) && run.id>0 &&
   Date.parse(run.created_at || '') >=
     Math.floor(Date.parse(since)/1000)*1000);
 return matches.length===1?matches[0]:null;
}
async function observe(get,row) {
 const action={operation:row.operation,input:row.request};
 if(row.operation==='issue.create') {
   const item=await findIssue(get,row.action_key);
   const expected=row.request.body+'\n\n'+MARKER(row.action_key);
   return item?.title===row.request.title && item.body===expected &&
     Number.isSafeInteger(item.number) && item.number>0
     ? {kind:'issue',number:item.number,url:item.html_url}:null;
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
export async function runMahoragaAction({db,config,transport=fetch},raw) {
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
 let get;
 try { get=await appClient(config,transport); }
 catch(error) { return {ok:false,state:row.state,id:row.id,taskId:row.task_id,error:error.message}; }
 if(row.state!=='prepared') {
   try { return await reconcile(db,get,row); }
   catch { return {ok:true,state:'uncertain',id:row.id,taskId:row.task_id,key:action.key}; }
 }
 try { await preflight(get,action); }
 catch(error) { return {ok:false,state:'prepared',id:row.id,taskId:row.task_id,error:error.message}; }
 const claim=await db.query(`UPDATE mahoraga_actions
   SET state='sent',attempt_started_at=now(),updated_at=now()
   WHERE id=$1 AND state='prepared'
   RETURNING id,task_id,action_key,operation,request,state,attempt_started_at,result`,[row.id]);
 if(!claim.rows.length) {
   row=(await db.query(`SELECT id,task_id,action_key,operation,request,state,attempt_started_at,result
     FROM mahoraga_actions WHERE id=$1`,[row.id])).rows[0];
   return row.state==='observed'
     ? {ok:true,state:'observed',id:row.id,taskId:row.task_id,key:action.key,result:row.result,reused:true}
     : reconcile(db,get,row);
 }
 row=claim.rows[0];
 try {
   const existing=await observe(get,row);
   if(!existing) {
     if(action.operation==='issue.create')
       await get('/issues','POST',{title:action.input.title,
         body:action.input.body+'\n\n'+MARKER(action.key)});
     else await get('/actions/workflows/verify.yml/dispatches','POST',
       {ref:action.input.ref});
   }
   return await reconcile(db,get,row);
 } catch {
   // A network or database error after the durable sent transition is ambiguous.
   // No later call with this key is allowed to POST again.
   try { await db.query(`UPDATE mahoraga_actions SET state='uncertain',updated_at=now()
     WHERE id=$1 AND state='sent'`,[row.id]); } catch {}
   return {ok:true,state:'uncertain',id:row.id,taskId:row.task_id,key:action.key};
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
