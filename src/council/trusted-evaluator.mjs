/* Pure Council proposal/evidence interface. No runtime secrets, provider tokens or egress.
 * Untrusted GitHub text remains evidence, never policy or executable instructions.
 */
const SHA=/^[a-f0-9]{40}$/;
const PATH=/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\0\r\n]{1,512}$/;
export const COUNCIL_ROLE_IDS=Object.freeze(['architect','security','sre','qa','scope','devils_advocate','judge']);
const KEYS=Object.freeze(['roleId','headSha','evidenceHash','conclusion','rationale','appId']);
const encoder=new TextEncoder();
const sha=async input=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(input)))).map(b=>b.toString(16).padStart(2,'0')).join('');
const asObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const fail=x=>{throw Error('council-'+x)};
function stripUntrusted(value){
 return value.replace(/<!--[\s\S]*?-->/g,'')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g,'');
}
function changedPaths(diff){
 const paths=[];
 for(const line of diff.split('\n')){
  if(!line.startsWith('diff --git a/'))continue;
  const match=/^diff --git a\/(.+) b\/(.+)$/.exec(line);
  if(!match||match[1]!==match[2]||!PATH.test(match[2]))fail('unparseable-path');
  if(!paths.includes(match[2]))paths.push(match[2]);
 }
 return Object.freeze(paths.sort());
}
/** Result is a bounded, deterministic proposal snapshot, not an approved plan. */
export function sanitizeProposalInput({headSha,baseSha,diffPatch,metadata}={}){
 if(!SHA.test(headSha||'')||!SHA.test(baseSha||''))fail('invalid-sha');
 if(typeof diffPatch!=='string'||diffPatch.length>2*1024*1024)fail('invalid-diff');
 if(metadata!==undefined&&!asObject(metadata))fail('invalid-metadata');
 const cleanDiff=stripUntrusted(diffPatch);
 const complete=cleanDiff.length<=65536;
 const bounded=cleanDiff.slice(0,65536);
 return Object.freeze({schema:'ultron.council.proposal.v1',headSha,baseSha,
  cleanDiff:bounded,changedPaths:changedPaths(bounded),complete,
  metadata:Object.freeze({pullRequest:Number.isSafeInteger(metadata?.pullRequest)?metadata.pullRequest:null})});
}
export async function evaluateProposalRole({proposal,roleId,modelVerdict,ownerOverride=false}={}){
 if(!asObject(proposal)||!SHA.test(proposal.headSha||'')||
   !SHA.test(proposal.baseSha||'')||
   !COUNCIL_ROLE_IDS.includes(roleId)||!Array.isArray(proposal.changedPaths))
  fail('invalid-proposal');
 const sensitive=proposal.changedPaths.some(x=>x.startsWith('.github/workflows/')||
  x.startsWith('cloud/hatchable/migrations/')||x.startsWith('src/auth/'));
 const requested=modelVerdict?.conclusion;
 const insufficient=!proposal.complete||requested!=='success'&&requested!=='failure';
 const held=insufficient||(roleId==='security'&&sensitive&&!ownerOverride);
 const conclusion=held?'failure':requested;
 const rationale=held?(!proposal.complete?'Incomplete diff evidence':
  roleId==='security'&&sensitive&&!ownerOverride?'Sensitive source requires owner-approved evaluation':
  'Invalid role verdict'):String(modelVerdict.rationale||'').slice(0,1000);
 const evidenceHash=await sha(JSON.stringify({schema:proposal.schema,headSha:proposal.headSha,
  baseSha:proposal.baseSha,paths:proposal.changedPaths,diff:proposal.cleanDiff}));
 return Object.freeze({roleId,headSha:proposal.headSha,conclusion,evidenceHash,rationale,
  source:'deterministic-policy-with-untrusted-model-verdict'});
}
export function canonicalRoleVerdict({roleId,headSha,evidenceHash,conclusion,rationale,appId}={}){
 if(!COUNCIL_ROLE_IDS.includes(roleId)||!SHA.test(headSha||'')||
  !/^[a-f0-9]{64}$/.test(evidenceHash||'')||
  !['success','failure'].includes(conclusion)||typeof rationale!=='string'||
  rationale.length>1000||!Number.isSafeInteger(appId)||appId<1)fail('invalid-verdict');
 return JSON.stringify({schema:'ultron.council.role-verdict.v1',
  roleId,headSha,evidenceHash,conclusion,rationale,appId});
}
function decodeBase64Url(value){
 if(typeof value!=='string'||!/^[A-Za-z0-9_-]{80,256}$/.test(value))fail('invalid-signature');
 const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4));
 return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
