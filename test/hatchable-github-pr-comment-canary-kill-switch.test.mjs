import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Load the real API handler with 'hatchable' stubbed and lib imports resolved.
const root=path=>new URL('../cloud/hatchable/'+path,import.meta.url);
const dataUrl=src=>'data:text/javascript;base64,'+Buffer.from(src).toString('base64');
const signerUrl=root('lib/rsa-pkcs1-sign.js').href;
const canaryUrl=dataUrl((await readFile(root('lib/github-pr-comment-canary.js'),'utf8'))
 .replace("'lib/rsa-pkcs1-sign.js'",JSON.stringify(signerUrl)));
const hatchableUrl=dataUrl(`export const db={query:(...a)=>globalThis.__canaryHost.db.query(...a)};
export const config={get:name=>globalThis.__canaryHost.config(name)};`);
const handler=(await import(dataUrl((await readFile(root('api/brain/github-pr-comment-canary.js'),'utf8'))
 .replace("from 'hatchable'",`from ${JSON.stringify(hatchableUrl)}`)
 .replace("from 'lib/security-adjudicator.js'",`from ${JSON.stringify(root('lib/security-adjudicator.js').href)}`)
 .replace("from 'lib/github-pr-comment-canary.js'",`from ${JSON.stringify(canaryUrl)}`)))).default;

const MIGRATIONS=['0001_tasks.sql','0002_events.sql','0008_admin_grants.sql',
 '0010_runtime_stop.sql','0013_continuum_outbox.sql','0016_owner_autonomy_profile.sql',
 '0033_owner_passkey_authority.sql','0034_owner_passkey_enrollment.sql',
 '0037_github_approval_nonces.sql','0039_github_idempotent_executions.sql',
 '0041_github_pr_comment_executions.sql'];
const KEY=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey
 .export({format:'pem',type:'pkcs1'}).toString();
const FULL={ULTRON_GITHUB_APP_ID:'5633654',ULTRON_GITHUB_INSTALLATION_ID:'179066535',
 ULTRON_GITHUB_APP_PRIVATE_KEY:KEY,
 ULTRON_SECURITY_ADJUDICATOR_PUBLIC_JWK:JSON.stringify({kty:'EC',crv:'P-256',x:'x'.repeat(43),y:'y'.repeat(43)})};
const TABLES=`SELECT
 (SELECT count(*)::int FROM github_pr_comment_executions) AS executions,
 (SELECT count(*)::int FROM github_idempotent_executions) AS idempotent,
 (SELECT count(*)::int FROM brain_authority_grants) AS grants,
 (SELECT count(*)::int FROM brain_github_approval_nonces) AS nonces`;

async function host(t,values){
 const pg=new PGlite();
 for(const m of MIGRATIONS)await pg.exec(await readFile(root('migrations/'+m),'utf8'));
 t.after(()=>pg.close());
 const queries=[],configReads=[],fetches=[];
 const realFetch=globalThis.fetch;
 globalThis.fetch=async(...a)=>{fetches.push(a[0]);throw Error('network forbidden in test');};
 t.after(()=>{globalThis.fetch=realFetch;delete globalThis.__canaryHost;});
 globalThis.__canaryHost={
  db:{query:(sql,params)=>{queries.push(sql);return pg.query(sql,params);}},
  config:async name=>{configReads.push(name);return values[name];}};
 return {pg,queries,configReads,fetches};
}
async function call(body){
 let status,payload;const headers={};
 const res={setHeader:(k,v)=>{headers[k]=v;},status(code){status=code;return this;},
  json(value){payload=value;return this;}};
 await handler({body},res);
 return {status,body:payload,headers};
}

for(const flag of [undefined,'','false','TRUE','1']){
 test(`flag ${JSON.stringify(flag)}: status reports disabled without leaking configuration`,async t=>{
  const h=await host(t,{...FULL,ULTRON_PR_COMMENT_CANARY_ENABLED:flag});
  const r=await call({mode:'status'});
  assert.equal(r.status,200);
  assert.deepEqual(r.body,{schema:'ultron.github.pr-comment-canary.v1',ok:true,
   status:'disabled',configured:false,enabled:false,reason:'canary-disabled',
   prerequisitesReady:true,missing:[]});
  const text=JSON.stringify(r.body);
  for(const secret of Object.values(FULL))assert.equal(text.includes(secret),false);
  assert.equal(text.includes('PRIVATE KEY'),false);
  assert.equal(h.fetches.length,0);
 });
}

test('disabled: every non-status mode returns 503 before reading credentials, the ledger or the network',async t=>{
 const h=await host(t,FULL);
 const before=(await h.pg.query(TABLES)).rows[0];
 const prepared={pullRequest:398,idempotencyKey:'ultron-task-c04-pr398-'+'a'.repeat(24),
  commentBody:'x',bodySha256:'b'.repeat(64)};
 for(const body of [{mode:'prepare',pullRequest:398},{mode:'submit',prepared,envelope:{}},
   {mode:'reconcile',prepared,envelope:{}},{mode:'bogus'},{},null]){
  h.queries.length=0;h.configReads.length=0;
  const r=await call(body);
  assert.equal(r.status,503,JSON.stringify(body));
  assert.deepEqual(r.body,{schema:'ultron.github.pr-comment-canary.v1',ok:false,
   status:'disabled',error:'canary-disabled',reason:'canary-disabled'});
  assert.equal(r.headers['Cache-Control'],'private, no-store');
  assert.deepEqual(h.queries,[],'no database access while disabled');
  assert.deepEqual(h.configReads,['ULTRON_PR_COMMENT_CANARY_ENABLED']);
 }
 assert.deepEqual((await h.pg.query(TABLES)).rows[0],before);
 assert.equal(h.fetches.length,0);
});

test('disabled when the flag read itself fails',async t=>{
 const h=await host(t,FULL);
 globalThis.__canaryHost.config=async name=>{
  if(name==='ULTRON_PR_COMMENT_CANARY_ENABLED')throw Error('config down');return FULL[name];};
 assert.equal((await call({mode:'prepare',pullRequest:398})).body.error,'canary-disabled');
 assert.equal((await call({mode:'status'})).body.status,'disabled');
 assert.equal(h.fetches.length,0);
});

test('explicit opt-in passes the kill switch and still enforces readiness',async t=>{
 const h=await host(t,{...FULL,ULTRON_PR_COMMENT_CANARY_ENABLED:'true'});
 const status=await call({mode:'status'});
 assert.deepEqual([status.body.status,status.body.configured,status.body.enabled,status.body.reason],
  ['configured',true,true,null]);
 const invalid=await call({mode:'submit',prepared:{}});
 assert.equal(invalid.status,400,'past the kill switch, request validation applies');
 globalThis.__canaryHost.config=async name=>name==='ULTRON_GITHUB_APP_ID'?'1':
  ({...FULL,ULTRON_PR_COMMENT_CANARY_ENABLED:'true'})[name];
 const mismatch=await call({mode:'prepare',pullRequest:398});
 assert.equal(mismatch.status,503);
 assert.equal(mismatch.body.error,'canary-not-configured');
 assert.equal(h.fetches.length,0);
});
