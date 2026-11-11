import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as engine from '../src/engine/master-pipeline.mjs';
import * as script from '../scripts/run-canary-pipeline.mjs';

const PUBLIC=['runMasterPipeline','createCanaryCommitOperation',
  'createCanaryLineageVerifier','loadLiveDependencies'];
const root=fileURLToPath(new URL('../',import.meta.url));
const moduleUrl=new URL('../src/engine/master-pipeline.mjs',import.meta.url).href;
const scriptPath=fileURLToPath(new URL('../scripts/run-canary-pipeline.mjs',import.meta.url));

function node(args){
  const result=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:20000});
  if(result.error)throw result.error;
  return result;
}

test('src/engine/master-pipeline.mjs exports the four pipeline functions',()=>{
  for(const name of PUBLIC)assert.equal(typeof engine[name],'function',name);
});

test('scripts/run-canary-pipeline.mjs re-exports identical function references',()=>{
  for(const name of PUBLIC)assert.equal(script[name],engine[name],name);
  assert.deepEqual(Object.keys(script).sort(),[...PUBLIC].sort());
});

test('importing the module has no side effects on argv, exit or exitCode',()=>{
  const probe=`
    const argv=JSON.stringify(process.argv);
    process.exit=()=>{throw Error('exit-called');};
    const m=await import(${JSON.stringify(moduleUrl)});
    if(JSON.stringify(process.argv)!==argv)throw Error('argv-changed');
    if(process.exitCode!==undefined)throw Error('exitCode-set');
    const deps=await m.loadLiveDependencies();
    const names=Object.keys(deps).sort().join(',');
    if(names!=='createVerifiedGitHubClient,dispatchHeadlessTask,enforceSignedApprovalAndTagPersona,executeIdempotentGitHubWrite,verifyPostConditionsAndStoreReceipt')
      throw Error('deps-'+names);
    for(const fn of Object.values(deps))if(typeof fn!=='function')throw Error('dep-not-function');
    console.log('ok');`;
  const result=node(['--input-type=module','-e',probe,'--','--request','x.json']);
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout.trim(),'ok');
  assert.equal(result.stderr,'');
});

test('CLI entrypoint keeps its fail-closed behaviour',()=>{
  const usage=node([scriptPath]);
  assert.equal(usage.status,1);
  assert.equal(usage.stderr.trim(),'canary-usage--request-FILE');
});
