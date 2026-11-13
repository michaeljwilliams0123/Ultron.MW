import {randomUUID} from 'node:crypto';
import {COMPOSIO_OWNER,validComposioAccountId} from '../../src/composio-v3-policy.mjs';
const SHA=/^[a-f0-9]{40}$/;
const HASH=/^[a-f0-9]{64}$/;
const PROFILE=new Set(['primary-direct','multi-account','primary-proxy']);
const fail=s=>{throw Error('Composio Postgres session held: '+s);};
const rows=r=>Array.isArray(r?.rows)?r.rows:[];

/** Durable session reservation and receipt readback. Database adapter must be trusted. */
export function createComposioPostgresStore({db,accountIds,customAuthConfigId}={}){
 if(typeof db?.query!=='function'||!validComposioAccountId(accountIds?.primaryAccountId))
  fail('database or primary account unavailable');
 const query=(sql,args=[])=>db.query(sql,args);
 async function assertPrincipal(profile){
  if(!PROFILE.has(profile))fail('unsupported session profile');
  const keys=profile==='multi-account'?['mw-primary','ultron-admin']:['mw-primary'];
  const result=await query('SELECT principal_key,connected_account_id,custom_auth_config_id,connection_state,grant_digest FROM brain_composio_principals WHERE principal_key=ANY($1::text[])',[keys]);
  const found=new Map(rows(result).map(r=>[r.principal_key,r]));
  for(const key of keys){
   const item=found.get(key);
   const expected=key==='mw-primary'?accountIds.primaryAccountId:accountIds.executorAccountId;
   if(!item||item.connection_state!=='active'||
      item.connected_account_id!==expected||
      item.custom_auth_config_id!==customAuthConfigId||
      (key==='ultron-admin'&&!item.grant_digest))
    fail('Platform principal not independently verified: '+key);
  }
 }
 async function read(profile){
  if(!PROFILE.has(profile))fail('invalid profile');
  const r=await query(
    'SELECT session_id AS "sessionId",config_digest AS "configDigest",source_sha AS "sourceSha",status FROM brain_composio_sessions WHERE principal_key=$1 AND session_profile=$2 AND status IN ($3,$4,$5) ORDER BY created_at DESC LIMIT 1',
    ['mw-primary',profile,'reserved','active','reconcile-required']);
  return rows(r)[0]||null;
 }
 async function reserve({profile,userId,sourceSha,configDigest}={}){
  if(!PROFILE.has(profile)||typeof userId!=='string'||userId.length<8||
    !SHA.test(sourceSha||'')||!HASH.test(configDigest||''))fail('invalid reservation');
  await assertPrincipal(profile);
  const lease='reservation_'+randomUUID().replace(/-/g,'');
  const r=await query(
    'INSERT INTO brain_composio_sessions(session_id,principal_key,session_profile,user_id,config_digest,source_sha,status) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING session_id',
    [lease,'mw-primary',profile,userId,configDigest,sourceSha,'reserved']);
  if(rows(r).length!==1)fail('existing active or unsettled session');
  return {ok:true,id:lease};
 }
 async function activate({profile,sessionId,configDigest,sourceSha,lease}={}){
  if(!PROFILE.has(profile)||typeof sessionId!=='string'||typeof lease!=='string'||
    !HASH.test(configDigest||'')||!SHA.test(sourceSha||''))fail('invalid activation');
  const r=await query(
    'UPDATE brain_composio_sessions SET session_id=$1,status=$2,last_verified_at=now(),updated_at=now(),version=version+1 WHERE session_id=$3 AND principal_key=$4 AND session_profile=$5 AND status=$6 AND config_digest=$7 AND source_sha=$8 RETURNING session_id',
    [sessionId,'active',lease,'mw-primary',profile,'reserved',configDigest,sourceSha]);
  if(rows(r).length!==1)fail('activation lease mismatch');
  return {ok:true};
 }
 async function reconcile({profile,lease}={}){
  if(!PROFILE.has(profile)||typeof lease!=='string')fail('invalid reconciliation');
  const r=await query(
    'UPDATE brain_composio_sessions SET status=$1,updated_at=now(),version=version+1 WHERE session_id=$2 AND session_profile=$3 AND status=$4 RETURNING session_id',
    ['reconcile-required',lease,profile,'reserved']);
  return {reconcileRequired:rows(r).length===1};
 }
 async function recordObservation({sessionId,actor,sourceSha,githubUserId,repositoryId,observationDigest}={}){
  if(typeof sessionId!=='string'||!['mw-primary','ultron-admin'].includes(actor)||
   !SHA.test(sourceSha||'')||!HASH.test(observationDigest||'')||
   repositoryId!==COMPOSIO_OWNER.repositoryId||
   githubUserId!==(actor==='mw-primary'?COMPOSIO_OWNER.owner.id:COMPOSIO_OWNER.executor.id))
   fail('invalid receipt identity');
  const key='composio-read-'+randomUUID().replace(/-/g,'');
  const r=await query(
    'INSERT INTO brain_composio_read_receipts(receipt_key,session_id,principal_key,repository_id,github_user_id,source_sha,observation_digest,operation,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING receipt_key',
    [key,sessionId,actor,repositoryId,githubUserId,sourceSha,observationDigest,'GITHUB_GET_A_REPOSITORY','verified']);
  if(rows(r).length!==1)fail('receipt insertion unavailable');
  const v=await query(
    'SELECT session_id,principal_key,repository_id,github_user_id,source_sha,observation_digest,result FROM brain_composio_read_receipts WHERE receipt_key=$1',[key]);
  const row=rows(v)[0];
  if(!row||row.session_id!==sessionId||row.principal_key!==actor||
     Number(row.repository_id)!==repositoryId||Number(row.github_user_id)!==githubUserId||
     row.source_sha!==sourceSha||row.observation_digest!==observationDigest||
     row.result!=='verified')fail('durable receipt readback mismatch');
  return Object.freeze({verified:true,receiptKey:key});
 }
 return Object.freeze({read,reserve,activate,reconcile,recordObservation});
}
