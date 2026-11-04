/** Publish-stage checks: hash/lineage verification only. NEVER execute model code
 * in the write-capable GitHub job. Model source was scored in separate read-only job.
 */
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {C06_PATHS,verifyC06Files} from '../src/c06-model-origin.mjs';

const dir='c06-output';
const files={};
for(const path of Object.values(C06_PATHS)){
 files[path]=await readFile(join(dir,path),'utf8');
}
const result=verifyC06Files(files,{
 sourceSha:process.env.GITHUB_SHA,
 runId:process.env.GITHUB_RUN_ID
});
if(process.env.GITHUB_REPOSITORY!=='michaeljwilliams0123/Ultron.MW'||
 process.env.GITHUB_ACTOR!=='michaeljwilliams0123'||
 process.env.ULTRON_REPOSITORY_PUBLIC!=='true'||
 process.env.ULTRON_PAID_BUDGET_CENTS!=='0')
 throw Error('c06-publish-admission-denied');
console.log(JSON.stringify({schema:'ultron.c06.publish-verification.v1',
 valid:result.valid,sourceSha:result.sourceSha,runId:result.runId,
 receiptDigest:result.receiptDigest,paths:result.paths,
 productionAccepted:false}));
