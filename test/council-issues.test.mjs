import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {collectIssuePortfolio,buildIssuePortfolio,inspectOpenIssue} from '../cloud/hatchable/lib/council-issues.js';

const ok=body=>({ok:true,status:200,json:async()=>body});
const issue=(n,extra={})=>({number:n,state:'open',title:'T'+n,body:'',labels:[],user:{login:'x'},...extra});

async function loadRoute(){
 const source=await readFile(new URL('../cloud/hatchable/api/brain/council-issues.js',import.meta.url),'utf8');
 const transformed=source.replace("import {collectIssuePortfolio} from 'lib/council-issues.js';",
  'const {collectIssuePortfolio}=globalThis.__councilIssuePortfolio;');
 assert.notEqual(transformed,source);
 return import('data:text/javascript;base64,'+Buffer.from(transformed).toString('base64')+'#'+Math.random());
}
function response(){
 return {code:200,headers:{},status(n){this.code=n;return this;},
  setHeader(k,v){this.headers[k]=v;},json(body){return {status:this.code,headers:this.headers,body};}};
}

test('portfolio is redacted, dependency-aware, and ignores pull requests',async()=>{
 const calls=[];
 const p=await collectIssuePortfolio({fetchGithub:async(url,init)=>{
  calls.push({url,init});
  return ok([issue(2,{body:'blocked by #1 token: ghp_'+'a'.repeat(30),labels:[{name:'bug'}]}),
   issue(1),issue(3,{pull_request:{}})]);
 }});
 assert.equal(calls.length,1);
 assert.equal(calls[0].init.method,'GET');
 assert.equal(calls[0].init.headers.Authorization,undefined);
 assert.deepEqual(p.issues.map(i=>[i.number,i.status]),[[1,'unblocked'],[2,'blocked']]);
 assert.deepEqual(p.issues[1].blockedBy,[1]);
 assert.deepEqual(p.issues[1].labels,['bug']);
 assert.ok(!JSON.stringify(p).includes('ghp_'));
 assert.equal(Object.hasOwn(p.issues[1],'excerpt'),false);
 assert.equal(p.advisoryOnly,true);
});

test('page cap truncates and failures are sanitized',async()=>{
 const full=Array.from({length:100},(_,i)=>issue(i+1));
 const p=await collectIssuePortfolio({fetchGithub:async()=>ok(full)});
 assert.equal(p.truncated,true);
 assert.ok(p.count<=150);
 await assert.rejects(collectIssuePortfolio({fetchGithub:async()=>({ok:false,status:403})}),/rate-limited-or-unauthorized/);
 await assert.rejects(collectIssuePortfolio({fetchGithub:async()=>{throw Error('secret')}}),/^Error: github-unreachable$/);
 assert.equal(buildIssuePortfolio([]).count,0);
});

test('blockers beyond the displayed issue limit still block dependent issues',()=>{
 const issues=[issue(1,{body:'depends on #151'}),
  ...Array.from({length:149},(_,i)=>issue(i+2)),issue(151)];
 const portfolio=buildIssuePortfolio(issues);
 const dependent=portfolio.issues.find(item=>item.number===1);
 assert.equal(portfolio.count,150);
 assert.equal(portfolio.truncated,true);
 assert.equal(dependent.status,'blocked');
 assert.deepEqual(dependent.blockedBy,[151]);
});

test('issue detail is re-read from the fixed repository and only open issues are accepted',async()=>{
 const calls=[];
 const result=await inspectOpenIssue(4,{fetchGithub:async(url,init)=>{
  calls.push({url,init});
  return ok(issue(4,{title:'Exact acceptance',body:'Require exact-head Verify token: ghp_'+'a'.repeat(30),
   labels:[{name:'acceptance'}]}));
 }});
 assert.equal(result.title,'Exact acceptance');
 assert.equal(result.excerpt.includes('ghp_'),false);
 assert.deepEqual(result.labels,['acceptance']);
 assert.ok(calls[0].url.startsWith('https://api.github.com/repos/michaeljwilliams0123/Ultron.MW/issues/4'));
 assert.equal(calls[0].init.headers.Authorization,undefined);
 await assert.rejects(inspectOpenIssue(4,{fetchGithub:async()=>ok(issue(4,{state:'closed'}))}),
  /issue-not-open-or-not-found/);
});

test('room exposes an explicit admin POST-only refresh action',async()=>{
 const api=await readFile(new URL('../cloud/hatchable/api/brain/council-issues.js',import.meta.url),'utf8');
 assert.match(api,/access='admin'/);
 assert.match(api,/methods=\['POST'\]/);
 assert.match(api,/req\.member\?\.handle!=='michaeljwilliams0123'/);
 assert.doesNotMatch(api,/vault|config|Authorization|method:\s*'PUT'|method:\s*'PATCH'|method:\s*'DELETE'/i);
 const html=await readFile(new URL('../cloud/hatchable/public/council-room.html',import.meta.url),'utf8');
 assert.match(html,/Refresh open issue inventory/);
 const ui=await readFile(new URL('../cloud/hatchable/public/council-room.js',import.meta.url),'utf8');
 assert.match(ui,/Plan with Council/);
 assert.match(ui,/ULTRON_ISSUE_REMEDIATION_V1/);
 assert.match(ui,/server must re-read GitHub/);
 assert.match(ui,/Review and send when ready/);
 assert.match(ui,/attachment-url/);
 assert.ok(html.indexOf('id="issue-card"')<html.indexOf('id="composer-body"'));
 assert.ok(html.indexOf('id="issue-refresh"')<html.indexOf('id="composer-body"'),
  'issue planner should remain visible above the composer on small screens');
});

test('issue API rejects missing and non-owner identities before GitHub reads',async()=>{
 globalThis.__councilIssuePortfolio={collectIssuePortfolio:async()=>{throw Error('must-not-run')}};
 try{
  const route=await loadRoute();
  for(const member of [undefined,{}, {handle:'other'}]){
   const result=await route.default({method:'POST',member},response());
   assert.equal(result.status,403);
   assert.equal(result.body.error,'owner-required');
  }
  const method=await route.default({method:'GET',member:{handle:'michaeljwilliams0123'}},response());
  assert.equal(method.status,405);
 }finally{delete globalThis.__councilIssuePortfolio}
});
