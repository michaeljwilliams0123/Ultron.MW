import {db,config} from 'hatchable';
import {executeDeepIssue} from 'lib/deep-issue-workflow.js';
import {runMahoragaAction,mahoragaActionStatus} from 'lib/mahoraga-actions.js';

/* A real owner/admin task lifecycle; only the existing scoped private
 * Mahoraga issue.create capability may perform an external mutation.
 * No arbitrary shell, credential issuance, paid provider, merge, or admin
 * permission expansion is provided by this route. */
export const access='admin';
export const methods=['GET','POST'];

export default async function(req,res){
 if(req.member?.handle!=='michaeljwilliams0123')
  return res.status(403).json({ok:false,status:'held',
   reason:'owner-identity-required',productionAccepted:false});
 if(req.method==='GET'){
  const key=req.query?.key;
  if(typeof key!=='string'||!/^[a-z][a-z0-9_.:-]{7,119}$/.test(key))
   return res.status(400).json({ok:false,error:'invalid-key'});
  const value=await db.query(`SELECT task_key AS key,state,
    profile_version AS "profileVersion",stop_version AS "stopVersion",
    issue_number AS "externalIssueNumber",external_url AS url
    FROM brain_deep_objectives WHERE task_key=$1`,[key]);
  if(value.rows.length!==1)
   return res.status(404).json({ok:false,error:'deep-task-not-found'});
  const adapter=await mahoragaActionStatus({db},key);
  return res.json({ok:true,workflow:value.rows[0],
   providerState:adapter?.action?.state??'not-established'});
 }
 const reconcile=async action=>{
  // A previously dispatching workflow must NEVER create a new Mahoraga action
  // on a subsequent call after an unknown database/network acknowledgment.
  const prior=await mahoragaActionStatus({db},action.key);
  if(!prior.ok||!['sent','uncertain','observed'].includes(prior.action?.state))
   return {ok:false,state:'reconcile-required'};
  if(prior.action.state==='observed')return prior;
  return runMahoragaAction({db,config},action);
 };
 const result=await executeDeepIssue({
  db,request:req.body,
  send:action=>runMahoragaAction({db,config},action),
  reconcile,
  observe:key=>mahoragaActionStatus({db},key),
 });
 const code=result.status==='completed'?200:
  result.status==='reconcile-required'?202:
  result.reason==='idempotency-conflict'?409:
  result.reason==='owner-grant-or-stop-denied'?403:400;
 return res.status(code).json({ok:result.status==='completed',...result});
}
