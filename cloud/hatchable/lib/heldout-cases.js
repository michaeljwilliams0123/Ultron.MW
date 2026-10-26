export const HELDOUT_CASE_IDS=Object.freeze([
 'valid-source-bound-review','edited-manifest-rejected',
 'forged-reviewer-login-rejected','forged-reviewer-id-rejected',
 'forged-reviewer-type-rejected','string-pull-number-rejected',
 'stale-source-rejected','duplicate-review-rejected',
 'requested-changes-held','tampered-assessment-rejected'
]);

const OWNER='michaeljwilliams0123';
const REVIEWER={login:'coderabbitai[bot]',id:136622811,type:'Bot'};
const REPO='https://api.github.com/repos/michaeljwilliams0123/Ultron.MW';

function numberSeed(value){
 const text=String(value||'');
 if(!/^\d{6,20}$/.test(text))throw Error('invalid-heldout-seed');
 let state=2166136261;
 for(const char of text)state=Math.imul(state^char.charCodeAt(0),16777619)>>>0;
 return state||1;
}
function generator(seed){
 let state=numberSeed(seed);
 return ()=>((state=Math.imul(state^state>>>15,2246822519)>>>0)/4294967296);
}
function hex(next,length=40){
 let value='';
 while(value.length<length)value+=Math.floor(next()*0x100000000).toString(16).padStart(8,'0');
 return value.slice(0,length);
}
function scenario(seed,overrides={}){
 const next=generator(seed),pull=10000+Math.floor(next()*800000);
 const baselinePull=pull+1,main=hex(next),head=hex(next),base=hex(next),tree=hex(next);
 const freezeId=100000+Math.floor(next()*800000),reviewId=100000+Math.floor(next()*800000);
 const created='2026-10-'+String(10+Math.floor(next()*15)).padStart(2,'0')+'T10:00:00Z';
 const submitted=created.replace('10:00:00','10:05:00');
 const manifest={schema:'ultron.github-review-proxy-manifest.v1',
  objectiveId:'issue-68-stage-1',baselinePullNumber:baselinePull,
  candidatePullNumber:pull,candidateHeadSha:head,frozen:true,setsDisjoint:false,
  evaluator:'github-review-actionable-findings-v1',scoring:'1/(1+actionable-comments)'};
 const review={id:reviewId,user:{...REVIEWER},state:'COMMENTED',commit_id:head,
  submitted_at:submitted,body:'<!-- coderabbit-ai-generated:v1 -->\n'+
   '**Actionable comments posted: 0**'};
 const data={
  '/git/ref/heads/main':{object:{sha:main}},
  ['/pulls/'+pull]:{number:pull,merged:true,merge_commit_sha:main,
   user:{login:OWNER},head:{sha:head}},
  ['/issues/'+pull+'/comments?per_page=100']:[{id:freezeId,user:{login:OWNER},
   author_association:'OWNER',created_at:created,updated_at:created,
   body:'<!-- ultron-review-proxy-manifest:v1\n'+JSON.stringify(manifest)+'\n-->'}],
  ['/pulls/'+pull+'/reviews?per_page=100']:[review],
  ['/commits/'+main]:{commit:{tree:{sha:tree}}},
  ['/commits/'+head]:{commit:{tree:{sha:tree}}},
  ['/pulls/'+baselinePull]:{number:baselinePull,merged:true,head:{sha:base}},
  ['/pulls/'+baselinePull+'/reviews?per_page=100']:[{...review,id:reviewId+1,
   commit_id:base,submitted_at:created.replace('10:00:00','09:00:00'),
   body:'<!-- coderabbit-ai-generated:v1 -->\n**Actionable comments posted: 2**'}]
 };
 const merged={...data,...overrides};
 return {pull,main,head,freezeId,reviewId,review,fetchImpl:async url=>{
  const path=String(url).replace(REPO,'');
  if(!Object.hasOwn(merged,path))throw Error('heldout-unexpected-url:'+path);
  return {ok:true,status:200,json:async()=>merged[path]};
 }};
}
async function rejects(promise,fragment){
 try{await promise;return false;}catch(error){return String(error?.message??error).includes(fragment);}
}
async function load(source,tag){
 if(typeof source!=='string'||!source.trim())return null;
 try{return await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(source)+'#'+tag);}
 catch(error){return {loadError:String(error?.message??error)};}
}

