import assert from 'node:assert/strict';
import {generateKeyPairSync,webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const root=new URL('../../cloud/hatchable/',import.meta.url);
const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const adjudicatorUrl=new URL('lib/security-adjudicator.js',root).href;
const pipelineUrl=new URL('lib/master-pipeline.js',root).href;
const rsaSignerUrl=new URL('lib/rsa-pkcs1-sign.js',root).href;
export const adjudicator=await import(adjudicatorUrl);
export const canary=await import(data((await readFile(new URL('lib/github-branch-canary.js',root),'utf8'))
 .replace("'lib/master-pipeline.js'",JSON.stringify(pipelineUrl))
 .replace("'lib/security-adjudicator.js'",JSON.stringify(adjudicatorUrl))
 .replace("'lib/rsa-pkcs1-sign.js'",JSON.stringify(rsaSignerUrl))));

export const REPO='michaeljwilliams0123/Ultron.MW';
export const SOURCE='1'.repeat(40);
export const TREE='2'.repeat(40);
export const MIGRATIONS=['0001_tasks.sql','0002_events.sql','0008_admin_grants.sql',
 '0010_runtime_stop.sql','0013_continuum_outbox.sql',
 '0016_owner_autonomy_profile.sql','0033_owner_passkey_authority.sql',
 '0034_owner_passkey_enrollment.sql','0037_github_approval_nonces.sql',
 '0039_github_idempotent_executions.sql','0040_ultron_org_transfer.sql',
 '0041_github_pr_comment_executions.sql','0044_github_branch_grant_executions.sql'];
const RSA=generateKeyPairSync('rsa',{modulusLength:2048});
export const APP=Object.freeze({appId:'5633654',installationId:'179066535',
 privateKey:RSA.privateKey.export({format:'pem',type:'pkcs1'}).toString()});
const subtle=webcrypto.subtle;
const owner=await subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
export const publicJwk=await subtle.exportKey('jwk',owner.publicKey);

export async function database(t,{allowed=true,passkey=true}={}){
 const db=new PGlite();
 for(const migration of MIGRATIONS)await db.exec(await readFile(new URL('migrations/'+migration,root),'utf8'));
 await db.query(`UPDATE brain_owner_autonomy_profile SET preset='release',version=7 WHERE id=1`);
 await db.query(`UPDATE brain_runtime_control SET version=5 WHERE id=1`);
 if(allowed)await db.query(`UPDATE brain_owner_autonomy_profile
  SET allowed_operations=allowed_operations||'["repair.branch.create"]'::jsonb WHERE id=1`);
 if(passkey){
  await db.query(`INSERT INTO brain_authority_grants(
   grant_id,objective_id,actor,operation,resource,policy_sha,expires_at)
   VALUES('owner-passkey-bootstrap-test','owner-passkey-test','michaeljwilliams0123',
    'owner.passkey.enroll','sha256:${'a'.repeat(64)}','${'b'.repeat(64)}',
    now()+interval '1 hour')`);
  await db.query(`INSERT INTO brain_owner_passkeys(
   credential_id,public_key_spki,label,enrollment_key,enrollment_fingerprint,
   enrolled_grant_id) VALUES($1,$2,'Test owner passkey','owner-passkey-test',
   $3,'owner-passkey-bootstrap-test')`,['credential-'+'c'.repeat(32),'d'.repeat(120),'e'.repeat(64)]);
 }
 t.after(()=>db.close());
 return db;
}
export async function sign(request,{key=owner.privateKey,now=Date.now(),ttl=240000,
 grantId='owner-412-'+crypto.randomUUID(),overrides={}}={}){
 const grant={schema:'ultron.security-grant.v1',issuer:'ultron-owner-authority',
  authorizedBy:'michaeljwilliams0123',audience:'ultron-cloud-brain',grantId,
  policySha:request.policySha,notBefore:new Date(now-1000).toISOString(),
  expiresAt:new Date(now+ttl).toISOString(),actor:request.actor,
  objectiveId:request.objectiveId,operation:request.operation,resource:request.resource,
  administrativeChange:false,profileVersion:request.profileVersion,
  stopVersion:request.stopVersion,...overrides};
 const payload=JSON.stringify(grant);
 const signature=Buffer.from(await subtle.sign({name:'ECDSA',hash:'SHA-256'},key,
  new TextEncoder().encode(payload))).toString('base64url');
 return {payload,signature};
}
export async function otherKey(){
 return (await subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify'])).privateKey;
}
const response=(status,body)=>({status,ok:status>=200&&status<300,json:async()=>structuredClone(body)});

/** Stateful offline GitHub double. No network is ever contacted. */
export function github({denyWrite=false,loseRefAck=false,loseCommitAck=false,tamperTree=false,
 onToken=null}={}){
 const calls=[],refs=new Map(),commits=new Map([[SOURCE,{sha:SOURCE,tree:{sha:TREE},
  parents:[{sha:'0'.repeat(40)}],message:'source'}]]);
 const api='https://api.github.com/repos/'+REPO;
 const fetchImpl=async(url,options={})=>{
  const method=options.method||'GET';
  calls.push({url,method});
  if(method==='POST'&&url==='https://api.github.com/app/installations/179066535/access_tokens'){
   const body=JSON.parse(options.body);
   assert.deepEqual(body.repository_ids,[1424939667]);
   await onToken?.(body.permissions);
   if(denyWrite&&body.permissions.contents==='write')return response(422,{message:'permission'});
   return response(201,{token:'scoped-'+body.permissions.contents+'-token',
    permissions:body.permissions,
    repositories:[{id:1424939667,full_name:REPO}],
    expires_at:new Date(Date.now()+1800000).toISOString()});
  }
  if(!url.startsWith(api))throw Error('unexpected '+method+' '+url);
  const path=url.slice(api.length);
  if(method==='GET'&&path==='/git/ref/heads/main')
   return response(200,{ref:'refs/heads/main',object:{type:'commit',sha:SOURCE}});
  if(method==='GET'&&path.startsWith('/git/ref/heads/')){
   const name=path.slice('/git/ref/heads/'.length);
   return refs.has(name)?response(200,{ref:'refs/heads/'+name,object:{type:'commit',sha:refs.get(name)}})
    :response(404,{message:'Not Found'});
  }
  if(method==='GET'&&path.startsWith('/git/commits/')){
   const commit=commits.get(path.slice('/git/commits/'.length));
   if(!commit)return response(404,{});
   return response(200,tamperTree&&commit.sha!==SOURCE?{...commit,tree:{sha:'9'.repeat(40)}}:commit);
  }
  if(method==='POST'&&path==='/git/commits'){
   const body=JSON.parse(options.body);
   const commit={sha:'c'.repeat(40),tree:{sha:body.tree},parents:body.parents.map(sha=>({sha})),
    message:body.message,author:body.author};
   commits.set(commit.sha,commit);
   if(loseCommitAck)throw Error('lost commit acknowledgement');
   return response(201,commit);
  }
  if(method==='POST'&&path==='/git/refs'){
   const body=JSON.parse(options.body);
   refs.set(body.ref.slice('refs/heads/'.length),body.sha);
   if(loseRefAck)throw Error('lost ref acknowledgement');
   return response(201,{ref:body.ref,object:{type:'commit',sha:body.sha}});
  }
  throw Error('unexpected '+method+' '+url);
 };
 const posts=suffix=>calls.filter(c=>c.method==='POST'&&c.url.endsWith(suffix)).length;
 return {fetchImpl,calls,refs,posts};
}
export async function counts(db){
 return (await db.query(`SELECT
  (SELECT count(*)::int FROM brain_github_approval_nonces) AS nonces,
  (SELECT count(*)::int FROM brain_authority_grants WHERE operation='repair.branch.create') AS grants,
  (SELECT count(*)::int FROM github_idempotent_executions) AS executions`)).rows[0];
}
