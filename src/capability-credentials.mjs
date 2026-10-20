import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const SCOPES = Object.freeze(['status:read', 'ci:read']);
const TOKEN_HEADER = 'ultron.v1';
const IDENT = /^[a-z][a-z0-9-]{1,39}$/;
const CRED_NAME = /^ULTRON_[A-Z0-9_]{3,60}$/;

/** Self-owned bearer credentials only. Never creates GitHub or third-party tokens. */
export function createSigningKey() {
  return randomBytes(32).toString('base64url');
}
function keyBytes(key) {
  if (typeof key !== 'string' || key.length < 43 || key.length > 256)
    throw Error('Signing key must come from a protected runtime secret');
  return Buffer.from(key, 'utf8');
}
function encoded(data) { return Buffer.from(JSON.stringify(data)).toString('base64url'); }
function signature(payload,key) {
  return createHmac('sha256', keyBytes(key)).update(payload).digest('base64url');
}
export function issueCapabilityToken({ key, audience, scopes=['status:read'],
  ttlSeconds=900, now=Math.floor(Date.now()/1000),
  nonce=randomBytes(16).toString('hex') } = {}) {
  keyBytes(key);
  if (!IDENT.test(audience||'') || !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds<30 || ttlSeconds>3600 || !Number.isSafeInteger(now) ||
    !Array.isArray(scopes) || !scopes.length || new Set(scopes).size!==scopes.length ||
    scopes.some(s=>!SCOPES.includes(s)) || !/^[a-f0-9]{32}$/.test(nonce))
    throw Error('Unsupported token audience, scope or time budget');
  const payload=TOKEN_HEADER+'.'+encoded({
    iss:'ultron-runtime',aud:audience,scopes,iat:now,exp:now+ttlSeconds,jti:nonce,
  });
  return payload+'.'+signature(payload,key);
}
export function verifyCapabilityToken(token,{key,audience,requiredScope='status:read',
  now=Math.floor(Date.now()/1000)}={}) {
  if (!SCOPES.includes(requiredScope)||!IDENT.test(audience||'')||
    typeof token!=='string' || token.length>2048) return false;
  try {
    const items=token.split('.');
    if(items.length!==4||items[0]!=='ultron'||items[1]!=='v1' ||
      !/^[A-Za-z0-9_-]+$/.test(items[2])||
      !/^[A-Za-z0-9_-]+$/.test(items[3]))return false;
    const message=items.slice(0,3).join('.');
    const expected=Buffer.from(signature(message,key),'base64url');
    const actual=Buffer.from(items[3],'base64url');
    if(expected.length!==actual.length||!timingSafeEqual(expected,actual))
      return false;
    const p=JSON.parse(Buffer.from(items[2],'base64url').toString('utf8'));
    return p?.iss==='ultron-runtime'&&p.aud===audience &&
      Number.isSafeInteger(p.iat)&&Number.isSafeInteger(p.exp)&&
      now>=p.iat&&now<p.exp&&p.exp-p.iat<=3600&&
      Array.isArray(p.scopes)&&p.scopes.includes(requiredScope);
  } catch { return false; }
}
/** Secret reference validation: never accept a literal credential in source. */
export function validateSecretReference(reference) {
  if(typeof reference!=='string' || !reference.startsWith('env:'))
    throw Error('Credential must be an environment-only secret reference');
  const name=reference.slice(4);
  if(!CRED_NAME.test(name))throw Error('Invalid scoped secret reference name');
  return Object.freeze({source:'environment',name,publicValue:null});
}
export function credentialReadiness(references,env={}) {
  if(!Array.isArray(references)||references.length>12)
    throw Error('Credential contract exceeds bounded adapter budget');
  return references.map(ref=>{
    const contract=validateSecretReference(ref);
    return {name:contract.name,available:typeof env[contract.name]==='string' &&
      env[contract.name].length>=32,valueNeverReturned:true};
  });
}
export const CREDENTIAL_POLICY=Object.freeze({
  owner:'GitHub Actions GITHUB_TOKEN is a short-lived workflow credential',
  externalProviders:'External provider scopes and accounts require owner-authorized grants',
  deployedApi:'Use a protected ULTRON_* environment signing key, not repository source',
  publicRepo:'Never commit credential material, private keys, OAuth refresh tokens or secret values',
});
