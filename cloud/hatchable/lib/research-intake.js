/**
 * C09 public research intake. Only six fixed primary GitHub release endpoints,
 * with explicit observed pinned versions and no authority to act on source text.
 * Never executes instructions in release notes and never issues provider writes.
 */
export const RESEARCH_SOURCES=Object.freeze([
 {repository:'actions/checkout',pinnedVersion:'v7.0.1',component:'GitHub workflow checkout'},
 {repository:'actions/setup-node',pinnedVersion:'v7.1.0',component:'GitHub workflow Node runtime'},
 {repository:'actions/upload-artifact',pinnedVersion:'v4.6.2',component:'GitHub workflow artifact persistence'},
 {repository:'microsoft/playwright',pinnedVersion:'v1.65.0',component:'Cloud browser worker'},
 {repository:'nodejs/node',pinnedVersion:'v22',component:'GitHub Actions pinned Node major'},
 {repository:'actions/cache',pinnedVersion:'v6.1.0',component:'GitHub workflow caching'}
].map(x=>Object.freeze(x)));
const TAG=/^v[0-9]{1,3}(?:\.[0-9]{1,3}){0,2}$/;
const DATE=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const HEADERS=Object.freeze({accept:'application/vnd.github+json',
 'user-agent':'UltronMW-Primary-Research'});
function score(source,tag){
 const major=Number(tag.slice(1).split('.')[0]);
 const old=Number(source.pinnedVersion.slice(1).split('.')[0]);
 return major>old?70:85;
}
function observe(source,value,now){
 const base={repository:source.repository,component:source.component,
   pinnedVersion:source.pinnedVersion,costCents:0};
 if(!value||typeof value!=='object'||value.draft!==false||value.prerelease!==false||
    !TAG.test(value.tag_name||'')||!DATE.test(value.published_at||''))return {
   ...base,status:'suppressed',reason:'source-invalid'};
 const tag=value.tag_name,ms=Date.parse(value.published_at);
 const sourceUrl='https://github.com/'+source.repository+'/releases/tag/'+tag;
 if(!Number.isFinite(ms)||value.html_url!==sourceUrl||ms>now.getTime()+5*60000)
   return {...base,status:'suppressed',reason:'source-invalid'};
 const ageDays=Math.max(0,Math.floor((now.getTime()-ms)/86400000));
 const versionMatch=tag===source.pinnedVersion ||
   (source.repository==='nodejs/node'&&tag.startsWith(source.pinnedVersion+'.'));
 const extra={...base,version:tag,sourceUrl,publishedAt:value.published_at,
  observedAt:now.toISOString(),ageDays};
 if(versionMatch)return {...extra,status:'suppressed',reason:'already-pinned'};
 if(ageDays>180)return {...extra,status:'suppressed',reason:'stale-source'};
 return {...extra,status:'candidate',reason:'version-drift-review-only',
  priority:score(source,tag),risk:score(source,tag)===70?'major-version':'version-review'};
}
export async function collectResearchIntake({now=new Date(),fetcher=fetch}={}){
 if(!(now instanceof Date)||!Number.isFinite(now.getTime())||
   typeof fetcher!=='function')throw Error('research-intake-input-invalid');
 const observations=await Promise.all(RESEARCH_SOURCES.map(async source=>{
  const url='https://api.github.com/repos/'+source.repository+'/releases/latest';
  try{
   const r=await fetcher(url,{method:'GET',headers:HEADERS,
     redirect:'error',signal:AbortSignal.timeout(6500)});
   if(!r?.ok||r.status!==200)return {repository:source.repository,
     component:source.component,pinnedVersion:source.pinnedVersion,
     status:'suppressed',reason:'source-unavailable',costCents:0};
   const length=r.headers?.get?.('content-length');
   if(length&&(!/^\d+$/.test(length)||Number(length)>196608))
     throw Error('research-response-too-large');
   const body=await r.json();
   return observe(source,body,now);
  }catch{
   return {repository:source.repository,component:source.component,
    pinnedVersion:source.pinnedVersion,status:'suppressed',
    reason:'source-unavailable',costCents:0};
  }
 }));
 const actionableCount=observations.filter(x=>x.status==='candidate').length;
 return {objective:'research.intake',at:now.toISOString(),
  source:'github-release-primary',paidCents:0,sourceCount:observations.length,
  actionableCount,suppressedCount:observations.length-actionableCount,
  reviewRequired:actionableCount>0,observations};
}
