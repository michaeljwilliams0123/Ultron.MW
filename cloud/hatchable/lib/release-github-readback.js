// Read-only GitHub source proof for a squash-merged Council-approved PR.
// Never authorize execution or release from this data alone.
const API='https://api.github.com/repos/michaeljwilliams0123/Ultron.MW';
const SHA=/^[a-f0-9]{40}$/;
const NAME='ultron/council-7of7';
const REPO_ID=1424939667;
const FULL_NAME='michaeljwilliams0123/Ultron.MW';
const empty=()=>({sourcePr:null,councilCheck:null});

function sourceIsMergedTo(pr,mainSha){
 return pr&&Number.isSafeInteger(pr.number)&&pr.number>0&&
  pr.state==='closed'&&pr.draft===false&&
  typeof pr.merged_at==='string'&&Number.isFinite(Date.parse(pr.merged_at))&&
  pr.merge_commit_sha===mainSha&&SHA.test(pr.head?.sha||'')&&
  pr.base?.ref==='main'&&pr.base?.repo?.id===REPO_ID&&
  pr.head?.repo?.id===REPO_ID&&
  pr.base?.repo?.full_name===FULL_NAME&&pr.head?.repo?.full_name===FULL_NAME;
}

export async function collectMergedCouncilReadback({commitSha,fetchGithub=fetch}={}){
 if(!SHA.test(commitSha||''))return empty();
 async function read(path){
  const res=await fetchGithub(API+path,{method:'GET',cache:'no-store',
   headers:{Accept:'application/vnd.github+json','User-Agent':'UltronMW-ReleaseReadback'},
   signal:AbortSignal.timeout(7000)});
  if(!res?.ok||res.status!==200)throw Error('independent-github-readback-unavailable');
  const link=res.headers?.get?.('link');
  return {body:await res.json(),hasNext:typeof link==='string'&&/rel="?next"?/i.test(link)};
 }
 try{
  // Reject any ambiguous, incomplete or paginated PR association, including
  // unknown schema entries that must not be silently filtered away.
  const associated=await read('/commits/'+commitSha+'/pulls?per_page=100');
  if(associated.hasNext||!Array.isArray(associated.body)||
     associated.body.length!==1)return empty();
  const sourcePr=associated.body[0];
  if(!sourceIsMergedTo(sourcePr,commitSha))return empty();

  // Independently re-read the canonical PR, not only the commit association.
  // Inconsistent merge metadata or a changed source head is an uncertainty.
  const fresh=await read('/pulls/'+sourcePr.number);
  if(fresh.hasNext||!sourceIsMergedTo(fresh.body,commitSha)||
     fresh.body.head.sha!==sourcePr.head.sha)return empty();

  const checks=await read('/commits/'+sourcePr.head.sha+
   '/check-runs?check_name='+encodeURIComponent(NAME)+'&per_page=100');
  const rows=checks.body?.check_runs;
  if(checks.hasNext||!Array.isArray(rows)||
     !Number.isSafeInteger(checks.body?.total_count)||
     checks.body.total_count!==rows.length||rows.length===100)
   return empty();
  const candidates=rows.filter(check=>
   Number.isSafeInteger(check?.id)&&check.id>0&&
   check.name===NAME&&check.head_sha===sourcePr.head.sha);
  // A newer HOLD supersedes an older success, regardless of App identity.
  const latest=candidates.reduce((last,check)=>
   !last||check.id>last.id?check:last,null);

  // Re-read current main last: a merge during the lookup cannot be certified
  // using an old main CI/deployment observation.
  const current=await read('/git/ref/heads/main');
  if(current.hasNext||current.body?.object?.sha!==commitSha)return empty();
  return {sourcePr:fresh.body,councilCheck:latest};
 }catch{
  return empty();
 }
}
