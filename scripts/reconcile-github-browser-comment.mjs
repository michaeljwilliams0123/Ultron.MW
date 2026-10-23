#!/usr/bin/env node
import { readFile, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createFileComputerStore } from '../src/computer/file-store.mjs';
import { createGitHubCliOwnerVerifier } from '../src/computer/github-owner-verifier.mjs';
import { reconcileGithubCommentCheckpoint } from '../src/computer/github-comment-reconcile.mjs';

const exec = promisify(execFile);
const checkpointRoot = join(homedir(), '.ultron-mw', 'browser-checkpoints');
const planPath = process.argv[2];
const apply = process.argv.length === 4 && process.argv[3] === '--apply';
if (!planPath || (process.argv.length !== 3 && !apply))
  throw Error('Usage: node scripts/reconcile-github-browser-comment.mjs <original-private-plan.json> [--apply]');

const ownerLogin = process.env.ULTRON_COMPUTER_GITHUB_OWNER;
if (!await createGitHubCliOwnerVerifier({ownerLogin})())
  throw Error('Independent owner-authenticated GitHub CLI required for readback');

const input=JSON.parse(await readFile(resolve(planPath),'utf8'));
if (!input || Object.keys(input).some(k=>!['allowedOrigins','plan'].includes(k)))
  throw Error('Unexpected reconciliation plan properties');
const store = createFileComputerStore(checkpointRoot);

// GitHub REST read only. The repository and issue are constructed exclusively
// from the validated, checkpoint-fingerprint-bound plan, never shell-expanded.
async function readComments({repository,issue}) {
  const route='repos/'+repository+'/issues/'+issue+'/comments?per_page=100';
  const {stdout}=await exec('gh',
    ['api','-X','GET','--paginate','--slurp',route],
    {timeout:20000,maxBuffer:2*1024*1024,windowsHide:true});
  const pages=JSON.parse(stdout);
  if (!Array.isArray(pages) || !pages.every(Array.isArray))
    throw Error('GitHub returned nonpaginated or incomplete readback');
  return pages.flat();
}
await store.withLock(input.plan.id,async()=>{
  const reconcile=async()=>reconcileGithubCommentCheckpoint({
    plan:input.plan,allowedOrigins:input.allowedOrigins,
    store,ownerLogin,readComments,apply,
  });
  // Verify provider proof before creating any checkpoint backup.
  const preview=await reconcileGithubCommentCheckpoint({
    plan:input.plan,allowedOrigins:input.allowedOrigins,
    store,ownerLogin,readComments,apply:false,
  });
  if (preview.status==='completed') {
    process.stdout.write(JSON.stringify({status:'completed',alreadyReconciled:true,
      browserActionReplayed:false,checkpointUpdated:false})+'\n');
    return;
  }
  if (preview.status!=='reconciliation-ready') {
    process.stdout.write(JSON.stringify({status:preview.status,
      reason:preview.reason||'No authorized pending change',writes:0})+'\n');
    process.exitCode=2;
    return;
  }
  if (!apply) {
    process.stdout.write(JSON.stringify({status:preview.status,
      commentId:preview.reconciliation.commentId,
      commentUrl:preview.reconciliation.commentUrl,checkpointUpdated:false,
      browserActionReplayed:false})+'\n');
    return;
  }
  const id=input.plan.id;
  const original=join(checkpointRoot,id+'.json');
  const backup=join(checkpointRoot,id+'.pre-github-reconciliation.json');
  await copyFile(original,backup,constants.COPYFILE_EXCL);
  const result=await reconcile();
  process.stdout.write(JSON.stringify({
    status:result.status,commentId:result.reconciliation?.commentId||null,
    originalCheckpointPreserved:true,checkpointUpdated:result.status==='completed',
    browserActionReplayed:false,
  })+'\n');
  if(result.status!=='completed')process.exitCode=2;
});
