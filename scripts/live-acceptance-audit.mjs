#!/usr/bin/env node
// Public, read-only, zero-credit observation. Never send credentials to a
// browser or cloud hostname. All private acceptance remains explicitly unknown.
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {evaluateAcceptance,parsePagesRevision,renderAcceptanceMarkdown} from '../src/live-acceptance-audit.mjs';
import {parseCloudStatus} from '../docs/core/cloud-status.mjs';

const REPO='michaeljwilliams0123/Ultron.MW';
const API='https://api.github.com/repos/'+REPO;
const PAGES='https://michaeljwilliams0123.github.io/Ultron.MW/';
const PRODUCTION='https://ultron-mw-cloud.hatchable.site';
const PAGES_ORIGIN=new URL(PAGES).origin;

async function request(url,{json=false,github=false,origin}={}){
 const headers={'user-agent':'ultron-live-acceptance/1.0',
  'accept':json?(github?'application/vnd.github+json':'application/json'):'text/html'};
 if(origin)headers.origin=origin;
 if(github&&process.env.GITHUB_TOKEN)headers.authorization='Bearer '+process.env.GITHUB_TOKEN;
 try {
  const response=await fetch(url,{redirect:'follow',headers,signal:AbortSignal.timeout(12000)});
  const body=await response.text();
  const meta={status:response.status,allowOrigin:response.headers.get('access-control-allow-origin')};
  if(body.length>450000)return {...meta,error:'response-over-limit'};
  if(!json)return {...meta,body};
  try{return {...meta,body:JSON.parse(body)};}
  catch{return {...meta,error:'invalid-json'};}
 } catch{return {status:null,error:'request-unavailable'};}
}
const observation=(id,status,detail)=>({id,status,detail});
const httpCheck=(id,response,expected)=>{
 const status=response.status;
 return observation(id,status===null?'unknown':expected.includes(status)?'pass':'fail',
  status===null?'HTTP unavailable':('HTTP '+status+'; expected '+expected.join('/')));
};

export async function collectLiveChecks(){
 const checks=[];
 // Read the canonical main SHA, not a self-reported deployment or the runner's
 // event SHA, which may be a pull-request synthetic commit.
 const head=await request(API+'/commits/main',{json:true,github:true});
 const sourceSha=head.status===200&&/^[0-9a-f]{40}$/.test(head.body?.sha||'')?head.body.sha:null;
 checks.push(observation('github-main',sourceSha?'pass':'unknown',
  sourceSha?'Current GitHub main SHA '+sourceSha.slice(0,12):'Main SHA unavailable'));
 const runs=await request(API+'/actions/workflows/verify.yml/runs?branch=main&event=push&per_page=30',{json:true,github:true});
 const verify=sourceSha&&Array.isArray(runs.body?.workflow_runs)?
  runs.body.workflow_runs.find(r=>r.head_sha===sourceSha&&r.event==='push'):null;
 checks.push(observation('github-verify',!sourceSha||runs.status!==200?'unknown':
  !verify?'unknown':verify.status!=='completed'?'unknown':
  verify.conclusion==='success'?'pass':'fail',
  !verify?'Exact-main push Verify not present in returned window':
  'Exact-main run '+verify.id+' '+verify.status+'/'+verify.conclusion));
 const [page,module,production,admin,tick,cloud,foreignCloud]=await Promise.all([
  request(PAGES),request(PAGES+'app.js'),request(PRODUCTION+'/'),
  request(PRODUCTION+'/api/brain/control'),request(PRODUCTION+'/api/brain/tick'),
  request(PRODUCTION+'/api/brain/status-public',{json:true,origin:PAGES_ORIGIN}),
  request(PRODUCTION+'/api/brain/status-public',{json:true,origin:'https://ultron-audit.invalid'})
 ]);
 checks.push(httpCheck('pages-http',page,[200]));
 const deployed=parsePagesRevision(page.body);
 checks.push(observation('pages-revision',!sourceSha||page.status!==200?'unknown':
  !deployed?'fail':deployed===sourceSha?'pass':'unknown',
  deployed?'Pages SHA '+deployed.slice(0,12)+(sourceSha?' / main '+sourceSha.slice(0,12):''):
  'No resolved ulton-source-sha meta marker'));
 checks.push(httpCheck('pages-module',module,[200]));
 checks.push(httpCheck('production-http',production,[200]));
 checks.push(httpCheck('production-admin-gate',admin,[401,403]));
 checks.push(httpCheck('production-scheduler-gate',tick,[404]));
 let cloudState=null;
 if(cloud.status===200&&!cloud.error){
  try{cloudState=parseCloudStatus(cloud.body);}catch{/* Invalid status is an observed failure. */}
 }
 checks.push(observation('production-cloud-status',cloud.status===null?'unknown':
  cloudState?'pass':'fail',cloudState?'Validated public cloud status: '+cloudState.status:
  cloud.status===null?'Cloud status unavailable':'Cloud status HTTP/schema invalid'));
 checks.push(observation('production-cloud-cors',cloud.status===null?'unknown':
  cloud.status===200&&cloud.allowOrigin===PAGES_ORIGIN?'pass':'fail',
  cloud.status===null?'Cloud status unavailable':'Canonical Pages origin must be allowed exactly'));
 checks.push(observation('production-cloud-foreign-origin',foreignCloud.status===null?'unknown':
  foreignCloud.status===200&&foreignCloud.allowOrigin===null?'pass':'fail',
  foreignCloud.status===null?'Foreign-origin probe unavailable':'Foreign origin must receive no allow-origin header'));
 return {sourceSha,checks,observedAt:new Date().toISOString()};
}

const runningAsScript=process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href;
if(runningAsScript){
 const input=await collectLiveChecks();
 const report=evaluateAcceptance(input);
 const markdown=renderAcceptanceMarkdown(report);
 const dir=process.env.ULTRON_AUDIT_DIR||'artifacts/live-acceptance';
 await mkdir(dir,{recursive:true});
 await Promise.all([
  writeFile(join(dir,'report.json'),JSON.stringify(report,null,2)+'\n'),
  writeFile(join(dir,'report.md'),markdown)
 ]);
 if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,markdown);
 console.log('Ultron live acceptance: '+report.publicReadiness+
  '; production '+report.productionReadiness+
  '; pass='+report.counts.passed+' fail='+report.counts.failed+
  ' unknown='+report.counts.unknown);
 // Unexpected public failures are actionable; incomplete private acceptance
 // is never automatically turned into a pass or an outage.
 if(report.publicReadiness==='degraded')process.exitCode=1;
}
