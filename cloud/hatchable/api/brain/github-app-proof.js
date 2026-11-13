/**
 * Owner-only, explicit POST: authentic App installation + scoped read proof.
 * No repository mutation, persisted token, database write, or paid service.
 */
import {config} from 'hatchable';
import {signRs256,base64url} from 'lib/rsa-pkcs1-sign.js';
import {APP_PROOF,probeGithubAppInstallation} from 'lib/github-app-installation-proof.js';
export const access='admin';
export const methods=['POST'];
const ORIGIN='https://ultron-mw-cloud.hatchable.site';
function reply(res,status,value){
 res.setHeader('Cache-Control','private, no-store');
 res.setHeader('Vary','Cookie');
 return res.status(status).json(value);
}
function json64(value){return Buffer.from(JSON.stringify(value)).toString('base64url');}
function makeJwt(credentials,now){
 const seconds=Math.floor(now/1000);
 const unsigned=json64({alg:'RS256',typ:'JWT'})+'.'+
  json64({iat:seconds-30,exp:seconds+420,iss:String(APP_PROOF.appId)});
 return unsigned+'.'+base64url(signRs256(credentials.privateKey,unsigned));
}
export default async function(req,res){
 if(req.member?.handle!==APP_PROOF.owner)
  return reply(res,403,{error:'owner-identity-required'});
 if(req.headers?.origin!==ORIGIN)
  return reply(res,403,{error:'origin-denied'});
 if(req.method!=='POST'||!req.body||Array.isArray(req.body)||
  Object.keys(req.body).length!==1||req.body.mode!=='probe')
  return reply(res,400,{error:'proof-request-invalid'});
 try{
  const [appId,installationId,privateKey]=await Promise.all([
   config.get('ULTRON_GITHUB_APP_ID'),
   config.get('ULTRON_GITHUB_INSTALLATION_ID'),
   config.get('ULTRON_GITHUB_APP_PRIVATE_KEY')
  ]);
  const proof=await probeGithubAppInstallation({
   credentials:{appId,installationId,privateKey},signJwt:makeJwt
  });
  return reply(res,200,proof);
 }catch{return reply(res,503,{schema:'ultron.github-app-installation-proof.v1',
  state:'unverified',reason:'configuration-unavailable',
  installationVerified:false,repositoryReadVerified:false,
  contentsWritePermissionObserved:false,externalMutationVerified:false,
  productionAccepted:false});}
}
