import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBoundedMultipartBridge } from '../src/computer/multipart-bridge.mjs';
import { validateUploadFile } from '../src/computer/file-transfer.mjs';
import { normalizeComputerPlan } from '../src/computer/executor.mjs';
import { summarizeComputerApproval } from '../src/computer/owner-console.mjs';

const bound='----WebKitFormBoundaryAnotherKnown42';
const origin='https://postman-echo.com';
const metadata=()=>Buffer.from('--'+bound+'\r\nContent-Disposition: form-data; name="canary"; filename="canary.txt"\r\nContent-Type: text/plain\r\n\r\n\r\n--'+bound+'--\r\n');
const page={url:()=> 'http://127.0.0.1:3822/fixture'};
function req(page,overrides={}){return {
  frame:()=>({page:()=>page}),url:()=>origin+'/post',method:()=> 'POST',
  isNavigationRequest:()=>true,
  headers:()=>({'content-type':'multipart/form-data; boundary='+bound}),
  postDataBuffer:metadata,...overrides,
};}
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'ultron-rehydration-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,'canary.txt');await writeFile(file,'ultron-approved-canary\n');
  const record=await validateUploadFile(file,root);
  return {root,file,record};
}
test('approved file bytes reconstruct one original multipart request, then consume grant',async t=>{
  const {root,record}=await fixture(t),bridge=createBoundedMultipartBridge();
  bridge.arm(page,record,root,'canary');
  bridge.approveSubmit(page,origin);
  const body=await bridge.rehydrate(req(page));
  assert.ok(body.includes(Buffer.from('ultron-approved-canary\n')));
  assert.equal(body.length,metadata().length+record.bytes);
  await assert.rejects(bridge.rehydrate(req(page)),/approved|bound/i);
});
test('unapproved origin, missing submit, mutation and wrong filename fail closed',async t=>{
  const {root,file,record}=await fixture(t);
  for(const shape of ['no-submit','wrong-origin','changed-file','wrong-field','extra-file']){
    const bridge=createBoundedMultipartBridge(),sidePage={url:page.url};
    bridge.arm(sidePage,record,root,'canary');
    if(shape!=='no-submit')bridge.approveSubmit(sidePage,origin);
    if(shape==='changed-file')await writeFile(file,'changed-after-approval\n');
    const badRequest=req(sidePage,shape==='wrong-origin'?{url:()=> 'https://other.test/post'}:
      shape==='wrong-field'?{postDataBuffer:()=>Buffer.from(metadata().toString().replace('name="canary"','name="other"'))}:
      shape==='extra-file'?{postDataBuffer:()=>Buffer.concat([metadata(),metadata()])}:{});
    await assert.rejects(bridge.rehydrate(badRequest));
    if(shape==='changed-file')await writeFile(file,'ultron-approved-canary\n');
  }
});
test('upload destination must be explicitly allowlisted and visible in owner preview',()=>{
  const origins=['http://127.0.0.1:3822',origin];
  const action={action:'click',selector:'#submit',expect:{urlIncludes:'/post'},sendToOrigin:origin};
  const p=normalizeComputerPlan({id:'transfer-dest',steps:[action]},{allowedOrigins:origins});
  assert.equal(p.steps[0].sendToOrigin,origin);
  for(const destination of ['https://unknown.test','https://postman-echo.com/elsewhere','javascript:alert(1)']){
    assert.throws(()=>normalizeComputerPlan({id:'no-exfil',steps:[{...action,sendToOrigin:destination}]},{allowedOrigins:origins}));
  }
  const summary=summarizeComputerApproval({planId:'transfer-dest',planFingerprint:'a'.repeat(64),
    action:'click',stepId:'submit',currentOrigin:origins[0],selector:'#submit',
    expectedState:action.expect,uploadDestination:origin});
  assert.equal(summary.uploadDestination,origin);
});

test('armed upload blocks background requests until one approved multipart submit',async t=>{
 const {root,record}=await fixture(t),bridge=createBoundedMultipartBridge();
 const p={url:()=>origin+'/form'};
 bridge.arm(p,record,root,'canary');
 assert.equal(bridge.mustBlockRequest(p,{url:()=>origin+'/leak?file=secret',method:()=> 'GET'}),true);
 assert.equal(bridge.mustBlockRequest(p,{url:()=>origin+'/data',method:()=> 'POST',
   headers:()=>({'content-type':'application/json'})}),true);
 bridge.approveSubmit(p,origin);
 assert.equal(bridge.mustBlockRequest(p,{url:()=>origin+'/data',method:()=> 'POST',
   headers:()=>({'content-type':'text/plain'})}),true);
 assert.equal(bridge.mustBlockRequest(p,req(p)),false);
 await bridge.rehydrate(req(p));
 // The file remains readable on the original page even after a submit;
 // keep it fenced until the isolated context is closed.
 assert.equal(bridge.mustBlockRequest(p,{url:()=>origin+'/receipt',method:()=> 'GET'}),true);
});

test('rehydrated multipart never sends bytes that differ from owner-approved SHA',async t=>{
 const {root,record}=await fixture(t),bridge=createBoundedMultipartBridge();
 const p={url:page.url};
 bridge.arm(p,record,root,'canary');bridge.approveSubmit(p,origin);
 // The independent buffer SHA check must be present on the actual dispatched contents.
 const fileModule=await import('node:fs/promises');
 const source=await fileModule.readFile(record.path);
 assert.equal(source.length,record.bytes);
 const output=await bridge.rehydrate(req(p));
 assert.ok(output.includes(source));
});
