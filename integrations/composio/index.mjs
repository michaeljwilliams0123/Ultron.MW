/**
 * Ultron.MW Composio v3 worker — Node >=22.22.3 only.
 * No model calls or direct mutation APIs; existing App executor remains authoritative.
 * Not imported into Hatchable's V8 isolate or root Node20 runtime.
 */
import {Composio,SessionPreset} from '@composio/core';
import {createHash} from 'node:crypto';
import {
 COMPOSIO_OWNER,buildComposioV3Policy,requireComposioReadAdmission,
 requireComposioProxyRead,maskComposioDisplay,denyUntrustedComposioMutation
} from '../../src/composio-v3-policy.mjs';
import {enforceSignedApprovalAndTagPersona} from '../../src/middleware/enforce-signed-approval.mjs';
import {gatePasses} from '../../src/council-trusted-gate.mjs';

const SHA=/^[a-f0-9]{40}$/;
const SESSION=/^[A-Za-z0-9_-]{8,160}$/;
const deny=message=>{throw Error('Composio v3 worker held: '+message);};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const safeStatus=result=>{
 if(result?.resultType!=='completed'||!result.data||
    result.data.successful===false)deny('provider returned unverified read');
 const data=result.data.successful===true?result.data.data:result.data;
 if(!data||typeof data!=='object'||Array.isArray(data))deny('provider read malformed');
 return data;
};
function configContainsExpected(config,expected,profile){
 if(!config||config.instant!==false)return false;
 const toolkit=config.toolkits;
 const enabled=Array.isArray(toolkit)?toolkit:toolkit?.enabled||toolkit?.enable;
 if(!Array.isArray(enabled)||enabled.length!==1||enabled[0]!=='github')return false;
 const ts=config.tools?.github?.enabled||config.tools?.github?.enable;
 if(!Array.isArray(ts)||ts.length!==2||
   !expected.tools.github.enable.every(t=>ts.includes(t)))return false;
 const connected=config.connected_accounts||config.connectedAccounts;
 const actual=connected?.github;
 if(!Array.isArray(actual)||actual.length!==expected.connectedAccounts.github.length||
   actual.some((x,i)=>x!==expected.connectedAccounts.github[i]))return false;
 const multi=config.multi_account||config.multiAccount;
 if(profile==='multi-account'&&(!multi?.enable||multi?.require_explicit_selection!==true&&
   multi?.requireExplicitSelection!==true))return false;
 const sandbox=config.sandbox||config.workbench;
 if(!sandbox||sandbox.enable!==false&&sandbox.enabled!==false)return false;
 const manager=config.manage_connections||config.manageConnections;
 if(manager&&(manager.enable===true||manager.enabled===true))return false;
 const proxy=config.proxy_execute??config.proxyExecute;
 const enabledProxy=proxy===true||proxy?.enable===true;
 if(enabledProxy!==(profile==='primary-proxy'))return false;
 if(profile!=='multi-account'&&multi?.enable===true)return false;
 return true;
}
function identity(actor){return actor==='mw-primary'?COMPOSIO_OWNER.owner:COMPOSIO_OWNER.executor;}

