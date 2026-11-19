import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 readDeploymentReleaseReceipt,
} from '../../cloud/hatchable/lib/deployment-release-receipt.js';

const input={key:'deploy-v137-main',target:'hatchable-v137',
 sourceSha:'a'.repeat(40),artifactDigest:'sha256:'+'b'.repeat(64),
 manifestFileCount:255,independentReadback:true};

test('reconcile reads one exact grant-bound receipt and rejects ambiguity',async()=>{
 const row={receiptId:41,receiptKey:input.key,target:input.target,
  sourceSha:input.sourceSha,artifactDigest:input.artifactDigest,
  manifestFileCount:input.manifestFileCount,independentReadback:true,
  grantId:'owner-deploy-v137-main',profileVersion:8,stopVersion:5};
 const observed=await readDeploymentReleaseReceipt({db:{query:async()=>({rows:[row]})},
  request:input,grantId:row.grantId});
 assert.equal(observed.ok,true);assert.equal(observed.status,'observed');
 assert.equal(observed.receiptId,'41');
 const missing=await readDeploymentReleaseReceipt({
  db:{query:async()=>({rows:[]})},request:input,grantId:row.grantId});
 assert.equal(missing.status,'reconcile-required');
 const ambiguous=await readDeploymentReleaseReceipt({
  db:{query:async()=>({rows:[row,row]})},request:input,grantId:row.grantId});
 assert.equal(ambiguous.status,'held');assert.equal(ambiguous.reason,'receipt-ambiguous');
 const conflict=await readDeploymentReleaseReceipt({db:{query:async()=>({rows:[{
  ...row,target:'hatchable-v138'}]})},request:input,grantId:row.grantId});
 assert.equal(conflict.status,'held');assert.equal(conflict.reason,'receipt-conflict');
});

test('receipt route enforces owner, origin and exact mode bodies',async()=>{
 const source=readFileSync(new URL(
  '../../cloud/hatchable/api/brain/deployment-release-receipt.js',import.meta.url),'utf8');
 const hatchableUrl='data:text/javascript;base64,'+Buffer.from(
  'export const db={};export const config={};').toString('base64');
 const libUrl='data:text/javascript;base64,'+Buffer.from(`
  export async function prepareDeploymentReleaseReceipt(){return {ok:true,status:'prepared',marker:'prepare'}}
  export async function submitDeploymentReleaseReceipt(){return {ok:true,status:'observed',marker:'submit'}}
  export async function readDeploymentReleaseReceipt(){return {ok:true,status:'observed',marker:'reconcile'}}
 `).toString('base64');
 const route=await import('data:text/javascript;base64,'+Buffer.from(source
  .replace("'hatchable'",`'${hatchableUrl}'`)
  .replace("'lib/deployment-release-receipt.js'",`'${libUrl}'`))
  .toString('base64')+'#route');
 const invoke=async({member={handle:'michaeljwilliams0123'},headers={},body})=>{
  let code=0,payload=null;
  const res={setHeader(){},status(value){code=value;return this;},json(value){payload=value;return value;}};
  await route.default({member,headers,method:'POST',body},res);
  return {code,payload};
 };
 assert.equal((await invoke({member:{handle:'other'},body:{mode:'prepare',request:input}})).code,403);
 assert.equal((await invoke({headers:{origin:'https://example.invalid'},
  body:{mode:'prepare',request:input}})).code,403);
 assert.equal((await invoke({body:{mode:'prepare',request:input,extra:true}})).code,422);
 assert.equal((await invoke({body:Object.assign(Object.create({extra:true}),{
  mode:'prepare',request:input})})).code,422);
 const prepared=await invoke({body:{mode:'prepare',request:input}});
 assert.equal(prepared.code,200);assert.equal(prepared.payload.marker,'prepare');
 const submitted=await invoke({body:{mode:'submit',request:input,envelope:{}}});
 assert.equal(submitted.code,200);assert.equal(submitted.payload.marker,'submit');
 const reconciled=await invoke({body:{mode:'reconcile',request:input,
  grantId:'owner-deploy-v137-main'}});
 assert.equal(reconciled.code,200);assert.equal(reconciled.payload.marker,'reconcile');
});

test('release-proof route reads an exact-main deployment receipt instead of inventing one',()=>{
 const source=readFileSync(new URL(
  '../../cloud/hatchable/api/brain/release-proof.js',import.meta.url),'utf8');
 assert.match(source,/findDeploymentReleaseReceipt/);
 assert.match(source,/sourcePr:councilSource\.sourcePr,deployment/);
 assert.doesNotMatch(source,/sourcePr:councilSource\.sourcePr,deployment:\{\}/);
});
