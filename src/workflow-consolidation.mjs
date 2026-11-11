/** Workflow consolidation manifest: 26 legacy workflows -> 8 Council lanes.
 * Phase 1 is additive and shadow-only. Legacy workflows keep every trigger
 * and every side effect; the lane workflows only read and report. This
 * module is the single source of truth that the parity test and the shadow
 * replay (scripts/workflow-shadow.mjs) both check against the real files.
 *
 * Dispositions:
 *  - anchor:  the legacy file's path/name is load-bearing (OIDC trust pin in
 *             Hatchable, attested receipt, workflow_run name, dispatch by
 *             filename). Its lane's jobs fold INTO this file at cutover; the
 *             path is never renamed without a coordinated Hatchable deploy.
 *  - absorb:  jobs move into the lane target file at cutover.
 *  - retire:  dead/stale; delete only after owner sign-off (see register).
 */
export const LANE_ROLES=Object.freeze(['Builder','Skeptic','Steward','Predictor',
  'Generator','Sentinel','Companion','Ultron Core']);

const pin=(file,needle,why)=>Object.freeze({file,needle,why});
const wf=(file,lane,disposition,jobs,extra={})=>Object.freeze({file,lane,disposition,
  jobs:Object.freeze(jobs),pinnedBy:Object.freeze(extra.pinnedBy||[]),
  note:extra.note||''});

export const LANES=Object.freeze({
  ci:Object.freeze({owner:'Skeptic',file:'lane-ci.yml',
    purpose:'Exact-head verification, attested receipts, fixed comparison, Reef probe.'}),
  'comment-router':Object.freeze({owner:'Companion',file:'lane-comment-router.yml',
    purpose:'One front door for owner comments: route, admit or skip, never fail on no-op.'}),
  council:Object.freeze({owner:'Steward',file:'lane-council.yml',
    purpose:'Council debate, Continuum supervisor and identity proofs.'}),
  'owner-canary':Object.freeze({owner:'Predictor',file:'lane-owner-canary.yml',
    purpose:'Owner-approved canaries and acceptance matrix.'}),
  'lab-evidence':Object.freeze({owner:'Generator',file:'lane-lab-evidence.yml',
    purpose:'Hugging Face CPU labs, held-out evidence and C06 model release.'}),
  'ops-audit':Object.freeze({owner:'Sentinel',file:'lane-ops-audit.yml',
    purpose:'Live acceptance audit, hourly self-scan, GitLab mirror, shadow parity.'}),
  'cloud-handoff':Object.freeze({owner:'Builder',file:'lane-cloud-handoff.yml',
    purpose:'Hosted objectives, PR creation and the Council worker.'}),
  'governed-task':Object.freeze({owner:'Ultron Core',file:'lane-governed-task.yml',
    purpose:'Bounded governed operations routed by Ultron Core.'}),
});

