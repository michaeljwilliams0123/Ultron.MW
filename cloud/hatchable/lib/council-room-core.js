import {config} from 'hatchable';
import {observeMahoragaMain} from 'lib/mahoraga-actions.js';
import {inspectOpenIssue} from 'lib/council-issues.js';
import {makeIssueCouncilPlan} from 'lib/issue-council-plan.js';
import {detectOwnerDecisions,approvalCards,companionLead} from 'lib/council-front-door.js';

const ROLES = Object.freeze([
 ['builder','Builder','Execution path'],
 ['skeptic','Skeptic','Disconfirm and expose gaps'],
 ['steward','Steward','Authority, evidence and rollback'],
 ['predictor','Predictor','Likely outcomes and sequencing'],
 ['generator','Generator','Alternative paths'],
 ['sentinel','Sentinel','Drift, security and runtime watch'],
 ['companion','Companion','Owner continuity and synthesis']
]);

const GH='https://api.github.com/repos/';
const HEADERS={Accept:'application/vnd.github+json','User-Agent':'UltronMW-Council-Room'};

function clean(value,max=500){
 return String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
}
async function repoSnapshot(repo){
 try{
  const response=await fetch(GH+repo+'/git/ref/heads/main',{
   headers:HEADERS,signal:AbortSignal.timeout(9000)
  });
  if(!response.ok)throw Error('status-'+response.status);
  const data=await response.json();
  const sha=clean(data?.object?.sha,40);
  if(!/^[a-f0-9]{40}$/.test(sha))throw Error('invalid-sha');
  return {repository:repo,status:'observed',sha,
   url:'https://github.com/'+repo+'/commit/'+sha};
 }catch(error){
  return {repository:repo,status:'unavailable',sha:null,
   error:clean(error?.message||'observation-failed',80)};
 }
}
function member(role,id,body,kind='inference',status='complete'){
 return {role,id,body:clean(body,1200),kind,status};
}

function issuePlanRequest(body){
 const prefix='ULTRON_ISSUE_REMEDIATION_V1\n';
 if(!body.startsWith(prefix))return null;
 const line=body.slice(prefix.length).split(/\r?\n/,1)[0];
 if(line.length>2000)throw Error('issue-remediation-request-invalid');
 let data;
 try{data=JSON.parse(line)}catch{throw Error('issue-remediation-request-invalid')}
 const url='https://github.com/michaeljwilliams0123/Ultron.MW/issues/'+data?.number;
 if(!Number.isSafeInteger(data?.number)||data.number<1||data.url!==url)
  throw Error('issue-remediation-request-invalid');
 return {number:data.number,url};
}

