// Read-only, authenticated GitHub REST adapter for release evidence.
// Uses Hatchable's existing github_operator OAuth proxy; never accesses tokens.
// Fail closed rather than falling back to GitHub's 60/hr anonymous limit.
const API_ORIGIN='https://api.github.com';
const REPO_PATH='/repos/michaeljwilliams0123/Ultron.MW';
const ALLOWED_QUERY=new Set(['per_page','page','state','sort','direction','branch',
 'event','check_name','filter']);
const validQueryValue=v=>typeof v==='string'&&v.length>0&&v.length<=160&&
 /^[a-zA-Z0-9._\/-]+$/.test(v);

export function createAuthenticatedGithubReleaseFetch({call}={}){
 return async function readGithub(url,options={}){
  if(typeof call!=='function')throw Error('authenticated-github-readback-unavailable');
  let u;
  try{u=new URL(String(url));}catch{throw Error('github-read-url-out-of-scope');}
  if(u.origin!==API_ORIGIN||!u.pathname.startsWith(REPO_PATH+'/')||
   u.username||u.password||u.hash||u.port||
   (options.method!==undefined&&options.method!=='GET')||
   (options.body!==undefined&&options.body!==null))
   throw Error('github-read-url-out-of-scope');
  const query={};
  for(const [name,value] of u.searchParams){
   if(!ALLOWED_QUERY.has(name)||!validQueryValue(value)||
      Object.hasOwn(query,name))
    throw Error('github-read-url-out-of-scope');
   query[name]=value;
  }
  const upstream=await call('github_operator',{
   method:'GET',path:u.pathname,
   ...(Object.keys(query).length?{query}:{})
  });
  const status=Number(upstream?.status);
  if(!Number.isSafeInteger(status)||status<100||status>599)
   throw Error('authenticated-github-readback-unavailable');
  const headers=upstream?.headers&&typeof upstream.headers==='object'
   ?upstream.headers:{};
  return {
   ok:status>=200&&status<300,status,
   headers:{get:key=>{
    if(typeof key!=='string')return null;
    const matched=Object.entries(headers).find(([name])=>
     name.toLowerCase()===key.toLowerCase());
    return typeof matched?.[1]==='string'?matched[1]:null;
   }},
   json:async()=>upstream.body
  };
 };
}
