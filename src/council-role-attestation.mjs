/**
 * Domain-separated Ed25519 attestations for the seven LOGICAL Council roles.
 * A shared trusted controller creates these signatures. A role signature is
 * NOT a separate GitHub App, independent review, owner approval or release.
 * The 256-bit root must be provisioned as a secure secret, never committed.
 */
import {createHmac,createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';
const ROLES=Object.freeze(['Builder','Skeptic','Steward','Predictor','Generator','Sentinel','Companion']);
const SHA=/^[a-f0-9]{40}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const PREFIX=Buffer.from('302e020100300506032b657004220420','hex');
const name='ultron.council-role-verdict.v1';
const roleCheck=role=>{if(!ROLES.includes(role))throw Error('role-invalid');};
const rootCheck=root=>{if(typeof root!=='string'||!DIGEST.test(root))throw Error('root-seed-invalid');};
const recordKeys=['schema','role','prNumber','sourceSha','verdict','confidence','source',
 'inputDigest','rationale','findings','issuedAt'];
function keyFor(root,role){
 rootCheck(root);roleCheck(role);
 const seed=createHmac('sha256',Buffer.from(root,'hex'))
  .update('ultron/council/ed25519/role/v1\0'+role,'utf8').digest();
 const privateKey=createPrivateKey({key:Buffer.concat([PREFIX,seed]),format:'der',type:'pkcs8'});
 const publicKey=createPublicKey(privateKey);
 return{privateKey,publicKey,spki:publicKey.export({format:'der',type:'spki'}).toString('base64')};
}
function canonical(value){
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
function validate(v){
 if(!v||!ROLES.includes(v.role))throw Error('role-invalid');
 if(!Number.isSafeInteger(v.prNumber)||v.prNumber<1)throw Error('pr-invalid');
 if(!SHA.test(v.sourceSha||''))throw Error('source-sha-invalid');
 if(!['proceed','hold','revise'].includes(v.verdict))throw Error('verdict-invalid');
 if(!Number.isFinite(v.confidence)||v.confidence<0||v.confidence>1)throw Error('confidence-invalid');
 if(!['model','deterministic-fallback'].includes(v.source))throw Error('source-invalid');
 if(!DIGEST.test(v.inputDigest||''))throw Error('input-digest-invalid');
 if(typeof v.rationale!=='string'||v.rationale.length>1200)throw Error('rationale-invalid');
 if(!Array.isArray(v.findings)||v.findings.length>3||
    v.findings.some(f=>typeof f!=='string'||f.length>240))throw Error('findings-invalid');
 if(typeof v.issuedAt!=='string'||Number.isNaN(Date.parse(v.issuedAt)))throw Error('issued-at-invalid');
}
export function deriveCouncilRolePublicKeys(root){
 rootCheck(root);
 return Object.freeze(Object.fromEntries(ROLES.map(role=>[role,keyFor(root,role).spki])));
}
export function signCouncilRoleVerdict(verdict,root,{issuedAt=new Date().toISOString()}={}){
 const payload={
  schema:name,role:verdict?.role,prNumber:verdict?.prNumber,sourceSha:verdict?.sourceSha,
  verdict:verdict?.verdict,confidence:verdict?.confidence,source:verdict?.source,
  inputDigest:verdict?.inputDigest,rationale:verdict?.rationale,
  findings:verdict?.findings??[],issuedAt
 };
 validate(payload);
 const key=keyFor(root,payload.role);
 return Object.freeze({...payload,attestation:Object.freeze({
  algorithm:'Ed25519',keyId:'council-role/'+payload.role+'/v1',publicKeySpki:key.spki,
  signature:sign(null,Buffer.from(canonical(payload)),key.privateKey).toString('base64url'),
  authority:'shared-council-controller',independentGithubReview:false
 })});
}
export function verifyCouncilRoleVerdict(signed,{trustedPublicKeys,expectedSha,expectedPr}={}){
 try{
  if(!signed||signed.schema!==name||
   !SHA.test(expectedSha||'')||signed.sourceSha!==expectedSha||
   !Number.isSafeInteger(expectedPr)||signed.prNumber!==expectedPr)return false;
  const a=signed.attestation;
  if(!a||a.algorithm!=='Ed25519'||a.authority!=='shared-council-controller'||
   a.independentGithubReview!==false||
   a.keyId!=='council-role/'+signed.role+'/v1'||
   typeof a.signature!=='string'||a.signature.length>300||
   typeof a.publicKeySpki!=='string'||a.publicKeySpki.length>200||
   !trustedPublicKeys||trustedPublicKeys[signed.role]!==a.publicKeySpki)return false;
  const payload=Object.fromEntries(recordKeys.map(k=>[k,signed[k]]));
  validate(payload);
  const publicKey=createPublicKey({key:Buffer.from(a.publicKeySpki,'base64'),format:'der',type:'spki'});
  return verify(null,Buffer.from(canonical(payload)),publicKey,Buffer.from(a.signature,'base64url'));
 }catch{return false;}
}