/** Evaluate exact values generated from an external post-freeze Actions run ID. */
export async function evaluateHeldOutSource({source,seed,variant='candidate'}={}){
 const adapter=await load(source,String(seed)+':'+variant);
 if(!adapter||adapter.loadError||typeof adapter.observeAcceptanceEvidence!=='function'||
    typeof adapter.verifyPersistedAcceptanceEvidence!=='function'||
    typeof adapter.reviewEvidenceProjection!=='function'){
  return HELDOUT_CASE_IDS.map(caseId=>Object.freeze({caseId,passed:false,
   reason:adapter?.loadError?'module-load-error':'capability-not-present'}));
 }
 const outcomes=[];
 async function check(caseId,run){
  let passed=false,reason='assertion-failed';
  try{passed=(await run())===true;if(passed)reason='observed-pass';}
  catch(error){reason='execution-error:'+String(error?.message??error).slice(0,120);}
  outcomes.push(Object.freeze({caseId,passed,reason}));
 }
 await check(HELDOUT_CASE_IDS[0],async()=>{
  const f=scenario(seed+'01');
  const result=await adapter.observeAcceptanceEvidence({objectiveId:'issue-68-stage-1',
   candidatePullNumber:f.pull,fetchImpl:f.fetchImpl});
  return result.sourceSha===f.main&&result.reviewId===f.reviewId;
 });
 await check(HELDOUT_CASE_IDS[1],async()=>{
  const f=scenario(seed+'02');
  const path='/issues/'+f.pull+'/comments?per_page=100';
  const original=await (await f.fetchImpl(REPO+path)).json();
  const edited=scenario(seed+'02',{[path]:original.map(item=>({...item,
   updated_at:item.created_at.replace('10:00:00','10:01:00')}))});
  return rejects(adapter.observeAcceptanceEvidence({objectiveId:'issue-68-stage-1',
   candidatePullNumber:f.pull,fetchImpl:edited.fetchImpl}),'review-proxy-manifest-missing');
 });
 for(const [offset,field,value] of [['03','login','attacker-'+String(seed).slice(-6)],
  ['04','id',42],['05','type','User']]){
  await check(HELDOUT_CASE_IDS[outcomes.length],async()=>{
   const f=scenario(seed+offset),path='/pulls/'+f.pull+'/reviews?per_page=100';
   const forged={...f.review,user:{...f.review.user,[field]:value}};
   const changed=scenario(seed+offset,{[path]:[forged]});
   return rejects(adapter.observeAcceptanceEvidence({objectiveId:'issue-68-stage-1',
    candidatePullNumber:f.pull,fetchImpl:changed.fetchImpl}),'candidate-review-missing');
  });
 }
 await check(HELDOUT_CASE_IDS[5],async()=>{
  const f=scenario(seed+'06');
  return rejects(adapter.observeAcceptanceEvidence({objectiveId:'issue-68-stage-1',
   candidatePullNumber:String(f.pull),fetchImpl:f.fetchImpl}),'invalid-acceptance-request');
 });
 await check(HELDOUT_CASE_IDS[6],async()=>{
  const f=scenario(seed+'07');
  return rejects(adapter.observeAcceptanceEvidence({objectiveId:'issue-68-stage-1',
   candidatePullNumber:f.pull,sourceSha:'f'.repeat(40),fetchImpl:f.fetchImpl}),
   'source-sha-mismatch');
 });
 await check(HELDOUT_CASE_IDS[7],async()=>{
  const f=scenario(seed+'08'),path='/pulls/'+f.pull+'/reviews?per_page=100';
  const changed=scenario(seed+'08',{[path]:[f.review,{...f.review,id:f.reviewId+9}]});
  return rejects(adapter.observeAcceptanceEvidence({objectiveId:'issue-68-stage-1',
   candidatePullNumber:f.pull,fetchImpl:changed.fetchImpl}),'ambiguous-candidate-review');
 });
 await check(HELDOUT_CASE_IDS[8],async()=>{
  const f=scenario(seed+'09'),path='/pulls/'+f.pull+'/reviews?per_page=100';
  const changed=scenario(seed+'09',{[path]:[{...f.review,state:'CHANGES_REQUESTED'}]});
  const observed=await adapter.observeAcceptanceEvidence({objectiveId:'issue-68-stage-1',
   candidatePullNumber:f.pull,fetchImpl:changed.fetchImpl});
  const projected=adapter.reviewEvidenceProjection(observed);
  return projected.assessment.recommendation==='repair-findings'&&
   projected.assessment.dissent.includes('independent-review-changes-requested');
 });
 await check(HELDOUT_CASE_IDS[9],async()=>{
  const f=scenario(seed+'10');
  const observed=await adapter.observeAcceptanceEvidence({objectiveId:'issue-68-stage-1',
   candidatePullNumber:f.pull,fetchImpl:f.fetchImpl});
  const projected=adapter.reviewEvidenceProjection(observed);
  const assessment={...projected.assessment,reviewer:{...projected.assessment.reviewer,
   identityReceiptId:77},recommendation:'promote'};
  const verified=await adapter.verifyPersistedAcceptanceEvidence({
   objectiveId:'issue-68-stage-1',sourceSha:f.main,identity:projected.identity,
   assessment,fetchImpl:f.fetchImpl});
  return verified.reviewer===false&&verified.evaluation===false;
 });
 return Object.freeze(outcomes);
}

export function heldOutScore(outcomes){
 if(!Array.isArray(outcomes)||outcomes.length!==HELDOUT_CASE_IDS.length||
    outcomes.some((item,index)=>item?.caseId!==HELDOUT_CASE_IDS[index]||
     typeof item.passed!=='boolean'))throw Error('invalid-heldout-outcomes');
 return outcomes.filter(item=>item.passed).length/outcomes.length;
}
