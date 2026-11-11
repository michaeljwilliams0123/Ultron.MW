/** Workflow consolidation manifest: 26 legacy workflows -> 8 Council lanes.
 * Phase 2 (live, owner decision Nov 10, 2026: "Get to the 8, redeploy
 * cleanly"). Exactly eight workflow files remain. Four load-bearing files ARE
 * their lane (verify.yml, owner-comment-router.yml, council-debate.yml,
 * cloud-pr.yml); four lanes are new files. Every legacy job moved byte-for-byte
 * into its lane file behind a job-level `if` that keeps its original trigger,
 * branch filter, cron and dispatch selection, with its legacy workflow-level
 * permissions and concurrency moved onto the job.
 *
 * Dispositions:
 *  - lane:     this legacy file is the lane file (path is load-bearing).
 *  - absorbed: jobs live in the lane file; the legacy file is deleted.
 *  - retired:  deleted after owner sign-off; its jobs exist nowhere.
 */
export const LANE_ROLES=Object.freeze(['Builder','Skeptic','Steward','Predictor',
  'Generator','Sentinel','Companion','Ultron Core']);

const pin=(file,needle,why)=>Object.freeze({file,needle,why});
const wf=(file,lane,disposition,jobs,extra={})=>Object.freeze({file,lane,disposition,
  jobs:Object.freeze(jobs),pinnedBy:Object.freeze(extra.pinnedBy||[]),
  note:extra.note||''});

const HATCH='cloud/hatchable/lib/';
export const LANES=Object.freeze({
  ci:Object.freeze({owner:'Skeptic',file:'verify.yml',
    purpose:'Exact-head verification, attested receipts, fixed comparison. Required check `test`.'}),
  'comment-router':Object.freeze({owner:'Companion',file:'owner-comment-router.yml',
    purpose:'One front door for owner comments: cloud feedback, PR conversation, implementation, /council, Codex audit, inline chat.'}),
  council:Object.freeze({owner:'Steward',file:'council-debate.yml',
    purpose:'Council debate, Continuum supervisor and identity proofs.'}),
  'owner-canary':Object.freeze({owner:'Predictor',file:'lane-owner-canary.yml',
    purpose:'Owner-approved canaries and acceptance matrix.'}),
  'lab-evidence':Object.freeze({owner:'Generator',file:'lane-lab-evidence.yml',
    purpose:'Hugging Face CPU labs, held-out evidence and C06 model release.'}),
  'ops-audit':Object.freeze({owner:'Sentinel',file:'lane-ops-audit.yml',
    purpose:'Live acceptance audit, hourly self-scan, GitLab mirror, Reef probe, self-repair loop.'}),
  'cloud-handoff':Object.freeze({owner:'Builder',file:'cloud-pr.yml',
    purpose:'Owner PR creation and room execution handoff (Hatchable job_workflow_ref pin).'}),
  'governed-task':Object.freeze({owner:'Ultron Core',file:'lane-governed-task.yml',
    purpose:'Hosted read-only objectives and the Council execution worker (own OIDC identity).'}),
});

