import {
 buildCouncilAssessmentReceipts,evaluateCouncilEvidence
} from 'lib/council-evidence.js';

const REPO = 'https://api.github.com/repos/michaeljwilliams0123/Ultron.MW';
const SITE = 'https://michaeljwilliams0123.github.io/Ultron.MW/';
const SHA = /^[0-9a-f]{40}$/;
const HEADERS = {Accept:'application/vnd.github+json','User-Agent':'UltronMW-Cloud-Brain'};
export const CAPABILITIES = [
 {id:'repo.inspect',kind:'github-native',effect:'read',description:'Verify the canonical GitHub main commit'},
 {id:'repo.prs',kind:'github-native',effect:'read',description:'Observe up to twelve open pull requests'},
 {id:'repo.ci',kind:'github-native',effect:'read',description:'Observe up to twelve recent Actions runs'},
 {id:'site.render',kind:'browser-native',effect:'read',description:'Render public GitHub Pages with managed Chromium'},
 {id:'council.review',kind:'brain-native',effect:'advisory',description:'Review recent verified receipts and propose next inspection'}
];
export const ALLOWED = new Set(CAPABILITIES.map(x=>x.id));
async function github(path){
 const response = await fetch(REPO+path,{headers:HEADERS,signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('github-status-'+response.status);
 return response.json();
}
function safeString(v,max=150){return String(v??'').slice(0,max);}
export async function executeObjective(objective, {db,browser,task={}}){
 const at=new Date().toISOString();
 if(objective==='repo.inspect'){
  const p=await github('/git/ref/heads/main');
  if(!SHA.test(p?.object?.sha||''))throw Error('invalid-main-ref');
  return {objective,at,source:'github-api',repository:'michaeljwilliams0123/Ultron.MW',sha:p.object.sha};
 }
 if(objective==='repo.prs'){
  const rows=await github('/pulls?state=open&per_page=12&sort=updated&direction=desc');
  if(!Array.isArray(rows))throw Error('invalid-pr-response');
  return {objective,at,source:'github-api',count:rows.length,partial:rows.length===12,prs:rows.map(p=>({number:p.number,title:safeString(p.title),draft:!!p.draft,updated_at:p.updated_at,url:p.html_url,head:safeString(p.head?.sha,40)}))};
 }
 if(objective==='repo.ci'){
  const data=await github('/actions/runs?per_page=12');
  if(!Array.isArray(data.workflow_runs))throw Error('invalid-runs-response');
  return {objective,at,source:'github-api',count:data.workflow_runs.length,runs:data.workflow_runs.map(r=>({id:r.id,name:safeString(r.name,90),status:r.status,conclusion:r.conclusion,head_sha:safeString(r.head_sha,40),url:r.html_url,event:r.event,created_at:r.created_at}))};
 }
 if(objective==='site.render'){
  const html=await browser.html(SITE);
  if(typeof html!=='string' || !html.length)throw Error('empty-rendered-page');
  const title=(html.match(/<title[^>]*>([^<]*)<\/title>/i)||[])[1]||'';
  const rendered=html.toLowerCase();
  return {objective,at,source:'hatchable-chromium',url:SITE,title:safeString(title),html_bytes:html.length,has_app_shell:rendered.includes('<body'),has_ultron:rendered.includes('ultron')};
 }
 if(objective==='council.review'){
  const recent=(await db.query(`SELECT t.id,t.task_key,t.objective,t.status,t.last_result,t.updated_at,
   (SELECT e.id FROM brain_events e WHERE e.task_id=t.id AND e.event_type='observed'
    ORDER BY e.id DESC LIMIT 1) AS receipt_id
   FROM brain_tasks t WHERE t.status='done' AND t.objective <> 'council.review'
   ORDER BY t.updated_at DESC LIMIT 16`)).rows;
  const identityRows=(await db.query(`SELECT id,details,created_at FROM brain_events
   WHERE event_type='independent-reviewer-attested' ORDER BY id DESC LIMIT 16`)).rows;
  const find=(type)=>recent.find(x=>x.objective===type)?.last_result;
  const latestCi=find('repo.ci'),latestPrs=find('repo.prs'),latestSite=find('site.render'),latestMain=find('repo.inspect');
  const failed=(latestCi?.runs||[]).filter(r=>r.conclusion==='failure');
  const advisory={
   verifier:{assessment:latestMain?'main-observed':'main-evidence-missing',next:latestMain?'repo.ci':'repo.inspect'},
   sentinel:{assessment:failed.length?'recent-failing-runs':'no-observed-failing-runs-or-evidence-incomplete',count:failed.length,next:'repo.ci'},
   planner:{assessment:latestPrs?'pr-inventory-observed':'pr-inventory-missing',count:latestPrs?.count??null,next:'repo.prs'},
   skeptic:{assessment:latestSite?.has_app_shell?'site-render-observed':'site-render-unverified',next:'site.render'}
  };
  const sourceSha=SHA.test(latestMain?.sha||'')?latestMain.sha:null;
  const objectiveId=typeof task.taskKey==='string'&&task.taskKey?task.taskKey:'council-review-unbound';
  const observations=recent.map(row=>({
   taskId:row.id,receiptId:row.receipt_id,objective:row.objective,
   result:row.last_result,observedAt:new Date(row.updated_at).toISOString()
  }));
  const assessmentReceipts=sourceSha?buildCouncilAssessmentReceipts({
   objectiveId,sourceSha,observations,assessedAt:at
  }):[];
  const identityAttestations=identityRows.map(row=>({
   eventId:row.id,eventType:'independent-reviewer-attested',
   objectiveId:row.details?.objectiveId,sourceSha:row.details?.sourceSha,
   reviewerId:row.details?.reviewerId,identitySource:row.details?.identitySource,
   observedAt:new Date(row.created_at).toISOString(),verified:row.details?.verified,
   verifiedBy:row.details?.verifiedBy
  }));
  const promotionGate=evaluateCouncilEvidence({
   objectiveId,sourceSha,receipts:assessmentReceipts,now:at,
   lease:{state:'active',tokenMatches:true},provider:{required:false},
   identityAttestations
  });
  return {objective,at,source:'local-evidence-only',source_sha:sourceSha,
   evidence_count:recent.length,advisory,assessment_receipts:assessmentReceipts,
   promotion_gate:promotionGate,
   disposition:'proposals-only-no-write-or-model-inference'};
 }
 throw Error('objective-not-allowed');
}
