import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeComputerPlan} from '../src/computer/executor.mjs';
import {createPlaywrightComputerDriver} from '../src/computer/playwright-driver.mjs';
const origin='https://example.test';
function page(url,ctx){
  return {url:()=>url,context:()=>ctx,locator:()=>({innerText:async()=>url,ariaSnapshot:async()=>url,count:async()=>0}),title:async()=>url,
    goto:async x=>{url=x;},bringToFront:async()=>{},close:async()=>{ctx.closed=true}};
}
test('bounded window steps refuse unknown names, foreign origins, extra properties',()=>{
  const steps=[
    {action:'navigate',url:origin+'/main'},
    {action:'window-open',windowId:'window-secondary',url:origin+'/new'},
    {action:'window-switch',windowId:'primary'},
    {action:'window-switch',windowId:'window-secondary'},
    {action:'window-close',windowId:'window-secondary'}
  ];
  assert.equal(normalizeComputerPlan({id:'window-plan',steps},{allowedOrigins:[origin]}).steps.length,5);
  for (const bad of [
    {action:'window-open',windowId:'window-rogue',url:origin},
    {action:'window-open',windowId:'window-secondary',url:'https://elsewhere.test'},
    {action:'window-close',windowId:'primary'},
    {action:'window-open',windowId:'window-secondary',url:origin,elevate:true},
  ]) assert.throws(()=>normalizeComputerPlan({id:'window-plan',steps:[bad]},{allowedOrigins:[origin]}));
});
test('independent authorized window context opens, switches, closes, no arbitrary window admission',async()=>{
  const primaryContext={close:async()=>{throw Error('Do not close primary')}};
  const secondaryContext={closed:false,close:async()=>{secondaryContext.closed=true}};
  const first=page(origin+'/main',primaryContext),second=page('about:blank',secondaryContext);
  const driver=createPlaywrightComputerDriver(first,{windows:{'window-secondary':second}});
  await assert.rejects(driver.perform({action:'window-switch',windowId:'window-secondary'}),/unopened/);
  await driver.perform({action:'window-open',windowId:'window-secondary',url:origin+'/window'});
  assert.equal((await driver.observe()).url,origin+'/window');
  await driver.perform({action:'window-switch',windowId:'primary'});
  assert.equal((await driver.observe()).url,origin+'/main');
  await driver.perform({action:'window-close',windowId:'window-secondary'});
  assert.equal(secondaryContext.closed,true);
  assert.equal((await driver.observe()).url,origin+'/main');
  await assert.rejects(driver.perform({action:'window-switch',windowId:'window-secondary'}),/unavailable/);
});
test('cannot admit windows in the primary context',()=>{
  const ctx={};
  const a=page(origin+'/a',ctx),b=page(origin+'/b',ctx);
  assert.throws(()=>createPlaywrightComputerDriver(a,{windows:{'window-secondary':b}}),/preallocated/);
});
