import { githubRequest } from '../src/cloud-pr.mjs';
import { publishTelemetry } from '../src/observability.mjs';
const ROOT='/repos/michaeljwilliams0123/Ultron.MW';
let event={kind:'ci-heartbeat',state:'unknown',sha:process.env.GITHUB_SHA};
try {
  const data=await githubRequest(ROOT+'/actions/runs?per_page=30');
  if(!Array.isArray(data?.workflow_runs))throw Error('CI inventory unavailable');
  const runs=data.workflow_runs.filter(x=>x.head_branch==='main');
  const completed=runs.filter(x=>x.status==='completed');
  event={...event,state:'succeeded',runId:completed[0]?.id,
    checksSucceeded:completed.filter(x=>x.conclusion==='success').length,
    checksFailed:completed.filter(x=>x.conclusion==='failure').length};
} catch { event={...event,state:'unknown'}; }
const receipt=await publishTelemetry(event);
console.log('Ultron CI observation: '+receipt.state);
if(event.state==='unknown')process.exitCode=1;
