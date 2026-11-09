/** Owner-scoped browser interactions executed in a fresh GitHub-hosted Playwright
 * context. Browser action evidence proves a DOM postcondition, not an external
 * third-party write; authenticated workflows require a separately scoped session. */
const OWNED=new Set(['ultron-mw-cloud.hatchable.site','michaeljwilliams0123.github.io']);
const SELECTOR=/^#[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const HIDDEN=/(?:password|passcode|secret|private[_ -]?key|api[_ -]?key|bearer\s+|gh[pousr]_[A-Za-z0-9_]{12,})/i;
export function browserActionUrl(raw){
 let u;
 try{u=new URL(raw);}catch{throw Error('browser-action-url-invalid');}
 if(u.protocol!=='https:'||u.username||u.password||u.port||
  !OWNED.has(u.hostname.toLowerCase())||u.hash)throw Error('browser-action-origin-denied');
 return u;
}
function exactKeys(o,keys){
 return o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).sort().join(',')===[...keys].sort().join(',');
}
export function parseBrowserAction(params){
 if(!exactKeys(params,['url','steps','expect']))throw Error('browser-action-shape-invalid');
 const url=browserActionUrl(params.url);
 const steps=params.steps;
 if(!Array.isArray(steps)||steps.length<1||steps.length>6)throw Error('browser-action-steps-invalid');
 const normalized=steps.map(step=>{
  if(!step||typeof step!=='object'||Array.isArray(step)||
    !SELECTOR.test(step.selector||''))throw Error('browser-action-selector-invalid');
  if(step.kind==='click'&&exactKeys(step,['kind','selector']))
   return Object.freeze({kind:'click',selector:step.selector});
  if(step.kind==='fill'&&exactKeys(step,['kind','selector','value'])&&
   typeof step.value==='string'&&step.value.length>0&&step.value.length<=160&&
   !HIDDEN.test(step.value)&&!/[\u0000-\u001f]/.test(step.value))
   return Object.freeze({kind:'fill',selector:step.selector,value:step.value});
  throw Error('browser-action-step-invalid');
 });
 if(!exactKeys(params.expect,['selector','contains'])||
  !SELECTOR.test(params.expect.selector||'')||
  typeof params.expect.contains!=='string'||params.expect.contains.length<1||
  params.expect.contains.length>160||HIDDEN.test(params.expect.contains))
  throw Error('browser-action-postcondition-invalid');
 return Object.freeze({url:url.toString(),origin:url.origin,steps:Object.freeze(normalized),
  expect:Object.freeze({...params.expect})});
}
export async function executeBrowserAction(plan,browser){
 if(!browser||typeof browser.open!=='function')throw Error('browser-action-adapter-unavailable');
 const session=await browser.open(plan.url,plan.origin);
 if(!session||typeof session.read!=='function'||typeof session.perform!=='function'||
  typeof session.close!=='function')throw Error('browser-action-session-invalid');
 try{
  const before=String(await session.read(plan.expect.selector)).slice(0,1200);
  for(const step of plan.steps)await session.perform(step);
  const after=String(await session.read(plan.expect.selector)).slice(0,1200);
  const reread=String(await session.read(plan.expect.selector)).slice(0,1200);
  const finalUrl=await session.url();
  const sameOrigin=browserActionUrl(finalUrl).origin===plan.origin;
  const changed=after!==before;
  const matched=after.includes(plan.expect.contains)&&reread===after;
  return {ok:sameOrigin&&changed&&matched,url:plan.url,finalUrl,
   before:before.slice(0,240),after:after.slice(0,240),
   evidence:'isolated-browser-dom-postcondition-double-read',
   checks:{sameOrigin,changed,matched}};
 }finally{await session.close();}
}
