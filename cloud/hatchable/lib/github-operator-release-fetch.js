// Read-only, authenticated GitHub REST adapter for release evidence.
// Uses Hatchable's existing github_operator OAuth proxy; no app-held tokens.
// Never silently fall back to GitHub's 60/hr anonymous rate limit.
const API_ORIGIN='https://api.github.com';
const ROOT='/repos/michaeljwilliams0123/Ultron.MW';
const SHA='[a-f0-9]{40}';
const ID='[1-9][0-9]{0,15}';
const ROUTES=[
 /^\/repos\/michaeljwilliams0123\/Ultron\.MW\/git\/ref\/heads\/main$/,
 /^\/repos\/michaeljwilliams0123\/Ultron\.MW\/pulls$/,
 new RegExp('^'+ROOT.replaceAll('.','\\.')+'/pulls/'+ID+'$'),
 new RegExp('^'+ROOT.replaceAll('.','\\.')+'/commits/'+SHA+'/pulls$'),
 new RegExp('^'+ROOT.replaceAll('.','\\.')+'/commits/'+SHA+'/check-runs$'),
 new RegExp('^'+ROOT.replaceAll('.','\\.')+'/compare/'+SHA+'\\.\\.\\.'+SHA+'$'),
 /^\/repos\/michaeljwilliams0123\/Ultron\.MW\/actions\/workflows\/verify\.yml\/runs$/,
 new RegExp('^'+ROOT.replaceAll('.','\\.')+'/actions/runs/'+ID+'/(jobs|artifacts)$')
];
const validQuery=(name,value)=>{
 switch(name){
  case 'per_page': return /^[1-9][0-9]{0,2}$/.test(value)&&Number(value)<=100;
  case 'page': return /^[1-9][0-9]{0,5}$/.test(value);
  case 'state': return value==='open';
  case 'sort': return value==='updated';
  case 'direction': return value==='desc';
  case 'branch': return value==='main';
  case 'head_sha': return /^[a-f0-9]{40}$/.test(value);
  case 'event': return value==='push';
  case 'check_name': return value==='ultron/council-7of7';
  case 'filter': return value==='all';
  default: return false;
 }
};

export function createAuthenticatedGithubReleaseFetch({call}={}){
 return async function readGithub(url,options={}){
  if(typeof call!=='function')throw Error('authenticated-github-readback-unavailable');
  let u;
  try{u=new URL(String(url));}catch{throw Error('github-read-url-out-of-scope');}
  // Exact read endpoints only: reject encoded traversal, foreign repositories,
  // arbitrary provider APIs and every method capable of mutation.
  if(u.origin!==API_ORIGIN||u.username||u.password||u.hash||u.port||
   u.pathname.includes('%')||!ROUTES.some(route=>route.test(u.pathname))||
   (options.method!==undefined&&options.method!=='GET')||
   (options.body!==undefined&&options.body!==null))
   throw Error('github-read-url-out-of-scope');
  const query={};
  for(const [name,value] of u.searchParams){
   if(!validQuery(name,value)||Object.hasOwn(query,name))
    throw Error('github-read-url-out-of-scope');
   query[name]=value;
  }
  let upstream;
  try{
   upstream=await call('github_operator',{
    method:'GET',path:u.pathname,
    ...(Object.keys(query).length?{query}:{})
   });
  }catch{
   throw Error('authenticated-github-readback-unavailable');
  }
  const status=Number(upstream?.status);
  if(!Number.isSafeInteger(status)||status<100||status>599)
   throw Error('authenticated-github-readback-unavailable');
  const headers=upstream?.headers&&typeof upstream.headers==='object'
   ?upstream.headers:{};
  return {
   ok:status===200,status,
   headers:{get:key=>{
    if(typeof key!=='string')return null;
    const matched=Object.entries(headers).find(([name])=>
     name.toLowerCase()===key.toLowerCase());
    return matched&&matched[1]!==null&&matched[1]!==undefined
     ?String(matched[1]):null;
   }},
   json:async()=>{
    if(status!==200||!upstream.body||typeof upstream.body!=='object')
     throw Error('authenticated-github-readback-unavailable');
    return upstream.body;
   }
  };
 };
}