const HATCH='cloud/hatchable/lib/';
export const LEGACY_WORKFLOWS=Object.freeze([
  wf('verify.yml','ci','anchor',['test','attested-receipt','fixed-comparison'],{pinnedBy:[
    pin('scripts/write-github-verification-receipt.mjs',".github/workflows/verify.yml@",'Sigstore receipt signer workflow ref'),
    pin(HATCH+'mahoraga-actions.js','/actions/workflows/verify.yml','Hatchable dispatches and reads verify.yml by path'),
    pin('src/ci-job-presence.mjs',".github/workflows/verify.yml",'#351 job-presence classifier'),
    pin('.github/workflows/gitlab-mirror.yml','"Ultron core verification"','workflow_run by workflow name'),
  ],note:'Required check `test` lives here; never duplicated by a lane file.'}),
  wf('reef-runtime-probe.yml','ci','absorb',['reef-runtime-probe'],
    {note:'cancel-in-progress noise contributed to #351; keep concurrency per PR at cutover.'}),
  wf('owner-comment-router.yml','comment-router','anchor',
    ['cloud-feedback','pr-conversation','issue-implementation','council-command'],{pinnedBy:[
    pin(HATCH+'council-oidc.js','/.github/workflows/owner-comment-router.yml@refs/heads/main','Hatchable OIDC room-router trust pin'),
  ]}),
  wf('codex-trigger-audit.yml','comment-router','absorb',['codex-trigger-audit'],
    {note:'Fail-closed exit 2 renders a red X when nothing was admitted; lane reports neutral.'}),
  wf('inline-pr-chat.yml','comment-router','absorb',['public-chat']),
  wf('pr-brain.yml','comment-router','absorb',['converse'],{pinnedBy:[
    pin('src/self-observer.mjs','.github/workflows/pr-brain.yml','self-observer inventory (repo-internal)'),
  ],note:'Reusable workflow; unadmitted PRs exit 1 today. Lane skips them instead.'}),
  wf('council-debate.yml','council','anchor',['council-debate'],{pinnedBy:[
    pin(HATCH+'council-oidc.js','/.github/workflows/council-debate.yml@refs/heads/main','Hatchable OIDC council trust pin'),
    pin('.github/workflows/continuum-council-supervisor.yml',"workflow_id:'council-debate.yml'",'dispatched by filename'),
  ]}),
  wf('continuum-council-supervisor.yml','council','absorb',['reconcile']),
  wf('council-identity-proof.yml','council','absorb',['prove']),
  wf('council-principal-proof.yml','council','absorb',['verify-principal']),
  wf('owner-actions-canary.yml','owner-canary','absorb',['read-only','one-branch'],
    {note:'Dispatch input `mode` collides with matrix/connection1026; namespace inputs at cutover.'}),
  wf('owner-canary-matrix.yml','owner-canary','absorb',['inspect-or-verify','marker-write']),
  wf('mahoraga-connection1026.yml','owner-canary','absorb',['verify']),
  wf('hf-free-cpu-tournament.yml','lab-evidence','absorb',['cpu-evaluation'],{pinnedBy:[
    pin('.github/workflows/hf-oidc-bridge.yml','Ultron Hugging Face free CPU tournament','workflow_run by workflow name'),
  ]}),
  wf('hf-heldout-cpu.yml','lab-evidence','absorb',['heldout-evaluation'],{pinnedBy:[
    pin('.github/workflows/hf-oidc-bridge.yml','Ultron Hugging Face held-out CPU repairs','workflow_run by workflow name'),
  ]}),
  wf('hf-oidc-bridge.yml','lab-evidence','anchor',['post-signed-receipt'],{pinnedBy:[
    pin(HATCH+'github-oidc-bridge.js','/.github/workflows/hf-oidc-bridge.yml@','Hatchable OIDC bridge trust pin'),
  ],note:'Never succeeded on record; repair before any retirement decision.'}),
  wf('held-out-acceptance.yml','lab-evidence','anchor',['held-out'],{pinnedBy:[
    pin(HATCH+'heldout-evidence.js','.github/workflows/held-out-acceptance.yml','Hatchable held-out evidence path pin'),
  ]}),
  wf('c06-owner-model-release.yml','lab-evidence','anchor',['generate','publish'],{pinnedBy:[
    pin(HATCH+'c06-live-evidence.js','.github/workflows/c06-owner-model-release.yml','Hatchable C06 evidence path pin'),
    pin('src/c06-replay-admission.mjs','.github/workflows/c06-owner-model-release.yml','C06 replay admission'),
  ],note:'Stale failures; keep until C06 evidence is re-earned or retired.'}),
  wf('c06-reconcile-publish.yml','lab-evidence','retire',['verify','publish'],
    {note:'0 recorded runs.'}),
  wf('live-acceptance-audit.yml','ops-audit','absorb',['audit']),
  wf('self-scan-pr.yml','ops-audit','absorb',['self-scan-pr'],{pinnedBy:[
    pin('src/pr-brain.mjs','/actions/workflows/self-scan-pr.yml/dispatches','dispatched by filename'),
    pin('src/self-observer.mjs','.github/workflows/self-scan-pr.yml','self-observer inventory (repo-internal)'),
  ]}),
  wf('gitlab-mirror.yml','ops-audit','absorb',['mirror'],{pinnedBy:[
    pin('src/route-reference-audit.mjs','.github/workflows/gitlab-mirror.yml','route-reference audit (repo-internal)'),
  ]}),
  wf('cloud-objective.yml','cloud-handoff','absorb',['cloud'],{pinnedBy:[
    pin('.github/workflows/owner-comment-router.yml','./.github/workflows/cloud-objective.yml','reusable workflow call'),
  ]}),
  wf('cloud-pr.yml','cloud-handoff','anchor',['create-pr'],{pinnedBy:[
    pin(HATCH+'council-oidc.js','/.github/workflows/cloud-pr.yml@refs/heads/main','Hatchable OIDC room-execution trust pin'),
  ]}),
  wf('council-worker.yml','cloud-handoff','anchor',['work'],{pinnedBy:[
    pin(HATCH+'council-oidc.js','/.github/workflows/council-worker.yml@refs/heads/main','Hatchable OIDC worker trust pin'),
  ]}),
  wf('governed-execution.yml','governed-task','retire',['execute_task'],
    {note:'0 recorded runs; lane keeps the slot for Ultron Core governed tasks.'}),
]);

