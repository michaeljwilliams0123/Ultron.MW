// Zero-paid, authenticated, strictly read-only GitHub data for cloud tasks.
// Only use the existing Hatchable github_operator OAuth binding. Never
// silently fall back to anonymous API requests when the binding is unavailable.
const API='https://api.github.com';
const ROOT='/repos/michaeljwilliams0123/Ultron.MW';
const SHA=/^[a-f0-9]{40}$/;
const RUN_ID=/^[1-9][0-9]{0,15}$/;
const SOURCES=new Set([
 '/repos/actions/checkout/releases/latest',
 '/repos/actions/setup-node/releases/latest',
 '/repos/actions/upload-artifact/releases/latest',
 '/repos/microsoft/playwright/releases/latest',
 '/repos/nodejs/node/releases/latest',
 '/repos/actions/cache/releases/latest'
]);
function invalid(){throw Error('github-read-out-of-scope');}
function queryFor(relative){
 if(typeof relative!=='string'||!relative.startsWith('/')||relative.startsWith('//')||
  relative.includes('://')||relative.includes('#')||relative.includes('%')||
  relative.includes('/./')||relative.includes('/../')||
  relative.includes('\\')||relative.length>480)invalid();
 const i=relative.indexOf('?');
 const path=i<0?relative:relative.slice(0,i);
 const raw=i<0?'':relative.slice(i+1);
 const params=new URLSearchParams(raw);
 const query=Object.create(null);
 for(const [key,value] of params){
  if(!key||Object.hasOwn(query,key))invalid();
  query[key]=value;
 }
 const keys=Object.keys(query);
 const exactly=(checks)=>{
  if(keys.length!==Object.keys(checks).length||
   !Object.entries(checks).every(([k,v])=>Object.hasOwn(query,k)&&v(query[k])))invalid();
 };
 if(path==='/git/ref/heads/main')exactly({});
 else if(path==='/pulls')exactly({
  state:v=>v==='open',per_page:v=>v==='12',
  sort:v=>v==='updated',direction:v=>v==='desc'
 });
 else if(path==='/actions/runs')exactly({
  head_sha:v=>SHA.test(v),per_page:v=>v==='12'
 });
 else if(/^\/actions\/runs\/[^/]+\/jobs$/.test(path)){
  const id=path.split('/')[3];
  if(!RUN_ID.test(id))invalid();
  exactly({per_page:v=>v==='100'});
 }else invalid();
 return {path:ROOT+path,query:Object.fromEntries(Object.entries(query))};
}
function upstreamURL(value){
 if(typeof value!=='string'||value.includes('%')||
  value.includes('\\')||value.includes('/../')||value.includes('/./'))invalid();
 let u;
 try{u=new URL(value);}catch{invalid();}
 if(u.origin!==API||u.username||u.password||u.hash||u.search||
  u.port||!SOURCES.has(u.pathname))invalid();
 return u.pathname;
}
function requireGet(options){
 if(options===null||typeof options!=='object'||Array.isArray(options)||
  (options.method!==undefined&&options.method!=='GET')||
  (options.body!==undefined&&options.body!==null))invalid();
}
export function createAuthenticatedBrainGithubRead({call}={}){
 async function providerGET(path,query){
  if(typeof call!=='function')throw Error('authenticated-github-readback-unavailable');
  let response;
  try{response=await call('github_operator',{
   method:'GET',path,...(query&&Object.keys(query).length?{query}:{})
  });}catch{throw Error('authenticated-github-readback-unavailable');}
  const status=Number(response?.status);
  if(!Number.isSafeInteger(status)||status<100||status>599)
   throw Error('authenticated-github-readback-unavailable');
  if(status===200&&(!response.body||typeof response.body!=='object'))
   throw Error('authenticated-github-readback-unavailable');
  return {status,body:response?.body,headers:response?.headers};
 }
 const readRepo=async relative=>{
  const {path,query}=queryFor(relative);
  const r=await providerGET(path,query);
  if(r.status!==200)throw Error('authenticated-github-readback-unavailable');
  return r.body;
 };
 const fetcher=async(url,options={})=>{
  requireGet(options);
  const path=upstreamURL(url);
  const r=await providerGET(path);
  const headers=r.headers&&typeof r.headers==='object'?r.headers:{};
  return {
   ok:r.status===200,status:r.status,
   headers:{get:key=>{
    if(typeof key!=='string')return null;
    const found=Object.entries(headers).find(([k])=>k.toLowerCase()===key.toLowerCase());
    return found&&found[1]!=null?String(found[1]):null;
   }},
   json:async()=>{
    if(r.status!==200||!r.body||typeof r.body!=='object')
     throw Error('authenticated-github-readback-unavailable');
    return r.body;
   }
  };
 };
 return Object.freeze({readRepo,fetcher});
}
