#!/usr/bin/env node
/** Shadow replay for the consolidated lanes. Read-only by construction: it
 * only issues GET requests. It (1) re-checks static parity against the
 * real workflow files and (2) replays recent legacy runs through the lane
 * rules to show what each lane would have reported. Legacy workflows keep
 * every side effect in phase 1.
 *
 *   node scripts/workflow-shadow.mjs --lane comment-router --days 7
 *   node scripts/workflow-shadow.mjs --lane all            (static only without a token)
 */
import {readFileSync,readdirSync,appendFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {checkParity,LANES,legacyByLane} from '../src/workflow-consolidation.mjs';
import {classifyLegacyFailure} from '../src/workflow-lane-rules.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const arg=(name,fallback)=>{const i=process.argv.indexOf('--'+name);return i>0?process.argv[i+1]:fallback;};
const API='https://api.github.com/repos/';

export function staticParity(){
  return checkParity({
    readFile:path=>readFileSync(root+path,'utf8'),
    listWorkflows:()=>readdirSync(root+'.github/workflows').filter(n=>/\.ya?ml$/.test(n)),
    listStaged:()=>{try{return readdirSync(root+'.github/workflow-lanes').filter(n=>/\.ya?ml$/.test(n));}catch{return [];}},
  });
}

async function getJson(path,token,{text=false}={}){
  const response=await fetch(path.startsWith('http')?path:API+path,{headers:{
    authorization:'Bearer '+token,accept:'application/vnd.github+json',
    'x-github-api-version':'2022-11-28'}});
  if(!response.ok)throw Error('GET '+response.status);
  return text?response.text():response.json();
}

/** Replays one lane. `get(path,{text})` is injectable for tests. */
export async function replayLane(lane,{get,repo,since,maxRuns=300,maxLogs=60}={}){
  const rows=[];let logs=0;
  for(const legacy of legacyByLane(lane)){
    const counts={success:0,failure:0,startup_failure:0,skipped:0,cancelled:0,other:0};
    const projected={red:0,skipped:0,neutral:0,rerun:0};
    const examples=[];
    let runs=[];
    for(let page=1;page<=Math.ceil(maxRuns/100);page++){
      const data=await get(repo+'/actions/workflows/'+legacy.file+'/runs?per_page=100&page='+page+
        '&created=%3E%3D'+since);
      runs=runs.concat(data.workflow_runs||[]);
      if((data.workflow_runs||[]).length<100)break;
    }
    for(const run of runs){
      const c=run.conclusion;
      if(c in counts)counts[c]++;else counts.other++;
      if(c!=='failure'&&c!=='startup_failure')continue;
      let jobCount,log='';
      try{
        const jobs=await get(repo+'/actions/runs/'+run.id+'/jobs?filter=latest&per_page=100');
        jobCount=jobs.total_count;
        const failed=(jobs.jobs||[]).find(j=>j.conclusion==='failure');
        if(failed&&logs<maxLogs){logs++;log=String(await get(repo+'/actions/jobs/'+failed.id+'/logs',{text:true})).slice(-6000);}
      }catch{/* unreadable run: classify on what we have */}
      const verdict=classifyLegacyFailure({workflow:legacy.file,log,jobCount});
      projected[verdict.projected]++;
      if(examples.length<5&&verdict.projected!=='red')
        examples.push({run:run.html_url,projected:verdict.projected,reason:verdict.reason});
    }
    rows.push({workflow:legacy.file,disposition:legacy.disposition,runs:runs.length,counts,projected,examples});
  }
  const legacyRed=rows.reduce((n,r)=>n+r.counts.failure+r.counts.startup_failure,0);
  const laneRed=rows.reduce((n,r)=>n+r.projected.red,0);
  return {lane,owner:LANES[lane].owner,rows,legacyRed,laneRed};
}

export function renderSummary(parity,results){
  const out=['## Consolidated workflow lanes (shadow, report-only)','',
    'Static parity: **'+(parity.ok?'OK':'DRIFT')+'**, '+parity.legacyCount+' legacy workflows -> '+
    parity.laneCount+' lanes, '+parity.mapped.length+' jobs mapped.',''];
  for(const p of parity.problems)out.push('- drift: '+p);
  for(const r of results){
    out.push('','### '+r.lane+' (owner: '+r.owner+')','',
      'Legacy red runs: **'+r.legacyRed+'**; lane would report red: **'+r.laneRed+'**','',
      '| legacy workflow | disposition | runs | success | failure | skipped | lane red | lane skip | lane neutral | rerun |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for(const row of r.rows)out.push('| `'+row.workflow+'` | '+row.disposition+' | '+row.runs+' | '+
      row.counts.success+' | '+(row.counts.failure+row.counts.startup_failure)+' | '+row.counts.skipped+' | '+row.projected.red+' | '+
      row.projected.skipped+' | '+row.projected.neutral+' | '+row.projected.rerun+' |');
    for(const row of r.rows)for(const e of row.examples)out.push('- '+e.projected+': '+e.run+' ('+e.reason+')');
  }
  out.push('','Shadow mode: no comment, label, dispatch, rerun or branch write was made.');
  return out.join('\n')+'\n';
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const parity=staticParity();
  const laneArg=arg('lane','all');
  const lanes=laneArg==='all'?Object.keys(LANES):[laneArg];
  if(!lanes.every(l=>LANES[l])){console.error('unknown lane '+laneArg);process.exit(2);}
  const token=process.env.GITHUB_TOKEN;
  const repo=process.env.GITHUB_REPOSITORY||'michaeljwilliams0123/Ultron.MW';
  const days=Math.min(30,Math.max(1,Number(arg('days','7'))||7));
  const since=new Date(Date.now()-days*86400000).toISOString().slice(0,10);
  const results=[];
  // Local operators may replay through an authenticated `gh` CLI instead.
  const viaGh=!token&&process.argv.includes('--gh');
  const ghGet=async path=>{
    const out=execFileSync('gh',['api','--allow-escape-sequences','--method','GET',path.replace(API,'repos/')],
      {encoding:'utf8',maxBuffer:64*1024*1024});
    try{return JSON.parse(out);}catch{return out;}
  };
  if(token||viaGh){
    for(const lane of lanes){
      try{results.push(await replayLane(lane,{repo:viaGh?'repos/'+repo:repo,since,
        get:viaGh?ghGet:(p,o)=>getJson(p,token,o)}));}
      catch(e){console.log('replay unavailable for '+lane+': '+e.message);}
    }
  }
  const summary=renderSummary(parity,results);
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
  console.log(summary);
  // Only real drift is red; "nothing to do" and replay gaps are neutral.
  if(!parity.ok)process.exitCode=1;
}
