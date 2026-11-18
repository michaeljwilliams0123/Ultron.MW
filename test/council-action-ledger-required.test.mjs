import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const entry=fileURLToPath(new URL('../scripts/council-act.mjs',import.meta.url));

function invoke(t,{ledgerStatus,sourceSha='a'.repeat(40)}){
 const cwd=mkdtempSync(join(tmpdir(),'ultron-council-act-'));
 t.after(()=>rmSync(cwd,{force:true,recursive:true}));
 writeFileSync(join(cwd,'council-members.json'),JSON.stringify({
  ownerMode:true,hold:false,itemNumber:334,isPr:false,sourceSha,
  memberAssessments:[{identity:{role:'Steward'},actions:[{op:'issue.label',labels:['council-screened']}]}]
 }));
 const preload=join(cwd,'fake-fetch.mjs');
 writeFileSync(preload,`
  import {appendFileSync} from 'node:fs';
  globalThis.fetch=async raw=>{
   const url=new URL(raw);
   if(url.hostname==='test.invalid')return Response.json({value:'test-oidc'});
   appendFileSync('calls',url.pathname+'\\n');
   if(url.pathname==='/api/brain/council-ledger'){
    return Response.json({ok:${ledgerStatus}===200},{status:${ledgerStatus}});
   }
   return Response.json({ok:false,error:'stub-stops-before-credentials'},{status:403});
  };
 `);
 const {status,stderr}=spawnSync(process.execPath,['--import',preload,entry],{
  cwd,encoding:'utf8',timeout:5000,
  env:{ACTIONS_ID_TOKEN_REQUEST_URL:'https://test.invalid/oidc',
   ACTIONS_ID_TOKEN_REQUEST_TOKEN:'test-request',COUNCIL_LEDGER_REQUIRED:'false'}
 });
 let calls=[];
 try{calls=readFileSync(join(cwd,'calls'),'utf8').trim().split('\n');}
 catch(e){if(e.code!=='ENOENT')throw e;}
 return {status,stderr,calls};
}

test('durable ledger outage stops owner action before requesting credentials',t=>{
 const result=invoke(t,{ledgerStatus:503});
 assert.equal(result.status,1);
 assert.deepEqual(result.calls,['/api/brain/council-ledger']);
 assert.match(result.stderr,/council-ledger-required-but-unavailable/);
});

test('a healthy ledger allows credential exchange to begin',t=>{
 const result=invoke(t,{ledgerStatus:200});
 assert.deepEqual(result.calls,['/api/brain/council-ledger','/api/brain/council-act']);
 assert.match(result.stderr,/stub-stops-before-credentials/);
});

test('invalid source identity cannot fall back to an unledgered write',t=>{
 const result=invoke(t,{ledgerStatus:200,sourceSha:'invalid'});
 assert.equal(result.status,1);
 assert.deepEqual(result.calls,[]);
 assert.match(result.stderr,/council-action-context-invalid/);
});