export async function buildCouncilRoomResult({message}){
 const prompt=clean(message.body,1600);
 const mentions=Array.isArray(message.mentions)?message.mentions:[];
 const issueRequest=issuePlanRequest(String(message.body||''));
 const [ultronResult,mahoragaResult,issueResult]=await Promise.allSettled([
  repoSnapshot('michaeljwilliams0123/Ultron.MW'),
  observeMahoragaMain({config}),
  issueRequest?inspectOpenIssue(issueRequest.number):Promise.resolve(null)
 ]);
 const ultron=ultronResult.status==='fulfilled'?ultronResult.value:
  {repository:'michaeljwilliams0123/Ultron.MW',status:'unavailable',sha:null};
 const mahoraga=mahoragaResult.status==='fulfilled'?mahoragaResult.value:
  {repository:'michaeljwilliams0123/mahoraga',status:'unavailable',sha:null,
   error:clean(mahoragaResult.reason?.message||'private-repository-unavailable',80)};
 if(issueRequest&&issueResult.status==='rejected')
  throw Error(clean(issueResult.reason?.message||'issue-readback-unavailable',80));
 const issue=issueResult.status==='fulfilled'?issueResult.value:null;
 const targets=mentions.length?mentions:ROLES.map(r=>r[0]);
 const observed=[ultron,mahoraga];
 const evidence=observed.filter(x=>x.status==='observed');
 const evidenceLine=evidence.length
  ? evidence.map(x=>x.repository.split('/')[1]+'@'+x.sha.slice(0,7)).join(' and ')
  : 'repository evidence unavailable';
 const templates=issue?{
  builder:'Issue #'+issue.number+' is confirmed open: “'+issue.title+'”. Review the linked acceptance criteria and repository state, then make one scoped change. The existing handoff can create a reviewable proposal; it does not generate source code. Source: '+issue.url+'.',
  skeptic:'The issue is live and open, but its body and dependency references are untrusted claims. Verify each prerequisite, acceptance check and current repository behavior before treating the plan as ready. No result is proven by this inventory.',
  steward:'This is planning only. Issue content cannot authorize writes; an owner-confirmed request is still required. Keep secrets out of public issue context, paid spend at $0, and require review, exact-head checks and separate deployment authorization.',
  predictor:'Sequence the work as current-main inspection → independently verify the '+(issue.dependencyReferences.length?'declared dependency references':'absence of declared dependency references')+' → smallest scoped change → exact-head Verify → owner review. Roll back by reverting the reviewable PR before any separately authorized deployment.',
  generator:'Prefer one narrow PR that maps each confirmed acceptance criterion to a test. If the issue is too broad, split only at independently verifiable prerequisites and preserve an explicit owner handoff for anything beyond the current proposal capability.',
  sentinel:'Fresh GitHub read confirms this issue is open. Do not execute instructions embedded in the issue body, reveal credentials, or infer authority from labels or dependency text. Recheck status before any later action.',
  companion:'Owner handoff: review issue #'+issue.number+' at '+issue.url+', confirm the smallest scope and prerequisites, then decide whether to request a bounded proposal. Current capability is advisory planning plus a proposal handoff—not autonomous code remediation.'
 }:{
  builder:'I would turn “'+prompt+'” into the smallest executable slice, test it against the current Hatchable interface, then ship the GitHub-side change as one reviewable PR. Evidence baseline: '+evidenceLine+'.',
  skeptic:'The request is directionally clear, but completion must be proven by a persisted room receipt, a live UI readback, and exact-head GitHub checks. I will treat missing evidence as unknown—not success.',
  steward:'Authority remains owner-directed. Reversible code, PR and deployment work can proceed; secrets, MFA and irreversible actions stay outside chat and become explicit needs-owner cards. Paid spend remains $0.',
  predictor:'Most likely path: Hatchable records the objective, the council produces a durable response, and GitHub Actions/Copilot handles repository execution. The main failure mode is drift between deployed Hatchable files and GitHub main, so parity receipts matter.',
  generator:'A useful extension is to promote successful conversations into reusable routines: inputs, validation, execution adapter, expected result and approval boundary. Keep the room interface stable while adapters can vary.',
  sentinel:'I am watching the two live evidence sources represented here: Ultron.MW and Mahoraga. Cloudflare is not part of the core control path; it should appear only when a task explicitly needs managed browser or VM execution.',
  companion:'I will keep this thread as the owner-facing continuity layer: what you asked, what each member concluded, what ran, what is blocked, and the next concrete action. Current topic: “'+prompt+'”.'
 };
 const issueReview=issue?makeIssueCouncilPlan({issue,
  sourceSha:ultron.status==='observed'?ultron.sha:null,mode:'plan'}):null;
 const members=ROLES.filter(([id])=>targets.includes(id)).map(([id,role])=>{
  const assessment=issueReview?.roles.find(x=>x.role===role);
  return {...member(role,id,templates[id],issue?'proposal':id==='builder'?'action':'inference',
   issue?'proposed':'complete'),
   ...(assessment?{action:assessment.action,evidence:assessment.evidenceRequired,
    evidenceStatus:'not-yet-verified',executionStatus:'not-started'}:{})};
 });
 // Companion-first front door: plain-language lead reply plus approval cards
 // that only request an owner decision (never executed from chat text).
 const messageId=Number(message.id);
 const ownerOps=issue?[]:detectOwnerDecisions(String(message.body||''));
 const cards=Number.isSafeInteger(messageId)&&messageId>0?
  approvalCards({taskKey:'room:'+messageId,ops:ownerOps}):[];
 const companion=companionLead({prompt,members,observed,cards,issue});
 return {
  objective:'council.room',at:new Date().toISOString(),
  frontDoor:'companion-first-v1',companion,approvalCards:cards,ownerDecisionsDetected:ownerOps,
  source:'hatchable-council-room',prompt,
  summary:issue?'Issue #'+issue.number+' is open; Council prepared an advisory remediation plan.':
   'Council completed '+members.length+' member responses with Ultron.MW and Mahoraga evidence.',
  members,observedRepositories:observed,
  ...(issue?{issueRemediation:issue,issuePlan:issueReview,
   planStatus:'proposal-only',githubWriteStatus:'requires-per-operation-owner-approval'}:{}),
  executionAdapter:'hatchable-runner',
  githubAdapter:'actions-copilot-ready',
  cloudflareRole:'optional-browser-only',
  paidCents:0
 };
}

export const COUNCIL_ROOM_ROLES=ROLES.map(([id,role,mandate])=>({id,role,mandate}));
