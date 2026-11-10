import { createHash, createVerify } from 'node:crypto';

const ISSUER = 'https://token.actions.githubusercontent.com';
const JWKS_URL = ISSUER + '/.well-known/jwks';
const REPOSITORY = 'michaeljwilliams0123/Ultron.MW';
const REPOSITORY_ID = '1424939667';
const WORKFLOW = REPOSITORY + '/.github/workflows/council-debate.yml@refs/heads/main';
const WORKER_WORKFLOW = REPOSITORY + '/.github/workflows/council-worker.yml@refs/heads/main';
const ROOM_ROUTER_WORKFLOW = REPOSITORY + '/.github/workflows/owner-comment-router.yml@refs/heads/main';
const ROOM_EXECUTION_WORKFLOW = REPOSITORY + '/.github/workflows/cloud-pr.yml@refs/heads/main';
const SHA = /^[a-f0-9]{40}$/;

function deny() {
  throw Error('council-oidc-untrusted');
}

function derLength(n) {
  if (n < 128) return Buffer.from([n]);
  const bytes = [];
  while (n > 0) { bytes.unshift(n & 255); n >>>= 8; }
  return Buffer.from([128 | bytes.length, ...bytes]);
}
function der(tag, payload) {
  return Buffer.concat([Buffer.from([tag]), derLength(payload.length), payload]);
}
function derInteger(value) {
  let bytes = Buffer.from(value, 'base64url');
  while (bytes.length > 1 && bytes[0] === 0 && (bytes[1] & 128) === 0) bytes = bytes.subarray(1);
  if ((bytes[0] & 128) !== 0) bytes = Buffer.concat([Buffer.from([0]), bytes]);
  return der(2, bytes);
}
function rsaJwkToPem(jwk) {
  if (!jwk || typeof jwk.n !== 'string' || typeof jwk.e !== 'string') deny();
  const rsa = der(48, Buffer.concat([derInteger(jwk.n), derInteger(jwk.e)]));
  const algorithm = Buffer.from('300d06092a864886f70d0101010500', 'hex');
  const spki = der(48, Buffer.concat([algorithm, der(3, Buffer.concat([Buffer.from([0]), rsa]))]));
  const b64 = spki.toString('base64').match(/.{1,64}/g)?.join('\n');
  if (!b64) deny();
  return '-----BEGIN PUBLIC KEY-----\n' + b64 + '\n-----END PUBLIC KEY-----\n';
}

function decode(value) {
  if (typeof value !== 'string' || value.length > 12000 || !/^[A-Za-z0-9_-]+$/.test(value)) deny();
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    deny();
  }
}

async function verifyIdentity({token,rawBody,fetchJwks,now,audience,workflowRefs,
  jobWorkflowRef,eventNames}={}){
  if (typeof token !== 'string' || token.length < 250 || token.length > 20000 ||
      typeof rawBody !== 'string') deny();
  const parts = token.split('.');
  if (parts.length !== 3) deny();
  const header = decode(parts[0]);
  const claims = decode(parts[1]);
  if (header?.alg !== 'RS256' || typeof header.kid !== 'string') deny();

  const epoch = Math.floor(now() / 1000);
  if (claims?.iss !== ISSUER || claims.aud !== audience(rawBody) ||
      claims.repository_visibility !== 'public' ||
      claims.repository !== REPOSITORY || claims.repository_id !== REPOSITORY_ID ||
      claims.repository_owner !== 'michaeljwilliams0123' ||
      claims.repository_owner_id !== '308995719' ||
      claims.sub !== 'repo:michaeljwilliams0123@308995719/Ultron.MW@1424939667:ref:refs/heads/main' ||
      !((claims.actor==='michaeljwilliams0123'&&claims.actor_id==='308995719')||(claims.actor==='michaeljwilliams0123ultron'&&claims.actor_id==='354634860')) ||
      !workflowRefs.includes(claims.workflow_ref) ||
      (jobWorkflowRef && claims.job_workflow_ref !== jobWorkflowRef) ||
      claims.ref !== 'refs/heads/main' ||
      !eventNames.includes(claims.event_name) ||
      !SHA.test(claims.sha || '') ||
      !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) ||
      claims.iat > epoch + 45 || claims.iat < epoch - 360 ||
      claims.exp < epoch || claims.exp > epoch + 600 ||
      claims.exp <= claims.iat || claims.exp - claims.iat > 600) deny();

  let keys;
  try {
    const response = await fetchJwks(JWKS_URL, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) deny();
    keys = (await response.json()).keys;
  } catch {
    deny();
  }

  if (!Array.isArray(keys) || keys.length > 30) deny();
  const jwk = keys.find(key => key?.kid === header.kid && key.kty === 'RSA' && key.alg === 'RS256');
  if (!jwk) deny();
  let valid = false;
  try {
    const verifier = createVerify('RSA-SHA256');
    verifier.update(parts[0] + '.' + parts[1]);
    verifier.end();
    valid = verifier.verify(rsaJwkToPem(jwk), Buffer.from(parts[2], 'base64url'));
  } catch {
    deny();
  }
  if (!valid) deny();
  return Object.freeze({
    actor: claims.actor, sha: claims.sha, event: claims.event_name,
    audience: claims.aud, workflow: claims.workflow_ref,
    jobWorkflow: claims.job_workflow_ref || null
  });
}

export async function verifyCouncilOidc({token,rawBody,fetchJwks=fetch,now=Date.now}={}){
 const identity=await verifyIdentity({token,rawBody,fetchJwks,now,
  audience:councilOidcAudience,workflowRefs:[WORKFLOW],
  eventNames:['issues','workflow_dispatch']});
 return Object.freeze({actor:identity.actor,sha:identity.sha,event:identity.event,
  audience:identity.audience});
}

export async function verifyCouncilWorkerOidc({token,rawBody,fetchJwks=fetch,now=Date.now}={}){
 const identity=await verifyIdentity({token,rawBody,fetchJwks,now,
  audience:councilOidcAudience,workflowRefs:[WORKER_WORKFLOW],
  eventNames:['workflow_dispatch','issues']});
 return Object.freeze({actor:identity.actor,sha:identity.sha,event:identity.event,
  audience:identity.audience,source:'council-worker'});
}

export async function verifyCouncilRoomExecutionOidc({
 token,rawBody,fetchJwks=fetch,now=Date.now
}={}){
 const identity=await verifyIdentity({token,rawBody,fetchJwks,now,
  audience:councilRoomExecutionOidcAudience,
  workflowRefs:[ROOM_ROUTER_WORKFLOW],jobWorkflowRef:ROOM_EXECUTION_WORKFLOW,
  eventNames:['issue_comment']});
 return Object.freeze({actor:identity.actor,sha:identity.sha,event:identity.event,
  audience:identity.audience});
}

export function councilOidcAudience(rawBody) {
  if (typeof rawBody !== 'string' || rawBody.length > 100000) deny();
  return 'ultron.council.v1:sha256:' + createHash('sha256').update(rawBody).digest('hex');
}

export function councilRoomExecutionOidcAudience(rawBody){
 if(typeof rawBody!=='string'||rawBody.length>100000)deny();
 return 'ultron.council-room.execution.v1:sha256:'+
  createHash('sha256').update(rawBody).digest('hex');
}