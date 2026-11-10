#!/usr/bin/env node
/** Fast, fixed-command source smoke checks. Never used as release approval. */
import {spawnSync} from 'node:child_process';
const source=['src/autonomous-repair-loop.mjs',
 'src/autonomous-repair-postgres-ledger.mjs',
 'src/autonomous-repair-github-adapter.mjs',
 'src/autonomous-repair-model-adapter.mjs'];
const tests=['test/autonomous-repair-loop.test.mjs',
 'test/autonomous-repair-postgres-ledger.test.mjs',
 'test/autonomous-repair-github-adapter.test.mjs',
 'test/autonomous-repair-model-adapter.test.mjs'];
function run(args,timeout){
 const result=spawnSync(process.execPath,args,{
  cwd:new URL('../',import.meta.url).pathname,encoding:'utf8',
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
