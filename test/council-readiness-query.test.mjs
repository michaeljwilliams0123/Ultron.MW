import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {COUNCIL_TABLES} from '../cloud/hatchable/lib/council-wiring.js';

test('readiness limits catalog query to required Council tables and reports missing tables', async () => {
 const route=new URL('../cloud/hatchable/api/brain/council-readiness.js',import.meta.url);
 const wiring=new URL('../cloud/hatchable/lib/council-wiring.js',import.meta.url);
 const original=await readFile(route,'utf8');
 const source=original.replace("import {db} from 'hatchable';","const db=globalThis.__readinessTestDb;")
  .replace("'lib/council-wiring.js'",JSON.stringify(wiring.href))
  .replace("import {CAPABILITIES} from 'lib/brain-core.js';","const CAPABILITIES=[];");
 const missing=COUNCIL_TABLES[0];
 let calls=0;
 globalThis.__readinessTestDb={query:async(sql,params)=>{
  calls++;
  if(!/table_name\s*=\s*ANY\(\$1::text\[\]\)/i.test(sql)||
     !Array.isArray(params)||params.length!==1||
     JSON.stringify(params[0])!==JSON.stringify(COUNCIL_TABLES))
   throw Error('SQLSTATE 57014: unbounded catalog scan timed out');
  return {rows:COUNCIL_TABLES.filter(t=>t!==missing).map(table_name=>({table_name}))};
 }};
 try {
  const {default:handler,access,methods}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  assert.equal(access,'admin');
  assert.deepEqual(methods,['GET']);
  let status,body;
  const res={setHeader(){},status(code){status=code;return this;},json(value){body=value;return this;}};
  await handler({},res);
  assert.equal(status,200);
  assert.equal(calls,1);
  assert.deepEqual(body.missingTables,[missing]);
  assert.equal(body.readyForProduction,false);
 } finally {delete globalThis.__readinessTestDb;}
});
