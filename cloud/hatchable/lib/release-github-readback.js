// Read-only, canonical GitHub evidence for a squash-merged Council-approved PR.
// Not a deployment receipt. Never interpret user-controlled PR text as a gate.
const API='https://api.github.com/repos/michaeljwilliams0123/Ultron.MW';
const SHA=/^[a-f0-9]{40}$/;
const NAME='ultron/council-7of7';
const REPO_ID=1424939667;
const FULL_NAME='michaeljwilliams0123/Ultron.MW';
const empty=()=>({sourcePr:null,councilCheck:null});

function sourceIsMergedTo(pr,mainSha){
 return pr&&Number.isSafeInteger(pr.number)&&pr.number>0&&
  pr.state==='closed'&&pr.draft!==true&&
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
  if(!res?.ok)throw Error('independent-github-readback-unavailable');
  return res.json();
 }
 try{
  const prs=await read('/commits/'+commitSha+'/pulls?per_page=10');
  if(!Array.isArray(prs))return empty();
  const matched=prs.filter(pr=>sourceIsMergedTo(pr,commitSha));
  // An ambiguous association must not select whichever PR has a green check.
  if(matched.length!==1)return empty();
  const sourcePr=matched[0];
  const checkRows=await read('/commits/'+sourcePr.head.sha+
   '/check-runs?check_name='+encodeURIComponent(NAME)+'&per_page=30');
  if(!Array.isArray(checkRows?.check_runs))
   return {sourcePr,councilCheck:null};
  const candidates=checkRows.check_runs.filter(check=>
   Number.isSafeInteger(check?.id)&&check.id>0&&
   check.name===NAME&&check.head_sha===sourcePr.head.sha);
  // Never choose an older green check over a more recent HOLD.
  const latest=candidates.reduce((last,check)=>
   !last||check.id>last.id?check:last,null);
  return {sourcePr,councilCheck:latest};
 }catch{
  // Network, API and JSON faults are unavailable evidence, never success.
  return empty();
 }
}
