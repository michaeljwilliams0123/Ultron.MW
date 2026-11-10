#!/usr/bin/env node
/** Fast, fixed-command source smoke checks. Never used as release approval. */
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const source=['src/autonomous-repair-loop.mjs',
 'src/autonomous-repair-postgres-ledger.mjs',
 'src/autonomous-repair-github-adapter.mjs',
 'src/pr-brain-verify.mjs',
 'src/autonomous-repair-model-adapter.mjs',
 'cloud/hatchable/lib/autonomous-repair-status.js',
 'cloud/hatchable/public/repair-operations.js',
 'cloud/hatchable/api/brain/autonomous-repairs.js',
 'scripts/autonomous-repair-canary.mjs'];
const tests=['test/autonomous-repair-loop.test.mjs',
 'test/autonomous-repair-postgres-ledger.test.mjs',
 'test/autonomous-repair-github-adapter.test.mjs',
 'test/autonomous-repair-ci-correlation.test.mjs',
 'test/autonomous-repair-model-adapter.test.mjs',
 'test/autonomous-repair-console.test.mjs',
 'test/autonomous-repair-console-dom.test.mjs',
 'test/autonomous-repair-restart-faults.test.mjs',
 'test/autonomous-repair-canary.test.mjs'];
function run(args,timeout){
 const result=spawnSync(process.execPath,args,{
  cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8',
  timeout,maxBuffer:1048576,windowsHide:true,shell:false,
  env:{PATH:process.env.PATH,HOME:process.env.HOME,
   NODE_ENV:'test',CI:process.env.CI||'false'}
 });
 if(result.stdout)process.stdout.write(result.stdout);
 if(result.stderr)process.stderr.write(result.stderr);
 if(result.error||result.status!==0)process.exit(result.status||1);
}
for(const path of source)run(['--check',path],10000);
run(['--test',...tests],90000);
console.log('Fast smoke passed. Exact-head GitHub Verify remains mandatory.');
