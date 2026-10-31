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
 const preserved=[],added=[],regressed=[],unverified=[];
 for(const [id,item] of previous){
  const after=next.get(id);
  if(!item.evidenceId||typeof item.evidenceId!=='string'||
     !item.evidenceId.trim())unverified.push(id);
  if(item.passed&&!after?.passed)regressed.push(id);
  else if(item.passed&&after?.passed)preserved.push(id);
 }
 for(const [id,item] of next){
  if(!item.evidenceId||typeof item.evidenceId!=='string'||
     !item.evidenceId.trim())unverified.push(id);
  if(!previous.has(id)&&item.passed)added.push(id);
 }
 const classification=regressed.length?'REGRESSION':
  unverified.length?'INCONCLUSIVE':
  added.length?'ADVANCEMENT':'PRESERVED';
 return Object.freeze({
  schema:'ultron.mutation-evolution.v1',
  classification,
  preserved:Object.freeze(sorted(preserved)),
  added:Object.freeze(sorted(added)),
  regressed:Object.freeze(sorted(regressed)),
  unverified:Object.freeze(sorted(new Set(unverified))),
  // Functional classification is not trusted or independent release evidence.
  releaseEligible:false,
  independentSecurityApprovalRequired:true
 });
}