export const LEGACY_WORKFLOWS=Object.freeze([
  wf('verify.yml','ci','lane',['test','attested-receipt','fixed-comparison'],{pinnedBy:[
    pin('scripts/write-github-verification-receipt.mjs',".github/workflows/verify.yml@",'Sigstore receipt signer workflow ref'),
    pin(HATCH+'mahoraga-actions.js','/actions/workflows/verify.yml','Hatchable dispatches and reads verify.yml by path'),
    pin('src/ci-job-presence.mjs',".github/workflows/verify.yml",'#351 job-presence classifier'),
    pin('.github/workflows/lane-ops-audit.yml','"Ultron core verification"','workflow_run by workflow name'),
  ],note:'Required check `test` lives here; verify.yml is byte-identical through the cutover.'}),
  wf('reef-runtime-probe.yml','ops-audit','absorbed',['reef-runtime-probe'],
    {note:'Moved to ops-audit, not ci, so a probe failure never turns Verify red.'}),
  wf('owner-comment-router.yml','comment-router','lane',
    ['cloud-feedback','issue-implementation','council-command'],{pinnedBy:[
    pin(HATCH+'council-oidc.js','/.github/workflows/owner-comment-router.yml@refs/heads/main','Hatchable OIDC room-router trust pin'),
  ]}),
  wf('codex-trigger-audit.yml','comment-router','absorbed',['codex-trigger-audit']),
  wf('inline-pr-chat.yml','comment-router','absorbed',['public-chat']),
  wf('pr-brain.yml','comment-router','absorbed',['pr-conversation'],{pinnedBy:[
    pin('src/self-observer.mjs','.github/workflows/owner-comment-router.yml','self-observer inventory (repo-internal)'),
  ],note:'The converse job is inlined as the router job pr-conversation (was a reusable call).'}),
  wf('council-debate.yml','council','lane',['council-debate'],{pinnedBy:[
    pin(HATCH+'council-oidc.js','/.github/workflows/council-debate.yml@refs/heads/main','Hatchable OIDC council trust pin'),
    pin('.github/workflows/council-debate.yml',"workflow_id:'council-debate.yml'",'supervisor dispatches by filename'),
  ]}),
  wf('continuum-council-supervisor.yml','council','absorbed',['reconcile']),
  wf('council-identity-proof.yml','council','absorbed',['prove']),
  wf('council-principal-proof.yml','council','absorbed',['verify-principal']),
  wf('owner-actions-canary.yml','owner-canary','absorbed',['read-only','one-branch'],
    {note:'Dispatch input `mode` is now `actions_mode`.'}),
  wf('owner-canary-matrix.yml','owner-canary','absorbed',['inspect-or-verify','marker-write'],
    {note:'Dispatch input `mode` is now `matrix_mode`.'}),
  wf('mahoraga-connection1026.yml','owner-canary','absorbed',['verify'],
    {note:'Dispatch input `mode` is now `connection_mode`.'}),
  wf('hf-free-cpu-tournament.yml','lab-evidence','absorbed',['cpu-evaluation'],{pinnedBy:[
    pin(HATCH+'workflow-lanes.js',"'hf-free-cpu-tournament':'tournament'",'Hatchable lab lane receipt key'),
  ]}),
  wf('hf-heldout-cpu.yml','lab-evidence','absorbed',['heldout-evaluation'],{pinnedBy:[
    pin(HATCH+'workflow-lanes.js',"'hf-heldout-cpu':'heldout'",'Hatchable lab lane receipt key'),
  ]}),
  wf('hf-oidc-bridge.yml','lab-evidence','retired',['post-signed-receipt'],
    {note:'Never succeeded (Hatchable unauthenticated readback 503); owner approved retirement. Trust entry removed in the next Hatchable release.'}),
  wf('held-out-acceptance.yml','lab-evidence','absorbed',['held-out'],{pinnedBy:[
    pin(HATCH+'heldout-evidence.js',"path:'.github/workflows/lane-lab-evidence.yml'",'Hatchable held-out evaluator identity'),
  ]}),
  wf('c06-owner-model-release.yml','lab-evidence','absorbed',['generate','publish'],{pinnedBy:[
    pin(HATCH+'workflow-lanes.js',"'c06-owner-model-release':'c06'",'Hatchable lab lane receipt key'),
  ],note:'c06-live-evidence.js pins one historical run whose recorded path never changes.'}),
  wf('c06-reconcile-publish.yml','lab-evidence','retired',['verify','publish'],
    {note:'0 recorded runs; owner approved retirement.'}),
  wf('live-acceptance-audit.yml','ops-audit','absorbed',['audit']),
  wf('self-scan-pr.yml','ops-audit','absorbed',['self-scan-pr'],{pinnedBy:[
    pin('src/pr-brain.mjs','/actions/workflows/lane-ops-audit.yml/dispatches','dispatched by filename with ops_task'),
    pin('docs/core/cloud-submit.mjs','actions/workflows/lane-ops-audit.yml','owner UI self-scan handoff link'),
  ]}),
  wf('gitlab-mirror.yml','ops-audit','absorbed',['mirror'],{pinnedBy:[
    pin('src/route-reference-audit.mjs','.github/workflows/lane-ops-audit.yml','route-reference audit (repo-internal)'),
  ]}),
  wf('council-self-repair.yml','ops-audit','absorbed',['diagnose','act'],
    {note:'Added by #411 after phase 1; folded into ops-audit as its header planned.'}),
  wf('cloud-objective.yml','governed-task','absorbed',['cloud'],{pinnedBy:[
    pin('.github/workflows/owner-comment-router.yml','./.github/workflows/lane-governed-task.yml','reusable workflow call'),
  ]}),
  wf('cloud-pr.yml','cloud-handoff','lane',['create-pr'],{pinnedBy:[
    pin(HATCH+'council-oidc.js','/.github/workflows/cloud-pr.yml@refs/heads/main','Hatchable OIDC room-execution trust pin'),
  ],note:'Unchanged. Nothing was folded in, so its job_workflow_ref identity stays exclusive.'}),
  wf('council-worker.yml','governed-task','absorbed',['work'],{pinnedBy:[
    pin(HATCH+'council-oidc.js','/.github/workflows/lane-governed-task.yml@refs/heads/main','Hatchable OIDC worker trust pin (lane identity)'),
  ],note:'Moved to governed-task (not cloud-pr) so the worker keeps an OIDC identity of its own.'}),
  wf('governed-execution.yml','governed-task','retired',['execute_task'],
    {note:'0 recorded runs; owner approved retirement.'}),
]);

