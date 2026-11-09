import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateScopedBrowserInput,
  runScopedBrowserTask,
} from '../src/mcp/playwright_scoped_runner.mjs';

const TARGET = 'https://example.test/settings';
const origin = 'https://example.test';
const params = {
  targetUrl: TARGET,
  allowedOrigin: origin,
  actionSelector: 'role=button[name="Save settings"]',
  actionType: 'click',
};
const state = {
  cookies: [{ name:'session', value:'not-a-real-token', domain:'example.test', path:'/', secure:true, httpOnly:true, sameSite:'Lax', expires:-1 }],
  origins:[{origin, localStorage:[{name:'theme',value:'dark'}]}],
};

function fakeBrowser({ startUrl=TARGET, status=200, count=1, loginOk=true, onAct, failGoto=false, afterUrl=TARGET, type='text' }={}) {
  const metrics={ launched:0, contextCreated:0, contextsClosed:0, browsersClosed:0, clicks:0, fills:[], locatorSelectors:[], routes:[] };
  let currentUrl=startUrl;
  const locator={
    count:async()=>count,
    elementHandle:async()=>locator,
    isVisible:async()=>true,
    click:async opts=>{ if(!opts?.trial){ metrics.clicks++;currentUrl=afterUrl;await onAct?.();}},
    fill:async v=>{metrics.fills.push(v);currentUrl=afterUrl;await onAct?.();},
    getAttribute:async attr=>attr==='type'?type:null,
  };
  const page={
    url:()=>currentUrl,
    goto:async target=>{if(failGoto)throw Error('navigation failed');currentUrl=target;return {status:()=>status};},
    getByRole:(role,{name,exact})=>{metrics.locatorSelectors.push(['role',role,name,exact]);return locator;},
    getByLabel:(label,{exact})=>{metrics.locatorSelectors.push(['label',label,exact]);return locator;},
    waitForLoadState:async()=>{},
  };
  const context={
    route:async(pattern,handler)=>{metrics.routes.push(['http',pattern]);metrics.handler=handler;},
    routeWebSocket:async(pattern,handler)=>{metrics.routes.push(['ws',pattern]);metrics.wsHandler=handler;},
    newPage:async()=>page,
    close:async()=>{metrics.contextsClosed++;},
    on:()=>{},
    storageState:async()=>state,
  };
  const browser={newContext:async args=>{metrics.contextCreated++;metrics.args=args;return context;},close:async()=>{metrics.browsersClosed++;}};
  const chromium={launch:async()=>{metrics.launched++;return browser;}};
  return {chromium,metrics,page,context,validSession:async()=>loginOk};
}
const opts=(b,more={})=>({chromium:b.chromium, authorizeAction:async()=>true, validateSession:b.validSession, revokeSession:async()=>{}, ...more});

