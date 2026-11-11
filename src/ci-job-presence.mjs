// Issue #351: classify a "Ultron core verification" run by the jobs GitHub
// actually created, not by its aggregate conclusion alone. A run whose
// expected job is absent (never created) or unexpectedly skipped is
// `unknown-missing`: it is neither a test failure nor green evidence.
// Read-only; never reruns, relabels, or bypasses a required check.
const REPO='michaeljwilliams0123/Ultron.MW';
const SHA=/^[a-f0-9]{40}$/;
const FAILED=new Set(['failure','cancelled','timed_out','action_required','startup_failure']);
// Mirrors the attested-receipt `if:` in .github/workflows/verify.yml; the
// contract test in test/ci-job-presence.test.mjs fails if the two drift.
export const ATTESTED_PR_AUTHORS=Object.freeze([
  Object.freeze({login:'michaeljwilliams0123',id:308995719}),
  Object.freeze({login:'michaeljwilliams0123ultron',id:354634860}),
]);
export const VERIFY_WORKFLOW=Object.freeze({
  name:'Ultron core verification',path:'.github/workflows/verify.yml',
  jobs:Object.freeze(['test','attested-receipt','fixed-comparison']),
});
/** Jobs verify.yml must create (and not skip) for one event. */
export function expectedVerifyJobs({event,pullRequest}={}){
  if(event==='push')return['test','attested-receipt'];
  if(event==='workflow_dispatch')return['test'];
  if(event!=='pull_request')return null;
  const jobs=['test','fixed-comparison'];
  const pr=pullRequest||{};
  const sameRepo=pr.head?.repo?.full_name===REPO;
  const trusted=ATTESTED_PR_AUTHORS.some(a=>a.login===pr.user?.login&&a.id===pr.user?.id);
  if(sameRepo&&trusted)jobs.push('attested-receipt');
  return jobs;
}
// GitHub surfaces service-side job-creation failures only as a run-level
// annotation; see docs/verification/ISSUE351-MISSING-PR-JOBS-2026-11-10.md.
export function isServiceSideError(messages=[]){
  return (Array.isArray(messages)?messages:[]).some(m=>
    /\bInternal server error\b/i.test(String(m||'')));
}
function invalid(reason){return Object.freeze({schema:'ultron.ci-job-presence.v1',state:'invalid',reason});}
/**
 * @param run  GET /repos/{repo}/actions/runs/{id}
 * @param jobs GET /repos/{repo}/actions/runs/{id}/jobs?filter=all
 * @param pullRequest the PR payload (pull_request runs only)
 * @param annotations run-level annotation messages, if available
 */
export function classifyVerifyRun({run,jobs,pullRequest,annotations=[]}={}){
  // Identity is the workflow path: verify.yml's `run-name:` makes the API
  // `name` the PR title or commit message, so `name` is display-only here.
  if(!run||run.path!==VERIFY_WORKFLOW.path)
    return invalid('not an Ultron core verification run');
  if(!Number.isSafeInteger(run.id)||run.id<1||!SHA.test(run.head_sha||''))
    return invalid('run identity incomplete');
  if(!Array.isArray(jobs?.jobs)||!Number.isSafeInteger(jobs?.total_count)||
     jobs.total_count!==jobs.jobs.length)
    return invalid('job page incomplete'); // partial pages never prove absence
  const expected=expectedVerifyJobs({event:run.event,pullRequest});
  if(!expected)return invalid('unsupported event '+run.event);
  if(run.event==='pull_request'&&pullRequest?.head?.sha!==run.head_sha)
    return invalid('pull request head does not match run head');
  const attempt=run.run_attempt;
  const byName=new Map();
  for(const job of jobs.jobs)
    if(job?.run_attempt===undefined||job.run_attempt===attempt)byName.set(job?.name,job);
  const missing=expected.filter(n=>!byName.has(n));
  const skipped=expected.filter(n=>byName.get(n)?.conclusion==='skipped');
  const failed=expected.filter(n=>FAILED.has(byName.get(n)?.conclusion));
  const pending=expected.filter(n=>byName.has(n)&&byName.get(n).status!=='completed');
  const serviceError=isServiceSideError(annotations);
  let state,reason;
  if(failed.length){state='red';reason='expected job concluded '+failed.map(n=>n+'='+byName.get(n).conclusion).join(', ');}
  else if(run.status!=='completed'||pending.length){state='pending';reason='run or job not terminal';}
  else if(missing.length||skipped.length){state='unknown-missing';
    reason='expected job never created or skipped; not a test result and not green';}
  else if(run.conclusion==='success'){state='green';reason='all expected jobs created and succeeded';}
  else{state='unknown-missing';reason='aggregate '+run.conclusion+' with every expected job green';}
  return Object.freeze({
    schema:'ultron.ci-job-presence.v1',state,reason,
    runId:run.id,runAttempt:attempt,event:run.event,headSha:run.head_sha,
    aggregate:run.conclusion??null,
    expected:Object.freeze(expected),missing:Object.freeze(missing),
    skipped:Object.freeze(skipped),failed:Object.freeze(failed),
    serviceError,
    // GitHub refused rerun-failed-jobs on zero-job runs (403) during #351;
    // a fresh full run on the same exact head is the honest recovery.
    recovery:state==='unknown-missing'?'rerun-entire-workflow-on-same-head':null,
    runUrl:'https://github.com/'+REPO+'/actions/runs/'+run.id,
  });
}