/** Files added by later, separately reviewed PRs that are not legacy and not lanes. */
export const NON_LEGACY_WORKFLOWS=Object.freeze(['council-self-repair.yml']);

export function laneFiles(){return Object.values(LANES).map(l=>l.file);}
/** Lane files live in .github/workflows/. A staged copy under
 * .github/workflow-lanes/ is also accepted; a file in both is drift. */
export const LANE_DIRS=Object.freeze({active:'.github/workflows/',staged:'.github/workflow-lanes/'});
export function legacyByLane(lane){return LEGACY_WORKFLOWS.filter(w=>w.lane===lane);}

/** Files that must still exist after a full cutover with no Hatchable change. */
export function cutoverFileCount({hatchablePinsUpdated=false}={}){
  const files=new Set();
  for(const [lane,def] of Object.entries(LANES)){
    const anchors=legacyByLane(lane).filter(w=>w.disposition==='anchor'&&
      (!hatchablePinsUpdated||w.pinnedBy.some(p=>!p.file.startsWith(HATCH))));
    if(!anchors.length)files.add(def.file);
    else for(const a of anchors)files.add(a.file);
  }
  return files.size;
}

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

/** Static parity: every legacy job maps to exactly one lane, and every
 * declared pin is still present in the file that depends on it. */
export function checkParity({readFile,listWorkflows,listStaged=()=>[]}){
  const problems=[];
  const present=new Set(listWorkflows());
  const lanes=new Set(laneFiles());
  const known=new Set(LEGACY_WORKFLOWS.map(w=>w.file));
  for(const file of present){
    if(lanes.has(file)||NON_LEGACY_WORKFLOWS.includes(file))continue;
    if(!known.has(file))problems.push('unmapped legacy workflow '+file);
  }
  const mapped=[];
  for(const w of LEGACY_WORKFLOWS){
    if(!LANES[w.lane]){problems.push(w.file+': unknown lane '+w.lane);continue;}
    if(!present.has(w.file)){problems.push(w.file+': mapped legacy workflow missing');continue;}
    const scan=scanWorkflow(readFile('.github/workflows/'+w.file));
    const want=[...w.jobs].sort().join(','),got=[...scan.jobs].sort().join(',');
    if(want!==got)problems.push(w.file+': jobs drifted (manifest '+want+' vs file '+got+')');
    for(const job of scan.jobs)mapped.push({workflow:w.file,job,lane:w.lane});
    if(w.disposition==='anchor'&&!w.pinnedBy.length)problems.push(w.file+': anchor without a pin');
    for(const p of w.pinnedBy){
      let source='';
      try{source=readFile(p.file);}catch{problems.push(w.file+': pin source missing '+p.file);continue;}
      if(!source.includes(p.needle))problems.push(w.file+': pin no longer present in '+p.file);
    }
  }
  const staged=new Set(listStaged());
  for(const [lane,def] of Object.entries(LANES)){
    if(!LANE_ROLES.includes(def.owner))problems.push(lane+': owner is not a Council role');
    if(present.has(def.file)&&staged.has(def.file))problems.push(lane+': lane workflow both staged and active');
    else if(!present.has(def.file)&&!staged.has(def.file))problems.push(lane+': lane workflow missing '+def.file);
  }
  const owners=Object.values(LANES).map(l=>l.owner);
  if(new Set(owners).size!==owners.length)problems.push('each lane needs a distinct owner');
  return Object.freeze({ok:problems.length===0,problems:Object.freeze(problems),
    mapped:Object.freeze(mapped),legacyCount:LEGACY_WORKFLOWS.length,
    laneCount:Object.keys(LANES).length});
}
