import test from 'node:test';
import assert from 'node:assert/strict';
import {collectLiveChecks} from '../scripts/live-acceptance-audit.mjs';
import {evaluateAcceptance} from '../src/live-acceptance-audit.mjs';

const SHA='a'.repeat(40);
const ORIGIN='https://michaeljwilliams0123.github.io';
const CLOUD='https://ultron-mw-cloud.hatchable.site';
const valid={schema:'ultron.cloud-status.v1',ok:true,status:'active',
 observedAt:'2026-10-29T12:00:00Z',lastEventAt:null,
 scheduler:'hourly-configured',ownerOperations:'protected'};

async function collect({status=200,body=valid,allowOrigin=ORIGIN,
 foreignAllow=null,unavailable=false}={}){
 const previous=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{
  calls.push({url,options});
  const reply=(value,code=200,headers={})=>new Response(
   typeof value==='string'?value:JSON.stringify(value),{status:code,headers});
  if(url.endsWith('/commits/main'))return reply({sha:SHA});
  if(url.includes('/actions/workflows/verify.yml/runs'))return reply({workflow_runs:[
   {id:18,head_sha:SHA,event:'push',status:'completed',conclusion:'success'}]});
  if(url===ORIGIN+'/Ultron.MW/')return reply('<meta name="ultron-source-sha" content="'+SHA+'">');
  if(url===ORIGIN+'/Ultron.MW/app.js')return reply('/* module fixture */');
  if(url===CLOUD+'/')return reply('Ultron');
  if(url===CLOUD+'/api/brain/control')return reply('denied',401);
  if(url===CLOUD+'/api/brain/tick')return reply('denied',404);
  if(url===CLOUD+'/api/brain/status-public'){
   if(unavailable)throw Error('fixture-unavailable');
   const allowed=options.headers.origin===ORIGIN?allowOrigin:foreignAllow;
   return reply(body,status,allowed?{'access-control-allow-origin':allowed}:{});
  }
  throw Error('unexpected-fixture-url');
 };
 try{return {input:await collectLiveChecks(),calls};}
 finally{globalThis.fetch=previous;}
}
const find=(input,id)=>input.checks.find(check=>check.id===id);

test('public audit requires valid cloud status and both trusted/foreign origin checks',async()=>{
 const {input,calls}=await collect();
 for(const id of ['production-cloud-status','production-cloud-cors','production-cloud-foreign-origin'])
  assert.equal(find(input,id)?.status,'pass',id);
 const report=evaluateAcceptance(input);
 assert.equal(report.counts.passed,11);
 assert.equal(report.publicReadiness,'observed-healthy');
 assert.equal(report.productionReadiness,'not-accepted');
 const cloudCalls=calls.filter(call=>call.url.startsWith(CLOUD));
 assert.equal(cloudCalls.filter(call=>call.url.endsWith('/status-public')).length,2);
 for(const {options} of cloudCalls){
  assert.equal(options.headers.authorization,undefined,'never send GitHub credentials to Hatchable');
  assert.equal(options.method??'GET','GET');
 }
});

test('HTTP 200 with malformed cloud status cannot leave the public audit healthy',async()=>{
 for(const body of [{...valid,schema:'wrong'},'<html>Sign in</html>',
  {...valid,ownerOperations:'public'}, {...valid,observedAt:'invalid-date'}]){
  const {input}=await collect({body});
  assert.equal(find(input,'production-cloud-status')?.status,'fail');
  assert.equal(evaluateAcceptance(input).publicReadiness,'degraded');
 }
});

test('an unavailable cloud backend is reported as unknown instead of passing',async()=>{
 const {input}=await collect({unavailable:true});
 for(const id of ['production-cloud-status','production-cloud-cors','production-cloud-foreign-origin'])
  assert.equal(find(input,id)?.status,'unknown');
 assert.equal(evaluateAcceptance(input).publicReadiness,'incomplete');
});

test('a real cloud status failure is degraded even while the landing page works',async()=>{
 const {input}=await collect({status:503,body:{ok:false}});
 assert.equal(find(input,'production-http')?.status,'pass');
 assert.equal(find(input,'production-cloud-status')?.status,'fail');
 assert.equal(evaluateAcceptance(input).publicReadiness,'degraded');
});

test('missing or wildcard trusted-origin access fails the UI cloud bridge check',async()=>{
 for(const allowOrigin of [null,'*','https://unrelated.invalid']){
  const {input}=await collect({allowOrigin});
  assert.equal(find(input,'production-cloud-cors')?.status,'fail');
  assert.equal(evaluateAcceptance(input).publicReadiness,'degraded');
 }
});

test('a foreign-origin allow header cannot pass the public isolation check',async()=>{
 for(const foreignAllow of ['*',ORIGIN,'https://ultron-audit.invalid']){
  const {input}=await collect({foreignAllow});
  assert.equal(find(input,'production-cloud-foreign-origin')?.status,'fail');
  assert.equal(evaluateAcceptance(input).publicReadiness,'degraded');
 }
});
