/**
 * Local-only signed offline task staging. This module cannot execute remote writes.
 * A task signature proves sender authenticity, NOT owner/Council release approval.
 * Every remote mutation must use the existing signed-grant, App and 0039 ledger path.
 */
import {sign,verify,createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import {open,readFile,rename,unlink,mkdir,lstat} from 'node:fs/promises';
import {dirname,basename,isAbsolute} from 'node:path';
const SCHEMA='ultron.offline-queue.v1',TASK_SCHEMA='ultron.offline-task.v1';
const ID=/^evt-[a-z0-9-]{8,72}$/,NONCE=/^ultron-offline-[a-z0-9-]{6,100}$/;
const ACTOR=/^[a-z][a-z0-9-]{2,63}$/,OPERATION=/^[a-z][a-z0-9_.-]{2,80}$/;
const HEX=/^[a-f0-9]{64}$/,BASE64URL=/^[A-Za-z0-9_-]{80,120}$/;
const HORIZON_MS=7*24*3600_000,MAX_RECORDS=500;
const TASK_KEYS=['schema','id','idempotencyKey','actor','operation','effect','payload','createdAt','expiresAt'];
const STATUS=new Set(['queued','staged-write','dispatching','delivered','reconcile-required','dead-letter']);
const forbiddenKey=/(?:token|secret|password|passcode|passkey|authorization|cookie|api.?key|private.?key|credential)/i;
const forbiddenText=/(?:github_pat_[A-Za-z0-9_]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|sk-[A-Za-z0-9_-]{16,}|-----BEGIN (?:PRIVATE|OPENSSH) KEY-----)/i;
const fail=reason=>{throw Error('offline-sync-queue: '+reason);};
function clean(value,depth=0){
 if(depth>12)fail('payload too deeply nested');
 if(value===null||typeof value==='boolean')return value;
 if(typeof value==='number'&&Number.isFinite(value))return value;
 if(typeof value==='string'){
  if(value.length>2048||forbiddenText.test(value))fail('secret or oversized payload');
  return value;
 }
 if(Array.isArray(value)){
  if(value.length>50||Object.getOwnPropertySymbols(value).length)fail('invalid payload');
  return value.map(v=>clean(v,depth+1));
 }
 if(!value||typeof value!=='object'||
    ![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('non-JSON payload');
 const descriptors=Object.getOwnPropertyDescriptors(value);
 const keys=Object.keys(descriptors);
 if(keys.length>100||Object.getOwnPropertySymbols(value).length)fail('invalid payload');
 const result={};
 for(const key of keys.sort()){
  if(key==='__proto__'||key==='constructor'||key==='prototype'||
     forbiddenKey.test(key)||!Object.hasOwn(descriptors[key],'value'))
   fail('secret or unsafe payload key');
  result[key]=clean(descriptors[key].value,depth+1);
 }
 return result;
}
function canonical(value){
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort()
  .map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
function validTask(t){
 if(!t||typeof t!=='object'||Array.isArray(t)||
    Object.keys(t).sort().join(',')!==[...TASK_KEYS].sort().join(',')||
    t.schema!==TASK_SCHEMA||!ID.test(t.id||'')||
    !NONCE.test(t.idempotencyKey||'')||!ACTOR.test(t.actor||'')||
    !OPERATION.test(t.operation||'')||!['read','write'].includes(t.effect)||
    !Number.isSafeInteger(t.createdAt)||!Number.isSafeInteger(t.expiresAt)||
    t.expiresAt<=t.createdAt||t.expiresAt-t.createdAt>HORIZON_MS)
  fail('invalid task identity or time');
 const payload=clean(t.payload);
 if(!payload||Array.isArray(payload)||canonical(payload).length>8192)
  fail('invalid payload or size');
 return {schema:TASK_SCHEMA,id:t.id,idempotencyKey:t.idempotencyKey,
  actor:t.actor,operation:t.operation,effect:t.effect,payload,
  createdAt:t.createdAt,expiresAt:t.expiresAt};
}
/** Caller supplies an owner-held Ed25519 private key, never persisted here. */
export function signOfflineTask({id,idempotencyKey,actor,operation,effect,
 payload,createdAt,expiresAt,privateKey}={}){
 const task=validTask({schema:TASK_SCHEMA,id,idempotencyKey,actor,
  operation,effect,payload,createdAt,expiresAt});
 if(privateKey?.asymmetricKeyType!=='ed25519'||privateKey.type!=='private')
  fail('Ed25519 private signing key required');
 let signature;
 try{signature=sign(null,Buffer.from(canonical(task)),privateKey).toString('base64url');}
 catch{fail('Ed25519 signing failed');}
 return Object.freeze({task,signature});
}
function verifySigned(signed,trustedKeys){
 if(!signed||typeof signed!=='object'||Array.isArray(signed)||
    Object.keys(signed).sort().join(',')!=='signature,task'||
    typeof signed.signature!=='string'||!BASE64URL.test(signed.signature))
  fail('invalid signature encoding');
 const task=validTask(signed.task);
 const key=Object.hasOwn(trustedKeys,task.actor)?trustedKeys[task.actor]:null;
 if(key?.asymmetricKeyType!=='ed25519'||key.type!=='public')
  fail('untrusted actor');
 let valid=false;
 try{valid=verify(null,Buffer.from(canonical(task)),key,
  Buffer.from(signed.signature,'base64url'));}
 catch{valid=false;}
 if(!valid)fail('signature verification failed');
 return {task,signature:signed.signature};
}
function digest(state,key){return createHmac('sha256',key).update(canonical(state)).digest('hex');}
function publicRecord(row){
 const t=row.signed.task;
 return Object.freeze({id:t.id,actor:t.actor,operation:t.operation,effect:t.effect,
  status:row.status,attempts:row.attempts,nextAttemptAt:row.nextAttemptAt,
  receiptDigest:row.receiptDigest});
}
function checkRows(rows,trustedKeys,readOps,stagedOps){
 if(!Array.isArray(rows)||rows.length>MAX_RECORDS)fail('invalid queue state');
 const ids=new Set(),nonces=new Set();
 for(const row of rows){
  const signed=verifySigned(row?.signed,trustedKeys),t=signed.task;
  if(ids.has(t.id)||nonces.has(t.idempotencyKey))fail('duplicate stored task');
  ids.add(t.id);nonces.add(t.idempotencyKey);
  if(t.effect==='read'?!readOps.has(t.operation):!stagedOps.has(t.operation))
   fail('disallowed stored operation');
  if(!row||typeof row!=='object'||Array.isArray(row)||
     Object.keys(row).sort().join(',')!=='attempts,nextAttemptAt,receiptDigest,signed,status'||
     !STATUS.has(row.status)||!Number.isSafeInteger(row.attempts)||
     row.attempts<0||row.attempts>10||!Number.isSafeInteger(row.nextAttemptAt)||
     !(row.receiptDigest===null||
       (typeof row.receiptDigest==='string'&&HEX.test(row.receiptDigest)))||
     (row.status==='delivered')!==(row.receiptDigest!==null)||
     (t.effect==='write'&&row.status!=='staged-write'))
   fail('invalid stored transition');
 }
}
/**
 * Single cooperating local process. Orphan .lock requires operator inspection;
 * never automatically break it. State is HMAC-authenticated, NOT encrypted.
 */
export async function openOfflineSyncQueue({path,integrityKey,trustedKeys,
 readOperations=[],stagedWriteOperations=[],clock=()=>Date.now(),
 maxAttempts=3,baseDelayMs=1000}={}){
 if(typeof path!=='string'||!isAbsolute(path)||
    !Buffer.isBuffer(integrityKey)||integrityKey.length<32||
    !trustedKeys||Object.keys(trustedKeys).length<1||
    typeof clock!=='function'||!Array.isArray(readOperations)||
    !Array.isArray(stagedWriteOperations)||
    !Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>5||
    !Number.isSafeInteger(baseDelayMs)||baseDelayMs<100||baseDelayMs>60000)
  fail('invalid trusted queue configuration');
 const readOps=new Set(readOperations),stagedOps=new Set(stagedWriteOperations);
 if([...readOps,...stagedOps].some(v=>!OPERATION.test(v))||
    [...readOps].some(v=>stagedOps.has(v)))fail('ambiguous operation allowlist');
 await mkdir(dirname(path),{recursive:true,mode:0o700});
 const lockPath=path+'.lock';
 let lock;
 try{lock=await open(lockPath,'wx',0o600);}
 catch{fail('queue locked; examine any orphan lock before recovery');}
 let rows=[],revision=0,closed=false,poisoned=false,active=0,work=Promise.resolve();
 async function atomicWrite(){
  const body={schema:SCHEMA,revision:++revision,records:rows};
  const record=JSON.stringify({...body,mac:digest(body,integrityKey)});
  const temp=dirname(path)+'/.'+basename(path)+'.'+randomUUID()+'.pending';
  let handle;
  try{
   handle=await open(temp,'wx',0o600);
   await handle.writeFile(record,'utf8');
   await handle.sync();
   await handle.close();handle=null;
   await rename(temp,path);
   if(process.platform!=='win32'){
    const dir=await open(dirname(path),'r');
    try{await dir.sync();}finally{await dir.close();}
   }
  }catch(error){
   poisoned=true;
   if(handle)await handle.close().catch(()=>{});
   await unlink(temp).catch(()=>{});
   throw error;
  }
 }
 async function exclusive(action){
  const job=work.then(()=>{
   if(closed)fail('queue closed');
   if(poisoned)fail('queue poisoned after persistence failure');
   return action();
  });
  work=job.catch(()=>{});
  return job;
 }
 try{
  try{
   const stat=await lstat(path);
   if(!stat.isFile()||stat.isSymbolicLink())fail('unsafe queue file');
   const raw=await readFile(path,'utf8');
   if(raw.length>2000000)fail('queue state oversized');
   const state=JSON.parse(raw);
   if(state?.schema!==SCHEMA||
      Object.keys(state).sort().join(',')!=='mac,records,revision,schema'||
      !Number.isSafeInteger(state.revision)||state.revision<1||
      typeof state.mac!=='string'||!HEX.test(state.mac))
    fail('invalid queue state');
   const body={schema:state.schema,revision:state.revision,records:state.records};
   const expected=Buffer.from(digest(body,integrityKey),'hex');
   if(!timingSafeEqual(expected,Buffer.from(state.mac,'hex')))
    fail('integrity check failed');
   checkRows(state.records,trustedKeys,readOps,stagedOps);
   rows=state.records;revision=state.revision;
   let recovering=false;
   for(const row of rows)if(row.status==='dispatching'){
    row.status='reconcile-required';recovering=true;
   }
   if(recovering)await atomicWrite();
  }catch(error){
   if(error.code!=='ENOENT')throw error;
   await atomicWrite();
  }
 }catch(error){
  await lock.close().catch(()=>{});
  await unlink(lockPath).catch(()=>{});
  throw error;
 }
 async function enqueue(raw){
  return exclusive(async()=>{
   const signed=verifySigned(raw,trustedKeys),t=signed.task,at=clock();
   if(!Number.isSafeInteger(at)||t.createdAt>at+300000||t.expiresAt<=at)
    fail('expired or future task time');
   if(t.effect==='read'?!readOps.has(t.operation):!stagedOps.has(t.operation))
    fail('operation not allowed');
   const same=rows.find(r=>r.signed.task.id===t.id);
   if(same){
    if(canonical(same.signed)!==canonical(signed))fail('task identity conflict');
    return publicRecord(same);
   }
   if(rows.some(r=>r.signed.task.idempotencyKey===t.idempotencyKey))
    fail('idempotency conflict');
   if(rows.length>=MAX_RECORDS)fail('queue capacity reached');
   const row={signed,status:t.effect==='write'?'staged-write':'queued',
    attempts:0,nextAttemptAt:at,receiptDigest:null};
   rows.push(row);await atomicWrite();return publicRecord(row);
  });
 }
 async function list(){return exclusive(async()=>rows.map(publicRecord));}
 async function drain(handler,{online=true,limit=50}={}){
  if(typeof handler!=='function'||typeof online!=='boolean'||
     !Number.isSafeInteger(limit)||limit<1||limit>100)
   fail('invalid read-only dispatcher');
  const summary={attempted:0,delivered:0,reconcileRequired:0,retried:0,deadLetter:0};
  if(!online)return summary;
  active++;
  try{
   for(let n=0;n<limit;n++){
    const claimed=await exclusive(async()=>{
     const at=clock();
     const row=rows.find(r=>r.status==='queued'&&
       r.signed.task.effect==='read'&&r.nextAttemptAt<=at);
     if(!row)return null;
     if(row.signed.task.expiresAt<=at){
      row.status='dead-letter';await atomicWrite();summary.deadLetter++;return {skip:true};
     }
     row.status='dispatching';row.attempts++;await atomicWrite();
     return {id:row.signed.task.id,signed:structuredClone(row.signed)};
    });
    if(!claimed)break;
    if(claimed.skip)continue;
    summary.attempted++;
    let response,beforeDispatch=false;
    try{response=await handler(claimed.signed);}
    catch(error){beforeDispatch=error?.beforeDispatch===true;}
    await exclusive(async()=>{
     const row=rows.find(r=>r.signed.task.id===claimed.id);
     if(!row||row.status!=='dispatching')fail('dispatch lease mismatch');
     if(response?.verified===true&&HEX.test(response.receiptDigest||'')){
      row.status='delivered';row.receiptDigest=response.receiptDigest;summary.delivered++;
     }else if(beforeDispatch){
      if(row.attempts>=maxAttempts||row.signed.task.expiresAt<=clock()){
       row.status='dead-letter';summary.deadLetter++;
      }else{
       row.status='queued';row.nextAttemptAt=clock()+
        Math.min(3600000,baseDelayMs*2**(row.attempts-1));summary.retried++;
      }
     }else{row.status='reconcile-required';summary.reconcileRequired++;}
     await atomicWrite();
    });
   }
   return Object.freeze(summary);
  }finally{active--;}
 }
 async function reconcile(id,independentReadback){
  if(typeof independentReadback!=='function'||!ID.test(id||''))
   fail('independent readback required');
  active++;
  try{
   const signed=await exclusive(async()=>{
    const found=rows.find(r=>r.signed.task.id===id);
    if(!found||found.status!=='reconcile-required')
     fail('no unresolved dispatch');
    return structuredClone(found.signed);
   });
   let result;
   try{result=await independentReadback(signed);}catch{return false;}
   if(result?.verified!==true||
      result.idempotencyKey!==signed.task.idempotencyKey||
      !HEX.test(result.receiptDigest||''))return false;
   return await exclusive(async()=>{
    const found=rows.find(r=>r.signed.task.id===id);
    if(!found||found.status!=='reconcile-required')fail('reconciliation race');
    found.status='delivered';found.receiptDigest=result.receiptDigest;
    await atomicWrite();return true;
   });
  }finally{active--;}
 }
 async function close(){
  if(active>0)fail('queue busy with dispatch or reconciliation');
  await work;
  if(closed)return;
  closed=true;await lock.close();await unlink(lockPath);
 }
 return Object.freeze({enqueue,list,drain,reconcile,close});
}
