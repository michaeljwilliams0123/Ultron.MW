/**
 * Static, bounded AST taint evidence from GitHub exact-head code snapshots.
 * The existing AST analyzer parses source without executing it. Return ONLY
 * constrained finding metadata: no source, tokens, AST objects or log bodies.
 */
import {analyzePayloadAST} from './security/ast_taint_analyzer.mjs';
const SHA=/^[a-f0-9]{40}$/;
const allowedPath=p=>typeof p==='string'&&p.length<=220&&
 /^(?:src|scripts|lib|api|cloud\/hatchable|test)\/[a-zA-Z0-9_.\/-]+\.(?:mjs|js|cjs|ts|tsx|jsx)$/.test(p)&&
 !p.split('/').some(x=>x==='..'||x==='.'||x==='');
const trimText=s=>typeof s==='string'&&/^[a-zA-Z0-9_.:-]{1,80}$/.test(s)?s:'unidentified';
const LANG='ultron.council-taint-evidence.v1';
export function scanCouncilChangedFiles({sourceSha,prNumber,sources,maxFiles=6}={}){
 if(!SHA.test(sourceSha||'')||!Number.isSafeInteger(prNumber)||prNumber<1||
   !Array.isArray(sources)||sources.length>100)throw Error('taint-input-invalid');
 const limit=Number.isSafeInteger(maxFiles)&&maxFiles>0&&maxFiles<=12?maxFiles:6;
 const accepted=sources.filter(x=>allowedPath(x?.filename)).slice(0,limit);
 const reports=accepted.map(item=>{
  const file=item.filename;
  if(typeof item.source!=='string'||Buffer.byteLength(item.source)>64000)
   return{file,status:'source-unavailable',findings:[],unknownCount:0};
  const raw=analyzePayloadAST(item.source);
  const status=['findings','unknown','no-known-flow','parse-error'].includes(raw.status)?
   raw.status:'parse-error';
  return{file,status,
   findings:(raw.flows||[]).slice(0,5).map(x=>({
    sink:trimText(x.sink),
    line:Number.isSafeInteger(x.line)&&x.line>0?x.line:null,
    kind:['taint-flow','unconditional-sink'].includes(x.kind)?x.kind:'unknown'
   })),
   unknownCount:Math.min(100,Array.isArray(raw.unknowns)?raw.unknowns.length:0)
  };
 });
 return Object.freeze({schema:LANG,sourceSha,prNumber,
  candidateFiles:sources.length,scannedFiles:reports.filter(x=>x.status!=='source-unavailable').length,
  complete:sources.filter(x=>allowedPath(x?.filename)).length===reports.length&&
   reports.every(x=>x.status!=='source-unavailable'&&x.status!=='parse-error'),
  reports:Object.freeze(reports)});
}
export function formatCouncilTaintEvidence(e){
 if(e?.schema!==LANG||!SHA.test(e.sourceSha||'')||!Array.isArray(e.reports))
  return 'AST taint evidence unavailable (not a security clearance).';
 const lines=['Trusted-source SHA '+e.sourceSha+
  '; bounded single-file AST taint scan, not a release clearance.',
  'Analyzed '+e.scannedFiles+'/'+e.candidateFiles+' candidate file(s), coverage '+(e.complete?'complete':'partial')];
 for(const r of e.reports.slice(0,8)){
  lines.push(r.file+': '+r.status+'; unknowns='+r.unknownCount);
  for(const f of r.findings.slice(0,5))
   lines.push('  sink '+f.sink+' at line '+f.line+' ['+f.kind+']');
 }
 return lines.join('\n').slice(0,1400);
}
