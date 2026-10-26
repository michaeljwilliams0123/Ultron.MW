import {spawnSync} from 'node:child_process';
import {writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';

import {
 HELDOUT_CASE_IDS,evaluateHeldOutSource,heldOutScore
} from '../cloud/hatchable/lib/heldout-cases.js';

const SHA40=/^[a-f0-9]{40}$/;
function source(sha){
 const result=spawnSync('git',['show',sha+':cloud/hatchable/lib/acceptance-evidence.js'],
  {encoding:'utf8',maxBuffer:2*1024*1024});
 return result.status===0?result.stdout:'';
}
const baseline=process.env.ULTRON_BASELINE_SHA;
const candidate=process.env.ULTRON_CANDIDATE_SHA;
const seed=process.env.ULTRON_EVALUATION_SEED;
if(!SHA40.test(baseline||'')||!SHA40.test(candidate||'')||baseline===candidate||
   !/^\d{6,20}$/.test(seed||''))throw Error('invalid-heldout-evaluation-input');
const [before,after]=await Promise.all([
 evaluateHeldOutSource({source:source(baseline),seed,variant:'baseline'}),
 evaluateHeldOutSource({source:source(candidate),seed,variant:'candidate'})
]);
const report={schema:'ultron.seeded-held-out-report.v1',baseline,candidate,
 seedSource:'github.run_id',seed,caseIds:HELDOUT_CASE_IDS,
 baselineResults:before,candidateResults:after,baselineScore:heldOutScore(before),
 candidateScore:heldOutScore(after),candidateFailures:after.filter(x=>!x.passed).length};
const output=process.env.ULTRON_EVALUATION_REPORT||'artifacts/seeded-held-out.json';
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({schema:report.schema,baseline,candidate,
 baselineScore:report.baselineScore,candidateScore:report.candidateScore,
 candidateFailures:report.candidateFailures,caseCount:HELDOUT_CASE_IDS.length}));
if(report.candidateFailures||report.candidateScore<=report.baselineScore)process.exitCode=1;