export async function verifyRoleAttestation({verdict,proof,roleId,headSha,publicJwks,expectedAppIds}={}){
 if(!asObject(verdict)||!asObject(proof)||!asObject(publicJwks)||!asObject(expectedAppIds)||
  !COUNCIL_ROLE_IDS.includes(roleId)||verdict.roleId!==roleId||
  verdict.headSha!==headSha||proof.appId!==expectedAppIds[roleId]||
  !Number.isSafeInteger(proof.appId))fail('identity-mismatch');
 const value=canonicalRoleVerdict({...verdict,appId:proof.appId});
 const key=publicJwks[roleId];if(!asObject(key)||key.kty!=='EC'||key.crv!=='P-256')fail('key-untrusted');
 try{
  const imported=await crypto.subtle.importKey('jwk',key,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},imported,
    decodeBase64Url(proof.signature),encoder.encode(value)))fail('invalid-signature');
 }catch{fail('invalid-signature')}
 return Object.freeze({roleId,headSha,appId:proof.appId,verified:true});
}
/** Publishing is owned by this trusted adapter; the role signer has no GitHub token. */
export async function publishRoleCheckRun({roleId,headSha,verdict,proof,publicJwks,
 expectedAppIds,octokitForRole,pullRequest}={}){
 await verifyRoleAttestation({verdict,proof,roleId,headSha,publicJwks,expectedAppIds});
 if(!Number.isSafeInteger(pullRequest)||pullRequest<1||
  typeof octokitForRole?.rest?.pulls?.get!=='function'||
  typeof octokitForRole?.rest?.checks?.create!=='function')fail('publisher-unavailable');
 const current=(await octokitForRole.rest.pulls.get({
  owner:'michaeljwilliams0123',repo:'Ultron.MW',pull_number:pullRequest})).data;
 if(current?.head?.sha!==headSha||current?.state!=='open')fail('stale-head');
 const name='council/'+roleId;
 const response=await octokitForRole.rest.checks.create({
  owner:'michaeljwilliams0123',repo:'Ultron.MW',name,
  head_sha:headSha,status:'completed',conclusion:verdict.conclusion,
  output:{title:'Council '+roleId+': '+verdict.conclusion,
   summary:'Evidence SHA256: '+verdict.evidenceHash+'\n'+verdict.rationale}
 });
 if(response?.data?.head_sha!==headSha||response?.data?.app?.id!==expectedAppIds[roleId]||
  response?.data?.name!==name)fail('provider-identity-mismatch');
 return Object.freeze({roleId,headSha,appId:response.data.app.id,
  checkRunId:response.data.id,conclusion:verdict.conclusion,evidenceHash:verdict.evidenceHash});
}
export function verifySevenRoleQuorum({checks,headSha,expectedAppIds}={}){
 if(!SHA.test(headSha||'')||!Array.isArray(checks)||!asObject(expectedAppIds))return false;
 const matched=COUNCIL_ROLE_IDS.map(roleId=>checks.filter(c=>c?.name==='council/'+roleId&&
  c?.head_sha===headSha&&c?.status==='completed'&&c?.conclusion==='success'&&
  c?.app?.id===expectedAppIds[roleId]));
 return matched.every(group=>group.length===1)&&
  new Set(COUNCIL_ROLE_IDS.map(roleId=>expectedAppIds[roleId])).size===7;
}