/** Trusted composition root must supply durable atomic reserve/activate/read/reconcile. */
export function createComposioV3Worker({
 apiKey,client,accountIds,customAuthConfigId,store,userId,sourceSha,
 verifyDelegatedGrant
}={}){
 if(!client){
  if(typeof apiKey!=='string'||apiKey.length<16)deny('protected API key required');
  client=new Composio({apiKey});
 }
 if(!client||typeof client.create!=='function'||typeof client.use!=='function'||
   !store||['read','reserve','activate','reconcile','recordObservation'].some(k=>typeof store[k]!=='function')||
   typeof userId!=='string'||!/^ultron-owner-[0-9]{6,20}$/.test(userId)||
   !SHA.test(sourceSha||''))deny('trusted SDK/store/source configuration incomplete');
 const policies=Object.freeze({
  'primary-direct':buildComposioV3Policy({
    profile:'primary-direct',primaryAccountId:accountIds?.primaryAccountId,
    customAuthConfigId,sessionPresetDirectTools:SessionPreset.DIRECT_TOOLS}),
  // No DIRECT_TOOLS or preload in mixed multi-account mode.
  'multi-account':null,
  'primary-proxy':buildComposioV3Policy({
    profile:'primary-proxy',primaryAccountId:accountIds?.primaryAccountId,
    customAuthConfigId,sessionPresetDirectTools:SessionPreset.DIRECT_TOOLS})
 });
 function policy(profile){
  if(!Object.hasOwn(policies,profile))deny('unrecognized profile');
  if(profile==='multi-account')return buildComposioV3Policy({
   profile,primaryAccountId:accountIds.primaryAccountId,
   executorAccountId:accountIds.executorAccountId,customAuthConfigId});
  return policies[profile];
 }
 async function sessionFor(profile){
  const config=policy(profile), digest=hash(config);
  const record=await store.read(profile);
  if(record){
   if(record.status!=='active'||record.sourceSha!==sourceSha||
      record.configDigest!==digest||!SESSION.test(record.sessionId||''))
    deny('stored session stale or unreconciled');
   const reused=await client.use(record.sessionId);
   if(reused.sessionId!==record.sessionId ||
      !configContainsExpected(reused.config,config,profile))
    deny('reused session server policy drift');
   return reused;
  }
  const lease=await store.reserve({profile,userId,sourceSha,configDigest:digest});
  if(!lease?.ok)deny('durable session reservation unavailable');
  let session;
  try{
   session=await client.create(userId,config);
   if(!SESSION.test(session?.sessionId||'')||
      !configContainsExpected(session.config,config,profile))
    deny('new session server policy mismatch');
   await store.activate({profile,sessionId:session.sessionId,
     configDigest:digest,sourceSha,lease:lease.id});
  }catch(e){
   await store.reconcile({profile,lease:lease.id,reason:'session-create-outcome-unverified'});
   throw e;
  }
  return session;
 }
 async function inspect({profile='primary-direct',actor,grant}={}){
  if(profile==='primary-direct'&&actor!=='mw-primary')deny('primary profile cannot select delegated actor');
  let grantVerified=false;
  if(actor==='ultron-admin'){
   if(profile!=='multi-account'||typeof verifyDelegatedGrant!=='function')
    deny('delegated actor grant verifier not configured');
   grantVerified=(await verifyDelegatedGrant(grant,{
     actor:'ultron-admin',repositoryId:COMPOSIO_OWNER.repositoryId,operation:'github.repo.read'}))===true;
  }
  const admitted=requireComposioReadAdmission({
   actor,toolSlug:'GITHUB_GET_THE_AUTHENTICATED_USER',accountIds,grantVerified});
  const session=await sessionFor(profile);
  const profileResponse=safeStatus(await session.execute(admitted.toolSlug,{},{
    account:admitted.account}));
  const expected=identity(actor);
  if(profileResponse.login!==expected.login||Number(profileResponse.id)!==expected.id)
   deny('GitHub actor mismatch');
  const repo=safeStatus(await session.execute('GITHUB_GET_A_REPOSITORY',{
    owner:'michaeljwilliams0123',repo:'Ultron.MW'},{account:admitted.account}));
  if(repo.full_name!==COMPOSIO_OWNER.repository||Number(repo.id)!==COMPOSIO_OWNER.repositoryId||
     repo.owner?.login!=='michaeljwilliams0123'||Number(repo.owner?.id)!==308995719||
     repo.permissions?.pull!==true||actor==='mw-primary'&&repo.permissions?.admin!==true)
   deny('canonical repository readback mismatch');
  const observationDigest=hash({actor,githubUserId:expected.id,repositoryId:COMPOSIO_OWNER.repositoryId,sourceSha});
  const persisted=await store.recordObservation({sessionId:session.sessionId,
   actor,sourceSha,githubUserId:expected.id,
   repositoryId:COMPOSIO_OWNER.repositoryId,observationDigest});
  if(persisted?.verified!==true)deny('PostgreSQL independent readback required');
  return Object.freeze({schema:'ultron.composio.v3.read-receipt',
   verified:true,effect:'read',actor,githubUserId:expected.id,
   repositoryId:COMPOSIO_OWNER.repositoryId,sourceSha,receiptKey:persisted.receiptKey});
 }
 async function proxyRead({actor,endpoint,profile='primary-proxy'}={}){
  const request=requireComposioProxyRead({actor,profile,method:'GET',endpoint});
  const session=await sessionFor(profile);
  // Session-level proxy uses Composio's server-held OAuth credential; never
  // put Authorization into params, never pass provider headers from input.
  const result=await session.proxyExecute(request);
  if(result?.resultType!=='completed'||result.status!==200)
   deny('proxy GET did not complete successfully');
  return Object.freeze({ok:true,httpStatus:200,endpoint:request.endpoint,
   // Do not return upstream headers, tokens, account.state.val or full body.
   responseDigest:hash(result.data),sourceSha});
 }
 return Object.freeze({inspect,proxyRead,
   // Mutation execution is deliberately NOT exposed as Composio SDK calls.
   denyMutation:denyUntrustedComposioMutation,
   // Safe UI label only; never an input to authentication.
   displayAccountState:maskComposioDisplay});
}

/**
 * Explicit trusted bridge to the EXISTING GitHub App writer. This never uses a
 * Composio OAuth token for a mutating GitHub operation.
 * The existing executor must reserve its 0039 idempotency row before network.
 */
export async function executeGovernedGitHubAppMutation({
 operationRequest,tokenFactory,trusted,councilResult,sha,prNumber,
 durableAppExecutor
}={}){
 if(typeof durableAppExecutor!=='function'||!gatePasses(councilResult,sha,prNumber))
  deny('trusted Council and durable App executor required');
 const approved=await enforceSignedApprovalAndTagPersona(
  operationRequest,tokenFactory,trusted);
 if(!approved?.authorized)deny('owner cryptographic authorization required');
 // The passed executor is a trusted backend function, never agent-controlled.
 return durableAppExecutor(approved);
}
