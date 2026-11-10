import {createHash} from 'node:crypto';
import {applyPrPatch} from './pr-brain-patch.mjs';
import {dispatchAndObserveVerify,observeVerifyRun} from './pr-brain-verify.mjs';

/**
 * Reuse the existing exact-context GitHub PR patch and exact-head CI engines.
 * The caller MUST supply a trusted installation-scoped get/post/updateRef
 * transport, owner step grant and a PREEXISTING authorized repair branch.
 * None of the credentials come from model text or task _meta.
 */
const REPO='Ultron-MW/Ultron.MW',ROOT='/repos/'+REPO;
const SHA=/^[a-f0-9]{40}$/;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function repairCorrelation(plan,attempt){
 if(!/^[a-f0-9]{64}$/.test(plan?.fingerprint||'')||
    !Number.isInteger(attempt)||attempt<1||attempt>3)
  throw Error('autonomous-repair-correlation-invalid');
 return 'repair-'+plan.fingerprint+'-'+attempt;
}
function content(file){
 if(file?.encoding!=='base64'||typeof file?.content!=='string')
  throw Error('autonomous-repair-source-unavailable');
 return Buffer.from(file.content.replace(/\s/g,''),'base64').toString('utf8');
}
function branchRef(plan){return ROOT+'/git/ref/heads/'+plan.branch;}
function githubPR(plan,headSha){
 return {head:{ref:plan.branch,sha:headSha,repo:{full_name:REPO}},
  base:{ref:'main'}};
}
async function observeBranch(get,plan){
 const ref=await get(branchRef(plan));
 const sha=ref?.object?.sha;
 if(ref?.ref!=='refs/heads/'+plan.branch||!SHA.test(sha||''))
  throw Error('autonomous-repair-branch-readback-invalid');
 return sha;
}
async function existingPR(get,plan){
 const list=await get(ROOT+'/pulls?state=all&head=Ultron-MW:'+
  encodeURIComponent(plan.branch)+'&base=main&per_page=100');
 if(!Array.isArray(list)||list.length>1)
  throw Error('autonomous-repair-pr-inventory-ambiguous');
 return list[0]??null;
}
function eligiblePR(plan,headSha,pr){
 const marker='<!-- ultron-repair:'+plan.fingerprint+' -->';
 return pr?.state==='open'&&pr.draft===false&&
  Number.isSafeInteger(pr.number)&&pr.number>0&&
  pr.head?.ref===plan.branch&&pr.head?.sha===headSha&&
  pr.head?.repo?.full_name===REPO&&pr.base?.ref==='main'&&
  pr.base?.repo?.full_name===REPO&&pr.body?.startsWith(marker);
}
export function createAutonomousRepairGitHubAdapters({get,post,updateRef,
 readFailureTrace}={}){
 if(typeof get!=='function'||typeof post!=='function'||
    typeof updateRef!=='function')
  throw Error('autonomous-repair-trusted-GitHub-adapter-required');
 const patcher=Object.freeze({
  async apply({plan,manifest,expectedHeadSha}){
   if(await observeBranch(get,plan)!==expectedHeadSha)
    throw Error('autonomous-repair-head-drift');
   return applyPrPatch({pr:githubPR(plan,expectedHeadSha),
    manifest:JSON.stringify(manifest),get,post,updateRef});
  },
  async observe({plan,manifest,expectedHeadSha}){
   const newHead=await observeBranch(get,plan);
   if(newHead===expectedHeadSha)return null;
   const commit=await get(ROOT+'/git/commits/'+newHead);
   if(!Array.isArray(commit?.parents)||commit.parents.length!==1||
      commit.parents[0]?.sha!==expectedHeadSha||
      !SHA.test(commit.tree?.sha||''))return null;
   const diff=await get(ROOT+'/compare/'+expectedHeadSha+'...'+newHead);
   if(diff?.total_commits!==1||diff?.ahead_by!==1||diff?.behind_by!==0||
      !Array.isArray(diff.files)||diff.files.length!==manifest.changes.length)
    return null;
   const planned=[...manifest.changes.map(x=>x.path)].sort().join(',');
   if(diff.files.map(x=>x.filename).sort().join(',')!==planned)return null;
   for(const change of manifest.changes){
    if(!diff.files.some(x=>x.filename===change.path&&x.status==='modified'))
     return null;
    const before=content(await get(ROOT+'/contents/'+change.path+
     '?ref='+expectedHeadSha));
    const after=content(await get(ROOT+'/contents/'+change.path+'?ref='+newHead));
    const pos=before.indexOf(change.before);
    if(pos<0||before.indexOf(change.before,pos+change.before.length)>=0||
      before.slice(0,pos)+change.after+before.slice(pos+change.before.length)!==after)
     return null;
   }
   return {verified:true,baseSha:expectedHeadSha,headSha:newHead,
    patchDigest:hash(manifest)};
  }
 });
 const verifier=Object.freeze({
  async start({plan,headSha,attempt}){
   return dispatchAndObserveVerify({get,post,branch:plan.branch,headSha,
    correlation:repairCorrelation(plan,attempt),maxPolls:1,intervalMs:0});
  },
  async observe({plan,headSha,attempt}){
   const run=await observeVerifyRun({get,branch:plan.branch,headSha,
    correlation:repairCorrelation(plan,attempt)});
   if(run.state!=='completed')return {state:'pending',headSha};
   let trace='FAIL: exact-head core verification '+run.conclusion+
    ' run #'+run.runId;
   if(run.conclusion!=='success'&&typeof readFailureTrace==='function'){
    try{const text=await readFailureTrace(run);if(typeof text==='string')trace=text;}
    catch{/* No fabricated diagnostic; keep observed run conclusion. */}
   }
   return {state:'completed',verified:true,headSha:run.sha,
    runId:run.runId,conclusion:run.conclusion,errorTrace:trace};
  }
 });
 const publisher=Object.freeze({
  async start({plan,headSha}){
   if(await observeBranch(get,plan)!==headSha)
    throw Error('autonomous-repair-publication-head-drift');
   const existing=await existingPR(get,plan);
   if(existing){
    if(!eligiblePR(plan,headSha,existing))
     throw Error('autonomous-repair-preexisting-pr-untrusted');
    return;
   }
   const marker='<!-- ultron-repair:'+plan.fingerprint+' -->';
   await post(ROOT+'/pulls',{head:plan.branch,base:'main',draft:false,
    title:'repair: '+plan.objective.slice(0,90),
    body:marker+'\n\nObjective: '+plan.objective+
     '\n\nExact-head CI and owner grant required. No auto-merge or deployment.'});
  },
  async observe({plan,headSha}){
   const ref=await observeBranch(get,plan);
   if(ref!==headSha)return null;
   const pr=await existingPR(get,plan);
   if(!eligiblePR(plan,headSha,pr))return null;
   return {verified:true,branch:plan.branch,headSha,prNumber:pr.number};
  }
 });
 return Object.freeze({patcher,verifier,publisher});
}
