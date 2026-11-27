import {fileURLToPath} from 'node:url';
import {readRemediationCheck,selectCouncilRetry,councilRemediationIssue,sameRemediationHead} from '../src/council-hold-remediation.mjs';
import {classifyTrustedRisk} from '../src/council-trusted-gate.mjs';
const REPO='michaeljwilliams0123/Ultron.MW',APP=5765239;
const runUrl=/^https:\/\/github\.com\/michaeljwilliams0123\/Ultron\.MW\/actions\/runs\/([1-9][0-9]{0,15})$/;
const botId=41898282;
const sha=/^[a-f0-9]{40}$/;
const bound=(xs,n)=>Array.isArray(xs)&&xs.length<n;
function latestGate(inventory,pr){
 if(!Array.isArray(inventory?.check_runs)||inventory.total_count!==inventory.check_runs.length||inventory.total_count>=100)return null;
 const gates=inventory.check_runs.filter(c=>c.name==='ultron/council-7of7'&&c.app?.id===APP&&c.head_sha===pr.head.sha);
 return gates.sort((a,b)=>b.id-a.id)[0]||null;
}
export async function sweepCouncilHolds({gh,mode='report-only',now=Date.now(),limit=5,prNumber=null}={}){
 if(mode==='off')return [];
 const results=[];
 const prs=prNumber?[await gh.get('/pulls/'+prNumber)]:await gh.get('/pulls?state=open&base=main&per_page=100');
 if(!bound(prs,100))return [{status:'incomplete-pr-inventory'}];
 let writes=0;
 for(const p of prs.slice(0,30)){
  if(p?.state!=='open'||p.base?.ref!=='main'||p.base.repo?.id!==1424939667||p.head?.repo?.id!==1424939667||
   !sha.test(p.head.sha)||!sha.test(p.base.sha)||!Number.isSafeInteger(p.number)||p.number<1)continue;
  try{
   const path='/commits/'+p.head.sha+'/check-runs?filter=all&per_page=100';
   const inventory=await gh.get(path),check=latestGate(inventory,p);
   if(!check||check.status!=='completed'||check.conclusion!=='failure')continue;
   const plan=readRemediationCheck(check,p);
   if(!plan){
    const files=await gh.get('/pulls/'+p.number+'/files?per_page=100');
    const risk=classifyTrustedRisk({files,filesComplete:bound(files,100)&&files.length===p.changed_files});
    results.push({pr:p.number,status:'legacy-hold',ownerRequired:risk.security,reason:'new trusted remediation evidence required; no writes'});
    continue;
   }
   const entry={pr:p.number,route:plan.route,ownerRequired:plan.ownerRequired,status:'diagnosed',transientRoles:plan.transientRoles,dissentRoles:plan.dissentRoles,unavailableRoles:plan.unavailableRoles};
   results.push(entry);
   if(writes>=Math.min(5,Math.max(0,limit))||mode!=='act')continue;
   // Immediately re-read exact PR and gate before any action.
   async function current(){
    const [fresh,inv]=await Promise.all([gh.get('/pulls/'+p.number),gh.get(path)]);
    return fresh.state==='open'&&fresh.base?.ref==='main'&&fresh.base.repo?.id===1424939667&&fresh.head?.repo?.id===1424939667&&sameRemediationHead(p,fresh)&&latestGate(inv,fresh)?.id===check.id;
   }
   const match=runUrl.exec(check.details_url||'');
   if(['retry-model','collect-evidence'].includes(plan.route)&&match){
    const run=await gh.get('/actions/runs/'+match[1]);
    // A completed retry on this same head/base remains visible across independent wakeups.
    let priorRetry=false;
    for(const old of inventory.check_runs){
     if(old.id===check.id||!readRemediationCheck(old,p))continue;
     const oldMatch=runUrl.exec(old.details_url||'');
     if(!oldMatch||oldMatch[1]===match[1])continue;
     const prev=await gh.get('/actions/runs/'+oldMatch[1]);
     if(prev.run_attempt>=2)priorRetry=true;
    }
    const retry=selectCouncilRetry({pr:p,check,run,now,priorRetry});
    if(retry&&await current()){
     writes++; // Count admission even if response is lost. Never retry in this pass.
     await gh.post('/actions/runs/'+retry.runId+'/rerun',{});
     entry.status='recheck-dispatched';continue;
    }
    if(run.status!=='completed'||now-Date.parse(check.completed_at)<15*60000){entry.status='retry-not-due';continue;}
   }
   const issue=councilRemediationIssue(plan);
   if(!issue)continue;
   // Durable, exact-head marker in bot-owned issues. Complete bounded history or no write.
   let complete=false,existing=null;
   for(let page=1;page<=5;page++){
    const list=await gh.get('/issues?state=all&creator=github-actions%5Bbot%5D&sort=created&direction=desc&per_page=100&page='+page);
    if(!Array.isArray(list))break;
    existing=list.find(i=>!i.pull_request&&i.user?.id===botId&&String(i.body||'').includes(issue.marker))||existing;
    if(existing||list.length<100){complete=true;break;}
   }
   if(existing){entry.status='investigation-already-recorded';entry.issue=existing.number;continue;}
   if(!complete){entry.status='issue-inventory-incomplete';continue;}
   if(!await current()){entry.status='superseded';continue;}
   writes++;
   const created=await gh.post('/issues',{title:issue.title,body:issue.body});
   entry.status='investigation-opened';entry.issue=created.number;
  }catch{results.push({pr:p.number,status:'readback-or-action-unavailable'});}
 }
 return results;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 // CLI path is only for local/manual diagnostics; workflow imports the function.
 const number=Number(process.argv[2]||0);
 const {githubClient}=await import('./council-self-repair.mjs');
 const result=await sweepCouncilHolds({gh:githubClient(process.env.GITHUB_TOKEN),mode:'report-only',prNumber:number||null});
 console.log(JSON.stringify(result,null,2));
}
