// A connector reports completed external writes only when the durable provider
// ledger and its independently persisted observation event agree. Never infer
// write authority from the presence of credentials or a successful read probe.
const SHA40=/^[a-f0-9]{40}$/;
const KEY=/^[a-z0-9][a-z0-9-]{7,63}$/;
const NOT_VERIFIED=Object.freeze({gitlabBranchVerified:false});
function validGitLab(row){
 const evidence=row?.evidence;
 return typeof row?.action_key==='string'&&KEY.test(row.action_key)&&
  evidence&&typeof evidence==='object'&&!Array.isArray(evidence)&&
  evidence.projectId===87884831&&
  evidence.branchName==='ultron/task-'+row.action_key&&
  typeof evidence.sourceSha==='string'&&SHA40.test(evidence.sourceSha)&&
  evidence.providerAcknowledged===true&&evidence.readbackMatches===true;
}
export async function verifiedProviderMutations({db}={}){
 if(typeof db?.query!=='function')return NOT_VERIFIED;
 try{
  const result=await db.query(`SELECT w.action_key,w.evidence
   FROM brain_mcp_provider_writes w
   WHERE w.operation='gitlab.branch.create' AND w.status='observed'
   AND EXISTS (
    SELECT 1 FROM brain_events e
    WHERE e.event_type='mcp-provider-write-observed'
      AND e.details->>'action_key'=w.action_key
      AND e.details->>'grant_id'=w.grant_id
      AND e.details->>'operation'=w.operation
      AND e.details->'evidence'=w.evidence
   )
   ORDER BY w.updated_at DESC LIMIT 100`);
  return Object.freeze({gitlabBranchVerified:
   Array.isArray(result?.rows)&&result.rows.some(validGitLab)});
 }catch{return NOT_VERIFIED;}
}
