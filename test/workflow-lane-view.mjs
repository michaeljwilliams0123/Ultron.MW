// Test helper for the 26 -> 8 workflow consolidation. A legacy workflow's jobs
// now live inside a lane file; laneView() returns that lane's header
// (name, triggers, workflow-level permissions) plus ONLY the named jobs, so a
// legacy contract test keeps asserting on the same job text it always did.
import {readFileSync} from 'node:fs';

const ROOT=new URL('../.github/workflows/',import.meta.url);
export function workflowText(file){return readFileSync(new URL(file,ROOT),'utf8');}
export function laneView(file,jobIds){
 const lines=workflowText(file).replace(/\r\n/g,'\n').split('\n');
 const j=lines.findIndex(l=>l.trimEnd()==='jobs:');
 if(j<0)throw Error('no-jobs:'+file);
 const blocks=[];let cur=null;
 for(const line of lines.slice(j+1)){
  const m=line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
  if(m){cur={id:m[1],lines:[line]};blocks.push(cur);}
  else if(cur)cur.lines.push(line);
 }
 const wanted=new Set(jobIds);
 const picked=blocks.filter(b=>wanted.has(b.id));
 if(picked.length!==wanted.size)throw Error('missing-job:'+file+':'+jobIds.join(','));
 return lines.slice(0,j+1).join('\n')+'\n'+picked.map(b=>b.lines.join('\n')).join('\n')+'\n';
}
/** Legacy file -> [lane file, job ids], for the moved legacy workflows. */
export const LEGACY_JOBS=Object.freeze({
 'hf-heldout-cpu.yml':['lane-lab-evidence.yml',['heldout-evaluation']],
 'hf-free-cpu-tournament.yml':['lane-lab-evidence.yml',['cpu-evaluation']],
 'c06-owner-model-release.yml':['lane-lab-evidence.yml',['generate','publish']],
 'held-out-acceptance.yml':['lane-lab-evidence.yml',['held-out']],
 'owner-actions-canary.yml':['lane-owner-canary.yml',['read-only','one-branch']],
 'owner-canary-matrix.yml':['lane-owner-canary.yml',['inspect-or-verify','marker-write']],
 'mahoraga-connection1026.yml':['lane-owner-canary.yml',['verify']],
 'live-acceptance-audit.yml':['lane-ops-audit.yml',['audit']],
 'self-scan-pr.yml':['lane-ops-audit.yml',['self-scan-pr']],
 'gitlab-mirror.yml':['lane-ops-audit.yml',['mirror']],
 'reef-runtime-probe.yml':['lane-ops-audit.yml',['reef-runtime-probe']],
 'council-self-repair.yml':['lane-ops-audit.yml',['diagnose','act']],
 'cloud-objective.yml':['lane-governed-task.yml',['cloud']],
 'council-worker.yml':['lane-governed-task.yml',['work']],
 'continuum-council-supervisor.yml':['council-debate.yml',['reconcile']],
 'council-identity-proof.yml':['council-debate.yml',['prove']],
 'council-principal-proof.yml':['council-debate.yml',['verify-principal']],
 'codex-trigger-audit.yml':['owner-comment-router.yml',['codex-trigger-audit']],
 'inline-pr-chat.yml':['owner-comment-router.yml',['public-chat']],
 'pr-brain.yml':['owner-comment-router.yml',['pr-conversation']]
});
export function legacyView(file){
 const entry=LEGACY_JOBS[file];
 if(!entry)throw Error('not-a-moved-legacy-workflow:'+file);
 return laneView(...entry);
}