/** Workflow files allowed besides the eight lanes (separately reviewed PRs). */
export const NON_LEGACY_WORKFLOWS=Object.freeze(['council-required-status.yml']);

export function laneFiles(){return Object.values(LANES).map(l=>l.file);}
/** Lane files live in .github/workflows/. A staged copy under
 * .github/workflow-lanes/ is also accepted; a file in both is drift. */
export const LANE_DIRS=Object.freeze({active:'.github/workflows/',staged:'.github/workflow-lanes/'});
export function legacyByLane(lane){return LEGACY_WORKFLOWS.filter(w=>w.lane===lane);}

/** Files that exist after the cutover: one per lane. */
export function cutoverFileCount(){return new Set(laneFiles()).size;}

/** Minimal scanner for this repository's uniformly formatted workflows:
 * top-level keys at column 0, triggers and job ids at two spaces. */
export function scanWorkflow(text){
  const lines=String(text).replace(/\r\n/g,'\n').split('\n');
  let top='';const triggers=[];const jobs=[];let name='';
  const permissions=[];
  for(const line of lines){
    const t=line.match(/^([A-Za-z_-]+):(.*)$/);
    if(t){top=t[1];if(top==='name')name=t[2].trim().replace(/^['"]|['"]$/g,'');continue;}
    const second=line.match(/^  ([A-Za-z0-9_-]+):\s*(?:#.*)?$/);
    if(top==='on'&&second)triggers.push(second[1]);
    if(top==='jobs'&&second)jobs.push(second[1]);
    const perm=line.match(/^\s+([a-z-]+):\s*(read|write|none)\s*$/);
    if(perm&&(top==='permissions'||top==='jobs'))permissions.push(perm[1]+':'+perm[2]);
  }
  return Object.freeze({name,triggers:Object.freeze(triggers),jobs:Object.freeze(jobs),
    permissions:Object.freeze(permissions)});
}

/** Static parity (phase 2): exactly the eight lane files exist (plus allowed
 * non-legacy files); every legacy job lives in its lane file exactly once;
 * absorbed/retired legacy files are gone; every declared pin is present. */
export function checkParity({readFile,listWorkflows,listStaged=()=>[]}){
  const problems=[];
  const present=new Set(listWorkflows());
  const lanes=new Set(laneFiles());
  for(const file of present){
    if(lanes.has(file)||NON_LEGACY_WORKFLOWS.includes(file))continue;
    problems.push('unmapped workflow '+file);
  }
  for(const file of listStaged())problems.push('staged lane left behind '+file);
  const mapped=[];
  const laneJobs=new Map();
  for(const [lane,def] of Object.entries(LANES)){
    if(!present.has(def.file)){problems.push(lane+': lane workflow missing '+def.file);continue;}
    laneJobs.set(lane,scanWorkflow(readFile('.github/workflows/'+def.file)).jobs);
  }
  const claimed=new Map();
  for(const w of LEGACY_WORKFLOWS){
    if(!LANES[w.lane]){problems.push(w.file+': unknown lane '+w.lane);continue;}
    if(w.disposition==='lane'&&LANES[w.lane].file!==w.file)problems.push(w.file+': lane file mismatch');
    if(w.disposition!=='lane'&&present.has(w.file))problems.push(w.file+': '+w.disposition+' legacy workflow still present');
    const jobs=laneJobs.get(w.lane)||[];
    for(const job of w.jobs){
      const key=w.lane+'#'+job;
      if(w.disposition==='retired')continue; // file deletion is the check above
      if(!jobs.includes(job)){problems.push(w.file+': job '+job+' missing from '+LANES[w.lane].file);continue;}
      if(claimed.has(key))problems.push(w.file+': job '+job+' also claimed by '+claimed.get(key));
      claimed.set(key,w.file);
      mapped.push({workflow:w.file,job,lane:w.lane});
    }
    if(w.disposition==='lane'&&!w.pinnedBy.length)problems.push(w.file+': lane file without a pin');
    for(const p of w.pinnedBy){
      let source='';
      try{source=readFile(p.file);}catch{problems.push(w.file+': pin source missing '+p.file);continue;}
      if(!source.includes(p.needle))problems.push(w.file+': pin no longer present in '+p.file);
    }
  }
  for(const [lane,jobs] of laneJobs)for(const job of jobs)
    if(!claimed.has(lane+'#'+job))problems.push(LANES[lane].file+': unmapped job '+job);
  const owners=Object.values(LANES).map(l=>l.owner);
  if(new Set(owners).size!==owners.length)problems.push('each lane needs a distinct owner');
  return Object.freeze({ok:problems.length===0,problems:Object.freeze(problems),
    mapped:Object.freeze(mapped),legacyCount:LEGACY_WORKFLOWS.length,
    laneCount:Object.keys(LANES).length});
}
