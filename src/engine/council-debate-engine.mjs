/** Bounded Council advisory orchestration; never manufactures cognitive turns,
 * authorization, commits, or reviewer independence. Caller must supply a
 * trusted read-only execution adapter backed by real provider evidence.
 * Durable queue/recovery integration is a distinct admission gate.
 */
import {COUNCIL_ROLES} from '../council-publication.mjs';
import {createCollectivePosition,synthesizeCollectiveDeliberation}
 from '../collective-cognition.mjs';
const PHASES=Object.freeze([
 Object.freeze({name:'propose',roles:['ultron-builder','ultron-generator']}),
 Object.freeze({name:'challenge',roles:['ultron-skeptic','ultron-sentinel']}),
 Object.freeze({name:'impact',roles:['ultron-predictor','ultron-companion']}),
 Object.freeze({name:'synthesize',roles:['ultron-steward']})
]);
const CONTEXT_ID=/^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,79}$/;
const SHA=/^[a-f0-9]{40}$/;
function hold(task,reason,turns=[]){
 return Object.freeze({schema:'ultron.council-evidence-debate.v1',status:'held',
  reason,taskId:task.taskId,sourceSha:task.sourceSha,decision:'hold',
  roleTurns:Object.freeze(turns),verifiedIndependentRoleCount:0,
  identityEvidence:'not-proven',authorized:false,githubWritePerformed:false,
  autoCommitEligible:false});
}
export async function executeCouncilDebateLoop(taskContext,{runPersona}={}){
 if(!taskContext||typeof taskContext!=='object'||
   !CONTEXT_ID.test(taskContext.taskId||'')||
   !SHA.test(taskContext.sourceSha||'')||
   typeof taskContext.objective!=='string'||
   !taskContext.objective.trim()||taskContext.objective.length>500)
  throw Error('council-debate-context-invalid');
 if(typeof runPersona!=='function')return hold(taskContext,'provider-execution-unavailable');
 const turns=[];
 for(const phase of PHASES){
  let entries;
  try{
   // No arbitrary tools or secret-bearing taskContext passed to role adapters.
   const prior=Object.freeze(turns.map(x=>Object.freeze({
    individualId:x.individualId,fingerprint:x.fingerprint,
    conclusion:x.conclusion,evidenceRefs:[...x.evidenceRefs],
    unknowns:[...x.unknowns],dissentTags:[...x.dissentTags]
   })));
   entries=await Promise.all(phase.roles.map(async roleId=>{
    const result=await runPersona(Object.freeze({roleId,phase:phase.name,
     taskId:taskContext.taskId,sourceSha:taskContext.sourceSha,
     objective:taskContext.objective,prior}));
    if(result?.roleId!==roleId||result?.sourceSha!==taskContext.sourceSha||
       !result.position||result.position.evidenceRefs?.length<1)
     throw Error('unverified-role-result');
    const position=createCollectivePosition({individualId:roleId,
     conclusion:result.position.conclusion,confidence:result.position.confidence,
     evidenceRefs:result.position.evidenceRefs,
     assumptions:result.position.assumptions,unknowns:result.position.unknowns,
     dissentTags:result.position.dissentTags});
    if(!['proceed','hold'].includes(position.conclusion))
     throw Error('invalid-role-conclusion');
    return position;
   }));
  }catch{return hold(taskContext,'role-execution-or-evidence-unavailable',turns);}
  turns.push(...entries);
 }
 if(turns.length!==COUNCIL_ROLES.length||
  new Set(turns.map(x=>x.individualId)).size!==COUNCIL_ROLES.length)
  return hold(taskContext,'incomplete-council-observation',turns);
 let deliberation;
 try{deliberation=synthesizeCollectiveDeliberation({positions:turns});}
 catch{return hold(taskContext,'invalid-council-deliberation',turns);}
 const consistent=turns.every(x=>x.conclusion==='proceed'&&
  x.unknowns.length===0&&x.dissentTags.length===0);
 const decision=consistent&&deliberation.decision==='proceed'?'proceed':'hold';
 const status=decision==='proceed'?'advisory-ready':'held';
 return Object.freeze({schema:'ultron.council-evidence-debate.v1',
  taskId:taskContext.taskId,sourceSha:taskContext.sourceSha,status,
  reason:decision==='hold'?'material-dissent-or-unknown':null,
  decision,deliberationFingerprint:deliberation.fingerprint,
  roleTurns:Object.freeze(turns),verifiedIndependentRoleCount:0,
  identityEvidence:'not-proven',authorized:false,githubWritePerformed:false,
  autoCommitEligible:false});
}
