import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {probeGithubOperator} from '../cloud/hatchable/lib/github-operator-probe.js';

const REPO='Ultron-MW/Ultron.MW', SHA='a'.repeat(40);
const ROOT='/repos/'+REPO;
const ALLOWED=new Set(['/user',ROOT,ROOT+'/git/ref/heads/main',
 ROOT+'/issues?state=open&per_page=1',
 ROOT+'/pulls?state=open&per_page=1',
 ROOT+'/actions/runs?branch=main&per_page=1']);

function fakeProvider(scenario){
 const calls=[];
 async function call(name,{method,path}={}){
  assert.equal(name,'github_operator');
  assert.equal(method,'GET');
  assert.ok(ALLOWED.has(path),'unexpected GitHub path '+path);
  calls.push(path);
  if(scenario.target==='setup'){
   if(scenario.effect==='typed'){const e=Error('missing');e.code='SetupRequired';throw e;}
   throw Error('gateway internal/api/call 412: API "github_operator" is not connected.');
  }
  if(scenario.target==='network')throw Error('gateway offline');
  const target=path==='/user'?'identity':path===ROOT?'repository':
   path.endsWith('/git/ref/heads/main')?'reference':
   path.includes('/issues?')?'issues':path.includes('/pulls?')?'pulls':'actions';
  const active=target===scenario.target;
  const effect=active?scenario.effect:'valid';
  if(effect==='throw')throw Error('token revoked or provider timeout');
  if(/^http\d+$/.test(effect))return {status:Number(effect.slice(4)),body:{message:'untrusted provider error'}};
  if(target==='identity'){
   const body={login:'michaeljwilliams0123ultron',id:354634860,type:'User',
    access_token:'SENSITIVE_MARKER_NEVER_RETURN'};
   if(effect==='wrong-login')body.login='other-user';
   if(effect==='wrong-case')body.login='Michaeljwilliams0123ultron';
   if(effect==='wrong-id')body.id=999;
   if(effect==='string-id')body.id='354634860';
   if(effect==='wrong-type')body.type='Bot';
   if(effect==='missing-login')delete body.login;
   if(effect==='missing-id')delete body.id;
   if(effect==='missing-type')delete body.type;
   return {status:200,body:effect==='malformed'?null:body};
  }
  if(target==='repository'){
   const body={id:1424939667,full_name:REPO,
    owner:{id:354776009,login:'Ultron-MW'},
    permissions:{push:true}};
   if(effect==='wrong-id')body.id=1;
   if(effect==='string-id')body.id='1424939667';
   if(effect==='wrong-full-name')body.full_name='michaeljwilliams0123/Ultron.MW';
   if(effect==='wrong-org-id')body.owner.id=3;
   if(effect==='string-org-id')body.owner.id='354776009';
   if(effect==='wrong-org-login')body.owner.login='other-org';
   if(effect==='missing-owner')delete body.owner;
   if(effect==='no-push')body.permissions.push=false;
   if(effect==='missing-permissions')delete body.permissions;
   return {status:200,body:effect==='malformed'?null:body};
  }
  if(target==='reference'){
   const body={ref:'refs/heads/main',object:{type:'commit',sha:SHA}};
   if(effect==='wrong-ref')body.ref='refs/heads/dev';
   if(effect==='tag-object')body.object.type='tag';
   if(effect==='uppercase-sha')body.object.sha='A'.repeat(40);
   if(effect==='short-sha')body.object.sha='abc';
   if(effect==='missing-sha')delete body.object.sha;
   return {status:200,body:effect==='malformed'?{}:body};
  }
  const body=target==='actions'?{workflow_runs:[]}:[];
  return {status:200,body:effect==='malformed'?{}:body};
 }
 return {call,calls};
}

