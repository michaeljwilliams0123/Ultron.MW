import {db,config,api} from 'hatchable';
import {normalizeUniversalCloudCommand} from 'lib/universal-cloud-routing.js';
import {gitlabBranchWrite} from 'lib/gitlab-branch-write.js';
import {graphWrite} from 'lib/mcp-graph-write.js';

export const access='admin';
export const methods=['POST'];
const OWNER='michaeljwilliams0123';
const ORIGIN='https://ultron-mw-cloud.hatchable.site';
const held=reason=>({ok:false,status:'held',reason});
const uncertain=reason=>({ok:false,status:'reconcile-required',reason});
function safeOutcome(value,mode,operation) {
 if(!value||typeof value!=='object'||Array.isArray(value))
  return uncertain('provider-outcome-unresolved');
 if(mode==='prepare') {
  return value.ok===true&&value.grantRequest&&typeof value.grantRequest==='object'
    ?{ok:true,status:'prepared',operation,grantRequest:value.grantRequest}
    :held(value.reason||'prepare-unavailable');
 }
 const {ok,status,reason,key,branch,url,evidence}=value;
 return {
  ok:ok===true&&status==='observed',
  status:typeof status==='string'?status:'reconcile-required',
  operation,
  ...(typeof reason==='string'?{reason}:{}),
  ...(typeof key==='string'?{key}:{}),
  ...(typeof branch==='string'?{branch}:{}),
  ...(typeof url==='string'?{url}:{}),
  ...(evidence&&typeof evidence==='object'&&!Array.isArray(evidence)?
    {evidence}:{}),
 };
}
function httpCode(outcome,mode) {
 if(mode==='prepare'&&outcome.ok===true)return 200;
 if(outcome.status==='observed')return 200;
 if(outcome.status==='reconcile-required'||
    outcome.status==='reconcile_required')return 503;
 if(outcome.reason?.includes('conflict'))return 409;
 if(outcome.reason?.startsWith('grant-')||
    outcome.reason==='owner-grant-required')return 403;
 return 422;
}
/**
 * Canonical Hatchable owner entrypoint for currently certified external
 * providers. Delegates ONLY to their existing cryptographic/PG/adjudicated
 * implementations, which provide provider readback and no-replay behavior.
 * Uncertified providers are denied; this route never invents authority.
 */
export default async function(req,res) {
 res.setHeader('Cache-Control','private, no-store');
 if(req.member?.handle!==OWNER)
  return res.status(403).json(held('owner-identity-required'));
 if(req.headers?.origin&&req.headers.origin!==ORIGIN)
  return res.status(403).json(held('origin-denied'));
 if(req.method!=='POST')
  return res.status(405).json(held('method-not-allowed'));
 let adapterConfigRaw=null;
 try{adapterConfigRaw=await config.get('ULTRON_ADAPTER_REGISTRY_JSON');}catch{}
 const command=normalizeUniversalCloudCommand(req.body,{adapterConfigRaw});
 if(!command.ok)
  return res.status(422).json(command);
 let result;
 try {
  if(command.provider==='gitlab') {
   result=await gitlabBranchWrite({
    mode:command.mode,request:command.request,
    envelope:command.envelope,passkey:command.passkey,
    grantId:command.grantId,db,config,api,
   });
  } else if(command.provider==='graph') {
   result=await graphWrite({
    mode:command.mode,request:command.request,
    envelope:command.envelope,grantId:command.grantId,db,config,
   });
  } else {
   return res.status(422).json(held('provider-not-certified'));
  }
 } catch {
  // No blind retry after an uncertain provider outcome or database response.
  return res.status(503).json(uncertain('provider-outcome-unresolved'));
 }
 const response=safeOutcome(result,command.mode,command.operation);
 return res.status(httpCode(response,command.mode))
  .json({schema:'ultron.universal-cloud.v1',...response});
}
