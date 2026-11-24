import test from 'node:test';
import assert from 'node:assert/strict';
import {deploymentArtifactDigest} from '../cloud/hatchable/lib/deployment-release-receipt.js';
import {verifyLiveHatchableManifest} from '../cloud/hatchable/lib/hatchable-manifest-readback.js';

const files=[{path:'api/brain/release-proof.js',hash:'a'.repeat(64)},
 {path:'lib/hatchable-manifest-readback.js',hash:'b'.repeat(64)}];
const snap={version:141,status:'live',source_sha:'c'.repeat(40),file_manifest:files};
const receipt={target:'hatchable-v141',source_sha:'c'.repeat(40),
 artifact_digest:deploymentArtifactDigest(files),manifest_file_count:2};
const config={get:async name=>name==='ULTRON_HATCHABLE_API_TOKEN'?'test-no-real-secret':''};
const mcpBody={jsonrpc:'2.0',id:1,result:{content:[
 {type:'text',text:JSON.stringify(snap)}]}};

test('release reader requests authoritative Hatchable MCP get_deployment, not nonexistent REST',async()=>{
 let calls=0;
 const result=await verifyLiveHatchableManifest({deploymentRow:receipt,config,
  fetchImpl:async(url,options)=>{
   calls++;
   assert.equal(url,'https://hatchable.com/mcp');
   assert.equal(options.method,'POST');
   assert.equal(options.headers.Authorization,'Bearer test-no-real-secret');
   const request=JSON.parse(options.body);
   assert.equal(request.method,'tools/call');
   assert.deepEqual(request.params,{name:'get_deployment',arguments:{
    project_id:'proj_A6GCXRSKizko',version:141}});
   return {ok:true,status:200,text:async()=>JSON.stringify(mcpBody)};
  }});
 assert.equal(calls,1);
 assert.equal(result.verified,true);
 assert.equal(result.artifactDigest,receipt.artifact_digest);
 assert.equal(result.sourceSha,receipt.source_sha);
});
test('MCP Server-Sent Events response is parsed without accepting unrelated data',async()=>{
 const result=await verifyLiveHatchableManifest({deploymentRow:receipt,config,
  fetchImpl:async()=>({ok:true,status:200,text:async()=>
   'event: message\ndata: '+JSON.stringify(mcpBody)+'\n\n'})});
 assert.equal(result.verified,true);
});
test('wrong token, invalid MCP response and obsolete deployment stay held',async()=>{
 const unauthorized=await verifyLiveHatchableManifest({deploymentRow:receipt,config,
  fetchImpl:async()=>({ok:false,status:401})});
 assert.equal(unauthorized.verified,false);
 assert.equal(unauthorized.reason,'hatchable-manifest-http-401');
 const bad=await verifyLiveHatchableManifest({deploymentRow:receipt,config,
  fetchImpl:async()=>({ok:true,status:200,text:async()=>
   JSON.stringify({jsonrpc:'2.0',id:1,error:{code:-32600}})})});
 assert.equal(bad.verified,false);
 const old=await verifyLiveHatchableManifest({deploymentRow:receipt,config,
  fetchImpl:async()=>({ok:true,status:200,text:async()=>
   JSON.stringify({...mcpBody,result:{content:[{type:'text',
    text:JSON.stringify({...snap,status:'superseded'})}]}})})});
 assert.equal(old.verified,false);
 assert.equal(old.reason,'live-deployment-version-or-status-mismatch');
});
test('unbound or foreign live source cannot be certified as independent',async()=>{
 for(const source of [undefined,'d'.repeat(40)]){
  const current={...snap};
  if(source===undefined)delete current.source_sha;
  else current.source_sha=source;
  const response=await verifyLiveHatchableManifest({deploymentRow:receipt,config,
   fetchImpl:async()=>({ok:true,status:200,text:async()=>JSON.stringify({
    jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:JSON.stringify(current)}]}
   })})});
  assert.equal(response.verified,false);
  assert.equal(response.reason,'live-deployment-source-unverified');
 }
});
test('configured manifest endpoint cannot exfiltrate token to a different host',async()=>{
 let calls=0;
 const hostile={get:async name=>name==='ULTRON_HATCHABLE_API_TOKEN'
  ?'opaque-test-token':name==='HATCHABLE_DEPLOYMENT_API_URL'
  ?'https://another.example/mcp':''};
 const result=await verifyLiveHatchableManifest({deploymentRow:receipt,
  config:hostile,fetchImpl:async()=>{calls++;return {ok:false,status:401}}});
 assert.equal(result.verified,false);
 assert.equal(result.reason,'hatchable-manifest-url-invalid');
 assert.equal(calls,0);
});
