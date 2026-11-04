import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifyMahoragaIssueReadback} from '../cloud/hatchable/lib/mahoraga-actions.js';

const KEY='mission:c06:provider-readback-0001';
const REPO='michaeljwilliams0123/mahoraga';
const URL='https://github.com/'+REPO+'/issues/1190';
const TITLE='A real cross-repository mission repair';
const BODY='A scoped, non-paid GitHub issue change for live acceptance.';
const MARKER='<!-- ULTRON_MAHORAGA_CONTROL_V1 '+KEY+' -->';
const INTENT={title:TITLE,body:BODY,expectedMainSha:'a'.repeat(40)};

function fixture({actionState='observed',issuePatch={},repoPatch={},
 providerUnavailable=false,actionMissing=false}={}){
 const calls=[];
 const result={kind:'issue',number:1190,url:URL};
 const action={action_key:KEY,operation:'issue.create',state:actionState,
  request:INTENT,result};
 const issue={number:1190,title:TITLE,body:BODY+'\n\n'+MARKER,
  html_url:URL,...issuePatch};
 const repository={id:1343333190,full_name:REPO,private:true,...repoPatch};
 const db={async query(sql,params){
   assert.match(sql,/FROM mahoraga_actions/);
   assert.deepEqual(params,[KEY]);
   return {rows:actionMissing?[]:[action]};
 }};
 const config={async get(name){
   if(name==='ULTRON_MAHORAGA_CREDENTIAL_MODE')return 'pat';
   if(name==='ULTRON_MAHORAGA_CONNECTION1026')
    return 'github_pat_'+ 'TEST_ONLY_'.repeat(4);
   throw Error('unexpected-config:'+name);
 }};
 const transport=async(url,init)=>{
   calls.push({url,method:init.method,headers:init.headers});
   if(providerUnavailable)return {ok:false,status:503};
   if(url==='https://api.github.com/repos/'+REPO)
    return {ok:true,status:200,json:async()=>repository};
   if(url==='https://api.github.com/repos/'+REPO+'/issues/1190')
    return {ok:true,status:200,json:async()=>issue};
   throw Error('unexpected-provider-request:'+url);
 };
 return {db,config,transport,calls};
}

test('C06-EXT-01: actual provider issue number/title/body/marker/repo independently match durable action',async()=>{
 const h=fixture();
 const outcome=await verifyMahoragaIssueReadback(h,KEY);
 assert.equal(outcome.status,'verified');
 assert.equal(outcome.ok,true);
 assert.equal(outcome.issueNumber,1190);
 assert.equal(outcome.url,URL);
 assert.equal(outcome.provider,'github');
 assert.equal(outcome.productionAccepted,false);
 assert.deepEqual(h.calls.map(c=>c.method),['GET','GET']);
 assert.ok(h.calls.every(c=>c.url.startsWith('https://api.github.com/repos/'+REPO)));
 for(const c of h.calls)assert.ok(!JSON.stringify(c).includes('POST'));
});

test('C06-EXT-02: same-key readback stays read-only on repeated observations',async()=>{
 const h=fixture();
 for(let i=0;i<3;i++)assert.equal((await verifyMahoragaIssueReadback(h,KEY)).status,'verified');
 assert.equal(h.calls.length,6);
 assert.ok(h.calls.every(c=>c.method==='GET'));
});

test('C06-EXT-03: changed provider title/body/marker/number/url cannot create verified completion',async()=>{
 const patches=[
  {title:'Changed title'},
  {body:'Changed body\n\n'+MARKER},
  {body:BODY},
  {number:1191},
  {html_url:'https://github.com/michaeljwilliams0123/mahoraga/issues/1191'},
  {pull_request:{url:'https://api.github.com/pulls/1190'}},
 ];
 for(const issuePatch of patches){
  const h=fixture({issuePatch}),out=await verifyMahoragaIssueReadback(h,KEY);
  assert.equal(out.status,'held',JSON.stringify(issuePatch));
  assert.equal(out.reason,'github-postcondition-drift');
  assert.ok(h.calls.every(c=>c.method==='GET'));
 }
});

test('C06-EXT-04: wrong repository identity or provider outage fails closed without another write',async()=>{
 for(const h of [fixture({repoPatch:{id:1}}),
                  fixture({repoPatch:{private:false}}),
                  fixture({providerUnavailable:true})]){
  const out=await verifyMahoragaIssueReadback(h,KEY);
  assert.notEqual(out.status,'verified');
  assert.ok(h.calls.every(c=>c.method==='GET'));
 }
});

test('C06-EXT-05: absent/uncertain adapter receipt cannot be promoted to provider-verified',async()=>{
 for(const h of [fixture({actionMissing:true}),fixture({actionState:'uncertain'})]){
  const out=await verifyMahoragaIssueReadback(h,KEY);
  assert.equal(out.status,'held');
  assert.equal(h.calls.length,0,'provider contact must not mask missing action state');
 }
});

test('C06-EXT-06: invalid keys and unauthorized owner route cannot reach GitHub',async()=>{
 const h=fixture();
 assert.equal((await verifyMahoragaIssueReadback(h,'invalid')).status,'held');
 assert.equal(h.calls.length,0);
 const [api,deep]=await Promise.all([
  readFile(new globalThis.URL('../cloud/hatchable/api/brain/deep-verify.js',import.meta.url),'utf8'),
  readFile(new globalThis.URL('../cloud/hatchable/api/brain/deep.js',import.meta.url),'utf8')
 ]);
 assert.match(api,/export const access='admin'/);
 assert.match(api,/export const methods=\['GET'\]/);
 assert.match(api,/req\.member\?\.handle!=='michaeljwilliams0123'/);
 assert.match(api,/verifyMahoragaIssueReadback/);
 assert.match(deep,/req\.member\?\.handle!=='michaeljwilliams0123'/);
});
