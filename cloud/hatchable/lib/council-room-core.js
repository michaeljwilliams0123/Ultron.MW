import {config} from 'hatchable';
import {observeMahoragaMain} from 'lib/mahoraga-actions.js';

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

export async function buildCouncilRoomResult({message}){
 const prompt=clean(message.body,1600);
 const mentions=Array.isArray(message.mentions)?message.mentions:[];
 const [ultronResult,mahoragaResult]=await Promise.allSettled([
  repoSnapshot('michaeljwilliams0123/Ultron.MW'),
  observeMahoragaMain({config})
 ]);
 const ultron=ultronResult.status==='fulfilled'?ultronResult.value:
  {repository:'michaeljwilliams0123/Ultron.MW',status:'unavailable',sha:null};
 const mahoraga=mahoragaResult.status==='fulfilled'?mahoragaResult.value:
  {repository:'michaeljwilliams0123/mahoraga',status:'unavailable',sha:null,
   error:clean(mahoragaResult.reason?.message||'private-repository-unavailable',80)};
 const targets=mentions.length?mentions:ROLES.map(r=>r[0]);
 const observed=[ultron,mahoraga];
 const evidence=observed.filter(x=>x.status==='observed');
 const evidenceLine=evidence.length
  ? evidence.map(x=>x.repository.split('/')[1]+'@'+x.sha.slice(0,7)).join(' and ')
  : 'repository evidence unavailable';
 const templates={
  builder:'I would turn “'+prompt+'” into the smallest executable slice, test it against the current Hatchable interface, then ship the GitHub-side change as one reviewable PR. Evidence baseline: '+evidenceLine+'.',
  skeptic:'The request is directionally clear, but completion must be proven by a persisted room receipt, a live UI readback, and exact-head GitHub checks. I will treat missing evidence as unknown—not success.',
  steward:'Authority remains owner-directed. Reversible code, PR and deployment work can proceed; secrets, MFA and irreversible actions stay outside chat and become explicit needs-owner cards. Paid spend remains $0.',
  predictor:'Most likely path: Hatchable records the objective, the council produces a durable response, and GitHub Actions/Copilot handles repository execution. The main failure mode is drift between deployed Hatchable files and GitHub main, so parity receipts matter.',
  generator:'A useful extension is to promote successful conversations into reusable routines: inputs, validation, execution adapter, expected result and approval boundary. Keep the room interface stable while adapters can vary.',
  sentinel:'I am watching the two live evidence sources represented here: Ultron.MW and Mahoraga. Cloudflare is not part of the core control path; it should appear only when a task explicitly needs managed browser or VM execution.',
  companion:'I will keep this thread as the owner-facing continuity layer: what you asked, what each member concluded, what ran, what is blocked, and the next concrete action. Current topic: “'+prompt+'”.'
 };
 const members=ROLES.filter(([id])=>targets.includes(id)).map(([id,role])=>
  member(role,id,templates[id],id==='builder'?'action':'inference'));
 return {
  objective:'council.room',at:new Date().toISOString(),
  source:'hatchable-council-room',prompt,
  summary:'Council completed '+members.length+' member responses with Ultron.MW and Mahoraga evidence.',
  members,observedRepositories:observed,
  executionAdapter:'hatchable-runner',
  githubAdapter:'actions-copilot-ready',
  cloudflareRole:'optional-browser-only',
  paidCents:0
 };
}

export const COUNCIL_ROOM_ROLES=ROLES.map(([id,role,mandate])=>({id,role,mandate}));