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
  if(!item||typeof item!=='object'||!ID.test(item.id||'')||
     typeof item.passed!=='boolean')
   throw Error('Invalid '+label+' mutation case');
  if(indexed.has(item.id))throw Error('Duplicate '+label+' mutation case: '+item.id);
  indexed.set(item.id,item);
 }
 return indexed;
}

const sorted=items=>[...items].sort();

/** A working capability is preserved unless an observed candidate case fails
 * or disappears. New passing behavior is advancement, not automatic release.
 */
export function classifyMutation({baseline,candidate}={}){
 const previous=indexCases(baseline,'baseline');
 const next=indexCases(candidate,'candidate');
 const preserved=[],added=[],recovered=[],regressed=[],failed=[],unverified=[];
 for(const [id,item] of previous){
  const after=next.get(id);
  if(typeof item.evidenceId!=='string'||!item.evidenceId.trim())
   unverified.push(id);
  if(item.passed){
   if(after?.passed)preserved.push(id);
   else regressed.push(id);
  }else if(after?.passed)recovered.push(id);
  else if(!after)unverified.push(id);
 }
 for(const [id,item] of next){
  if(typeof item.evidenceId!=='string'||!item.evidenceId.trim())
   unverified.push(id);
  if(!item.passed)failed.push(id);
  if(!previous.has(id)&&item.passed)added.push(id);
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
