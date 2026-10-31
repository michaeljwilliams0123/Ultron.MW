/**
 * Evidence-indexed, preservation-first mutation classification.
 *
 * This classifies externally supplied case results; evidenceId is an audit
 * pointer, NOT proof that a check ran or independent release authorization.
 * Never use this classifier as an autonomous merge or production gate.
 */
const ID=/^[a-z][a-z0-9_.-]{2,79}$/;

function indexCases(rows,label){
 if(!Array.isArray(rows))throw Error('Invalid '+label+' case list');
 const indexed=new Map();
 for(const item of rows){
  if(!item||typeof item!=='object'||(typeof item.id!=='string'||!ID.test(item.id))||
     typeof item.passed!=='boolean')
   throw Error('Invalid '+label+' mutation case');
  if(indexed.has(item.id))throw Error('Duplicate '+label+' mutation case: '+item.id);
  indexed.set(item.id,item);
 }
 return indexed;
}

const sorted=items=>[...items].sort();
const hasEvidence=item=>typeof item?.evidenceId==='string'&&Boolean(item.evidenceId.trim());

/** A working capability is preserved unless an observed candidate case fails
 * or disappears. New passing behavior is advancement, not automatic release.
 */
export function classifyMutation({baseline,candidate}={}){
 const previous=indexCases(baseline,'baseline');
 const next=indexCases(candidate,'candidate');
 const preserved=[],added=[],recovered=[],regressed=[],failed=[],unverified=[];
 for(const [id,item] of previous){
  const after=next.get(id);
  const baselineObserved=hasEvidence(item);
  const candidateObserved=after&&hasEvidence(after);
  if(!baselineObserved||(after&&!candidateObserved))
   unverified.push(id);
  if(item.passed){
   if(after?.passed){
    if(baselineObserved&&candidateObserved)preserved.push(id);
   }else if(baselineObserved&&(!after||candidateObserved))
    regressed.push(id);
  }else if(after?.passed){
   if(baselineObserved&&candidateObserved)recovered.push(id);
  }else if(!after)unverified.push(id);
 }
 for(const [id,item] of next){
  const observed=hasEvidence(item);
  if(!observed)unverified.push(id);
  if(!item.passed&&observed)failed.push(id);
  if(!previous.has(id)&&item.passed&&observed)added.push(id);
 }
 const classification=regressed.length?'REGRESSION':
  (unverified.length||failed.length||(!previous.size&&!next.size))?'INCONCLUSIVE':
  (added.length||recovered.length)?'ADVANCEMENT':'PRESERVED';
 return Object.freeze({
  schema:'ultron.mutation-evolution.v1',
  classification,
  preserved:Object.freeze(sorted(preserved)),
  added:Object.freeze(sorted(added)),
  recovered:Object.freeze(sorted(recovered)),
  regressed:Object.freeze(sorted(regressed)),
  failed:Object.freeze(sorted(failed)),
  unverified:Object.freeze(sorted(new Set(unverified))),
  // Functional classification is not trusted or independent release evidence.
  releaseEligible:false,
  independentSecurityApprovalRequired:true
 });
}
