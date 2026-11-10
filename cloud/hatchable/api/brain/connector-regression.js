import {probeGithubOperator} from 'lib/github-operator-probe.js';
export const access='admin';
export const methods=['GET'];
const OWNER='michaeljwilliams0123';

const invalidIdentity=new Set(['wrong-login','wrong-user-id','wrong-type']);
const invalidRepository=new Set(['repo-denied','wrong-repo-id',
 'wrong-repo-name','wrong-org-id','wrong-org-login','ref-denied',
 'wrong-ref','wrong-ref-type','invalid-sha']);
const partialReads={
 'issues-denied':'issues','issues-malformed':'issues',
 'pulls-denied':'pullRequests','pulls-malformed':'pullRequests',
 'actions-denied':'actions','actions-malformed':'actions',
 'revoked-mid-probe':'actions'
};
const scenarios=[
 'valid','valid-no-push','setup','typed-setup','network-error',
 'identity-denied','wrong-login','wrong-user-id','wrong-type',
 ...invalidRepository,'issues-denied','pulls-denied','actions-denied',
 'issues-malformed','pulls-malformed','actions-malformed',
 'revoked-mid-probe','no-configured-call'
];

// Fake responses are deterministic and have no network dependency.
async function runOne(scenario){
 const methods=[];
 const call=async(name,request)=>{
  if(name!=='github_operator'||request?.method!=='GET')
   throw Error('non-read-call');
  methods.push(request.method);
  const path=request.path;
  if(scenario==='setup')throw Error(
   'gateway internal/api/call 412: API "github_operator" is not connected.');
  if(scenario==='typed-setup'){
   const error=Error('missing');error.code='SetupRequired';throw error;
  }
  if(scenario==='network-error'||scenario==='no-configured-call')
   throw Error('offline');
  if(path==='/user')return {
   status:scenario==='identity-denied'?401:200,
   body:{login:scenario==='wrong-login'?'other':'michaeljwilliams0123ultron',
    id:scenario==='wrong-user-id'?4:354634860,
    type:scenario==='wrong-type'?'Bot':'User',
    access_token:'must-never-be-exposed'}
  };
  if(path==='/repos/Ultron-MW/Ultron.MW')return{
   status:scenario==='repo-denied'?403:200,
   body:{id:scenario==='wrong-repo-id'?1:1424939667,
    full_name:scenario==='wrong-repo-name'?'old/Ultron.MW':'Ultron-MW/Ultron.MW',
    owner:{id:scenario==='wrong-org-id'?5:354776009,
     login:scenario==='wrong-org-login'?'other':'Ultron-MW'},
    permissions:{push:scenario!=='valid-no-push'}}
  };
  if(path==='/repos/Ultron-MW/Ultron.MW/git/ref/heads/main')return{
   status:scenario==='ref-denied'?404:200,
   body:{ref:scenario==='wrong-ref'?'refs/heads/dev':'refs/heads/main',
    object:{type:scenario==='wrong-ref-type'?'tag':'commit',
     sha:scenario==='invalid-sha'?'F'.repeat(40):'a'.repeat(40)}}
  };
  if(path.includes('/issues?'))return{
   status:scenario==='issues-denied'?403:200,
   body:scenario==='issues-malformed'?{}:[]
  };
  if(path.includes('/pulls?'))return{
   status:scenario==='pulls-denied'?403:200,
   body:scenario==='pulls-malformed'?{}:[]
  };
  if(path.includes('/actions/runs?')){
   if(scenario==='revoked-mid-probe')throw Error('token-revoked');
   return{status:scenario==='actions-denied'?403:200,
    body:scenario==='actions-malformed'?{}:{workflow_runs:[]}};
  }
  throw Error('unexpected-provider-path');
 };
 const observed=await probeGithubOperator(
  scenario==='no-configured-call'?undefined:call);
 let expected='identity-and-repository-read-verified';
 if(scenario==='setup'||scenario==='typed-setup')expected='setup-required';
 if(scenario==='network-error'||scenario==='no-configured-call')
  expected='provider-readback-unavailable';
 if(scenario==='identity-denied')expected='principal-unverified';
 if(invalidIdentity.has(scenario))expected='wrong-principal';
 if(invalidRepository.has(scenario))expected='repository-unverified';
 const partial=Object.hasOwn(partialReads,scenario);
 const passed=observed.state===expected&&
  (expected!=='identity-and-repository-read-verified'||
   (observed.readCoverage===(partial?'partial':'complete')&&
    (!partial||observed.readCapabilities?.[partialReads[scenario]]===false)))&&
  (scenario!=='valid-no-push'||observed.providerPushFlag===false)&&
  observed.executionAuthorized!==true&&observed.liveMutationVerified!==true&&
  methods.every(m=>m==='GET')&&
  !JSON.stringify(observed).includes('must-never-be-exposed');
 return {name:scenario,passed};
}
export default async function(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.member?.handle!==OWNER)
  return res.status(403).json({error:'owner-identity-required'});
 const results=await Promise.all(scenarios.map(runOne));
 const failed=results.filter(x=>!x.passed).map(x=>x.name);
 return res.status(failed.length?500:200).json({
  schema:'ultron.connector-regression.v1',
  tested:results.length,passed:results.length-failed.length,
  failed:failed.length,failedCases:failed,
  mockProviderOnly:true,providerWrites:0,productionAccepted:false
 });
}