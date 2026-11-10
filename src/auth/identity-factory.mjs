/**
 * Server-only entry point for the unified Ultron GitHub App principal.
 *
 * A GitHub App installation proves identity, NOT approval for a mutation.
 * Caller authorization, durable stop checks, plan binding, and exact-route
 * admission remain the responsibility of the existing operation executor.
 *
 * Reuse the audited issuer instead of creating a second JWT implementation.
 * No token is persisted, logged, sent to the browser, or shared in metadata.
 */
import {createScopedInstallationTokenProvider}
 from '../security/crypto_auth.mjs';
import {
 operationProfile,requiredTokenPermissions,
 ULTRON_REPOSITORY,ULTRON_REPOSITORY_ID,
} from '../github-principal-policy.mjs';

const API='https://api.github.com/repos/'+ULTRON_REPOSITORY;
const HEADERS=Object.freeze({
 Accept:'application/vnd.github+json',
 'X-GitHub-Api-Version':'2026-03-10',
});

function positiveId(value){
 if(typeof value!=='string'||!/^[1-9][0-9]*$/.test(value))
  throw Error('GitHub App credential configuration invalid');
 const number=Number(value);
 if(!Number.isSafeInteger(number))
  throw Error('GitHub App credential configuration invalid');
 return number;
}

function trustedConfiguration(env){
 if(!env||typeof env!=='object'||
   typeof env.GITHUB_PRIVATE_KEY!=='string'||
   !env.GITHUB_PRIVATE_KEY.trim()||
   !env.GITHUB_PRIVATE_KEY.includes('PRIVATE KEY'))
  throw Error('GitHub App credential configuration invalid');
 return Object.freeze({
  appId:positiveId(env.GITHUB_APP_ID),
  installationId:positiveId(env.GITHUB_INSTALLATION_ID),
  privateKey:env.GITHUB_PRIVATE_KEY.replace(/\\n/g,'\n'),
 });
}

async function repositoryReadback(grant,fetchImpl){
 let response;
 try{
  response=await fetchImpl(API,{
   method:'GET',redirect:'error',
   headers:{...HEADERS,Authorization:'Bearer '+grant.token},
   signal:AbortSignal.timeout(15000),
  });
 }catch{
  throw Error('GitHub App repository identity readback unavailable');
 }
 if(!response?.ok||response.status!==200)
  throw Error('GitHub App repository identity readback denied');
 let data;
 try{data=await response.json();}
 catch{throw Error('GitHub App repository identity readback invalid');}
 if(!data||data.id!==ULTRON_REPOSITORY_ID||
   data.full_name!==ULTRON_REPOSITORY)
  throw Error('GitHub App repository identity mismatch');
 return data;
}

/**
 * Authenticate once at startup, prove the exact repository identity, and
 * demonstrate that the installation grants Contents:write without writing.
 *
 * Output contract:
 *  - octokit: narrow Octokit-compatible, authenticated repos.get facade.
 *    This avoids broad SDK request/write methods and new dependencies.
 *  - installationId: verified installation ID as a positive integer.
 *  - getTokenForScope(operation): fresh repository-ID / permission-scoped
 *    {token,operation,repositoryId,installationId,permissions,expiresAt}.
 *
 * IMPORTANT: This is a trusted server-side factory, NOT a public MCP tool.
 * Step-up scopes are deliberately excluded; they require the independent
 * owner approval and operation executor already present in Ultron.
 */
export async function createVerifiedGitHubClient({
 env=process.env,fetchImpl=globalThis.fetch,clock=Date.now,
}={}){
 const credentials=trustedConfiguration(env);
 if(typeof fetchImpl!=='function'||typeof clock!=='function')
  throw Error('GitHub App trusted transport configuration invalid');

 const issueToken=createScopedInstallationTokenProvider({
  ...credentials,fetchImpl,clock,
 });
 const getTokenForScope=async(scope)=>{
  if(typeof scope!=='string')
   throw Error('GitHub App token scope denied');
  let profile;
  try{profile=operationProfile(scope);}
  catch{throw Error('GitHub App token scope denied');}
  if(profile.authorization!=='standing')
   throw Error('GitHub App elevated token scope denied');
  return issueToken({
   operation:scope,repositoryId:ULTRON_REPOSITORY_ID,
   permissions:requiredTokenPermissions(scope),
  });
 };

 // ID proof is a GET only. The write-capability check is a scoped token
 // exchange, NOT an unapproved or speculative repository mutation.
 const initialRead=await getTokenForScope('identity.read');
 await repositoryReadback(initialRead,fetchImpl);
 await getTokenForScope('repair.branch.create');

 const octokit=Object.freeze({
  repos:Object.freeze({
   get:async({owner,repo}={})=>{
    if(owner!=='michaeljwilliams0123'||repo!=='Ultron.MW')
     throw Error('GitHub App repository scope denied');
    const grant=await getTokenForScope('identity.read');
    return Object.freeze({data:await repositoryReadback(grant,fetchImpl)});
   },
  }),
 });
 return Object.freeze({
  octokit,installationId:credentials.installationId,getTokenForScope,
 });
}
