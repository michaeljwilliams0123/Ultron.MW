/** Independently reverify a previously generated C06 source/test/docs artifact.
 * No model execution, network writes or credential access. Git refs are checked
 * read-only. Caller MUST use this again in the separate write-capable job.
 */
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {C06_PATHS,verifyC06Files} from '../src/c06-model-origin.mjs';
import {admitC06Replay,C06_REPLAY_PINNED_PATHS,C06_REPLAY_OUTPUT_PATHS,hasNovelC06Outputs} from '../src/c06-replay-admission.mjs';
const SHA=/^[a-f0-9]{40}$/;
const RUN=/^[1-9][0-9]{0,19}$/;
const sourceSha=process.env.ULTRON_C06_REPLAY_SOURCE_SHA;
const runId=process.env.ULTRON_C06_REPLAY_RUN_ID;
const checkout=process.env.GITHUB_SHA;
if(!SHA.test(sourceSha||'')||!SHA.test(checkout||'')||
 !RUN.test(runId||''))throw Error('c06-replay-invalid-input');
function git(args,allowOne=false){
 const result=spawnSync('git',args,{encoding:'utf8',timeout:7000,
  maxBuffer:16384,windowsHide:true});
 if(result.error||!Number.isInteger(result.status)||
   (result.status!==0&&!(allowOne&&result.status===1)))
  throw Error('c06-replay-git-read-failed: '+args[0]);
 return result;
}
const main=git(['rev-parse','refs/remotes/origin/main']).stdout.trim();
const current=git(['rev-parse','HEAD']).stdout.trim();
if(!SHA.test(main)||main!==checkout||current!==checkout)
 throw Error('c06-replay-main-moved-reconcile');
const ancestry=git(['merge-base','--is-ancestor',sourceSha,main],true);
const changed=git(['diff','--name-only',sourceSha,main,'--',
 ...C06_REPLAY_PINNED_PATHS]).stdout.trim();
const branch='ultron/c06-model-'+runId;
const existing=git(['ls-remote','--heads','origin','refs/heads/'+branch]).stdout.trim();
const files={};
for(const path of Object.values(C06_PATHS))
 files[path]=await readFile(join('c06-output',path),'utf8');
const receipt=verifyC06Files(files,{sourceSha,runId});
// Existing model files are expected after earlier protected releases.
// Compare byte-for-byte against the independently verified artifact instead
// of blocking every future corrected model output solely due to path existence.
const existingFiles={};
for(const path of C06_REPLAY_OUTPUT_PATHS){
 try{existingFiles[path]=await readFile(path,'utf8');}
 catch(error){if(error?.code!=='ENOENT')throw Error('c06-replay-existing-file-unavailable');}
}
const isNovel=hasNovelC06Outputs(existingFiles,files);
const admission=admitC06Replay({
 repository:process.env.GITHUB_REPOSITORY,actor:process.env.GITHUB_ACTOR,
 publicRepository:process.env.ULTRON_REPOSITORY_PUBLIC==='true',
 paidBudgetCents:Number(process.env.ULTRON_PAID_BUDGET_CENTS),
 sourceSha,mainSha:main,runId,
 isOriginalAncestor:ancestry.status===0,
 changedModelToolchainPaths:changed?changed.split('\n'):[],
 alreadyPublished:!!existing||!isNovel
});
console.log(JSON.stringify({schema:'ultron.c06.model-replay-verified.v1',
 originSha:admission.originSha,mainSha:admission.mainSha,runId,
 branch:admission.branch,receiptDigest:receipt.receiptDigest,
 files:receipt.paths,productionAccepted:false,paidCents:0,
 modelWasRerun:false}));
