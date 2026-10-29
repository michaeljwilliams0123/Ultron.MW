#!/usr/bin/env node
// Public, read-only, zero-credit observation. Never send credentials to a
// browser or cloud hostname. All private acceptance remains explicitly unknown.
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {evaluateAcceptance,parsePagesRevision,renderAcceptanceMarkdown} from '../src/live-acceptance-audit.mjs';

const REPO='michaeljwilliams0123/Ultron.MW';
const API='https://api.github.com/repos/'+REPO;
const PAGES='https://michaeljwilliams0123.github.io/Ultron.MW/';
const PRODUCTION='https://ultron-mw-cloud.hatchable.site';

async function request(url,{json=false,github=false}={}){
 const headers={'user-agent':'ultron-live-acceptance/1.0','accept':json?'application/vnd.github+json':'text/html'};
 if(github&&process.env.GITHUB_TOKEN)headers.authorization='Bearer '+process.env.GITHUB_TOKEN;
 try {
  const response=await fetch(url,{redirect:'follow',headers,signal:AbortSignal.timeout(12000)});
  const body=await response.text();
  if(body.length>450000)return {status:response.status,error:'response-over-limit'};
  if(!json)return {status:response.status,body};
  try{return {status:response.status,body:JSON.parse(body)};}
  catch{return {status:response.status,error:'invalid-json'};}
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
 const [page,module,production,admin,tick]=await Promise.all([
  request(PAGES),request(PAGES+'app.js'),request(PRODUCTION+'/'),
  request(PRODUCTION+'/api/brain/control'),request(PRODUCTION+'/api/brain/tick')
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