const cases=[
 {name:'healthy',target:'',effect:'valid',state:'identity-and-repository-read-verified',coverage:'complete'},
 {name:'no-push-hint',target:'repository',effect:'no-push',state:'identity-and-repository-read-verified',coverage:'complete'},
 {name:'no-permission-field',target:'repository',effect:'missing-permissions',state:'identity-and-repository-read-verified',coverage:'complete'},
 {name:'unconnected-412',target:'setup',effect:'gateway',state:'setup-required'},
 {name:'unconnected-typed',target:'setup',effect:'typed',state:'setup-required'},
 {name:'provider-unavailable',target:'network',effect:'throw',state:'provider-readback-unavailable'},
 {name:'identity-401',target:'identity',effect:'http401',state:'principal-unverified'},
 {name:'identity-403',target:'identity',effect:'http403',state:'principal-unverified'},
 {name:'identity-429',target:'identity',effect:'http429',state:'principal-unverified'},
 {name:'identity-500',target:'identity',effect:'http500',state:'principal-unverified'},
 {name:'identity-malformed',target:'identity',effect:'malformed',state:'wrong-principal'},
 ...['wrong-login','wrong-case','wrong-id','string-id','wrong-type',
   'missing-login','missing-id','missing-type'].map(effect=>({
   name:'identity-'+effect,target:'identity',effect,state:'wrong-principal'})),
 ...['http401','http403','http404','http429','http500','wrong-id','string-id',
   'wrong-full-name','wrong-org-id','string-org-id','wrong-org-login',
   'missing-owner','malformed'].map(effect=>({
   name:'repository-'+effect,target:'repository',effect,state:'repository-unverified'})),
 {name:'repo-provider-throws',target:'repository',effect:'throw',state:'provider-readback-unavailable'},
 ...['http403','http404','http429','http500','wrong-ref','tag-object',
   'uppercase-sha','short-sha','missing-sha','malformed'].map(effect=>({
   name:'reference-'+effect,target:'reference',effect,state:'repository-unverified'})),
 {name:'reference-provider-throws',target:'reference',effect:'throw',state:'provider-readback-unavailable'},
 ...['issues','pulls','actions'].flatMap(target=>
  ['http401','http403','http404','http429','http500','malformed','throw'].map(effect=>({
   name:target+'-'+effect,target,effect,
   state:'identity-and-repository-read-verified',coverage:'partial'})))
];

for(const scenario of cases){
 test('OAUTH: '+scenario.name,async()=>{
  const {call,calls}=fakeProvider(scenario);
  const result=await probeGithubOperator(call);
  assert.equal(result.state,scenario.state);
  if(scenario.coverage)assert.equal(result.readCoverage,scenario.coverage);
  if(scenario.coverage==='partial'){
   const key=scenario.target==='pulls'?'pullRequests':scenario.target;
   assert.equal(result.readCapabilities[key],false);
  }
  if(scenario.name==='no-push-hint')assert.equal(result.providerPushFlag,false);
  if(scenario.state==='wrong-principal'||scenario.state==='principal-unverified')
   assert.deepEqual(calls,['/user'],'wrong actor cannot reach repo APIs');
  assert.notEqual(result.executionAuthorized,true);
  assert.notEqual(result.liveMutationVerified,true);
  assert.doesNotMatch(JSON.stringify(result),/SENSITIVE_MARKER_NEVER_RETURN|gh[pousr]_/);
  assert.ok(calls.every(path=>ALLOWED.has(path)));
 });
}
test('OAUTH: missing integration caller fails closed',async()=>{
 assert.deepEqual(await probeGithubOperator(),{state:'provider-readback-unavailable'});
});

test('OAUTH: manifest requires native platform consent and no embedded credentials',()=>{
 const manifest=readFileSync('cloud/hatchable/hatchable.toml','utf8');
 assert.match(manifest,/name\s*=\s*"github_operator"/);
 assert.match(manifest,/auth\s*=\s*"oauth2"/);
 assert.match(manifest,/scopes\s*=\s*\["read:user", "public_repo"\]/);
 assert.doesNotMatch(manifest,/gh[pousr]_[A-Za-z0-9]{15,}|-----BEGIN PRIVATE KEY-----/);
});

test('OAUTH: only owner can run the live read-only route and deterministic suite',()=>{
 for(const path of ['cloud/hatchable/api/brain/connectors.js',
                    'cloud/hatchable/api/brain/connector-regression.js']){
  const source=readFileSync(path,'utf8');
  assert.match(source,/export const access\s*=\s*'admin'/);
  assert.match(source,/export const methods\s*=\s*\['GET'\]/);
  assert.match(source,/req\.member\?\.handle\s*!==\s*OWNER/);
  assert.doesNotMatch(source,/['"]PATCH['"]|['"]PUT['"]|['"]DELETE['"]|gh[pousr]_[A-Za-z0-9]{15,}/);
 }
});

test('OAUTH: browser diagnostics expose no token sinks or fake write approvals',()=>{
 const html=readFileSync('cloud/hatchable/public/connectors.html','utf8');
 const js=readFileSync('cloud/hatchable/public/connectors.js','utf8');
 for(const id of ['run-tests','test-status','test-results','refresh','connections'])
  assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(js,/credentials:'same-origin'/);
 assert.match(js,/textContent/);
 assert.doesNotMatch(js,/innerHTML\s*=|localStorage|sessionStorage|document\.cookie|eval\(/);
 assert.match(html,/https:\/\/hatchable\.com\/connect\/callback/);
 assert.match(html,/michaeljwilliams0123ultron/);
});