// RED: no implementation exists until the new runner is committed.
test('rejects mismatched origin, credentials in URL, plain HTTP, and noncanonical origin',()=>{
  for(const p of [
    {...params,targetUrl:'https://different.test'},
    {...params,targetUrl:'https://user:pw@example.test/'},
    {...params,targetUrl:'http://example.test/'},
    {...params,allowedOrigin:'https://example.test/path'},
  ]) assert.throws(()=>validateScopedBrowserInput(p),/ORIGIN_VIOLATION|INVALID_ORIGIN/);
});
test('rejects any cookie or origin outside exact permitted host; never launches',async()=>{
  for(const s of [
    {...state,cookies:[{...state.cookies[0],domain:'.example.test'}]},
    {...state,cookies:[{...state.cookies[0],domain:'tracker.test'}]},
    {...state,cookies:[{...state.cookies[0],partitionKey:'https://tracker.test'}]},
    {...state,origins:[{origin:'https://tracker.test',localStorage:[]}]},
  ]){
    const b=fakeBrowser();
    await assert.rejects(runScopedBrowserTask(params,JSON.stringify(s),opts(b)),/STORAGE_STATE_VIOLATION/);
    assert.equal(b.metrics.launched,0);
  }
});
test('requires explicit owner authorization even without restored state',async()=>{
  const b=fakeBrowser();
  await assert.rejects(runScopedBrowserTask(params,undefined,{chromium:b.chromium}),/APPROVAL_REQUIRED/);
  assert.equal(b.metrics.launched,0);
  await assert.rejects(runScopedBrowserTask(params,undefined,opts(b,{authorizeAction:async()=>false})),/APPROVAL_DENIED/);
  assert.equal(b.metrics.clicks,0);
  assert.equal(b.metrics.contextsClosed,1);
});
test('restored cookies require a validator and revocation callback',async()=>{
  const b=fakeBrowser();
  await assert.rejects(runScopedBrowserTask(params,JSON.stringify(state),{chromium:b.chromium,authorizeAction:async()=>true}),/SESSION_VALIDATOR_REQUIRED/);
  await assert.rejects(runScopedBrowserTask(params,JSON.stringify(state),{chromium:b.chromium,authorizeAction:async()=>true,validateSession:b.validSession}),/SESSION_REVOCATION_HANDLER_REQUIRED/);
  assert.equal(b.metrics.launched,0);
});
test('uses exact accessible role name, fresh context, and network fence',async()=>{
  const b=fakeBrowser();
  const result=await runScopedBrowserTask(params,JSON.stringify(state),opts(b));
  assert.deepEqual(result,{success:true,finalUrl:TARGET});
  assert.deepEqual(b.metrics.locatorSelectors,[['role','button','Save settings',true]]);
  assert.equal(b.metrics.clicks,1);
  assert.equal(b.metrics.contextsClosed,1);
  assert.equal(b.metrics.browsersClosed,1);
  assert.equal(b.metrics.args.serviceWorkers,'block');
  assert.deepEqual(b.metrics.args.storageState,state);
  assert.deepEqual(b.metrics.routes,[['http','**/*'],['ws','**/*']]);
});
test('blocks cross-origin HTTP request and WebSocket after page opens',async()=>{
  const b=fakeBrowser();
  await runScopedBrowserTask(params,undefined,opts(b));
  let aborted=false,continued=false;
  await b.metrics.handler({request:()=>({url:()=> 'https://attacker.test/steal',method:()=> 'GET'}),abort:async()=>{aborted=true;},continue:async()=>{continued=true;}});
  assert.equal(aborted,true);assert.equal(continued,false);
  let closed=false;
  await b.metrics.wsHandler({url:()=> 'wss://attacker.test/ws',close:()=>{closed=true;}});
  assert.equal(closed,true);
});
test('does not accept raw CSS selectors or nonunique targets',async()=>{
  assert.throws(()=>validateScopedBrowserInput({...params,actionSelector:'#save'}),/ACCESSIBLE_TARGET_REQUIRED/);
  const b=fakeBrowser({count:2});
  await assert.rejects(runScopedBrowserTask(params,undefined,opts(b)),/TARGET_NOT_UNIQUE/);
  assert.equal(b.metrics.clicks,0);
});
test('supports accessible label and empty-string fill, but rejects passwords',async()=>{
  const fill={...params,actionType:'fill',actionSelector:'label=Display name',fillValue:''};
  const b=fakeBrowser();
  await runScopedBrowserTask(fill,undefined,opts(b));
  assert.deepEqual(b.metrics.fills,['']);
  assert.deepEqual(b.metrics.locatorSelectors,[['label','Display name',true]]);
  const secret=fakeBrowser({type:'password'});
  await assert.rejects(runScopedBrowserTask(fill,undefined,opts(secret)),/CREDENTIAL_TARGET_DENIED/);
});
test('detects rejected or expired state, revokes saved state, never clicks',async()=>{
  const b=fakeBrowser({loginOk:false});let revoked=[];
  await assert.rejects(runScopedBrowserTask(params,JSON.stringify(state),opts(b,{revokeSession:async o=>{revoked.push(o);}})),/SESSION_REVOKED/);
  assert.deepEqual(revoked,[origin]); assert.equal(b.metrics.clicks,0);
});
test('refuses a cross-origin final URL and always cleans up',async()=>{
  const b=fakeBrowser({afterUrl:'https://different.test/redirect'});
  await assert.rejects(runScopedBrowserTask(params,undefined,opts(b)),/ORIGIN_VIOLATION/);
  assert.equal(b.metrics.contextsClosed,1);
  assert.equal(b.metrics.browsersClosed,1);
});
test('closes context and browser on navigation failures',async()=>{
  const b=fakeBrowser({failGoto:true});
  await assert.rejects(runScopedBrowserTask(params,undefined,opts(b)),/navigation failed/);
  assert.equal(b.metrics.contextsClosed,1);
  assert.equal(b.metrics.browsersClosed,1);
});
