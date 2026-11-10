import {config, api} from 'hatchable';
import {probeGithubOperator} from 'lib/github-operator-probe.js';

export const access='admin';
export const methods=['GET'];
const OWNER='michaeljwilliams0123';
const REPO='michaeljwilliams0123/Ultron.MW';
const REPO_ID=1424939667;

// Never serialize credential values or provider tokens to the browser.
async function configured(name){
 try {
  const value=await config.get(name);
  return typeof value==='string'?value.trim().length>0:value!==null&&value!==undefined;
 } catch {return false;}
}
async function oauthRead(name){
 try {
  const response=await api.call(name,{method:'GET',path:'/api/v4/user'});
  if(response?.status===200)return {state:'authenticated-read',httpStatus:200};
  return {state:'read-probe-failed',httpStatus:Number(response?.status)||null};
 } catch(error){
  return {state:error?.code==='SetupRequired'?'setup-required':'unverified',
   httpStatus:Number(error?.status)||null};
 }
}
export default async function(req,res){
 res.setHeader('Cache-Control','private, no-store');
 res.setHeader('Vary','Cookie');
 if(req.member?.handle!==OWNER)
  return res.status(403).json({schema:'ultron.connector-readiness.v1',
   error:'owner-identity-required'});
 const names=[
  'ULTRON_GITHUB_APP_ID','ULTRON_GITHUB_INSTALLATION_ID',
  'ULTRON_GITHUB_APP_PRIVATE_KEY','ULTRON_GITHUB_ISSUE_TOKEN',
  'ULTRON_MAHORAGA_GITHUB_APP_CLIENT_ID',
  'ULTRON_MAHORAGA_GITHUB_APP_INSTALLATION_ID',
  'ULTRON_MAHORAGA_GITHUB_APP_PRIVATE_KEY',
  'ULTRON_VAULT_KEY','ULTRON_GRAPH_WORKBOOK_BINDING',
  'ULTRON_GRAPH_DELEGATED_TOKEN'
 ];
 const [states,gitlabRead,gitlabWrite,githubOauth]=await Promise.all([
  Promise.all(names.map(configured)),
  oauthRead('gitlab'),
  oauthRead('gitlab_write'),
  probeGithubOperator((name,options)=>api.call(name,options))
 ]);
 const present=Object.fromEntries(names.map((name,i)=>[name,states[i]]));
 const appParts={
  id:present.ULTRON_GITHUB_APP_ID,
  installationId:present.ULTRON_GITHUB_INSTALLATION_ID,
  privateKey:present.ULTRON_GITHUB_APP_PRIVATE_KEY
 };
 const appComplete=Object.values(appParts).every(Boolean);
 const mahoragaConfigured=[
  present.ULTRON_MAHORAGA_GITHUB_APP_CLIENT_ID,
  present.ULTRON_MAHORAGA_GITHUB_APP_INSTALLATION_ID,
  present.ULTRON_MAHORAGA_GITHUB_APP_PRIVATE_KEY
 ].every(Boolean);
 return res.json({
  schema:'ultron.connector-readiness.v1',
  ownerAuthenticated:true,
  repository:{name:REPO,id:REPO_ID},
  githubApp:{
   state:appComplete?'credentials-present-unverified':'setup-required',
   configuredParts:appParts,installationVerified:false,
   liveMutationVerified:false
  },
  githubIssueToken:{state:present.ULTRON_GITHUB_ISSUE_TOKEN?
   'present-unverified':'not-configured'},
  mahoragaApp:{state:mahoragaConfigured?
   'credentials-present-scope-unverified':'setup-required',
   approvedForUltronRepository:false},
  gitlab:{read:gitlabRead,writeScopeReadProbe:gitlabWrite,
   writeMutationVerified:false},
  githubOauth,
  graph:{state:present.ULTRON_GRAPH_WORKBOOK_BINDING&&
   present.ULTRON_GRAPH_DELEGATED_TOKEN?'credentials-present-unverified':'not-configured'},
  hatchable:{ownerSession:'authenticated-collaborator',
   emailCode:'platform-managed',mcpEnabled:true,
   protectedVaultConfigured:present.ULTRON_VAULT_KEY},
  gmail:{chatgptConnectionNotInherited:true,hatchableApiIntegration:'not-declared'},
  productionAccepted:false,paidCeilingCents:0
 });
}