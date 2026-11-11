// Read-only #351 diagnostic: node scripts/ci-job-presence.mjs <runId>
// Uses GITHUB_TOKEN if set (never printed); exits 0 only for `green`.
import {classifyVerifyRun} from '../src/ci-job-presence.mjs';
const API='https://api.github.com/repos/michaeljwilliams0123/Ultron.MW';
const runId=process.argv[2];
if(!/^\d+$/.test(runId||'')){console.error('usage: ci-job-presence.mjs <runId>');process.exit(2);}
const headers={accept:'application/vnd.github+json','x-github-api-version':'2022-11-28'};
if(process.env.GITHUB_TOKEN)headers.authorization='Bearer '+process.env.GITHUB_TOKEN;
async function get(path){
  const response=await fetch(API+path,{headers});
  if(!response.ok)throw Error('GitHub '+response.status+' for '+path);
  return response.json();
}
const run=await get('/actions/runs/'+runId);
const jobs=await get('/actions/runs/'+runId+'/jobs?filter=all&per_page=100');
let pullRequest;
let number=run.pull_requests?.[0]?.number;
if(run.event==='pull_request'&&!number){
  // Closed PRs drop out of run.pull_requests; resolve from the exact head.
  const pulls=await get('/commits/'+run.head_sha+'/pulls');
  const same=pulls.filter(p=>p.head?.ref===run.head_branch);
  if(same.length===1)number=same[0].number;
}
if(run.event==='pull_request'&&number){
  pullRequest=await get('/pulls/'+number);
  // A later push moves the PR head; classify against the run's own head.
  if(pullRequest.head?.sha!==run.head_sha)pullRequest={...pullRequest,head:{...pullRequest.head,sha:run.head_sha}};
}
const annotations=[];
if(run.check_suite_id){
  // Service-side job-creation errors surface as check-suite annotations only
  // when a check run exists; absence of annotations is not evidence of health.
  const suite=await get('/check-suites/'+run.check_suite_id+'/check-runs?per_page=100').catch(()=>null);
  for(const check of suite?.check_runs||[])if(check.output?.annotations_count){
    const list=await get('/check-runs/'+check.id+'/annotations').catch(()=>[]);
    for(const a of list)annotations.push(a.message);
  }
}
const result=classifyVerifyRun({run,jobs,pullRequest,annotations});
console.log(JSON.stringify(result,null,2));
process.exitCode=result.state==='green'?0:1;
