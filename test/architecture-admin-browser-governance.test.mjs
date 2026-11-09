import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root=new URL('../docs/governance/',import.meta.url);
const read=name=>readFile(new URL(name,root),'utf8');

test('administrative browser blueprint extends one Hatchable authority rather than adding a new executor',async()=>{
 const docs=await read('OWNER-ADMIN-BROWSER-EXECUTION.md');
 for(const invariant of [
  'cloud/hatchable/lib/brain-core.js',
  '.github/workflows/council-worker.yml',
  'src/browser-action.mjs',
  'src/browser-external-write.mjs',
  'docs/OWNER-SOLE-AUTHORITY.md',
  'Hatchable',
  'PostgreSQL',
  'No retirements authorized'
 ])assert.ok(docs.includes(invariant),'missing '+invariant);
 assert.match(docs,/not runtime enforcement or deployed capability/);
 assert.match(docs,/not a general authenticated third-party SaaS browser/i);
});

test('architecture addendum rejects unsafe copied blueprint patterns',async()=>{
 const docs=await read('OWNER-ADMIN-BROWSER-EXECUTION.md');
 for(const hazard of [
  'Shell injection','Signature presence is not authorization',
  'MCP metadata is not a bearer grant','Regex isn\'t AST/IR',
  'No arbitrary browser origin','Page title is not effect proof',
  'Incomplete example code/tests','Privilege/deployment drift',
  'reconcile-required'
 ])assert.ok(docs.includes(hazard),'missing '+hazard);
 assert.match(docs,/signature.*P-256/s);
 assert.match(docs,/owner-approved provider\/session binding/);
 assert.match(docs,/no cookie\/log\/artifact disclosure/);
});

test('architecture decision and retirement register link the governance addendum',async()=>{
 const [decision,retirement]=await Promise.all([
  read('ARCHITECTURE-GOVERNANCE.md'),read('RETIREMENT-REGISTER.md')
 ]);
 assert.ok(decision.includes('OWNER-ADMIN-BROWSER-EXECUTION.md'));
 assert.ok(retirement.includes('OWNER-ADMIN-BROWSER-EXECUTION.md'));
 assert.ok(retirement.includes('KEEP'));
 assert.ok(retirement.includes('DEFER'));
 assert.ok(retirement.includes('taint_engine.ts'));
});

test('governance case matrix assigns negative cases to existing workstreams',async()=>{
 const docs=await read('OWNER-ADMIN-BROWSER-EXECUTION.md');
 for(let i=1;i<=10;i++)assert.match(docs,new RegExp('GB-'+String(i).padStart(2,'0')));
 for(const issue of ['#169','#187','#192','#204','#225','#285','#348','#349','#351']){
  assert.ok(docs.includes(issue),'missing existing issue '+issue);
 }
 assert.match(docs,/No retirements authorized/);
});
