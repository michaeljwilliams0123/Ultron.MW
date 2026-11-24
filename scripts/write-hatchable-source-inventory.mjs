#!/usr/bin/env node
import {writeFile,mkdir,appendFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {collectSourceFiles} from './check-hatchable-deployment-parity.mjs';
import {sourceInventory,sourceInventoryArtifactName} from '../cloud/hatchable/lib/independent-source-inventory.js';
import {buildGitHubVerificationReceipt} from './write-github-verification-receipt.mjs';
const observedSha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const identity=buildGitHubVerificationReceipt({observedSha});
if(identity.event!=='push'||identity.workflowRef!=='michaeljwilliams0123/Ultron.MW/.github/workflows/verify.yml@refs/heads/main'||!process.env.GITHUB_OUTPUT)throw Error('trusted-main-source-inventory-required');
const inventory=sourceInventory(collectSourceFiles({sha:observedSha}).map(f=>({path:f.path,hash:f.sha256})));
const name=sourceInventoryArtifactName({sourceSha:observedSha,digest:inventory.digest,count:inventory.count,attempt:identity.workflowRunAttempt});
const dest=resolve(process.argv[2]||'artifacts/hatchable-source-inventory.json');
await mkdir(dirname(dest),{recursive:true});
await writeFile(dest,JSON.stringify({schema:'ultron.hatchable-source-inventory.v1',sourceSha:observedSha,repository:identity.repository,workflowRunId:identity.workflowRunId,workflowRunAttempt:identity.workflowRunAttempt,sourceDigest:'sha256:'+inventory.digest,sourceFileCount:inventory.count,files:inventory.files},null,2)+'\n',{flag:'wx'});
await appendFile(process.env.GITHUB_OUTPUT,'artifact_name='+name+'\n');
console.log(JSON.stringify({sourceSha:observedSha,sourceDigest:inventory.digest,sourceFileCount:inventory.count}));
